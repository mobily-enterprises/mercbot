import { toGroupHistory, toModelHistory } from "./botAgent.js";
import { toHistoryMessage } from "./botRows.js";

const ROUTINE_RUNS_READ = 3;
const RECENT_MESSAGES_READ = 6;

/**
 * What a bot reads before replying (D-48): a conversation's messages after its latest summary, the summaries kept between
 * turns, and the saved runs that keep one reply per conversation at a time. Reads take the call's options last; the
 * summaries' own hooks, which name only a conversation, read it in its home (records.conversations.summaryOf).
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").ChatModel} dependencies.model
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {(input: { previous: string, text: string }) => Promise<string>} [dependencies.summarize] replaces the summary's model call
 * @param {import("./types.js").SummaryLimits} [dependencies.compactionLimits] replaces the summary limits
 * @param {(work: Promise<unknown>) => void} dependencies.background runs work that outlives the request (backgroundWork.js)
 */
export function createBotHistory({ records, model, meter, notices, conversations, summarize, compactionLimits, background }) {
  const { conversations: store, messages } = records;
  // What the bot reads before replying: the conversation's latest summary (@jskit-ai/agent-runtime summaries)
  // and every message after it, replies with their transcripts. A room that continues another knows
  // that room's messages up to the moment it began, and so on back (D-36), until its own first
  // summary takes them in; in a room each person's words carry their name.
  const INHERITED_LIMIT = 60;
  const historyRows = async (conversationId, after, options) =>
    (await messages.messagesAfter(conversationId, after, options)).map(toHistoryMessage);
  async function inheritedHistory(room, options) {
    const inherited = [];
    for (let current = room; current?.parent_id && current.forked_at_message_id && inherited.length < INHERITED_LIMIT;) {
      const left = INHERITED_LIMIT - inherited.length;
      const earlier = await messages.messagesUpTo(current.parent_id, current.forked_at_message_id, left, options);
      inherited.unshift(...earlier.reverse().map(toHistoryMessage));
      current = await store.conversationRow(current.parent_id, options);
    }
    return inherited;
  }
  const withNames = (list) =>
    list.map((message) =>
      message.role === "user" && message.body.from
        ? { ...message, body: { ...message.body, text: `${message.body.from.name}: ${message.body.text}` } }
        : message);

  async function conversationHistory(row, options) {
    // Summarised first if it has outgrown what a reply reads, never cut unseen (D-48).
    await compaction.ensureWithin(row.conversation_id);
    const { summary, after } = await compaction.current(row.conversation_id);
    const inherited = row.room && !after ? await inheritedHistory(row.room, options) : [];
    const history = [...inherited, ...await historyRows(row.conversation_id, after, options)];
    return { summary, history: row.room ? withNames(history) : history };
  }

  // What a routine run reads (D-57): its own last few runs, not the whole chat. Its instructions come
  // with its prompt. Reading weeks of chat for each run is what made a headline check expensive.
  async function routineHistory(row, routineId, options) {
    const runs = await messages.routineRuns(row.conversation_id, routineId, ROUTINE_RUNS_READ, options);
    return { summary: "", history: runs.reverse().map(toHistoryMessage) };
  }

  // What a finished command's follow-up reads (D-60): the chat's last few messages, in words only. They
  // hold what the person wanted done with the result, without weeks of chat and every old tool call.
  async function recentHistory(row, options) {
    const recent = await messages.recentText(row.conversation_id, RECENT_MESSAGES_READ, options);
    const list = recent.reverse().map(toHistoryMessage);
    const named = row.room ? withNames(list) : list;
    return { summary: "", history: named.map((message) => ({ ...message, body: { text: message.body.text } })) };
  }

  // One reply per conversation at a time, its steps saved as it goes (D-48, @jskit-ai/agent-runtime runs).
  const runs = records.agent.createRuns();
  const claimReply = (row) => runs.claim(row.conversation_id, { bot_id: row.id });

  // Summaries between turns (@jskit-ai/agent-runtime), read the way each bot reads its conversation: a group's
  // messages as said by the person or a named bot, a room's with each person's name. The summary worker names
  // only the conversation, so each hook reads it, and then the rest, in that conversation's home.
  const compaction = records.agent.createSummaries({
    notices,
    model,
    app: "Mercbot",
    summarize,
    limits: compactionLimits,
    async history(conversationId, { after }) {
      const { conversation, options } = await store.summaryOf(conversationId);
      const bot = await store.botOf(conversation.bot_id, options);
      const list = await historyRows(conversationId, after, options);
      if (bot.kind === "group") {
        const members = (await conversations.membersOf([bot.id], options)).get(String(bot.id)) || [];
        const owner = (await store.profilesOf([bot.user_id], options)).get(String(bot.user_id));
        return {
          messages: list,
          inherited: [],
          named: true,
          toModel: async (given) => toGroupHistory(given, { bot: { id: "" }, members, person: owner?.displayName || "The person" })
        };
      }
      const room = conversation.user_id ? null : conversation;
      return {
        messages: list,
        inherited: room && !after ? await inheritedHistory(room, options) : [],
        named: Boolean(room),
        toModel: async (given) => toModelHistory(room ? withNames(given) : given)
      };
    },
    // Metered to the conversation's person (a room's: the bot's owner) and its bot; nobody is waiting on it (D-59).
    async track(conversationId, work) {
      const { conversation, options } = await store.summaryOf(conversationId);
      const bot = await store.botOf(conversation.bot_id, options);
      return meter.track({ userId: conversation.user_id ?? bot.user_id, botId: conversation.bot_id, work: "background" }, work);
    }
  });
  // Background work, so a drain or a server shutting down waits for the check as for the reply that started it.
  const compactLater = (conversationId) =>
    background(compaction.consider(conversationId).catch((error) => console.error(`Compaction check failed: ${error?.message || error}`)));

  return Object.freeze({
    historyRows,
    conversationHistory,
    routineHistory,
    recentHistory,
    runs,
    claimReply,
    compaction,
    compactLater
  });
}
