import { generateOnce } from "@jskit-ai/agent/server";
import { templateChipOf } from "./botTemplate.js";
import { escape, mentionsIn, plainMentions } from "./mentions.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { GENERAL } from "./templates.js";

// A Shared bot decides when to join in (D-102). In its shared tabs, in a home of two or more people, people talk to each
// other as much as to the bot, so a person's message that doesn't call the bot goes through one judging call, and the
// bot answers only when the judge says it makes sense; with the home's setting off, it answers only when called. A
// message that names the bot, @-mentions it or replies to one of its messages calls it, and so does the first person
// message in a new tab; a card's answer is always answered (the page says so, `afterCard`). You only, a home of one,
// Private and Mixed bots and group chats (D-46) never judge. A "no" leaves nothing visible: no working line, no message,
// and the message is marked `judged: "quiet"`, so nothing takes it up again.

/** How many of a tab's latest text messages the judge reads, and how many characters of each. */
export const JUDGED_MESSAGES = 12;
export const JUDGED_CHARACTERS = 400;
// The judge answers {"reply": true} or {"reply": false}: a few tokens, with room for a code fence around it.
const JUDGE_OUTPUT_TOKENS = 24;

/**
 * The judge's instructions: fixed for a bot, so the provider caches them.
 * @param {string} botName
 * @param {string} job what the bot is for: its template's description
 */
export function judgingInstructions(botName, job) {
  return [
    `You decide whether ${botName}, a bot in a shared conversation, should answer the latest message. Several people talk ` +
      `here, to each other and sometimes to ${botName}. ${botName}'s job: ${job}`,
    "Answer with one JSON object and nothing else: {\"reply\": true} or {\"reply\": false}.",
    `Answer true when the latest message asks ${botName} something, asks for something its job covers, asks everyone a ` +
      `question ${botName} can usefully answer, or carries on a conversation the person is having with ${botName}.`,
    "Answer false when people are talking to each other, chatting, thanking, agreeing or saying goodbye, or when an answer " +
      "would interrupt. When unsure, answer false."
  ].join("\n");
}

/**
 * What the judge reads: the tab's latest text messages, oldest first, the one decided on last, each on one line named
 * by its speaker and clipped to JUDGED_CHARACTERS.
 * @param {{ id: string, name: string }} bot
 * @param {Array<{ role: string, body: { text?: string, from?: { name?: string }, mentions?: object[] } }>} messages oldest
 *   first; the bots a message mentions are named as it keeps them
 */
export function judgedConversation(bot, messages) {
  const lines = messages.slice(-JUDGED_MESSAGES).map((message) => {
    const speaker = message.role === "bot" ? bot.name : message.body.from?.name || "Someone";
    const named = [bot, ...(message.body.mentions || [])];
    const text = plainMentions(message.body.text, named).replace(/\s+/gu, " ").trim().slice(0, JUDGED_CHARACTERS);
    return `[${speaker}]: ${text}`;
  });
  return ["The conversation, oldest first; decide on the last message:", ...lines].join("\n");
}

/**
 * The judge's answer: true or false from `{"reply": …}`, in a code fence or not; null for anything else.
 * @param {unknown} text
 */
export function judgementOf(text) {
  try {
    const parsed = JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
    return typeof parsed?.reply === "boolean" ? parsed.reply : null;
  } catch {
    return null;
  }
}

/**
 * Whether a person's words call the bot: its name as a word, in any case, or an @-mention of it (`<@bot:ID>`).
 * @param {{ id: string, name: string }} bot
 * @param {unknown} text
 */
export function namesBot(bot, text) {
  const words = String(text || "");
  if (mentionsIn(words).includes(String(bot.id))) return true;
  const name = String(bot.name || "").trim();
  return Boolean(name) && new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`, "iu").test(words);
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records: the tab's messages
 * @param {import("./types.js").BotConversations} dependencies.conversations the home's people
 * @param {import("./types.js").HomeDefaults} dependencies.homeDefaults whether the home's bots join in
 * @param {import("@local/account/server/types").Meter} dependencies.meter the turn's ticket, and whether the home is paused
 * @param {import("./types.js").ChatModel} dependencies.model
 */
export function createJoiningIn({ records, conversations, homeDefaults, meter, model }) {
  /**
   * Whether a person's message replies to one of the bot's messages: one in the tab's latest messages, else read.
   * @param {object} row
   * @param {{ body: { replyTo?: { id?: string } } }} message
   * @param {Array<{ id: unknown, role: string }>} recent the tab's latest text messages
   * @param {import("./types.js").CallOptions} call
   */
  async function repliesToBot(row, message, recent, call) {
    const target = message.body.replyTo?.id;
    if (!target) return false;
    const seen = recent.find((entry) => String(entry.id) === String(target));
    return (seen ?? (await records.messages.messageIn(row.conversation_id, String(target), call)))?.role === "bot";
  }

  /**
   * The judging call (D-102): one generateOnce without reasoning, on the chat kind of work, metered on the turn's own
   * ticket (its home, person and bot), as a reply's own small calls are. A failure, or an answer that isn't
   * {"reply": true|false}, is a no, logged without the conversation.
   * @param {object} row the bot as seen in the tab
   * @param {object[]} conversation the tab's latest text messages, oldest first, the one decided on last
   */
  async function judge(row, conversation) {
    const bot = { id: String(row.id), name: row.name };
    const system = judgingInstructions(bot.name, templateChipOf(row)?.description || GENERAL.description);
    const prompt = judgedConversation(bot, conversation);
    try {
      const text = await meter.track({ work: "chat" }, () =>
        generateOnce({ model, system, messages: [{ role: "user", content: prompt }], maxOutputTokens: JUDGE_OUTPUT_TOKENS }));
      const answer = judgementOf(text);
      if (answer === null) console.warn(`Bot ${bot.id} stayed quiet: its judgement came back in another shape.`);
      return answer === true;
    } catch (error) {
      const why = isModelFailure(error) ? modelFailure(error) : error?.message || error;
      console.warn(`Bot ${bot.id} stayed quiet: its judgement failed: ${why}`);
      return false;
    }
  }

  /** A "no": the message decided on is marked, so nothing takes it up again, and the turn has heard it. */
  async function quietOn(message, call) {
    await records.messages.mergeBody(message.id, { judged: "quiet" }, call);
    return { heard: Number(message.id) };
  }

  /**
   * Whether the bot leaves the tab's newest person message to the people (D-102): null when it answers as before, else
   * `{ heard }`, that message's id, marked quiet. Only a Shared bot's shared tabs in a home of two or more people
   * judge; anywhere else, and for a message that calls the bot, it answers. The newest person message is decided on,
   * with the others that came since the bot last spoke or a judgement left the tab quiet: a burst gets one judgement,
   * on its latest, and any message in it that calls the bot is answered. The statements are the same however long the
   * tab: its people, its latest JUDGED_MESSAGES text messages, the home's setting, and a mark on a no.
   * A reply carried on (D-48), a connect follow-up and a card's answer (`afterCard`) are never judged.
   * @param {object} row the bot as seen in the tab (asSeen)
   * @param {{ resume?: unknown, connected?: unknown, afterCard?: boolean }} input what the reply was asked for
   * @param {object | null} held a connect follow-up's run, if this reply is one
   * @param {import("./types.js").CallOptions} call
   */
  async function staysQuiet(row, input, held, call) {
    if (input.resume || input.connected || input.afterCard || held) return null;
    if (row.kind === "group" || !row.room || row.sharing !== "shared") return null;
    if ((await conversations.everyoneIn(call)).length < 2) return null;
    const recent = (await records.messages.recentText(row.conversation_id, JUDGED_MESSAGES, call)).reverse();
    const at = recent.findLastIndex((message) => message.role === "user");
    if (at < 0) return null;
    const latest = recent[at];
    // Judged already: nothing new to decide. The bot spoke since: what this reply is for isn't a person's message.
    if (latest.body.judged === "quiet") return { heard: Number(latest.id) };
    if (at < recent.length - 1) return null;
    let first = at;
    while (first > 0 && recent[first - 1].role === "user" && recent[first - 1].body.judged !== "quiet") first -= 1;
    const burst = recent.slice(first, at + 1);
    // The tab's first person message (all of the tab is in the window, with no person message before the burst).
    if (recent.length < JUDGED_MESSAGES && !recent.slice(0, first).some((message) => message.role === "user")) return null;
    const bot = { id: String(row.id), name: row.name };
    if (burst.some((message) => namesBot(bot, message.body.text))) return null;
    for (const message of burst) if (await repliesToBot(row, message, recent, call)) return null;
    // Off, or a paused home (D-73), where no new AI work starts: only a call is answered.
    if (!(await homeDefaults.joinsIn(call)) || (await meter.pausedMessage(row.workspace_id))) return quietOn(latest, call);
    return (await judge(row, recent)) ? null : quietOn(latest, call);
  }

  return Object.freeze({ staysQuiet });
}
