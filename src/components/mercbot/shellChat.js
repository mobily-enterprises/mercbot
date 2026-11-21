/**
 * The chat, as MercbotShell provides it to its parts and to the parts a copy built on Mercbot adds (extensions.js:
 * shellParts, botActions and messageCards), under this key:
 * - appendMessages(chatId, messages) and replaceMessage(chatId, message) show messages a change made or rewrote in a
 *   chat; updateChat(chat) merges a chat's new fields into the list; openChat(chatId) opens a chat;
 * - setWork(chatId, text) and playMood(chatId, steps) say what a chat's bots are working on and how they look meanwhile;
 * - showToast(text) confirms a step in the chat; reportFailure(text, cause) explains one that failed;
 * - holdKeys(isOpen) keeps Mercbot's keyboard shortcuts away while `isOpen()` says the part's own dialog is open, and
 *   answers the function that stops that, for when the part goes away.
 * @typedef {{
 *   appendMessages: (chatId: string, messages: object[]) => void,
 *   replaceMessage: (chatId: string, message: object) => void,
 *   updateChat: (chat: object) => void,
 *   openChat: (chatId: string) => void,
 *   setWork: (chatId: string, text: string) => void,
 *   playMood: (chatId: string, steps: object[]) => void,
 *   showToast: (text: string) => void,
 *   reportFailure: (text: string, cause?: unknown) => void,
 *   holdKeys: (isOpen: () => boolean) => () => void
 * }} ShellChat
 */
export const MERCBOT_CHAT_KEY = "mercbotChat";

/**
 * The parts' holds on the keyboard, behind the chat's holdKeys: `hold(isOpen)` adds one and answers the function that
 * removes it; `held()` says whether any part's dialog is open now, so the shell's shortcuts wait.
 */
export function createKeyHolds() {
  const holds = new Set();
  function hold(isOpen) {
    holds.add(isOpen);
    return () => holds.delete(isOpen);
  }
  function held() {
    return [...holds].some((isOpen) => isOpen());
  }
  return Object.freeze({
    hold,
    held
  });
}
