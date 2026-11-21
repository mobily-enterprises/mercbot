import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { BotsError, archivedBotRefusal } from "./botsError.js";
import { cleanName } from "./botRows.js";
import { additionsChange, changeRefusal, mayChangeBot } from "./botAdditions.js";
import { createCallerReaders } from "./records/recordRows.js";

/**
 * A bot's settings, the home's for everyone in it (D-112): its name, its additions (D-98) and whether it's the home's
 * main bot; and a bot deleted. Every method takes the call's options last.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/computer/server/types").Computer} dependencies.computer a deleted bot's computers go with it
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {(botIds: string[], change: string, options: object) => Promise<void>} dependencies.tellHome everyone in the home
 *   hears a bot changed (botList.js)
 * @param {(botId: string, options: object) => Promise<object>} dependencies.listedBot the bot as Team lists it
 */
export function createBotSettings({ records, computer, notices, tellHome, listedBot }) {
  const { bots, chats, archives } = records;
  const { personOf } = createCallerReaders();

  /**
   * Changes a bot: its name and its additions (its maker and the home's owners and admins, as Team offers them: 403 for
   * anyone else) and, with `main`, makes it the home's main bot, the one that's never deleted or archived (the route lets
   * only owners and admins). An archived bot is refused (409): unarchive it first. Answers the bot as Team lists it.
   * @param {{ name?: unknown, additions?: unknown, main?: unknown }} patch
   */
  async function updateBot(botId, patch = {}, options) {
    const changed = await retryLostInsertRace(options, () => chats.withTransaction(options, async (txOptions) => {
      const bot = await bots.get(botId, txOptions);
      if (bot.archived_at) throw archivedBotRefusal(bot);
      const columns = {};
      const mayChange = mayChangeBot(bot.made_by, personOf(txOptions), txOptions);
      if (patch.name !== undefined) {
        if (!mayChange) {
          throw new BotsError(403, `Only the person who made ${bot.name} and the home's owners and admins can rename it.`, {
            code: "bots_rename_forbidden"
          });
        }
        columns.name = cleanName(patch.name);
      }
      if (patch.additions !== undefined) {
        if (!mayChange) throw new BotsError(403, changeRefusal(bot.name), { code: "bots_additions_forbidden" });
        Object.assign(columns, additionsChange(patch.additions));
      }
      if (patch.main === true && !bot.is_main) {
        await bots.clearMain(txOptions);
        columns.is_main = true;
      }
      if (!Object.keys(columns).length) return null;
      await bots.update(bot.id, columns, txOptions);
      return bot;
    }));
    if (changed) await tellHome([changed.id], "changed", options);
    return listedBot(String(botId), options);
  }

  /**
   * Deletes a bot for everyone in the home, by whoever made it and the home's owners and admins (403 for anyone else),
   * never the main bot (409). Its seats in every chat go with it, and so does each person's direct chat with it
   * (ON DELETE CASCADE): those chats' computers and folders are removed, its other computers put to sleep, and what it
   * wrote elsewhere stays, its author gone. Everyone in the home hears it, and each person who had a direct chat with
   * it that the chat is gone.
   */
  async function deleteBot(botId, options) {
    const person = personOf(options);
    const { bot, seats, direct, people } = await chats.withTransaction(options, async (txOptions) => {
      const bot = await bots.get(botId, txOptions);
      if (!mayChangeBot(bot.made_by, person, txOptions)) {
        throw new BotsError(403, `Only the person who made ${bot.name} and the home's owners and admins can delete it.`, {
          code: "bots_delete_forbidden"
        });
      }
      if (bot.is_main) throw new BotsError(409, "Your main bot can't be deleted.", { code: "bots_main_bot_delete" });
      // Every chat it's in, the private ones the person can't open too, read before they go.
      const everyone = archives.forEveryone(txOptions);
      const seats = await archives.seatsOf(bot.id, txOptions);
      const direct = (await chats.byIds(seats.map((seat) => seat.chatId), everyone))
        .filter((chat) => String(chat.direct_bot_id) === String(bot.id))
        .map((chat) => String(chat.id));
      const people = await chats.peopleOf(direct, everyone);
      await bots.remove(bot.id, txOptions);
      return { bot, seats, direct, people };
    });
    const homeId = String(bot.workspace_id);
    const gone = new Set(direct);
    for (const chatId of direct) {
      const chatBotIds = seats.filter((seat) => seat.chatId === chatId).map((seat) => seat.id);
      await computer.chatRemoved({ homeId, chatId, chatBotIds })
        .catch((error) => console.warn("Removing a deleted bot's chat computers failed; the hourly sweep removes them.", error?.message));
    }
    const kept = seats.filter((seat) => !gone.has(seat.chatId)).map((seat) => seat.id);
    if (kept.length) {
      await computer.sleepHome(homeId, kept)
        .catch((error) => console.warn("Putting a deleted bot's computers to sleep failed; they sleep when idle.", error?.message));
    }
    for (const chatId of direct) {
      const chatPeople = (people.get(chatId) ?? []).map((entry) => String(entry.user_id));
      await notices.publishEach("bots", chatPeople, { type: "chat", chatId, change: "deleted" })
        .catch((error) => console.warn("Telling people a chat went failed; they see it on their next read.", error));
    }
    await tellHome([bot.id], "deleted", options);
    return { deleted: String(bot.id) };
  }

  return Object.freeze({
    updateBot,
    deleteBot
  });
}
