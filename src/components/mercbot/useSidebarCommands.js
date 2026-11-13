import { botsApi } from "./botsApi.js";
import { shellPreferences } from "./shellPreferences.js";

/**
 * Sidebar commands. Each one changes the server, then the local state from its answer.
 * `editingSectionId` is the section being renamed and `store` the shell's messages (useBotMessages).
 * `currentBotId` names the open bot; after deleting it, `reopen(botId)` opens another: the main bot
 * for a group (`mainBotId`), otherwise the first in the list (`firstBotId`). `dropBot` takes a
 * conversation off the list, `open` holds the account menu's dialogs, `copy` copies text to the
 * clipboard and `reportFailure` explains a command that failed.
 * @param {object} options
 * @param {import("vue").Ref<Array<Record<string, any>>>} options.bots The sidebar's bots.
 * @param {import("vue").Ref<Array<Record<string, any>>>} options.sections The sidebar's sections.
 */
export function useSidebarCommands({
  bots,
  sections,
  editingSectionId,
  store,
  currentBotId,
  mainBotId,
  firstBotId,
  reopen,
  dropBot,
  open,
  copy,
  reportFailure
}) {
  const setBot = (botId, changes) => botsApi.update(botId, changes).then(({ bot }) => store.updateBot(bot));
  const takeSections = (result) => {
    store.mergeBots(result.bots);
    sections.value = result.sections;
  };

  const COMMANDS = {
    pin: ({ botId }) => setBot(botId, { pinned: true }),
    unpin: ({ botId }) => setBot(botId, { pinned: false }),
    markUnread: ({ botId }) => botsApi.update(botId, { unread: true }).then(({ bot }) => store.updateBot({ ...bot, unread: true })),
    markRead: ({ botId }) => setBot(botId, { unread: false }),
    hide: ({ botId }) => setBot(botId, { hidden: true }),
    show: ({ botId }) => setBot(botId, { hidden: false }),
    renameBot: ({ botId, name }) => setBot(botId, { name }),
    setLabel: ({ botId, label }) => setBot(botId, { label }),
    moveBot: ({ botId, sectionId }) => setBot(botId, { sectionId }),
    copyId: ({ botId }) => copy(`mbc-${botId}`, "Conversation ID copied"),
    // The old main bot changes too, so read the whole list again.
    makeMain: ({ botId }) => botsApi.update(botId, { main: true }).then(async () => store.mergeBots((await botsApi.list()).bots)),
    deleteBot: async ({ botId }) => {
      const wasOpen = botId === currentBotId();
      const group = bots.value.find((bot) => bot.id === botId)?.kind === "group";
      await botsApi.remove(botId);
      bots.value = bots.value.filter((bot) => bot.id !== botId);
      // A deleted group opens the main bot; a deleted bot leaves its groups.
      if (wasOpen) reopen((group && mainBotId()) || firstBotId());
      if (!group) store.mergeBots((await botsApi.list()).bots);
    },
    addMember: ({ groupId, botId }) => botsApi.addMember(groupId, botId).then(({ bot }) => store.updateBot(bot)),
    removeMember: ({ groupId, botId }) => botsApi.removeMember(groupId, botId).then(({ bot }) => store.updateBot(bot)),
    addPerson: ({ groupId, userId }) => botsApi.addPerson(groupId, userId).then(({ bot }) => store.updateBot(bot)),
    // Leaving, or the last one out ending the group, takes it off the list (D-46).
    removePerson: ({ groupId, userId }) =>
      botsApi.removePerson(groupId, userId).then((result) => (result.bot ? store.updateBot(result.bot) : dropBot(groupId))),
    reorderPins: ({ botIds }) => botsApi.reorderPins(botIds).then((result) => store.mergeBots(result.bots)),
    createSection: async ({ botId }) => {
      const result = await botsApi.createSection("New section", botId);
      const known = new Set(sections.value.map((section) => section.id));
      takeSections(result);
      editingSectionId.value = result.sections.find((section) => !known.has(section.id))?.id || "";
    },
    renameSection: ({ sectionId, name }) =>
      botsApi.updateSection(sectionId, { name }).then(({ section }) => {
        editingSectionId.value = "";
        sections.value = sections.value.map((entry) => (entry.id === section.id ? section : entry));
      }),
    toggleSection: ({ section }) => {
      sections.value = sections.value.map((entry) => (entry.id === section.id ? { ...entry, collapsed: !entry.collapsed } : entry));
      return botsApi.updateSection(section.id, { collapsed: !section.collapsed });
    },
    moveSection: ({ sectionId, direction }) => botsApi.moveSection(sectionId, direction).then(takeSections),
    deleteSection: ({ sectionId }) => botsApi.removeSection(sectionId).then(takeSections),
    toggleHidden: () => {
      shellPreferences.hiddenExpanded = !shellPreferences.hiddenExpanded;
    },
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
      reportFailure("That didn't work. Try again.", error);
    }
  }

  return { runCommand };
}
