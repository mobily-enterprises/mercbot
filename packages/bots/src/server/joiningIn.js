import { generateOnce } from "@jskit-ai/agent/server";
import { templateChipOf } from "./botTemplate.js";
import { plainMentions } from "./mentions.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { GENERAL } from "./templates.js";

// Bots join in when useful (D-115, D-102's judge moved to chats). In a chat with several people, people talk to each
// other as much as to the bots, so a bot answers only when it's called (R3). With the chat's "Bots join in when useful"
// on (`conversations.bots_join_in`, off by default, O17), a person's message that calls no bot goes through one
// judging call, which names at most one of the chat's bots to answer it, or none: with several people and nobody
// called, at most one bot joins per message. The judge's answer is kept on the message (`body.judged`: the bot's id, or
// "quiet"), so a page asking again, another server, or a bot freed later (answerWaiting) reads the same answer and
// nothing judges it twice. A chat of one person never judges (every bot answers it, R3), nor a paused home (D-73).

/** How many of a chat's latest text messages the judge reads, and how many characters of each. */
export const JUDGED_MESSAGES = 12;
export const JUDGED_CHARACTERS = 400;
// The judge answers {"bot": "<name>"} or {"bot": null}: a few tokens, with room for a code fence around it.
const JUDGE_OUTPUT_TOKENS = 40;
/** The mark on a message the judge left to the people. */
export const QUIET = "quiet";

/**
 * The judge's instructions: fixed for a chat's bots, so the provider caches them.
 * @param {Array<{ name: string, job: string }>} bots the chat's bots that may answer, with what each is for
 */
export function judgingInstructions(bots) {
  return [
    "You decide whether one of the bots in a shared conversation should answer the latest message, and which one. " +
      "Several people talk here, to each other and sometimes to the bots. The bots and their jobs:",
    ...bots.map((bot) => `- ${bot.name}: ${bot.job}`),
    "Answer with one JSON object and nothing else: {\"bot\": \"<its name>\"} or {\"bot\": null}.",
    "Name a bot when the latest message asks it something, asks for something its job covers, asks everyone a question " +
      "it can usefully answer, or carries on a conversation the person is having with it. Never name more than one: the " +
      "one whose job fits best.",
    "Answer null when people are talking to each other, chatting, thanking, agreeing or saying goodbye, or when an " +
      "answer would interrupt. When unsure, answer null."
  ].join("\n");
}

/**
 * What the judge reads: the chat's latest text messages, oldest first, the one decided on last, each on one line named
 * by its author as the chat keeps it (`body.authorName`) and clipped to JUDGED_CHARACTERS.
 * @param {Array<{ id: string, name: string }>} bots the chat's bots, whose mentions read as "@Name"
 * @param {Array<{ body: { text?: string, authorName?: string } }>} messages oldest first
 */
export function judgedConversation(bots, messages) {
  const lines = messages.slice(-JUDGED_MESSAGES).map((message) => {
    const text = plainMentions(message.body.text, bots).replace(/\s+/gu, " ").trim().slice(0, JUDGED_CHARACTERS);
    return `[${message.body.authorName || "Someone"}]: ${text}`;
  });
  return ["The conversation, oldest first; decide on the last message:", ...lines].join("\n");
}

/**
 * The judge's answer: the bot it names among `bots` (by name, in any case), null for none, or undefined for an answer
 * in any other shape (a name that isn't one of them included). A code fence around it is read.
 * @param {unknown} text
 * @param {Array<{ id: string, name: string }>} bots
 */
export function judgementOf(text, bots) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || !Object.hasOwn(parsed, "bot")) return undefined;
  if (parsed.bot === null) return null;
  const name = typeof parsed.bot === "string" ? parsed.bot.trim().toLowerCase() : "";
  return bots.find((bot) => bot.name.trim().toLowerCase() === name);
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records the chat's messages and bots, and its reader
 * @param {import("@local/account/server/types").Meter} dependencies.meter the judge's ticket, and whether the home is paused
 * @param {import("./types.js").ChatModel} dependencies.model
 */
export function createJoiningIn({ records, meter, model }) {
  /**
   * The judging call: one generateOnce without reasoning, on the chat kind of work, metered to the person whose message
   * it decides on, in the chat's home, and no bot, since none has spoken (R8). A failure, or an answer in another shape,
   * is a no, logged without the conversation.
   * @param {{ id: string, workspace_id: string }} chat
   * @param {Array<{ id: string, name: string, job: string }>} bots
   * @param {object[]} conversation the chat's latest text messages, oldest first
   * @param {string} askerId
   */
  async function judge(chat, bots, conversation, askerId) {
    const system = judgingInstructions(bots);
    const prompt = judgedConversation(bots, conversation);
    try {
      const text = await meter.track({ userId: String(askerId), botId: null, workspaceId: String(chat.workspace_id), work: "chat" }, () =>
        generateOnce({ model, system, messages: [{ role: "user", content: prompt }], maxOutputTokens: JUDGE_OUTPUT_TOKENS }));
      const answer = judgementOf(text, bots);
      if (answer === undefined) console.warn(`Chat ${chat.id}'s bots stayed quiet: their judgement came back in another shape.`);
      return answer ?? null;
    } catch (error) {
      const why = isModelFailure(error) ? modelFailure(error) : error?.message || error;
      console.warn(`Chat ${chat.id}'s bots stayed quiet: their judgement failed: ${why}`);
      return null;
    }
  }

  /**
   * The judgement kept on the message (`body.judged`), unless another server kept one first: then that one stands, so
   * two judgements at once still let at most one bot join in. Answers the mark that stands.
   */
  async function keep(chat, message, mark, call) {
    return records.chats.withTransaction(call, async (txOptions) => {
      const held = await records.messages.lockMessageIn(String(chat.id), String(message.id), txOptions);
      if (!held) return QUIET;
      if (held.body?.judged) return String(held.body.judged);
      await records.messages.mergeBody(String(message.id), { judged: mark }, txOptions);
      return mark;
    });
  }

  /**
   * Whether a person's message `latest` that calls none of the chat's bots goes to the judge: only with the chat's
   * setting on, a live bot, and no judgement on it yet. (With one person in the chat every bot is called, R3.)
   * @param {{ bots_join_in?: boolean }} chat
   * @param {{ body?: { judged?: string } } | null | undefined} latest
   * @param {{ people: object[], bots: object[] }} present
   */
  function mayJudge(chat, latest, present) {
    return Boolean(chat.bots_join_in && latest && !latest.body?.judged && present.bots.some((bot) => !bot.archived_at));
  }

  /**
   * The bot that joins in on the chat's latest person's message `latest`, which calls none of its bots, in a list of at
   * most one (D-115): none unless mayJudge, nor in a paused home. It is called only when the message calls no bot, so
   * with several people (addressedBots). The judge reads through the chat's own reader (R1:
   * what the chat may read, for no one), its JUDGED_MESSAGES latest text messages and its live bots' rows: the same
   * statements however long the chat. The mark is written with the person's request (`call`).
   * @param {{ id: string, workspace_id: string, bots_join_in?: boolean }} chat records.chats row
   * @param {{ id: string | number, authorUserId?: string | number, body: { judged?: string } }} latest
   * @param {{ people: object[], bots: object[] }} present
   * @param {import("./types.js").CallOptions} call
   * @returns {Promise<object[]>} the present.bots entry that joins in, or none
   */
  async function joining(chat, latest, present, call) {
    if (!mayJudge(chat, latest, present) || await meter.pausedMessage(String(chat.workspace_id))) return [];
    const live = present.bots.filter((bot) => !bot.archived_at);
    const reader = { context: records.readers.forChat({ homeId: String(chat.workspace_id), chatId: String(chat.id) }) };
    const [recent, rows] = await Promise.all([
      records.messages.recentText(String(chat.id), JUDGED_MESSAGES, reader),
      records.bots.byIds(live.map((bot) => String(bot.bot_id)), reader)
    ]);
    const jobs = live.map((bot) => {
      const row = rows.find((entry) => String(entry.id) === String(bot.bot_id));
      return { id: String(bot.bot_id), name: bot.name, job: (row && templateChipOf(row)?.description) || GENERAL.description };
    });
    const picked = await judge(chat, jobs, [...recent].reverse(), latest.authorUserId);
    const mark = await keep(chat, latest, picked ? picked.id : QUIET, call);
    return live.filter((bot) => String(bot.bot_id) === mark);
  }

  return Object.freeze({
    mayJudge,
    joining
  });
}
