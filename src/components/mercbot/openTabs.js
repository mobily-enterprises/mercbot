// A Shared bot's files and computer follow the conversation they're shown in (D-99): a shared tab's are the bot's
// for everyone, "You only" (the person's own conversation) theirs. So every address for them names the tab the bot
// has open on this page (?room=), unless it names a group (D-46) or a tab of its own. The shell says which tab each
// bot has open (MercbotShell: the message store's roomOf); until it does, the server uses the one last opened.
// readable-check: allow module-state - shared resource: the shell says once which tab each bot has open; every file and computer address reads it
let openTab = () => null;

/** @param {(botId: string) => string | null} roomOf the tab each bot has open, null for a bot with no tabs */
export function followOpenTabs(roomOf) {
  openTab = roomOf;
}

/** The tab a bot has open on this page, or null. */
export const openTabFor = (botId) => (botId ? openTab(String(botId)) : null);

/**
 * The query naming where a bot's files or computer are: `group=` for a bot's in a group (D-46), else `room=` for the
 * tab given, or with none given the one it has open. Empty when neither applies.
 * @param {string | null} botId
 * @param {{ group?: string | null, room?: string | null }} [where]
 */
export function placeQuery(botId, { group = null, room } = {}) {
  if (group) return `group=${encodeURIComponent(group)}`;
  const tab = room === undefined && botId ? openTab(String(botId)) : room;
  return tab ? `room=${encodeURIComponent(tab)}` : "";
}

/** A Shared bot's "You only" tab (D-99), the person's own conversation with it: its id, or null. */
export const ownTabOf = (bot) => bot.rooms?.find((room) => room.own)?.id ?? null;

/** Whether the bot's open tab is "You only" (D-99). */
export const ownTabOpen = (bot) => Boolean(bot.roomId) && bot.roomId === ownTabOf(bot);
