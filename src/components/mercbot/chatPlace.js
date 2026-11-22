// Where a bot's files and computer are (D-112, R6, D14): a bot in a chat has its own computer and works in the chat's
// folder, so every address for them names the chat (?chat=<id>); without one, a file address is the bot's own folder
// (its Knowledge files, and pages shared there from a public chat). The shell says which chat is open (MercbotShell:
// followOpenChat); an address for another chat names it.
// readable-check: allow module-state - shared resource: the shell says once which chat is open; every file and computer address reads it
let openChat = () => null;

/** @param {() => string | null} chatOf the chat open on this page, or null while none is */
export function followOpenChat(chatOf) {
  openChat = chatOf;
}

/** The chat open on this page, or null. */
export const openChatId = () => openChat() ?? null;

/**
 * The query naming the chat whose files or computer an address means: the one given, or with none given the open one.
 * `null` names none: the bot's own folder. Empty when there's no chat.
 * @param {{ chat?: string | null }} [where]
 */
export function placeQuery({ chat } = {}) {
  const id = chat === undefined ? openChat() : chat;
  return id ? `chat=${encodeURIComponent(id)}` : "";
}
