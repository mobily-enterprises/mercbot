/**
 * Work paused where nobody sees it or can stop it (D-99, D-101): the routines and watches of the conversations given
 * pause, as a person pausing each would, and each conversation with something paused says so in a line naming them,
 * read when it's seen again. They stay paused until someone resumes them there, so nothing starts again unexpectedly.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("./types.js").BotConversations} dependencies.conversations
 */
export function createWorkPause({ records, apps, conversations }) {
  /**
   * @param {{ id: string }} bot
   * @param {string[]} conversationIds
   * @param {{ text: string, detail: (paused: string) => string }} line the line's title, and its words given what paused
   * @param {import("./types.js").CallOptions} txOptions
   */
  return async function pauseWorkIn(bot, conversationIds, line, txOptions) {
    if (!conversationIds.length) return;
    const routines = await records.work.pauseRoutinesIn(conversationIds, txOptions);
    const watches = await apps.watches.pauseIn({ botId: String(bot.id), conversationIds }, txOptions);
    const paused = [
      ...routines.map((routine) => ({ conversationId: String(routine.conversationId), name: `routine "${routine.name}"` })),
      ...watches.map((watch) => ({ ...watch, name: `watch "${watch.name}"` }))
    ];
    for (const [conversationId, list] of Map.groupBy(paused, (entry) => entry.conversationId)) {
      await conversations.append({ id: bot.id, conversation_id: conversationId }, [{
        kind: "event",
        role: "system",
        body: { text: line.text, icon: "routine", detail: line.detail(list.map((entry) => entry.name).join(", ")) }
      }], txOptions);
    }
  };
}
