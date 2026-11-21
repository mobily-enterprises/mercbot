import { chatsApi } from "@/components/mercbot/chatsApi.js";
import { saveDraft } from "@/components/mercbot/useDrafts.js";

/**
 * Opens the person's direct chat with a bot (made on first use) with a first line ready to finish and send. When the
 * chat can't be read here, the shell opens it by the bot (?bot=) and says what went wrong there, without the line.
 * @param {import("vue-router").Router} router
 * @param {{ chat: string, botId: string, line: string }} where `chat` is the home's chat page, from usePaths().page("/").
 */
export async function askInChat(router, { chat, botId, line }) {
  let direct = null;
  try {
    direct = (await chatsApi.direct(botId)).chat;
    saveDraft(String(direct.id), line);
  } catch {
    direct = null;
  }
  await router.push({ path: chat, query: direct ? { chat: String(direct.id) } : { bot: String(botId) } });
}
