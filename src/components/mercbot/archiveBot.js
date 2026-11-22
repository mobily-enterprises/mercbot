import { currentLanguage } from "./shellPreferences.js";

// Archiving a whole bot (D-108, plan 5.1): a member of the home that has left, for everyone in it. It's listed under
// Under Archived bots in Bots, stays in its chats without answering, its routines and watches paused, until someone resumes it.
// Who may, the question asked first, and the lines an archived bot shows.

/**
 * Why the person can't archive the bot, or "" when they can: the server's rule (packages/bots botArchive.js), said
 * before asking, so the card offers Archive only where it works and says why not.
 * @param {{ id: string, name: string, isMain?: boolean, canArchive?: boolean }} bot
 * @param {string | null} builderId the home's Builder (builderBot.js)
 */
export function archiveRefusal(bot, builderId) {
  if (!bot.canArchive) return "Only its maker and the home's owners and admins can archive it.";
  if (bot.isMain) return "The main bot can't be archived. Make another bot main first.";
  if (builderId != null && String(builderId) === String(bot.id)) return "The Builder can't be archived. Choose another Builder first.";
  return "";
}

/**
 * The question before archiving, as short as the card's line (D-119): it leaves everyone's bots, its chats stay.
 * @param {{ name: string }} bot
 */
export function archiveBotQuestion(bot) {
  return {
    title: `Archive ${bot.name}?`,
    text: "Removes it for everyone. Its chats stay.",
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

/**
 * An archived bot's line on its card and in Archived bots (plan 4.2): "Bot · left 20 Nov", with the year when it isn't this year's.
 * @param {{ archivedAt: string }} bot
 * @param {string} [language] the person's (shellPreferences)
 * @param {Date} [now]
 */
export function leftLine(bot, language = currentLanguage(), now = new Date()) {
  const at = new Date(bot.archivedAt);
  const year = at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" };
  return `Bot · left ${new Intl.DateTimeFormat(language, { day: "numeric", month: "short", ...year }).format(at)}`;
}
