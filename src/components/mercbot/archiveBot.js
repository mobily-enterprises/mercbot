import { currentLanguage } from "./shellPreferences.js";

// Archiving a whole bot (D-108): put away for everyone in the home in the sidebar's Archived bots, its chats kept and
// read-only, its routines and watches paused, until someone unarchives it. Who may, the question asked first, and the
// line an archived bot shows.

/**
 * Why the person can't archive the bot, or "" when they can: the server's rule (packages/bots botArchive.js), said
 * before asking, so a menu offers Archive only where it works and Details says why not.
 * @param {{ id: string, name: string, kind?: string, isMain?: boolean, canArchive?: boolean }} bot
 * @param {string | null} builderId the home's Builder (builderBot.js)
 */
export function archiveRefusal(bot, builderId) {
  if (bot.kind === "group") return "A group chat can't be archived. Leave it or delete it instead.";
  if (!bot.canArchive) return `Only the person who made ${bot.name} and the home's owners and admins can archive it.`;
  if (bot.isMain) return `${bot.name} is this home's main bot, so it can't be archived. Make another bot the main bot first.`;
  if (builderId != null && String(builderId) === String(bot.id)) {
    return `${bot.name} builds this home's apps, so it can't be archived. Choose another Builder in Apps first.`;
  }
  return "";
}

/**
 * The question before archiving: who it's put away for, what stops, and that it comes back.
 * @param {{ name: string }} bot
 */
export function archiveBotQuestion(bot) {
  return {
    title: `Archive ${bot.name}?`,
    text:
      "It moves to Archived bots for everyone in this home: its chats become read-only, and its routines and watches pause. " +
      "Nothing is deleted. Whoever made it, or an owner or admin, can unarchive it.",
    confirmLabel: "Archive"
  };
}

/**
 * An archived bot's line: who archived it ("you", a name, or nobody known) and the day, as "Archived by Ana on 21 Nov
 * 2026".
 * @param {{ archivedAt: string, archivedBy?: string | null }} bot
 * @param {string} [language] the person's (shellPreferences)
 */
export function archivedBotLine(bot, language = currentLanguage()) {
  const day = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(new Date(bot.archivedAt));
  return bot.archivedBy ? `Archived by ${bot.archivedBy} on ${day}` : `Archived on ${day}`;
}
