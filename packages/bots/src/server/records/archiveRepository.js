// Conversations archived and resumed (D-101): who archived one and when, a Shared bot's archived conversations the
// person sees, and everyone's archived "You only" made their chat again as a bot stops being Shared. The columns written
// here are what conversationRepository's isHiddenRoom reads to keep everything out of an archived conversation. Every
// method takes the call's options last, so ownership keeps it in the call's home and the row policies decide which
// conversations it sees.
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
  const { botConversations: conversations } = resources;
  const { homeOf, personOf, asRow } = createCallerReaders(systemContext);

  /**
   * A conversation archived by the person, or with `archived` false resumed.
   * @param {string} conversationId
   * @param {boolean} archived
   * @param {CallOptions} options
   */
  async function markArchived(conversationId, archived, options) {
    const columns = archived
      ? { archivedAt: new Date().toISOString(), archivedBy: personOf(options) }
      : { archivedAt: null, archivedBy: null };
    await conversations.patch(conversationId, columns, { ...passedOn(options), returning: "none" });
  }

  /**
   * The bot's archived conversations the person sees, in id order, in one read: its archived tabs, and their own
   * archived "You only" (the row policies keep anyone else's out).
   * @param {string} botId
   * @param {CallOptions} options
   */
  async function archivedOf(botId, options) {
    const rows = await conversations.queryAll({ filters: { botId, archived: true }, sort: ["id"] }, passedOn(options));
    return rows.map((row) => asRow(row, options));
  }

  /**
   * Everyone's archived "You only" with a bot made their chat again as it stops being Shared: it is their only
   * conversation then. Other people's rows, which the caller's row policy doesn't show, so written for the home.
   * @param {string} botId
   * @param {CallOptions} options
   */
  async function unarchiveSeats(botId, options) {
    const reason = "a bot that stops being Shared makes each person's archived You only their chat again";
    const forHome = { ...passedOn(options), context: systemContext(reason).forWorkspace(homeOf(options)) };
    const resumed = { archivedAt: null, archivedBy: null };
    await conversations.patchWhere({ botId, seat: true, archived: true }, resumed, { ...forHome, returning: "none" });
  }

  return Object.freeze({
    markArchived,
    archivedOf,
    unarchiveSeats
  });
}
