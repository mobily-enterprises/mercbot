import { botFace } from "./chatView.js";

// Who wrote each message in a chat, as the timeline shows them (D-112, plan 4.4): your own on the right; every other
// person's on the left with their name and initials; each bot's with its face and name. Pure, so the rules are tested
// once.

const SOMEONE = "Someone";

/**
 * Whether a chat has more than one bot or more than one person. Then the timeline names who wrote each message and the
 * composer's @ offers its members; a direct chat (one person, one bot) has neither.
 * @param {import("../../types.js").Chat | null} chat
 */
export const hasSeveral = (chat) => (chat?.bots?.length || 0) > 1 || (chat?.people?.length || 0) > 1;

/** A person's initials, as their avatar shows them: the first letters of their first two names, else two letters. */
export function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2)).toUpperCase();
}

/** The face of a bot gone from the home, as its messages show it. */
export const GONE_BOT = Object.freeze({ id: "gone", name: SOMEONE, color: null, shape: "cloud", archivedAt: null });

/**
 * Who wrote a message: `key` (the same for every message of one author), `name`, and either `person` with `initials`
 * or `bot`, a face for the avatar; `mine` for the person looking; `member` while they're still in the chat. A person no
 * longer in the chat keeps the name the home's people give them, a bot the Team's; one gone from the home too reads
 * "Someone". Null for Mercbot's own lines.
 * @param {{ authorUserId?: string | null, authorBotId?: string | null, role: string }} message
 * @param {{
 *   chat: import("../../types.js").Chat,
 *   people?: Array<{ id: string, name: string }> | null,
 *   bots?: Array<{ id: string, name: string, color?: string, shape?: string, archivedAt?: string | null }> | null,
 *   me?: string
 * }} where the open chat, the home's people and bots (null while they load), and the person looking
 */
export function authorOf(message, { chat, people = null, bots = null, me = "" }) {
  if (message.authorUserId != null) {
    const id = String(message.authorUserId);
    const inChat = (chat?.people || []).find((person) => String(person.userId) === id);
    const name = inChat?.name || (people || []).find((person) => String(person.id) === id)?.name || "";
    return {
      key: `person-${id}`,
      name: name || SOMEONE,
      person: true,
      initials: name ? initialsOf(name) : "?",
      mine: Boolean(me) && id === String(me),
      member: Boolean(inChat)
    };
  }
  if (message.authorBotId != null) {
    const id = String(message.authorBotId);
    const inChat = (chat?.bots || []).find((bot) => String(bot.botId) === id);
    const known = inChat ? botFace(inChat) : (bots || []).find((bot) => String(bot.id) === id);
    const bot = known
      ? { id, name: known.name, color: known.color, shape: known.shape, archivedAt: known.archivedAt ?? null }
      : { ...GONE_BOT, id };
    return { key: `bot-${id}`, name: bot.name, bot, mine: false, member: Boolean(inChat) };
  }
  // A person or a bot whose account has gone from the home: what they said stays, under no name.
  if (message.role === "user") return { key: "person-gone", name: SOMEONE, person: true, initials: "?", mine: false, member: false };
  if (message.role === "bot") return { key: "bot-gone", name: SOMEONE, bot: GONE_BOT, mine: false, member: false };
  return null;
}

/**
 * Which side a message sits on: your own on the right ("user"), another person's ("other") and a bot's ("bot") on the
 * left, and Mercbot's own lines ("system").
 * @param {ReturnType<typeof authorOf>} author
 */
export function sideOf(author) {
  if (!author) return "system";
  if (author.mine) return "user";
  return author.person ? "other" : "bot";
}

/**
 * Whether a message carries its author's name and face: in a chat of several, everyone's but your own; in a direct
 * chat, only an author no longer in it.
 * @param {ReturnType<typeof authorOf>} author
 * @param {boolean} several the chat's hasSeveral
 */
export const isLabelled = (author, several) => Boolean(author) && !author.mine && (several || !author.member);
