/**
 * Work paused where nobody sees it or can stop it (D-99, D-101, D-112): the routines and watches of the bots' seats
 * given (an archived bot), or those a person made in a home they left (a routine and a watch run as their maker, R4),
 * pause as a person pausing each would, and each chat with something paused says so in a line naming them, read when
 * it's seen again; its people hear of it. They stay paused until someone resumes them there, so nothing starts again
 * unexpectedly.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats where each chat's people hear of it
 */
export function createWorkPause({ records, apps, seats }) {
  /**
   * The line in each chat with something paused, naming what paused there.
   * @param {Array<{ chatBotId: string, name: string }>} paused
   * @param {Map<string, string>} chatOf each seat's chat, by seat
   */
  async function sayPaused(paused, chatOf, line, txOptions) {
    for (const [chatId, list] of Map.groupBy(paused, (entry) => chatOf.get(entry.chatBotId))) {
      await records.messages.append(chatId, [{
        kind: "event",
        role: "system",
        body: { text: line.text, icon: "routine", detail: line.detail(list.map((entry) => entry.name).join(", ")) }
      }], txOptions);
      await seats.tell(chatId, { type: "messages" }, txOptions);
    }
  }

  const named = (routines, watches) => [
    ...routines.map((routine) => ({ chatBotId: String(routine.chatBotId), name: `routine "${routine.name}"` })),
    ...watches.map((watch) => ({ chatBotId: String(watch.chatBotId), name: `watch "${watch.name}"` }))
  ];

  /**
   * @param {Array<{ id: string, chatId: string }>} chatBots the seats (chat_bots ids) whose work pauses, and their chats
   * @param {{ text: string, detail: (paused: string) => string }} line the line's title, and its words given what paused
   * @param {import("./types.js").CallOptions} txOptions a context that may write in each of those chats
   */
  async function pauseWork(chatBots, line, txOptions) {
    if (!chatBots.length) return;
    const chatOf = new Map(chatBots.map((seat) => [String(seat.id), String(seat.chatId)]));
    const chatBotIds = [...chatOf.keys()];
    const routines = await records.work.pauseRoutinesIn(chatBotIds, txOptions);
    const watches = await apps.watches.pauseIn({ chatBotIds }, txOptions);
    await sayPaused(named(routines, watches), chatOf, line, txOptions);
  }

  /**
   * The routines and watches a person made in a home, paused when they leave it.
   * @param {{ userId: string, homeId: string }} maker
   * @param {{ text: string, detail: (paused: string) => string }} line as pauseWork's
   * @param {import("./types.js").CallOptions} txOptions a context in that home that may write in each of its chats
   */
  async function pauseMadeBy({ userId, homeId }, line, txOptions) {
    const routines = await records.work.pauseRoutinesMadeBy(String(userId), txOptions);
    const watches = await apps.watches.pauseIn({ createdBy: String(userId), homeId: String(homeId) }, txOptions);
    const paused = named(routines, watches);
    if (!paused.length) return;
    const where = await records.directory.seats([...new Set(paused.map((entry) => entry.chatBotId))], txOptions);
    await sayPaused(paused, new Map(where.map((seat) => [String(seat.id), String(seat.chatId)])), line, txOptions);
  }

  return Object.freeze({ pauseWork, pauseMadeBy });
}
