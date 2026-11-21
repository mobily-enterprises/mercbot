import { chatsApi } from "@/components/mercbot/chatsApi.js";
import { saveDraft } from "@/components/mercbot/useDrafts.js";

/** Opens a chat on the home's chat page (usePaths().page("/")) with a first line ready to finish and send. */
async function openWithLine(router, page, chat, line) {
  saveDraft(String(chat.id), line);
  await router.push({ path: page, query: { chat: String(chat.id) } });
}

/**
 * A view's Ask: the person's direct chat with the view's bot (made on first use), with a first line. When that chat
 * can't be read here, the shell opens it by the bot (?bot=) and says what went wrong there, without the line.
 * @param {import("vue-router").Router} router
 * @param {{ chat: string, botId: string, line: string }} where `chat` is the home's chat page, from usePaths().page("/").
 */
export async function askInChat(router, { chat, botId, line }) {
  let direct = null;
  try {
    direct = (await chatsApi.direct(botId)).chat;
  } catch {
    await router.push({ path: chat, query: { bot: String(botId) } });
    return;
  }
  await openWithLine(router, chat, direct, line);
}

/**
 * Ask Builder (D-41): the app's chat with the Builder, made the first time anyone asks, with a first line. A refusal
 * (no Builder, 409 apps_builder_missing; an app that isn't there, 404) is the caller's to explain.
 * @param {import("vue-router").Router} router
 * @param {{ chat: string, appSlug: string, line: string }} where `chat` is the home's chat page.
 */
export async function askBuilder(router, { chat, appSlug, line }) {
  const { chat: appChat } = await chatsApi.appChat(appSlug);
  await openWithLine(router, chat, appChat, line);
}
