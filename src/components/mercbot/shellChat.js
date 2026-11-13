/**
 * The chat, as MercbotShell provides it to the parts a copy built on Mercbot adds (extensions.js: shellParts,
 * botActions and messageCards), under this key:
 * - appendMessages(botId, messages) and replaceMessage(botId, message) show messages a change made or rewrote in a
 *   bot's chat; updateBot(bot) merges a bot's new fields into the list;
 * - setWork(botId, text) and playMood(botId, steps) say what a bot is working on and how it looks meanwhile;
 * - showToast(text) confirms a step in the chat; reportFailure(text, cause) explains one that failed;
 * - holdKeys(isOpen) keeps Mercbot's keyboard shortcuts away while `isOpen()` says the part's own dialog is open, and
 *   answers the function that stops that, for when the part goes away.
 * @typedef {{
 *   appendMessages: (botId: string, messages: object[]) => void,
 *   replaceMessage: (botId: string, message: object) => void,
 *   updateBot: (bot: object) => void,
 *   setWork: (botId: string, text: string) => void,
 *   playMood: (botId: string, steps: object[]) => void,
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
