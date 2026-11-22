import { mentionsIn, plainMentions } from "./mentions.js";

// Bots talking to each other in a chat (R3, D-123): a bot @-mentioned by another bot answers it there, where everyone
// sees it, round after round. After BOT_TALK_LIMIT replies from one bot to another with no person writing, no bot
// answers another until a person writes, anything, to anyone; the bot that would have answered says so plainly, once.
// A room's brief (start_room, D-122) is answered the same way, by the bot it's for.

/** R3: another bot mentioned this one in the chat, and it answers there. */
const followUpPrompt = (name = "Another bot") =>
  `(${name} just mentioned you here. If it asked you something, answer it here, in this chat, where everyone sees it; ` +
  `mention it (@${name}) only when you need something more from it. If you have nothing useful to add, reply with exactly PASS.)`;

/** A room's brief, written by the bot that proposed the room (D-122), is for this one. */
const briefPrompt = (name = "Another bot") =>
  `(${name} started this room with the person, and its brief above is for you: answer it here, by yourself. ` +
  "Start on it, or ask the one thing you need to know first.)";

/**
 * The prompt of a turn another bot asked for: answering its mention (R3's follow-up, which may PASS) or a room's brief;
 * "" for any other turn.
 * @param {{ brief?: boolean, followUp?: boolean, botAsked?: { name: string } | null }} input runReply's
 */
export function askedByBotPrompt(input) {
  if (input.brief) return briefPrompt(input.botAsked?.name);
  return input.followUp ? followUpPrompt(input.botAsked?.name) : "";
}

/** How many replies from one bot to another may follow in a row before a person is needed. */
export const BOT_TALK_LIMIT = 5;
const HAND_BACK = "We need you to go on: ";
const BACK_AND_FORTH = `we've gone back and forth ${BOT_TALK_LIMIT} times, so tell us how you'd like to continue.`;

/**
 * Where the chat's bots are in talking to each other: their replies to one another (body.answersBot) since the latest
 * person's message, and whether the plain line has been said since. One bounded read, the chat's newest
 * BOT_TALK_LIMIT + 1 text messages, and no stored counter: a person's message ends the run whoever it's for.
 */
async function botTalk(turns, chatId, call) {
  const newest = await turns.messages(chatId, { kind: "text" }, { newestFirst: true, limit: BOT_TALK_LIMIT + 1 }, call);
  const person = newest.findIndex((message) => message.role !== "bot");
  const run = person < 0 ? newest : newest.slice(0, person);
  return { replies: run.filter((message) => message.body?.answersBot).length, handedBack: run.some((message) => message.body?.handBack) };
}

/**
 * The plain line a bot says at the limit: what the asking bot last asked it (its last question, without the mention
 * that starts it), or that they've gone back and forth. It mentions no bot, so no bot answers it.
 * @param {string} asking the asking bot's message, as stored
 * @param {object[]} bots the chat's bots (records.chats.bots rows)
 */
export function handBackLine(asking, bots) {
  const members = bots.map((bot) => ({ id: String(bot.bot_id), name: bot.name }));
  const sentences = String(asking || "").replace(/\s+/gu, " ").trim().split(/(?<=[.!?])\s+/u);
  const question = [...sentences].reverse().find((sentence) => sentence.endsWith("?"));
  const open = plainMentions(String(question || "").replace(/^(?:<@bot:\d+>[,:]?\s*)+/u, ""), members).trim().slice(0, 300);
  return `${HAND_BACK}${open || BACK_AND_FORTH}`;
}

/**
 * The bots that `posted` messages mention, each once, in the order mentioned: live bots of the chat, never a message's
 * own author, and not one that already spoke after the message mentioning it. Each with `botAsked`, the bot that
 * mentioned it and its words. The plain line at the limit mentions no one.
 */
export function mentionedNext(posted, bots) {
  const next = new Map();
  posted.forEach((message, index) => {
    if (message.role !== "bot" || message.kind !== "text" || message.body?.handBack) return;
    const author = String(message.authorBotId);
    for (const id of mentionsIn(message.body?.text)) {
      const bot = bots.find((entry) => String(entry.bot_id) === id && !entry.archived_at);
      if (!bot || id === author || next.has(id)) continue;
      if (posted.slice(index + 1).some((later) => later.role === "bot" && String(later.authorBotId) === id)) continue;
      next.set(id, { ...bot, botAsked: { id: author, name: message.body?.authorName || "Another bot", text: message.body?.text || "" } });
    }
  });
  return [...next.values()];
}

/**
 * Whether a bot asked by another (`botAsked`) is past the chat's limit, so it doesn't run: then it says the plain line,
 * unless it was said since the last person's message, and what it said is added to `posted`. Once the line is said,
 * every bot asked by another is past it until a person writes.
 * @param {{ turns: import("./types.js").BotRecords["turns"], seats: import("./chatSeats.js").ChatSeats }} parts
 * @param {object} seat the bot in its chat
 * @param {{ text: string }} botAsked the asking bot's words
 * @param {object[]} bots the chat's bots (records.chats.bots rows)
 * @param {object[]} posted
 */
export async function pastTalkLimit({ turns, seats }, seat, botAsked, bots, posted) {
  const call = seats.readerOf(seat);
  const talk = await botTalk(turns, seat.chat_id, call);
  // Once said, the line holds every bot back until a person writes, however few replies the read still sees.
  if (talk.replies < BOT_TALK_LIMIT && !talk.handedBack) return false;
  if (!talk.handedBack) {
    posted.push(...await seats.say(seat, [{ kind: "text", role: "bot", body: { text: handBackLine(botAsked.text, bots), handBack: true } }], call));
    await seats.tell(seat.chat_id, { type: "messages" }, call);
  }
  return true;
}

/**
 * A room a bot's card started (start_room, D-122): the bot its brief is for answers it there by itself, once, as a reply
 * to the bot that wrote it, for the person who said yes. Then the bots it mentions answer it, as after any reply. In the
 * background, so the card's answer doesn't wait for it.
 * @param {object} parts
 * @param {import("./types.js").BotRecords} parts.records
 * @param {import("./types.js").BackgroundWork} parts.background
 * @param {Function} parts.speak botReplies' speakInTurn
 * @returns {(chatId: string, brief: { botId: string, by: string, userId: string }, options: object) => void}
 */
export function briefAnswerer({ records, background, speak }) {
  return (chatId, { botId, by, userId }, options) => {
    background.add((async () => {
      const chat = await records.chats.get(String(chatId), options);
      const present = { people: await records.chats.people(chat.id, options), bots: await records.chats.bots(chat.id, options) };
      const bot = present.bots.find((entry) => String(entry.bot_id) === String(botId) && !entry.archived_at);
      const writer = present.bots.find((entry) => String(entry.bot_id) === String(by));
      if (!bot || !writer) return;
      await speak(chat, [{ ...bot, brief: true, botAsked: { id: String(by), name: writer.name, text: "" } }], { asked: 0 }, String(userId), present);
    })().catch((error) => console.error(`Answering a room's brief failed: ${error?.message || error}`)));
  };
}
