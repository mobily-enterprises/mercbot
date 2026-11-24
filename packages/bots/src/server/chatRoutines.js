import { BotsError, archivedBotRefusal } from "./botsError.js";
import { nextRunAt } from "./routineSchedule.js";
import { createCallerReaders } from "./records/recordRows.js";

/**
 * Routines as people see and switch them (D-112, R11): each belongs to a bot in a chat (`chat_bot_id`) and runs as the
 * person who made it (R4). A chat lists its own; a bot's card on Team lists its routines in the chats the viewer can
 * open, and no others. Anyone who can open a routine's chat pauses or deletes it; only the person it runs as resumes
 * it, and not while its bot or its chat is archived. Routines are made and changed from chat (routineTools.js). Every
 * method takes the call's options last: the person is its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 */
export function createChatRoutines({ records }) {
  const { bots, chats, directory, work } = records;
  const { personOf } = createCallerReaders();

  /**
   * The chats and bots routines and watches name, as people see them (D-132): each chat by its id with its title (a
   * direct chat by its bot and person: "you" or their name) and whether it's archived, and each bot by its id. Three
   * reads for any number of chats.
   * @param {string[]} chatIds
   * @param {string[]} botIds
   */
  async function places(chatIds, botIds, options) {
    const person = personOf(options);
    const rows = await chats.byIds([...new Set(chatIds)], options);
    const direct = rows.map((row) => row.direct_user_id).filter((id) => id != null && String(id) !== person);
    const wantedBots = [...new Set([...botIds, ...rows.map((row) => row.direct_bot_id).filter((id) => id != null)].map(String))];
    const [names, botRows] = await Promise.all([chats.names(direct, options), bots.byIds(wantedBots, options)]);
    const botOf = new Map(botRows.map((bot) => [String(bot.id), bot]));
    const titleOf = (chat) => {
      if (chat.title) return chat.title;
      if (chat.direct_user_id == null) return null;
      const who = String(chat.direct_user_id) === person ? "you" : names.get(String(chat.direct_user_id)) || "Someone";
      return `${botOf.get(String(chat.direct_bot_id))?.name || "A bot"} and ${who}`;
    };
    const chatOf = new Map(rows.map((row) => [String(row.id), { title: titleOf(row), archived: Boolean(row.archived_at) }]));
    return { chatOf, botOf };
  }

  /**
   * Routines as the page shows them, each naming its bot and chat, with its schedule, its last and next run and its
   * failures in a row, and whether the person may resume it. Three reads for any number of chats.
   * @param {object[]} routines records.work rows
   * @param {Map<string, { botId: string, chatId: string }>} seats each routine's bot in a chat, by chat_bots id
   */
  async function shown(routines, seats, options) {
    const person = personOf(options);
    const chatIds = routines.map((routine) => seats.get(String(routine.chatBotId))?.chatId).filter(Boolean);
    const { chatOf, botOf } = await places(chatIds, [...new Set([...seats.values()].map((seat) => seat.botId))], options);
    return routines.flatMap((routine) => {
      const seat = seats.get(String(routine.chatBotId));
      const chat = seat && chatOf.get(seat.chatId);
      if (!chat) return [];
      const madeBy = routine.madeBy == null ? null : String(routine.madeBy);
      return [{
        id: String(routine.id),
        name: routine.name,
        schedule: routine.schedule,
        enabled: Boolean(routine.enabled),
        once: Boolean(routine.once),
        failures: Number(routine.failures) || 0,
        nextRunAt: routine.nextRunAt ?? null,
        lastRunAt: routine.lastRunAt ?? null,
        botId: seat.botId,
        chatId: seat.chatId,
        chatTitle: chat.title,
        madeBy,
        canResume: madeBy === person && !chat.archived && !botOf.get(seat.botId)?.archived_at
      }];
    });
  }

  /** A chat's routines, the routines of every bot in it, for anyone who can open it (404 otherwise). */
  async function routinesIn(chatId, options) {
    const chat = await chats.get(chatId, options);
    const seats = await directory.botsInChat(chat.id, options);
    const byId = new Map(seats.map((seat) => [seat.id, { botId: seat.botId, chatId: String(chat.id) }]));
    return { routines: await shown(await work.routinesIn([...byId.keys()], options), byId, options) };
  }

  /** A bot's routines in the chats the person can open, and no others (R11): its card's Routines on Team. */
  async function routinesOf(botId, options) {
    const bot = await bots.get(botId, options);
    const seats = await directory.seatsOfBot(bot.id, options);
    const byId = new Map(seats.map((seat) => [seat.id, { botId: String(bot.id), chatId: seat.chatId }]));
    return { routines: await shown(await work.routinesIn([...byId.keys()], options), byId, options) };
  }

  /**
   * Every routine in the chats the person can open, and no others (R11): the home's recurring tasks (D-132). Four reads
   * for any number of routines.
   */
  async function routinesOfHome(options) {
    const routines = await work.routinesOfHome(options);
    const found = await directory.seats(routines.map((routine) => String(routine.chatBotId)), options);
    const byId = new Map(found.map((seat) => [seat.id, { botId: seat.botId, chatId: seat.chatId }]));
    return shown(routines, byId, options);
  }

  /** The routine, which the person can reach through its chat, with its bot in that chat; a 404 otherwise. */
  async function reachable(routineId, options) {
    const routine = await work.routine(routineId, options);
    const seat = routine && await chats.chatBot(routine.chatBotId, options);
    if (!seat) throw new BotsError(404, "Routine not found.", { code: "bots_routine_not_found" });
    return { routine, seat: { botId: String(seat.bot_id), chatId: String(seat.conversation_id) } };
  }

  /**
   * A routine paused or resumed. Pausing is anyone's who can open its chat. Resuming is only the person it runs as
   * (403 for anyone else: it would act as them), never while its bot or chat is archived (409), and starts its count of
   * failures in a row again (a routine pauses itself at five) and its next run from now. Answers the routine.
   */
  async function switchRoutine(routineId, enabled, options) {
    if (typeof enabled !== "boolean") throw new BotsError(400, "Say whether the routine is on or off.", { code: "bots_routine_enabled" });
    const { routine, seat } = await reachable(routineId, options);
    const changes = { enabled };
    if (enabled) {
      if (String(routine.madeBy) !== personOf(options)) {
        throw new BotsError(403, "Only the person who made this routine can resume it: it runs as them.", { code: "bots_routine_resume_forbidden" });
      }
      const [bot, chat] = await Promise.all([bots.get(seat.botId, options), chats.get(seat.chatId, options)]);
      if (bot.archived_at) throw archivedBotRefusal(bot);
      if (chat.archived_at) throw new BotsError(409, "This chat is archived. Unarchive it to continue.", { code: "bots_chat_archived" });
      changes.failures = 0;
      if (routine.cron) changes.nextRunAt = nextRunAt(routine.cron, routine.timezone);
    }
    const changed = await work.changeRoutine(routine.id, changes, options);
    if (!changed) throw new BotsError(404, "Routine not found.", { code: "bots_routine_not_found" });
    const [shownRoutine] = await shown([changed], new Map([[String(changed.chatBotId), seat]]), options);
    return { routine: shownRoutine };
  }

  /** A routine deleted, by anyone who can open its chat. */
  async function deleteRoutine(routineId, options) {
    const { routine } = await reachable(routineId, options);
    if (!(await work.deleteRoutine(routine.id, routine.chatBotId, options))) {
      throw new BotsError(404, "Routine not found.", { code: "bots_routine_not_found" });
    }
    return { deleted: String(routine.id) };
  }

  return Object.freeze({
    routinesIn,
    routinesOf,
    routinesOfHome,
    places,
    switchRoutine,
    deleteRoutine
  });
}
