import { generateOnce } from "@jskit-ai/agent/server";
import { templateChipOf } from "./botTemplate.js";
import { plainMentions } from "./mentions.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { GENERAL } from "./templates.js";

// Bots join in when useful (D-115, as D-129 changes it). In a chat with several people and the chat's switch on
// (`conversations.bots_join_in`, on by default), every live bot reads every person's message, one after another in the
// chat's order (R3), so each reads what the ones before it said. A bot the message calls (its name, an @-mention, a reply
// to one of its messages, @everyone) answers it as always. Any other bot first decides for itself whether it has
// something useful to say, in one cheap call of its own: no tools, no reasoning, its name and job and the chat's latest
// text messages, one word out. Only REPLY starts its turn, which may still PASS; anything else leaves the chat as it
// was, with nothing posted, shown or kept. Off, only a bot that is called answers. A chat of one person never decides
// (every bot answers it, R3), nor a paused home (D-73).

/** How many of a chat's latest text messages a decision reads, and how many characters of each. */
export const DECIDED_MESSAGES = 12;
export const DECIDED_CHARACTERS = 400;
// The decision answers REPLY or PASS: a token or two, with room for a stray word around it.
const DECISION_OUTPUT_TOKENS = 10;
/** The first words of every decision's instructions. */
export const DECIDING = "You decide whether you reply to a message in a chat that several people share.";

/**
 * What a bot is told in the turn it decided to take: say what's useful, and PASS (which posts nothing) if, with the
 * whole chat in front of it, there's nothing after all.
 */
export const UNCALLED =
  "Nobody called you by name in it: you read it and chose to reply. Say what you have that's useful, such as an " +
  "answer, a correction, or what it settles of a question you asked, and carry on with what you were doing with them. " +
  "If, with the whole chat in front of you, there's nothing useful to add after all, reply with exactly PASS.";

/**
 * A bot's instructions for deciding: fixed for the bot, so the provider caches them. They say what makes a reply
 * useful, and it decides how chatty a room feels.
 * @param {{ name: string, job: string }} bot
 */
export function decidingInstructions({ name, job }) {
  return [
    DECIDING,
    `You are ${name}, one of the bots in it. Your job: ${job}`,
    "You read every message here, also the ones that don't call you by name, so people can carry on with you without " +
      "naming you every time.",
    "Reply when you have something useful to say: an answer, a correction, or something that settles one of your own " +
      "open questions. Above all, reply when the message answers a question you asked or carries on what you were doing " +
      "with its writer: that is how your work goes on.",
    "Pass when you'd add nothing: people talking to each other, chatting, thanking, agreeing or saying goodbye, " +
      "something another bot is doing or has already answered, or a reply that would only repeat what's been said.",
    "Answer with one word: REPLY or PASS."
  ].join("\n");
}

/**
 * What a decision reads: the chat's latest text messages, oldest first, each on one line named by its author as the chat
 * keeps it (`body.authorName`, the deciding bot's own lines as "(you)") and clipped to DECIDED_CHARACTERS; the message
 * decided on is marked ">>", and the lines after it were said since (by the bots before this one).
 * @param {{ botId: string, decidedId: string, bots: Array<{ id: string, name: string }> }} at the deciding bot, the
 *   message decided on, and the chat's bots, whose mentions read as "@Name", as the people a message mentions do from
 *   the names kept on it (`body.mentionedPeople`, D-114)
 * @param {Array<{ id: string | number, author_bot_id?: string | number | null, body: { text?: string, authorName?: string,
 *   mentionedPeople?: Array<{ id: string, name: string }> } }>} messages oldest first
 */
export function decidedConversation({ botId, decidedId, bots }, messages) {
  const lines = messages.slice(-DECIDED_MESSAGES).map((message) => {
    const text = plainMentions(message.body.text, bots, message.body.mentionedPeople).replace(/\s+/gu, " ").trim().slice(0, DECIDED_CHARACTERS);
    const own = message.author_bot_id != null && String(message.author_bot_id) === String(botId);
    const line = `[${message.body.authorName || "Someone"}${own ? " (you)" : ""}]: ${text}`;
    return String(message.id) === String(decidedId) ? `>> ${line}` : line;
  });
  return [`The conversation, oldest first. Decide on the message marked ">>"; anything after it was said since.`, ...lines].join("\n");
}

/**
 * The decision's answer: true for REPLY, false for PASS (each in any case, as its first word), undefined for anything
 * else.
 * @param {unknown} text
 */
export function decisionOf(text) {
  const word = /^[^\p{L}]*(\p{L}+)/u.exec(String(text || ""))?.[1]?.toUpperCase();
  return word === "REPLY" ? true : word === "PASS" ? false : undefined;
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records the chat's messages and bots, and its reader
 * @param {import("@local/account/server/types").Meter} dependencies.meter the decision's ticket, and whether the home is paused
 * @param {import("./types.js").ChatModel} dependencies.model
 */
export function createJoiningIn({ records, meter, model }) {
  /**
   * Whether a bot its chat's latest person's message doesn't call replies to it (D-129): false in a paused home, when
   * the message isn't among the chat's DECIDED_MESSAGES latest text messages any more (the chat has moved on), and when
   * the decision fails or answers in another shape (logged without the conversation). One generateOnce on the chat kind
   * of work, no tools, metered to the person the bot works for (who wrote the message), in the chat's home, and that bot
   * (R8). It reads through the chat's own reader (R1: what the chat may read, for no one) the chat's latest text messages
   * and the bot's row: the same statements however long the chat.
   * @param {{ id: string, name: string, chat_id: string, workspace_id: string, user_id: string }} seat the bot's seat
   * @param {string | number} messageId the person's message decided on
   * @param {Array<{ bot_id: string | number, name: string }>} bots the chat's bots (records.chats.bots rows)
   * @returns {Promise<boolean>}
   */
  async function replies(seat, messageId, bots) {
    if (await meter.pausedMessage(String(seat.workspace_id))) return false;
    const reader = { context: records.readers.forChat({ homeId: String(seat.workspace_id), chatId: String(seat.chat_id) }) };
    const [recent, [row]] = await Promise.all([
      records.messages.recentText(String(seat.chat_id), DECIDED_MESSAGES, reader),
      records.bots.byIds([String(seat.id)], reader)
    ]);
    if (!recent.some((message) => String(message.id) === String(messageId))) return false;
    const job = (row && templateChipOf(row)?.description) || GENERAL.description;
    const members = bots.map((bot) => ({ id: String(bot.bot_id), name: bot.name }));
    const system = decidingInstructions({ name: seat.name, job });
    const prompt = decidedConversation({ botId: seat.id, decidedId: messageId, bots: members }, [...recent].reverse());
    try {
      const who = { userId: String(seat.user_id), botId: String(seat.id), workspaceId: String(seat.workspace_id), work: "chat" };
      const text = await meter.track(who, () =>
        generateOnce({ model, system, messages: [{ role: "user", content: prompt }], maxOutputTokens: DECISION_OUTPUT_TOKENS }));
      const decided = decisionOf(text);
      if (decided === undefined) console.warn(`Bot ${seat.id} stayed quiet in chat ${seat.chat_id}: its decision came back in another shape.`);
      return decided === true;
    } catch (error) {
      const why = isModelFailure(error) ? modelFailure(error) : error?.message || error;
      console.warn(`Bot ${seat.id} stayed quiet in chat ${seat.chat_id}: its decision failed: ${why}`);
      return false;
    }
  }

  return Object.freeze({
    replies
  });
}
