import { BotsError } from "./botsError.js";
import { mayChangeBot } from "./botAdditions.js";
import { createCallerReaders } from "./records/recordRows.js";

/**
 * A whole bot archived, and unarchived as it was (D-108, D-112: a member of the home who has left). Archived, it stays a
 * member of every chat it's in, shown as left, and never speaks there (R3); its routines and watches pause with a line
 * where they were, its computers go to sleep, and nothing it does costs anything until someone unarchives it. Its chats
 * and files are kept; its direct chats are read-only while it's away. Unarchived, it's back as it was, its work still
 * paused until someone resumes it, so nothing starts again unexpectedly. Whoever made it and the home's owners and
 * admins do either. Every method takes the call's options last: the person is its context, never an id it's given.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps which bot builds the home's apps
 * @param {import("@local/computer/server/types").Computer} dependencies.computer an archived bot's computers sleep
 * @param {(seats: Array<{ id: string, chatId: string }>, line: { text: string, detail: (paused: string) => string }, txOptions: object) => Promise<void>}
 *   dependencies.pauseWork the routines and watches of some bots in chats paused, with a line in each chat naming them
 *   (chatTurns.js)
 * @param {(botIds: string[], change: string, options: object) => Promise<void>} dependencies.tellHome everyone in the home
 *   hears a bot changed (botList.js)
 * @param {(botId: string, options: object) => Promise<object>} dependencies.listedBot the bot as Team lists it
 */
export function createBotArchive({ records, apps, computer, pauseWork, tellHome, listedBot }) {
  const { bots, chats, archives } = records;
  const { personOf } = createCallerReaders();

  /**
   * The bot the person may archive, or with `unarchiving` unarchive: one of the home's, for whoever made it and the
   * home's owners and admins (403 for anyone else, decided before anything about the bot is said). The home's main bot
   * and its Builder, which others reach for, aren't archived: another must take their place first.
   */
  async function botTarget(botId, options, { unarchiving = false } = {}) {
    const bot = await bots.get(botId, options);
    if (!mayChangeBot(bot.made_by, personOf(options), options)) {
      const verb = unarchiving ? "unarchive" : "archive";
      throw new BotsError(403, `Only the person who made ${bot.name} and the home's owners and admins can ${verb} it.`, {
        code: "bots_archive_forbidden"
      });
    }
    if (unarchiving) return bot;
    if (bot.is_main) {
      throw new BotsError(409, `${bot.name} is this home's main bot, so it can't be archived. Make another bot the main bot first.`, {
        code: "bots_archive_main"
      });
    }
    if (String((await apps.apps.builder(options))?.id) === String(bot.id)) {
      throw new BotsError(409, `${bot.name} builds this home's apps, so it can't be archived. Make another bot the Builder from its card in Bots first.`, {
        code: "bots_archive_builder"
      });
    }
    return bot;
  }

  /**
   * Archives a bot for everyone in the home: in every chat it's in, the private ones the person can't open too, its
   * routines and watches pause, a line there naming them, and its computers go to sleep. Archiving one already archived
   * changes nothing. Answers the bot as Team lists it; everyone in the home hears it, and the people of each chat with a
   * line in it hear that chat's news (pauseWork).
   */
  async function archiveBot(botId, options) {
    const { bot, seats } = await chats.withTransaction(options, async (txOptions) => {
      const found = await botTarget(botId, txOptions);
      if (!(await archives.markBotArchived(found.id, true, txOptions))) return { bot: found, seats: [] };
      const seats = await archives.seatsOf(found.id, txOptions);
      await pauseWork(seats, {
        text: "Paused while archived",
        detail: (paused) => `${found.name} was archived, so its ${paused} paused. They stay paused when it's resumed: resume them here.`
      }, archives.forEveryone(txOptions));
      return { bot: found, seats };
    });
    if (seats.length) {
      await computer.sleepHome(String(bot.workspace_id), seats.map((seat) => seat.id))
        .catch((error) => console.warn("Putting an archived bot's computers to sleep failed; they sleep when idle.", error?.message));
    }
    await tellHome([bot.id], "archived", options);
    return { bot: await listedBot(String(bot.id), options) };
  }

  /**
   * Unarchives a bot, by the same rule as archiving it: it's back in every chat it was in, as it was. Its paused routines
   * and watches wait for someone to resume them, as the line where they paused says. Answers the bot as Team lists it.
   */
  async function unarchiveBot(botId, options) {
    const bot = await chats.withTransaction(options, async (txOptions) => {
      const found = await botTarget(botId, txOptions, { unarchiving: true });
      return (await archives.markBotArchived(found.id, false, txOptions)) ? found : null;
    });
    if (bot) await tellHome([bot.id], "unarchived", options);
    return { bot: await listedBot(String(botId), options) };
  }

  return Object.freeze({
    archiveBot,
    unarchiveBot
  });
}
