import { nextTick, ref } from "vue";

/**
 * Runs a search palette row: opens its chat, a bot's direct chat, a person's card on Team, a message, app, routine or
 * made file, or runs its command. A made file found in search opens in its viewer, a page in place of its chat (D-74);
 * each opens over the chat it's in (`chatId`).
 * @param {{
 *   selectChat: (chatId: string) => void,
 *   openDirect: (botId: string) => Promise<void>,
 *   openMember: (key: string) => void,
 *   showPage: (page: { path: string, botId: string, chatId?: string | null }) => void,
 *   store: import("../../types.js").ChatMessages,
 *   chatPanel: import("vue").Ref<{ showMessage(id: string): void } | null>,
 *   openApp: (pluginId: string) => void,
 *   openSettings: (section?: string) => void,
 *   setTheme: (theme: string) => void,
 *   showDetails: () => void,
 *   actions: Record<string, () => void>
 * }} options
 */
export function usePaletteRunner({ selectChat, openDirect, openMember, showPage, store, chatPanel, openApp, openSettings, setTheme, showDetails, actions }) {
  const foundFile = ref(null);

  async function openMessage({ chatId, id }) {
    selectChat(String(chatId));
    // A chat opens on its newest page; a message further back brings the pages down to it.
    await store.loadThrough(String(chatId), id);
    await nextTick();
    chatPanel.value?.showMessage(id);
  }

  async function runPaletteEntry(entry) {
    if (entry.kind === "file" && entry.file.kind === "page" && entry.file.botId) {
      showPage({ path: entry.file.path, botId: entry.file.botId, chatId: entry.file.chatId || null });
      return;
    }
    if (entry.kind === "file") {
      // A view isn't any one chat's: it opens over whatever is showing.
      if (entry.file.chatId) selectChat(String(entry.file.chatId));
      foundFile.value = entry.file;
      return;
    }
    if (entry.kind === "chat") selectChat(entry.chat.id);
    else if (entry.kind === "bot") await openDirect(String(entry.bot.id));
    else if (entry.kind === "person") openMember(`person:${entry.person.id}`);
    else if (entry.kind === "app") openApp(entry.plugin.id);
    else if (entry.kind === "routine") {
      // A routine is in the chat it runs in, in that chat's details.
      if (entry.routine.chatId) selectChat(String(entry.routine.chatId));
      showDetails();
    } else if (entry.kind === "message") await openMessage({ chatId: entry.message.chatId, id: entry.message.id });
    else if (entry.id.startsWith("settings:")) openSettings(entry.id.slice(9));
    else if (entry.id.startsWith("theme:")) setTheme(entry.id.slice(6));
    else actions[entry.id]();
  }

  return { foundFile, runPaletteEntry };
}
