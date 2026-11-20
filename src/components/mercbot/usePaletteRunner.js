import { nextTick, ref } from "vue";
import { shellPreferences } from "./shellPreferences.js";

/**
 * Runs a search palette row: opens its conversation, message, app, routine or made
 * file, or runs its command. A made file found in search opens in its chat's viewer, a page in place of its chat (D-74).
 * A Shared bot's message, routine or file opens in the tab it's in (`roomId`), shared or "You only" (D-99).
 * @param {{
 *   selectBot: (botId: string) => void,
 *   selectRoom: (roomId: string, botId: string) => Promise<void>,
 *   showPage: (page: { path: string, botId: string, chatBot?: string }) => void,
 *   store: import("../../types.js").BotMessages,
 *   chatPanel: import("vue").Ref<{ showMessage(id: string): void } | null>,
 *   openApp: (pluginId: string) => void,
 *   openSettings: (section?: string) => void,
 *   setTheme: (theme: string) => void,
 *   actions: Record<string, () => void>
 * }} options
 */
export function usePaletteRunner({ selectBot, selectRoom, showPage, store, chatPanel, openApp, openSettings, setTheme, actions }) {
  const foundFile = ref(null);

  // The bot, in the tab its result is in.
  async function openIn(botId, roomId) {
    selectBot(botId);
    if (roomId) await selectRoom(roomId, botId);
  }

  async function openMessage({ conversationId, roomId, id }) {
    await openIn(conversationId, roomId);
    // A chat opens on its newest page; a message further back brings the pages down to it.
    await store.loadThrough(conversationId, id);
    await nextTick();
    chatPanel.value?.showMessage(id);
  }

  async function runPaletteEntry(entry) {
    if (entry.kind === "file" && entry.file.kind === "page" && entry.file.botId) {
      if (entry.file.roomId) await selectRoom(entry.file.roomId, entry.file.botId);
      showPage({ path: entry.file.path, botId: entry.file.botId, chatBot: entry.file.botId });
      return;
    }
    if (entry.kind === "file") {
      // A view isn't any one bot's: it opens over whatever is showing.
      if (entry.file.botId) await openIn(entry.file.botId, entry.file.roomId);
      foundFile.value = entry.file;
      return;
    }
    if (entry.kind === "conversation") selectBot(entry.bot.id);
    else if (entry.kind === "app") openApp(entry.plugin.id);
    else if (entry.kind === "routine") {
      await openIn(entry.routine.botId, entry.routine.roomId);
      shellPreferences.detailsOpen = true;
      shellPreferences.detailsTab = "details";
    } else if (entry.kind === "message") await openMessage({ conversationId: entry.message.conversationId, roomId: entry.message.roomId, id: entry.message.id });
    else if (entry.id === "members") {
      shellPreferences.detailsOpen = true;
      shellPreferences.detailsTab = "members";
    } else if (entry.id.startsWith("settings:")) openSettings(entry.id.slice(9));
    else if (entry.id.startsWith("theme:")) setTheme(entry.id.slice(6));
    else actions[entry.id]();
  }

  return { foundFile, runPaletteEntry };
}
