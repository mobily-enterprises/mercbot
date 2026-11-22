import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

/**
 * The home's Builder moving into every app's chat (O26, D-112), for the chats' records (chatRepository.js).
 * @param {ResourceHandle} conversations
 * @param {ResourceHandle} chatBots
 * @param {(options: object) => string | null} personOrNull the caller's person, or null for work done for no one
 */
export function builderChanger(conversations, chatBots, personOrNull) {
  /**
   * The home's Builder changed (O26, D-112): in every app's chat the new Builder (`toBotId`) is seated after the bots
   * there, where it isn't already; the old one stays a member until someone removes it. Answers the ids of every app's
   * chat, whose Builder each changed, for their lines. Three statements, however many apps.
   * @param {{ toBotId: string }} change
   */
  return async function changeAppBuilder({ toBotId }, txOptions) {
    const ids = (await conversations.queryAll({ filters: { app: true }, fields: ["appId"] }, passedOn(txOptions))).map((chat) => String(chat.id));
    if (!ids.length) return [];
    const seats = await chatBots.queryAll({ filters: { conversationIds: ids }, fields: ["conversationId", "botId", "position"] }, passedOn(txOptions));
    const last = new Map();
    const seated = new Set();
    for (const seat of seats) {
      const chatId = String(seat.conversationId);
      last.set(chatId, Math.max(last.get(chatId) ?? -1, Number(seat.position)));
      if (String(seat.botId) === String(toBotId)) seated.add(chatId);
    }
    const joining = ids.filter((id) => !seated.has(id));
    if (joining.length) {
      const addedBy = personOrNull(txOptions);
      const seat = (chatId) => ({ conversationId: chatId, botId: String(toBotId), addedBy, position: (last.get(chatId) ?? -1) + 1 });
      const rows = joining.map(seat);
      await chatBots.createMany(rows, {
        ...passedOn(txOptions),
        onConflict: { keys: ["conversationId", "workspaceId", "botId"], action: "ignore" },
        returning: "none"
      });
    }
    return ids;
  };
}
