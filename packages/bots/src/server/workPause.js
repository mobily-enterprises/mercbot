/**
 * Work paused where nobody sees it or can stop it (D-99, D-101, D-112): the routines and watches of the bots' seats
 * given pause, as a person pausing each would, and each chat with something paused says so in a line naming them, read
 * when it's seen again; its people hear of it. They stay paused until someone resumes them there, so nothing starts
 * again unexpectedly.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats where each chat's people hear of it
 */
export function createWorkPause({ records, apps, seats }) {
  /**
   * @param {Array<{ id: string, chatId: string }>} chatBots the seats (chat_bots ids) whose work pauses, and their chats
   * @param {{ text: string, detail: (paused: string) => string }} line the line's title, and its words given what paused
   * @param {import("./types.js").CallOptions} txOptions a context that may write in each of those chats
   */
  return async function pauseWork(chatBots, line, txOptions) {
    if (!chatBots.length) return;
    const chatOf = new Map(chatBots.map((seat) => [String(seat.id), String(seat.chatId)]));
    const chatBotIds = [...chatOf.keys()];
    const routines = await records.work.pauseRoutinesIn(chatBotIds, txOptions);
    const watches = await apps.watches.pauseIn({ chatBotIds }, txOptions);
    const paused = [
      ...routines.map((routine) => ({ chatBotId: String(routine.chatBotId), name: `routine "${routine.name}"` })),
      ...watches.map((watch) => ({ chatBotId: String(watch.chatBotId), name: `watch "${watch.name}"` }))
    ];
    for (const [chatId, list] of Map.groupBy(paused, (entry) => chatOf.get(entry.chatBotId))) {
      await records.messages.append(chatId, [{
        kind: "event",
        role: "system",
        body: { text: line.text, icon: "routine", detail: line.detail(list.map((entry) => entry.name).join(", ")) }
      }], txOptions);
      await seats.tell(chatId, { type: "messages" }, txOptions);
    }
  };
}
