import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { refusalOf } from "@local/account/meter";
import { ONBOARDING_STEPS, firstNameOf } from "./onboarding.js";
import { findSkill, pickable } from "./skills.js";
import { withMentions } from "./mentions.js";
import { BotsError } from "./botsError.js";
import { messageBody, toBot, toMessage } from "./botRows.js";
import { answerAsBot } from "./botWriting.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";

const QUICK_REACTIONS = new Set(["👍", "👎", "❤️", "😂", "🎉", "🙌", "👀", "🔥", "🙏", "😮", "😢", "✅"]);
// A cursor is a transaction id (xid8): an unsigned 64-bit number in decimal.
const isCursor = (value) => typeof value === "string" && /^\d{1,20}$/u.test(value) && BigInt(value) < 2n ** 64n;
// A message id, as the page names the oldest message it shows.
const isMessageId = (value) => typeof value === "string" && /^[1-9]\d{0,17}$/u.test(value);
// The longest words find in chat looks for on the server.
const FIND_LIMIT = 200;

/**
 * The person's side of a chat: messages sent and listed, onboarding answers, reactions, the status line,
 * voice conversation records, and one answer a bot writes for another feature. Every method takes the call's options
 * last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").ChatModel} dependencies.model
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("./types.js").Goals} dependencies.goals
 * @param {(bot: object, userMessage: object) => Promise<{ status: string, emoji: string | null }>} dependencies.activity
 * @param {(homeId: string) => Promise<string | null>} dependencies.pausedMessage why a home's new AI work is paused (D-73), or null
 */
export function createBotChat({ records, model, integrations, conversations, goals, activity, pausedMessage }) {
  const { conversations: store, messages: history } = records;

  /**
   * A conversation's messages (D-15). Without options, its newest page, whether older ones
   * are left (`more`) and a cursor; with `before` (the oldest message the page shows) the page
   * before it, and no cursor, since it says nothing about news; with an earlier cursor (`since`)
   * only the messages written or changed since, so an open page catches up on news without
   * reading the chat again.
   * @param {string} botId
   * @param {string | null} room a shared bot's tab (D-36)
   * @param {{ since?: string, before?: string }} page
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @returns {Promise<{ messages: object[], cursor?: string, more?: boolean }>}
   */
  async function messages(botId, room = null, { since, before } = {}, options) {
    const given = (value) => value !== undefined && value !== null;
    if (given(since) && !isCursor(since)) {
      throw new BotsError(400, "That catch-up point isn't valid.", { code: "bots_cursor_invalid" });
    }
    if (given(before) && (!isMessageId(before) || given(since))) {
      throw new BotsError(400, "That place in the chat isn't valid.", { code: "bots_before_invalid" });
    }
    const row = await conversations.ownedBot(botId, options, { room });
    if (given(before)) return conversations.timeline(row, { before }, options);
    // Read before the messages, so every transaction that read can't see (still running, or
    // started later) has an id at or above it, and the next catch-up includes what it wrote.
    // Messages sent twice are harmless: the page merges them by id.
    const cursor = await history.changeHorizon(options);
    if (!given(since)) return { ...(await conversations.timeline(row, {}, options)), cursor };
    return { messages: await history.catchUp(row.conversation_id, since, options), cursor };
  }

  /**
   * Find in chat in the part of a chat the page hasn't read: how many times the words appear in the
   * conversation's messages before `before` (the oldest message the page has), and the newest and oldest message
   * holding them. The page counts the matches it shows itself and brings the pages down to one of these only when the
   * person goes to it, so finding never reads the whole chat.
   * @param {string} botId
   * @param {string | null} room a shared bot's tab (D-36)
   * @param {{ q?: unknown, before?: unknown }} find
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  async function findOlder(botId, room = null, { q, before } = {}, options) {
    const text = typeof q === "string" ? q : "";
    if (!isMessageId(before)) throw new BotsError(400, "That place in the chat isn't valid.", { code: "bots_before_invalid" });
    if (text.length > FIND_LIMIT) throw new BotsError(400, "That's too long to find.", { code: "bots_find_too_long" });
    const row = await conversations.ownedBot(botId, options, { room });
    if (!text) return { count: 0, newest: null, oldest: null };
    return history.findBefore(row.conversation_id, text, before, options);
  }

  /** @param {{ displayName?: string }} user the person, for their first name */
  async function advanceOnboarding(botId, expectedStep, user, options) {
    // The step's words come first, outside the transaction: a model call is never held under the
    // conversation's lock, nor made again when the transaction is retried.
    const before = await conversations.ownedBot(botId, options);
    const step = before.onboarding_step;
    if (!step || step !== expectedStep || !ONBOARDING_STEPS[step]) {
      return { bot: toBot(before), messages: [] };
    }
    const chosenName = (await history.latestOfKind(before.conversation_id, "choice", options))?.body?.chosen;
    const result = await ONBOARDING_STEPS[step]({
      firstName: firstNameOf(user?.displayName),
      chosenName,
      bot: toBot(before),
      // A paused home (D-73) gets the steps' own words, with no AI call.
      model: (await pausedMessage(before.workspace_id)) ? null : model
    });
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      // Written only while the step is still the one the words are for (another page may have moved it on).
      const row = await conversations.ownedBot(botId, txOptions, { lock: true });
      if (row.onboarding_step !== step) {
        return { bot: toBot(row), messages: [] };
      }
      // A new bot's "what first?" card is pointless once the person has already asked for something:
      // it would arrive after their message and stay open.
      const started = step === "intro-ask" && (await history.hasUserText(row.conversation_id, txOptions));
      const appended = await conversations.append(
        row,
        started ? result.messages.filter((message) => message.kind !== "choice") : result.messages,
        txOptions
      );
      await store.updateConversation(row.conversation_id, { onboarding_step: result.next }, txOptions);
      if (result.rename) {
        await store.updateBot(row.id, { name: result.rename }, txOptions);
        await store.updateConversation(row.conversation_id, { last_activity_at: new Date().toISOString() }, txOptions);
      }
      return { bot: toBot(await conversations.refresh(row, txOptions)), messages: appended };
    }));
  }

  async function chooseName(botId, name, options) {
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const row = await conversations.ownedBot(botId, txOptions, { lock: true });
      const choice = await history.latestOfKind(row.conversation_id, "choice", txOptions);
      if (row.onboarding_step !== "ask-name" || !choice || !choice.body.options.includes(name)) {
        throw new BotsError(409, "That choice isn't open any more.", { code: "bots_choice_closed" });
      }
      const updatedChoice = await history.setBody(choice.id, { ...choice.body, chosen: name }, txOptions);
      await store.updateConversation(row.conversation_id, { onboarding_step: "confirm" }, txOptions);
      return { bot: toBot(await conversations.refresh(row, txOptions)), messages: [updatedChoice] };
    }));
  }

  async function sendMessage(botId, input = {}, options) {
    const row = await conversations.ownedBot(botId, options, { room: input.room });
    const members = row.kind === "group" ? (await conversations.membersOf([row.id], options)).get(String(row.id)) || [] : [];
    const body = withMentions(messageBody(input), members);
    // In a shared bot's room, everyone sees who said what (D-36).
    if (row.room) body.from = await conversations.fromOf(conversations.personOf(options), options);
    // A skill picked with "/" is kept by name, so the message reads right later.
    const picked = [...String(body.text || "").matchAll(/<@skill:([\w-]+)>/gu)].map((match) => match[1]);
    if (picked.length) {
      const own = await integrations.skillNames(options);
      body.skills = picked.map((id) => findSkill(id, own)).filter(Boolean).map((skill) => ({ id: skill.id, name: skill.name }));
    }
    // The same message sent twice (a retry after a lost server) is stored once (D-19).
    const clientId = typeof input.clientId === "string" ? input.clientId.slice(0, 64) : "";
    if (clientId) {
      const existing = await history.byClientId(row.conversation_id, clientId, options);
      if (existing) return { bot: toBot(row), messages: [toMessage(existing)] };
      body.clientId = clientId;
    }
    const replyToId = String(input.replyTo?.id ?? "");
    if (isMessageId(replyToId)) {
      const target = await history.messageIn(row.conversation_id, replyToId, options);
      if (target) body.replyTo = { id: String(target.id), text: String(target.body.text || target.body.heading || "").slice(0, 200) };
    }
    const changed = [];
    const [userMessage] = await conversations.append(row, [{ kind: "text", role: "user", body }], options);
    // The person writing again resumes a goal the bot paused to wait for them (D-48).
    if (row.kind !== "group") await goals.resume(row.conversation_id);
    if (row.onboarding_step === "await-nudge") {
      await store.updateConversation(row.conversation_id, { onboarding_step: null }, options);
    }
    // Typing while a choice card is open makes the card inactive; onboarding carries on without a rename.
    const openChoice = await history.latestOfKind(row.conversation_id, "choice", options);
    if (openChoice && !openChoice.body.chosen && !openChoice.body.inactive) {
      changed.push(await history.setBody(openChoice.id, { ...openChoice.body, inactive: true }, options));
      if (row.onboarding_step === "ask-name") {
        await store.updateConversation(row.conversation_id, { onboarding_step: "about" }, options);
      }
    }
    const bot = toBot(await conversations.refresh(row, options));
    return { bot, messages: [...changed, userMessage] };
  }

  /** The "/" picker's skills: Mercbot's pickable ones and all of the person's own. */
  async function skillsFor(options) {
    return { skills: pickable(await integrations.skillNames(options)) };
  }

  /** A voice conversation's record: an event line with how long it lasted. */
  async function recordVoiceCall(botId, seconds, options) {
    const row = await conversations.ownedSingleBot(botId, options);
    const total = Math.max(0, Math.min(24 * 3600, Math.round(Number(seconds) || 0)));
    const duration = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    const messages = await conversations.append(row, [
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
    return { messages };
  }

  async function setReaction(messageId, who, emoji, options) {
    const message = await history.messageById(messageId, options);
    const reactions = { ...(message.body.reactions || {}) };
    if (emoji) {
      reactions[who] = emoji;
    } else {
      delete reactions[who];
    }
    return history.setBody(message.id, { ...message.body, reactions }, options);
  }

  /** A few words for the status line, and the bot's own reaction to the user's message. */
  async function describeWork(botId, messageId, options) {
    const message = await conversations.ownedMessage(botId, messageId, options);
    const bot = toBot(await conversations.ownedBot(botId, options));
    const result = await activity(bot, toMessage(message));
    const messages = message.role === "user" && result.emoji ? [await setReaction(message.id, "bot", result.emoji, options)] : [];
    return { status: result.status, messages };
  }

  /**
   * One answer the person's bot writes in its own voice to `question`, kept nowhere, for a feature that shows it
   * somewhere else (`purpose` says what it is, in the log). Refused (meter.js refuseWork), it's the refusal (D-73); any
   * other failure answers "", and a model call's failure is logged in one line.
   * @param {string} botId
   * @param {{ question: string, purpose: string }} ask
   * @param {object} options the call's options
   */
  async function answerOnce(botId, { question, purpose }, options) {
    const bot = toBot(await conversations.ownedSingleBot(botId, options));
    return answerAsBot(model, bot, question).catch((error) => {
      if (refusalOf(error)) throw error;
      if (isModelFailure(error)) console.warn(`Bot ${bot.id}'s ${purpose} wasn't written: ${modelFailure(error)}`);
      return "";
    });
  }

  async function react(botId, messageId, emoji, options) {
    const message = await conversations.ownedMessage(botId, messageId, options);
    if (message.role !== "bot") throw new BotsError(400, "You can react to your bot's messages.", { code: "bots_reaction_not_bot" });
    if (emoji && !QUICK_REACTIONS.has(emoji)) throw new BotsError(400, "That reaction isn't available.", { code: "bots_reaction_unknown" });
    return { messages: [await setReaction(message.id, "user", emoji || null, options)] };
  }

  return Object.freeze({
    messages,
    findOlder,
    advanceOnboarding,
    chooseName,
    sendMessage,
    skillsFor,
    recordVoiceCall,
    describeWork,
    answerOnce,
    react
  });
}
