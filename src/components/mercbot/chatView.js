// How a chat reads on screen (D-112): its name, its faces, who's in it, whether it's Public or Private and what that
// means, and the composer's line. Pure, so every screen says the same thing and the words are tested once.

/** Whether a chat is a person's direct chat with one bot: the chat a bot's [Message] reopens. */
export const isDirect = (chat) => Boolean(chat?.directBotId);

/** A chat member bot as the avatars draw it: { id, name, color, shape }, archived ones marked. */
export const botFace = (member) => ({
  id: String(member.botId),
  name: member.name,
  color: member.color,
  shape: member.shape,
  archivedAt: member.archived ? "archived" : null
});

/** The bot of a direct chat, as the avatars draw it, or null. */
export function directBotOf(chat) {
  if (!isDirect(chat)) return null;
  const member = (chat.bots || []).find((bot) => String(bot.botId) === String(chat.directBotId)) || chat.bots?.[0];
  return member ? botFace(member) : null;
}

/** "A and B", or "A, B and C". */
export function joinNames(names) {
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A person's first name, for short lists. */
const firstName = (name) => String(name || "").trim().split(/\s+/u)[0] || "Someone";

/**
 * Who's in a chat, by name: the people (the person looking first, as "you", when `me` names them), then the bots.
 * @param {import("../../types.js").Chat} chat
 * @param {string} [me] the person looking
 */
export function memberNames(chat, me = "") {
  const people = chat?.people || [];
  const mine = people.filter((person) => String(person.userId) === String(me));
  const others = people.filter((person) => String(person.userId) !== String(me)).map((person) => firstName(person.name));
  return [...mine.map(() => "you"), ...others, ...(chat?.bots || []).map((bot) => bot.name)];
}

/**
 * The person's private chat with just one other person, which [Message] on that person opens (plan 4.2): the two of
 * them, no bots, not an app's; the one with the newest activity when there are several, or null.
 * @param {Array<{ kind: string, appId?: string | null, people?: Array<{ userId: string }>, bots?: unknown[], lastActivityAt?: string }>} chats
 * @param {string} me
 * @param {string} personId
 */
export function privateChatWith(chats, me, personId) {
  const pair = [String(me), String(personId)].sort().join(" ");
  const theirs = (chats || []).filter((chat) => chat.kind === "private" && !chat.appId && !(chat.bots || []).length
    && (chat.people || []).map((person) => String(person.userId)).sort().join(" ") === pair);
  return theirs.sort((a, b) => String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || "")))[0] || null;
}

/**
 * A chat's name: its title; a direct chat's bot; otherwise who's in it besides the person looking; "New chat" for a
 * chat of no one else yet.
 */
export function chatTitle(chat, me = "") {
  if (chat?.title) return chat.title;
  const bot = directBotOf(chat);
  if (bot) return bot.name;
  const others = memberNames(chat, me).filter((name) => name !== "you");
  return others.length ? joinNames(others) : "New chat";
}

/** "Public" or "Private". */
export const kindLabel = (chat) => (chat?.kind === "private" ? "Private" : "Public");

/** The kind's sign: a globe for Public, a lock for Private. */
export const kindIcon = (chat) => (chat?.kind === "private" ? "$lock" : "$language");

/** What each kind means, as New chat offers it (D15) and Chat details says it. */
export const KIND_MEANS = Object.freeze({
  public: (homeName) => `Everyone in ${homeName} can open it, and its bots remember what's said here in their other chats.`,
  private: () => "Only its members can open it, and nothing in it reaches other chats."
});

/** What a chat's kind means for this chat, in one plain line. */
export const kindMeaning = (chat, homeName) => (chat?.kind === "private" ? KIND_MEANS.private() : KIND_MEANS.public(homeName));

/**
 * The faces a chat shows, at most `limit`: a direct chat its bot's; otherwise its people (by initials) and its bots.
 * Each is { key, person: { name } } or { key, bot }.
 */
export function chatFaces(chat, limit = 3) {
  const bot = directBotOf(chat);
  if (bot) return [{ key: `bot-${bot.id}`, bot }];
  const people = (chat?.people || []).map((person) => ({ key: `person-${person.userId}`, person: { name: person.name } }));
  const bots = (chat?.bots || []).map((member) => ({ key: `bot-${member.botId}`, bot: botFace(member) }));
  return [...people, ...bots].slice(0, limit);
}

/** The header's second line on a phone (plan 4.6): "Anna, Ben, Chef · Public". */
export function chatSubtitle(chat, me = "") {
  return `${joinNames(memberNames(chat, me).map((name) => (name === "you" ? "You" : name)).slice(0, 4))} · ${kindLabel(chat)}`.replace(/^ · /u, "");
}

/**
 * Which of a public chat's bots remember what's said in it (D-113): "Chef remembers it", "Chef and Ada remember it",
 * "Chef, Ada and 2 more remember it"; "" when it has none. An archived bot remembers nothing new, so isn't named.
 * @param {import("../../types.js").Chat} chat
 */
export function remembersLine(chat) {
  const names = (chat?.bots || []).filter((bot) => !bot.archived).map((bot) => bot.name);
  if (!names.length) return "";
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names;
  return `${joinNames(shown)} remember${names.length === 1 ? "s" : ""} it`;
}

/**
 * The composer's line (plan 4.4, 8): who can read what's written here. Public: the whole home, and the chat's bots,
 * which remember it (D-113): "Everyone in Rossi family can read this · Chef remembers it". Private: only its members,
 * by name.
 * @param {import("../../types.js").Chat} chat
 * @param {{ me?: string, homeName: string, short?: boolean }} where `short` for a phone's composer
 */
export function readersLine(chat, { me = "", homeName, short = false }) {
  if (chat?.kind === "private") {
    const names = memberNames(chat, me);
    if (short) return "Only its members can read this";
    return names.length > 4 ? "Only this chat's members can read this" : `Only ${joinNames(names)} can read this`;
  }
  if (short) return "Everyone can read this";
  const remembers = remembersLine(chat);
  return `Everyone in ${homeName} can read this${remembers ? ` · ${remembers}` : ""}`;
}

/** The first-time notice above a public chat's composer (plan 8): what public means, once per person. */
export const publicNotice = (homeName, chat) => ({
  title: "This chat is public",
  text: `${readersLine(chat, { homeName })}. Its bots remember what's said here in every chat they're in. ` +
    "For something only some of you should see, start a private chat."
});

/**
 * A chat row's preview line: the latest message, with who wrote it in any chat but a direct one ("Ben: oak it is",
 * "You: see you there"); Mercbot's own lines as they are.
 */
export function previewLine(chat, me = "") {
  const latest = chat?.latest;
  const text = chat?.preview || latest?.preview || "";
  if (!latest || !text || isDirect(chat)) return text;
  if (latest.authorUserId) {
    if (String(latest.authorUserId) === String(me)) return `You: ${text}`;
    const person = (chat.people || []).find((entry) => String(entry.userId) === String(latest.authorUserId));
    return `${firstName(person?.name)}: ${text}`;
  }
  if (latest.authorBotId) {
    const bot = (chat.bots || []).find((entry) => String(entry.botId) === String(latest.authorBotId));
    return bot ? `${bot.name}: ${text}` : text;
  }
  return text;
}

/** What a chat's bots are waiting on the person for, from the first that is, or "". */
export const waitingTaskOf = (chat) => (chat?.bots || []).find((bot) => bot.waitingTask)?.waitingTask || "";

/**
 * What a bot's computer in a chat is (D14, D16), in one plain line: it belongs to the chat, and everyone who can open
 * the chat can watch it and use what's signed in on it.
 */
export function computerLine(chat, homeName) {
  if (chat?.kind === "private") return "It belongs to this chat. Only the chat's members can watch it and use what's signed in on it.";
  return `It belongs to this chat. The chat is public, so everyone in ${homeName} can watch it and use what's signed in on it.`;
}

/** Who has a computer now: "You have control", "Anna has control", or "" while its bot does. */
export function controlLine(control, me = "") {
  if (!control) return "";
  return String(control.userId) === String(me) ? "You have control" : `${firstName(control.name)} has control`;
}

/**
 * A Discussion card's state as this page sees it (D-115): a running round whose lease ran out reads as interrupted.
 * The lease is counted from what the server said was left of it when it answered (`leaseLeftMs`, by its own clock), on
 * this page's clock from when the card arrived (`arrivedAt`), so a browser clock set ahead of the server's, or behind
 * it, changes nothing. A card that doesn't say stays as the server last said.
 * @param {{ status?: string, leaseLeftMs?: number }} body
 * @param {number} arrivedAt
 * @param {number} now
 */
export function discussionState(body, arrivedAt, now) {
  const left = body?.leaseLeftMs;
  return body?.status === "running" && typeof left === "number" && now - arrivedAt >= left ? "interrupted" : body?.status;
}
