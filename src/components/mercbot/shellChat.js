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

/**
 * Whether a person's visit to a home with no chats yet shows the intro slides (MercbotIntro.vue): only in their first
 * home (D-36), and only when the copy (extensions.js `introSlides`) hasn't first-run screens of its own (D-142).
 * @param {number} homeCount how many homes the person has
 * @param {{ introSlides?: boolean }} extensions
 */
export const showsIntroSlides = (homeCount, extensions) => homeCount <= 1 && extensions.introSlides !== false;

/**
 * What a home's page waits for, with its chats, before it shows the shell (extensions.js `beforeShell`): every read the
 * copy asks for, so its shell parts know what to show from their first frame. A read that fails doesn't hold the shell.
 * @param {{ beforeShell?: Array<() => unknown> }} extensions
 * @returns {Promise<void>}
 */
export async function beforeShell(extensions) {
  await Promise.all((extensions.beforeShell || []).map((read) => Promise.resolve().then(read).catch(() => {})));
}

/**
 * The shell's check, as it starts, of what a copy built on Mercbot adds (extensions.js): a copy still written for a
 * shape that's gone stops here, naming the fix, instead of losing its part without a word.
 * @param {Record<string, unknown>} extensions
 */
export function checkExtensions(extensions) {
  if ("teamActions" in extensions) throw new Error("extensions.teamActions is gone: use peopleActions, the People section's +.");
  if ((extensions.peopleActions || []).length > 1) throw new Error("extensions.peopleActions takes at most one: the People section's +.");
}
