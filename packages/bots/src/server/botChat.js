import { refusalOf } from "@local/account/meter";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { findSkill, pickable } from "./skills.js";
import { withMentions } from "./mentions.js";
import { BotsError } from "./botsError.js";
import { messageBody, toMessage } from "./botRows.js";
import { answerAsBot } from "./botWriting.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { addressedBots } from "./botReplies.js";

const QUICK_REACTIONS = new Set(["👍", "👎", "❤️", "😂", "🎉", "🙌", "👀", "🔥", "🙏", "😮", "😢", "✅"]);
// A cursor is a transaction id (xid8): an unsigned 64-bit number in decimal.
const isCursor = (value) => typeof value === "string" && /^\d{1,20}$/u.test(value) && BigInt(value) < 2n ** 64n;
// A message id, as the page names the oldest message it shows.
const isMessageId = (value) => typeof value === "string" && /^[1-9]\d{0,17}$/u.test(value);
// The longest words find in chat looks for on the server.
const FIND_LIMIT = 200;

/**
 * A person's side of a chat (D-112): its messages listed and found, a message sent, the bots' replies asked for, the
 * status line, reactions, voice calls, and one answer a bot writes for another feature. The routes have opened the
 * chat for the caller (a private chat they aren't in is a 404) and refused writes to an archived one. Every method
 * takes the call's options last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").ChatModel} dependencies.model
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("./types.js").Goals} dependencies.goals
 * @param {ReturnType<typeof import("./botReplies.js").createBotReplies>} dependencies.replies
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {{ get: (chatId: string, options: object) => Promise<{ chat: object }> }} dependencies.chats chatMembers, for the chat's row
 * @param {(bot: object, userMessage: object) => Promise<{ status: string, emoji: string | null }>} dependencies.activity
 * @param {{ afterMessage: (chat: object, txOptions: object) => Promise<object> }} dependencies.onboarding the
 *   welcome chat's steps (B), told of a message in a chat with an onboarding step
 */
export function createBotChat({ records, model, integrations, goals, replies, seats, chats, activity, onboarding }) {
  const { messages: history } = records;
  const chatOf = async (chatId, options) => (await chats.get(chatId, options)).chat;

  /**
   * A chat's messages (D-15). Without options, its newest page, whether older ones are left (`more`) and a cursor; with
   * `before` (the oldest message the page shows) the page before it, and no cursor, since it says nothing about news;
   * with an earlier cursor (`since`) only the messages written or changed since, so an open page catches up on news
   * without reading the chat again.
   * @returns {Promise<{ messages: object[], cursor?: string, more?: boolean }>}
   */
  async function messages(chatId, { since, before } = {}, options) {
    const given = (value) => value !== undefined && value !== null;
    if (given(since) && !isCursor(since)) {
      throw new BotsError(400, "That catch-up point isn't valid.", { code: "bots_cursor_invalid" });
    }
    if (given(before) && (!isMessageId(before) || given(since))) {
      throw new BotsError(400, "That place in the chat isn't valid.", { code: "bots_before_invalid" });
    }
    const chat = await records.chats.get(String(chatId), options);
    if (given(before)) return history.timeline(chat.id, { before }, options);
    // Read before the messages, so every transaction that read can't see (still running, or
    // started later) has an id at or above it, and the next catch-up includes what it wrote.
    // Messages sent twice are harmless: the page merges them by id.
    const cursor = await history.changeHorizon(options);
    if (!given(since)) return { ...(await history.timeline(chat.id, {}, options)), cursor };
    return { messages: await history.catchUp(chat.id, since, options), cursor };
  }

  /**
   * Find in chat in the part of a chat the page hasn't read: how many times the words appear before `before` (the
   * oldest message the page has), and the newest and oldest message holding them. The page counts the matches it shows
   * itself and brings the pages down to one of these only when the person goes to it, so finding never reads the whole
   * chat.
   */
  async function findOlder(chatId, { q, before } = {}, options) {
    // Whose chat it is first (a 404 for one the caller can't open), then what they asked for.
    const chat = await records.chats.get(String(chatId), options);
    const text = typeof q === "string" ? q : "";
    if (!isMessageId(before)) throw new BotsError(400, "That place in the chat isn't valid.", { code: "bots_before_invalid" });
    if (text.length > FIND_LIMIT) throw new BotsError(400, "That's too long to find.", { code: "bots_find_too_long" });
    if (!text) return { count: 0, newest: null, oldest: null };
    return history.findBefore(chat.id, text, before, options);
  }

  /** The caller, who must be one of the chat's people to write in it: a public chat is joined first. */
  async function writer(chatId, options) {
    const me = String(resolveActorId(options.context) ?? "");
    if (!me || !(await records.chats.isPerson(chatId, me, options))) {
      throw new BotsError(403, "Join this chat to write in it.", { code: "bots_chat_join_first" });
    }
    return me;
  }

  /**
   * A person's message (D-19: the same client id is stored once). Mentions of the chat's bots and of its other people
   * are kept on it (a person mentioned has it waiting as the chat list's "@", D-114), a skill picked with "/" by name,
   * and a reply quotes the message it answers, with that message's bot (R3). Open pages hear of it; the bots answer when
   * the page asks for their reply (`reply`).
   * @param {string} chatId
   * @param {{ clientId?: string, text?: string, quotes?: string[], attachments?: object[], replyTo?: { id?: string } }} input
   * @returns {Promise<{ messages: object[], chat: object }>}
   */
  async function sendMessage(chatId, input = {}, options) {
    const chat = await records.chats.get(String(chatId), options);
    const me = await writer(chat.id, options);
    const [chatBots, people] = await Promise.all([records.chats.bots(chat.id, options), records.chats.people(chat.id, options)]);
    const others = people.filter((person) => String(person.user_id) !== me)
      .map((person) => ({ id: String(person.user_id), name: person.name }));
    const body = withMentions(messageBody(input), chatBots.map((bot) => ({ id: String(bot.bot_id), name: bot.name })), others);
    // The person's name as they wrote it (R2): the chat still names them once they've left it, or the home.
    body.authorName = people.find((person) => String(person.user_id) === me)?.name || "Someone";
    const picked = [...String(body.text || "").matchAll(/<@skill:([\w-]+)>/gu)].map((match) => match[1]);
    if (picked.length) {
      const own = await ownSkillsIn(chat, me, options);
      body.skills = picked.map((id) => findSkill(id, own)).filter(Boolean).map((skill) => ({ id: skill.id, name: skill.name }));
    }
    const clientId = typeof input.clientId === "string" ? input.clientId.slice(0, 64) : "";
    if (clientId) {
      const existing = await history.byClientId(chat.id, clientId, options);
      if (existing) return { messages: [toMessage(existing)], chat: await chatOf(chat.id, options) };
      body.clientId = clientId;
    }
    const replyToId = String(input.replyTo?.id ?? "");
    if (isMessageId(replyToId)) {
      const target = await history.messageIn(chat.id, replyToId, options);
      if (target) {
        body.replyTo = {
          id: String(target.id),
          text: String(target.body.text || target.body.heading || "").slice(0, 200),
          ...(target.author_bot_id ? { botId: String(target.author_bot_id) } : {})
        };
      }
    }
    const { sent, changed } = await records.chats.withTransaction(options, async (txOptions) => {
      const [userMessage] = await history.append(chat.id, [{ kind: "text", role: "user", body }], txOptions);
      if (body.mentionedPeople) await records.chats.markMentioned(chat.id, body.mentionedPeople.map((person) => person.id), txOptions);
      // Typing while one's own choice card is open makes the card inactive; another person's card stays theirs (R4).
      const openChoice = await history.latestOfKind(chat.id, "choice", txOptions);
      const mine = openChoice && (!openChoice.body.for || String(openChoice.body.for.id) === me);
      const inactive = mine && !openChoice.body.chosen && !openChoice.body.inactive
        ? [await history.setBody(openChoice.id, { ...openChoice.body, inactive: true }, txOptions)]
        : [];
      // The welcome chat's steps move on as the person writes (B's onboarding).
      if (chat.onboarding_step) await onboarding.afterMessage(chat, txOptions);
      return { sent: userMessage, changed: inactive };
    });
    // The person writing again resumes a goal its bot paused to wait for them (D-48), for the bots it's for.
    const present = { people, bots: chatBots };
    for (const bot of addressedBots(sent, present)) await goals.resume(bot.chat_bot_id);
    await seats.tell(chat.id, { type: "messages" }, options);
    return { messages: [...changed, sent], chat: await chatOf(chat.id, options) };
  }

  /**
   * The bots' replies to the chat's latest message, or after a card was answered (R3): what they said, or
   * { pending: true } while they're still going.
   */
  async function reply(chatId, input = {}, _person, options) {
    const answer = await replies.replyIn(String(chatId), input, options);
    return answer.pending ? answer : { ...answer, chat: await chatOf(String(chatId), options) };
  }

  /**
   * The person's own skills where a bot of the chat may use them, as `{ id, name, description }`: only in a Private chat
   * whose one person is them (O24, D12: their own things are opened by them alone; the bot's reads,
   * rowPolicies.js personalRule, say the same), and none anywhere else.
   */
  async function ownSkillsIn(chat, person, options) {
    if (chat.kind !== "private") return [];
    const people = await records.chats.people(chat.id, options);
    return people.length === 1 && String(people[0].user_id) === String(person) ? integrations.skillNames(options) : [];
  }

  /**
   * The "/" picker's skills in a chat (`chatId`, a 404 for one the caller can't open): Mercbot's pickable ones, with
   * the person's own first only where its bot may use them (ownSkillsIn). Without a chat, Mercbot's alone.
   */
  async function skillsFor(chatId, options) {
    const me = String(resolveActorId(options.context) ?? "");
    const chat = chatId == null || chatId === "" ? null : await records.chats.get(String(chatId), options);
    return { skills: pickable(chat && me ? await ownSkillsIn(chat, me, options) : []) };
  }

  /** A bot of this chat, or a 404. */
  async function botIn(chatId, botId, options) {
    const seat = await records.chats.chatBotOf(String(botId), String(chatId), options);
    if (!seat) throw new BotsError(404, "That bot isn't in this chat.", { code: "bots_bot_not_in_chat" });
    return records.bots.get(String(botId), options);
  }

  /** A voice conversation's record: an event line with how long it lasted. */
  async function recordVoiceCall(chatId, botId, seconds, options) {
    await writer(String(chatId), options);
    await botIn(chatId, botId, options);
    const total = Math.max(0, Math.min(24 * 3600, Math.round(Number(seconds) || 0)));
    const duration = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    const messages = await history.append(String(chatId), [
      {
        kind: "event",
        role: "system",
        body: {
          text: "Voice conversation",
          icon: "voice",
          name: duration,
          detail: `A voice conversation of ${duration} just ended; what was said is in the messages above.`
        }
      }
    ], options);
    await seats.tell(String(chatId), { type: "messages" }, options);
    return { messages };
  }

  /**
   * A few words for the status line, and the reaction of the first bot the message is for (R3). A message no bot of the
   * chat is for has neither.
   */
  async function describeWork(chatId, messageId, options) {
    const message = isMessageId(String(messageId)) ? await history.messageIn(String(chatId), String(messageId), options) : null;
    if (!message) throw new BotsError(404, "Message not found.", { code: "bots_message_not_found" });
    const [people, bots] = await Promise.all([records.chats.people(String(chatId), options), records.chats.bots(String(chatId), options)]);
    const present = { people, bots };
    const [first] = message.role === "user" ? addressedBots(message, present) : [];
    if (!first) return { status: "", messages: [] };
    const bot = await records.bots.get(String(first.bot_id), options);
    const result = await activity(bot, toMessage(message));
    const messages = result.emoji ? [await history.setReaction(message.id, `bot:${bot.id}`, result.emoji, options)] : [];
    if (messages.length) await seats.tell(String(chatId), { type: "messages" }, options);
    return { status: result.status, messages };
  }

  /**
   * One answer a bot writes in its own voice to `question`, kept nowhere, for a feature that shows it somewhere else
   * (`purpose` says what it is, in the log). Refused (meter.js refuseWork), it's the refusal (D-73); any other failure
   * answers "", and a model call's failure is logged in one line.
   */
  async function answerOnce(botId, { question, purpose }, options) {
    const bot = await records.bots.get(String(botId), options);
    return answerAsBot(model, bot, question).catch((error) => {
      if (refusalOf(error)) throw error;
      if (isModelFailure(error)) console.warn(`Bot ${bot.id}'s ${purpose} wasn't written: ${modelFailure(error)}`);
      return "";
    });
  }

  /** A person's reaction to a message from a bot or another person, or none (`emoji` empty). */
  async function react(chatId, messageId, emoji, options) {
    const me = await writer(String(chatId), options);
    const message = isMessageId(String(messageId)) ? await history.messageIn(String(chatId), String(messageId), options) : null;
    if (!message) throw new BotsError(404, "Message not found.", { code: "bots_message_not_found" });
    if (message.role === "system" || String(message.author_user_id) === me) {
      throw new BotsError(400, "You can react to the bots' and other people's messages.", { code: "bots_reaction_not_allowed" });
    }
    if (emoji && !QUICK_REACTIONS.has(emoji)) throw new BotsError(400, "That reaction isn't available.", { code: "bots_reaction_unknown" });
    // One reaction per person or bot (`user:<id>`, `bot:<id>`), written by the database so none is lost (D-114).
    const changed = await history.setReaction(message.id, `user:${me}`, emoji || null, options);
    await seats.tell(String(chatId), { type: "messages" }, options);
    return { messages: [changed] };
  }

  return Object.freeze({
    messages,
    findOlder,
    sendMessage,
    reply,
    skillsFor,
    recordVoiceCall,
    describeWork,
    answerOnce,
    react
  });
}
