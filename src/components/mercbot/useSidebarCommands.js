import { botsApi } from "./botsApi.js";
import { chatsApi } from "./chatsApi.js";
import { shellPreferences } from "./shellPreferences.js";

/**
 * The shell's commands, from the sidebar's menus, Team, a member's card and Chat details. Each one changes the server,
 * then the local state from its answer. `store` holds the chats (useChatMessages), `team` the home's members (useTeam);
 * `editingSectionId` is the section being renamed. `dropChat` takes a chat off the list (and opens another if it was
 * open), `open` holds the account menu's dialogs, `copy` copies text to the clipboard and `reportFailure` explains a
 * command that failed: the server's own words where it refused (who may, D-112). `homeName` names the home, for the
 * everyone chat's refusals.
 * @param {object} options
 * @param {import("vue").Ref<Array<import("../../types.js").ChatSection>>} options.sections The sidebar's sections.
 */
export function useSidebarCommands({ sections, editingSectionId, store, team, dropChat, open, copy, reportFailure, homeName }) {
  const place = (chatId, changes) => chatsApi.changePlace(chatId, changes).then(({ chat }) => store.updateChat(chat));
  const takeList = (result) => {
    store.mergeChats(result.chats);
    sections.value = result.sections;
  };
  /** A chat change the server answers with the chat, or with it gone for this person. */
  const changed = (result, chatId) => {
    if (result?.chat) store.updateChat(result.chat);
    else dropChat(chatId);
  };

  // The everyone chat has everyone in the home (O9): no one leaves it, or is taken out of it, but by leaving the home.
  const EVERYONE_REFUSED = {
    leaveChat: () => `Everyone in ${homeName()} is in this chat. You leave it only by leaving the home.`,
    removePerson: () => `Everyone in ${homeName()} is in this chat, so no one can be taken out of it.`
  };
  // A refusal the server words (who may, a chat archived meanwhile, a direct chat taking no one else) is said as is.
  const said = (name, error) => {
    if (error?.code === "bots_chat_everyone") return (EVERYONE_REFUSED[name] || EVERYONE_REFUSED.removePerson)();
    return [403, 404, 409].includes(error?.status) && error.message;
  };

  const COMMANDS = {
    pin: ({ chatId }) => place(chatId, { pinned: true }),
    unpin: ({ chatId }) => place(chatId, { pinned: false }),
    markUnread: ({ chatId }) => place(chatId, { unread: true }),
    markRead: ({ chatId }) => place(chatId, { unread: false }),
    hide: ({ chatId }) => place(chatId, { hidden: true }),
    show: ({ chatId }) => place(chatId, { hidden: false }),
    mute: ({ chatId }) => place(chatId, { muted: true }),
    unmute: ({ chatId }) => place(chatId, { muted: false }),
    moveChat: ({ chatId, sectionId }) => place(chatId, { sectionId }),
    copyId: ({ chatId }) => copy(`mbc-${chatId}`, "Chat ID copied"),
    renameChat: ({ chatId, title }) => chatsApi.rename(chatId, title).then(({ chat }) => store.updateChat(chat)),
    archiveChat: ({ chatId }) => chatsApi.archive(chatId).then(({ chat }) => store.updateChat(chat)),
    unarchiveChat: ({ chatId }) => chatsApi.unarchive(chatId).then(({ chat }) => store.updateChat(chat)),
    joinChat: ({ chatId }) => chatsApi.join(chatId).then(({ chat }) => store.updateChat(chat)),
    // Leaving a private chat, or the last person leaving it (which deletes it), takes it off the list.
    leaveChat: ({ chatId }) => chatsApi.leave(chatId).then((result) => changed(result, chatId)),
    deleteChat: ({ chatId }) => chatsApi.remove(chatId).then(() => dropChat(chatId)),
    addPerson: ({ chatId, userId }) => chatsApi.addPerson(chatId, userId).then(({ chat }) => store.updateChat(chat)),
    removePerson: ({ chatId, userId }) => chatsApi.removePerson(chatId, userId).then((result) => changed(result, chatId)),
    addBot: ({ chatId, botId }) => chatsApi.addBot(chatId, botId).then(({ chat }) => store.updateChat(chat)),
    removeBot: ({ chatId, botId }) => chatsApi.removeBot(chatId, botId).then(({ chat }) => store.updateChat(chat)),
    reorderPins: ({ chatIds }) => chatsApi.reorderPins(chatIds).then(takeList),
    createSection: async ({ chatId }) => {
      const result = await chatsApi.createSection("New section", chatId);
      const known = new Set(sections.value.map((section) => section.id));
      takeList(result);
      editingSectionId.value = result.sections.find((section) => !known.has(section.id))?.id || "";
    },
    renameSection: ({ sectionId, name }) =>
      chatsApi.updateSection(sectionId, { name }).then(({ section }) => {
        editingSectionId.value = "";
        sections.value = sections.value.map((entry) => (entry.id === section.id ? section : entry));
      }),
    toggleSection: ({ section }) => {
      sections.value = sections.value.map((entry) => (entry.id === section.id ? { ...entry, collapsed: !entry.collapsed } : entry));
      return chatsApi.updateSection(section.id, { collapsed: !section.collapsed });
    },
    moveSection: ({ sectionId, direction }) => chatsApi.moveSection(sectionId, direction).then(takeList),
    deleteSection: ({ sectionId }) => chatsApi.removeSection(sectionId).then(takeList),
    toggleHidden: () => {
      shellPreferences.hiddenExpanded = !shellPreferences.hiddenExpanded;
    },
    toggleArchived: () => {
      shellPreferences.archivedExpanded = !shellPreferences.archivedExpanded;
    },
    // The home's bots (Team and a bot's card): a bot renamed, made the main bot (the old main changes too, so the whole
    // list is read again), archived or unarchived for everyone (D-108). Archiving replaced deleting (D11).
    renameBot: ({ botId, name }) => botsApi.update(botId, { name }).then(({ bot }) => team.updateBot(bot)),
    makeMain: ({ botId }) => botsApi.update(botId, { main: true }).then(() => team.loadBots()),
    archiveBot: ({ botId }) => botsApi.archiveBot(botId).then(({ bot }) => team.updateBot(bot)),
    unarchiveBot: ({ botId }) => botsApi.unarchiveBot(botId).then(({ bot }) => team.updateBot(bot)),
    // The account menu's support items.
    openShortcuts: () => {
      open.shortcuts.value = true;
    },
    openAbout: () => {
      open.about.value = true;
    },
    openSettings: () => open.settings("general"),
    openUsage: () => open.settings("usage")
  };

  async function runCommand({ name, args }) {
    try {
      await COMMANDS[name](args);
    } catch (error) {
      reportFailure(said(name, error) || "That didn't work. Try again.", error);
    }
  }

  return { runCommand };
}
