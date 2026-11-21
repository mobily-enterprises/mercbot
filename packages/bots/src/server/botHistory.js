import { toModelHistory } from "./botAgent.js";
import { toHistoryMessage } from "./botRows.js";

const ROUTINE_RUNS_READ = 3;
const RECENT_MESSAGES_READ = 6;

/**
 * What a bot reads before replying in a chat (D-48, R5): the chat's messages after its latest summary, each under its
 * author's name, the summaries kept between turns, and the saved runs that keep one reply per bot in a chat at a time.
 * Every read a turn makes takes the model's reader (records.readers.forBot) as its options. A chat's summary is the
 * chat's, read by each of its bots: the summary worker names only the chat, so its hooks read that one chat in its home.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context factory
 * @param {import("./types.js").ChatModel} dependencies.model
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {(input: { previous: string, text: string }) => Promise<string>} [dependencies.summarize] replaces the summary's model call
 * @param {import("./types.js").SummaryLimits} [dependencies.compactionLimits] replaces the summary limits
 * @param {(work: Promise<unknown>) => void} dependencies.background runs work that outlives the request (backgroundWork.js)
 */
export function createBotHistory({ records, systemContext, model, meter, notices, summarize, compactionLimits, background }) {
  const { messages, chats, directory } = records;

  /** Messages as the bots read them, each with its author's name: one read of the people's, one of the home's bots'. */
  async function named(rows, options) {
    const list = rows.map(toHistoryMessage);
    const people = await chats.names(list.map((message) => message.authorUserId), options);
    const bots = list.some((message) => message.authorBotId)
      ? new Map((await directory.listHomeBots(options)).map((bot) => [bot.id, bot.name]))
      : new Map();
    return list.map((message) => {
      const authorName = message.authorUserId
        ? people.get(message.authorUserId)
        : message.authorBotId ? bots.get(message.authorBotId) : null;
      return authorName ? { ...message, authorName } : message;
    });
  }

  /** The chat after its latest summary, as a turn reads it; summarised first if it has outgrown a reply (D-48). */
  async function chatHistory(seat, reader) {
    await compaction.ensureWithin(seat.chat_id);
    const { summary, after } = await compaction.current(seat.chat_id);
    return { summary, history: await named(await messages.messagesAfter(seat.chat_id, after, reader), reader) };
  }

  // What a routine run reads (D-57): its own last few runs, not the whole chat. Its instructions come
  // with its prompt. Reading weeks of chat for each run is what made a headline check expensive.
  async function routineHistory(seat, routineId, reader) {
    const runs = await messages.routineRuns(seat.chat_id, routineId, ROUTINE_RUNS_READ, reader);
    return { summary: "", history: await named(runs.reverse(), reader) };
  }

  // What a finished command's follow-up reads (D-60): the chat's last few messages, in words only. They
  // hold what the person wanted done with the result, without weeks of chat and every old tool call.
  async function recentHistory(seat, reader) {
    const recent = await named((await messages.recentText(seat.chat_id, RECENT_MESSAGES_READ, reader)).reverse(), reader);
    return { summary: "", history: recent.map((message) => ({ ...message, body: { text: message.body.text } })) };
  }

  // One reply per bot in a chat at a time, its steps saved as it goes (D-48, @jskit-ai/agent-runtime runs): the
  // runtime's conversation is the bot's seat in the chat (chat_bots.id), and the run knows its bot and its person.
  const runs = records.agent.createRuns();
  const claimReply = (seat) => runs.claim(seat.chat_bot_id, { bot_id: seat.id, user_id: seat.user_id });

  const SUMMARY_REASON = "a chat's summary is made from that chat's own messages, in its home";
  /**
   * The chat a summary is for, in its home: found through one of its bots (a chat with no bot left makes no model call,
   * so it has nothing to summarise). Read with the bots' system context in that home, for this one chat only: what
   * every bot of the chat may read there (D12's readable_from always holds the chat itself).
   */
  async function summarised(chatId) {
    const across = { context: systemContext(SUMMARY_REASON) };
    const seats = await directory.botsInChat(String(chatId), across);
    const place = seats.length ? await directory.computerOf(seats[0].id, across) : null;
    if (!place) return null;
    // A chat's only bot reads the summary alone, so it keeps what that bot did with its tools; with several, each reads
    // the others' words and records only (R5), so the summary holds no bot's tool calls.
    const reader = seats.length === 1 ? place.botId : null;
    return { place, reader, options: { context: systemContext(SUMMARY_REASON).forWorkspace(place.workspaceId) } };
  }

  // Summaries between turns (@jskit-ai/agent-runtime), one per chat: every message under its author's name, as the
  // chat's bots read it (summarised's reader).
  const compaction = records.agent.createSummaries({
    notices,
    model,
    app: "Mercbot",
    summarize,
    limits: compactionLimits,
    async history(chatId, { after }) {
      const found = await summarised(chatId);
      const list = found ? await named(await messages.messagesAfter(String(chatId), after, found.options), found.options) : [];
      return { messages: list, inherited: [], named: true, toModel: async (given) => toModelHistory(given, { botId: found?.reader ?? null }) };
    },
    // Metered to the chat's home and one of its bots, with no person: nobody asked for it and nobody waits on it (R8, D-59).
    async track(chatId, work) {
      const found = await summarised(chatId);
      return meter.track({ userId: null, botId: found?.place.botId ?? null, workspaceId: found?.place.workspaceId ?? null, work: "background" }, work);
    }
  });
  // Background work, so a drain or a server shutting down waits for the check as for the reply that started it.
  const compactLater = (chatId) =>
    background(compaction.consider(chatId).catch((error) => console.error(`Compaction check failed: ${error?.message || error}`)));

  return Object.freeze({
    named,
    chatHistory,
    routineHistory,
    recentHistory,
    runs,
    claimReply,
    compaction,
    compactLater
  });
}
