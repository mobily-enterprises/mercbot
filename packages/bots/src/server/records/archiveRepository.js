// Bots archived and unarchived (D-108), and what archiving a whole bot reaches: every chat it's in, whoever can open
// them (D-112). Chats themselves are archived through records.chats. Every method takes the call's options last, so
// ownership keeps it in the call's home and the row policies decide which chats it reads.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the
 *   records feature's handles
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
export function createArchiveRepository({ resources, systemContext }) {
  const { bots, chatBots } = resources;
  const { homeOf, personOf } = createCallerReaders();

  /**
   * A bot archived by the person, or with `archived` false unarchived (D-108), only when it isn't so already: answers
   * whether it changed, so two archives at once pause its work once.
   * @param {string} botId
   * @param {boolean} archived
   * @param {CallOptions} options
   */
  async function markBotArchived(botId, archived, options) {
    const columns = archived
      ? { archivedAt: new Date().toISOString(), archivedBy: personOf(options) }
      : { archivedAt: null, archivedBy: null };
    const changed = await bots.patchWhere({ id: String(botId), archived: !archived }, columns, { ...passedOn(options), returning: "records" });
    return changed.length > 0;
  }

  /**
   * Every chat the bot is in, as its seats there ({ id: chat_bots id, chatId }), in one read: private chats the caller
   * can't open included (D-108: archiving it pauses its work in all of them).
   * @param {string} botId
   * @param {CallOptions} options
   * @returns {Promise<Array<{ id: string, chatId: string }>>}
   */
  async function seatsOf(botId, options) {
    const rows = await chatBots.queryAll({ filters: { botId: String(botId) }, fields: ["conversationId"], sort: ["id"] }, forEveryone(options));
    return rows.map((row) => ({ id: String(row.id), chatId: String(row.conversationId) }));
  }

  /**
   * The call's options reaching every chat a bot is in, in its transaction (D-108): the work archiving a bot pauses
   * there, and the line saying so in each, once the service has checked the caller.
   * @param {CallOptions} options
   */
  const forEveryone = (options) => ({
    ...passedOn(options),
    context: systemContext("archiving a bot pauses its work in every chat it's in").forWorkspace(homeOf(options))
  });

  return Object.freeze({
    markBotArchived,
    seatsOf,
    forEveryone
  });
}
