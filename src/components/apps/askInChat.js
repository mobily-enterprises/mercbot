/**
 * Opens a person's chat with a bot with a first line ready to finish and send.
 * @param {import("vue-router").Router} router
 * @param {{ chat: string, botId: string, line: string }} where `chat` is the home's chat page, from usePaths().page("/").
 */
export function askInChat(router, { chat, botId, line }) {
  try {
    const drafts = JSON.parse(window.localStorage.getItem("mercbot.drafts") || "{}") || {};
    drafts[botId] = line;
    window.localStorage.setItem("mercbot.drafts", JSON.stringify(drafts));
  } catch {
    // Without storage the chat opens empty.
  }
  router.push({ path: chat, query: { bot: botId } });
}
