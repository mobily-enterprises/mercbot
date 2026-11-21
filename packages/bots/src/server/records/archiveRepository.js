// Conversations archived and resumed (D-101), and bots archived and unarchived (D-108): who archived one and when, a
// Shared bot's archived conversations the person sees, everyone's archived "You only" made their chat again as a bot
// stops being Shared, and what archiving a whole bot reaches (all its conversations, every person's, and the groups it
// is in). The columns written here are what conversationRepository's isHiddenRoom and runsNoWork read to keep work out
// of an archived conversation and an archived bot. Every method takes the call's options last, so ownership keeps it in
// the call's home and the row policies decide which conversations it sees.
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
  const { bots, botConversations: conversations, botGroupMembers: groupMembers, botGroupPeople: groupPeople } = resources;
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
   * Every conversation of the bot's, in one read: each person's own, its rooms and its computers for groups, other
   * people's included, which the caller's row policy doesn't show (D-108: archiving it reaches them all).
   * @param {string} botId
   * @param {CallOptions} options
   * @returns {Promise<string[]>}
   */
  async function conversationIdsOf(botId, options) {
    const rows = await conversations.queryAll({ filters: { botId: String(botId) }, fields: ["botId"], sort: ["id"] }, forEveryone(options));
    return rows.map((row) => String(row.id));
  }

  /**
   * The group chats the bot is in, each with its people (D-46), in two reads however many: who hears the bot is
   * archived or back in each (D-108).
   * @param {string} botId
   * @param {CallOptions} options
   * @returns {Promise<Map<string, string[]>>}
   */
  async function groupsWith(botId, options) {
    const memberships = await groupMembers.queryAll({ filters: { botId: String(botId) } }, passedOn(options));
    const groupIds = [...new Set(memberships.map((row) => String(row.groupId)))];
    if (!groupIds.length) return new Map();
    const people = await groupPeople.queryAll({ filters: { groupIds } }, passedOn(options));
    return new Map(groupIds.map((groupId) =>
      [groupId, people.filter((row) => String(row.groupId) === groupId).map((row) => String(row.userId))]));
  }

  /**
   * The call's options reaching every person's conversation with a bot in its home, in its transaction (D-108): the
   * work archiving a bot pauses there, and the line saying so in each, once the service has checked the caller.
   * @param {CallOptions} options
   */
  const forEveryone = (options) => ({
    ...passedOn(options),
    context: systemContext("archiving a bot pauses the work in every person's conversation with it").forWorkspace(homeOf(options))
  });

  return Object.freeze({
    markArchived,
    archivedOf,
    unarchiveSeats,
    markBotArchived,
    conversationIdsOf,
    groupsWith,
    forEveryone
  });
}
