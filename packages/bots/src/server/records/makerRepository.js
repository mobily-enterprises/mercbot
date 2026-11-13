import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/**
 * The bots a person made, in every home the call's options reach (a system context's), with their homes. A bot's
 * home is its ownership field, which the handle's own reads keep hidden, so this is a report on the bots' table.
 * @param {{ bots: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} resources the records feature's handles
 */
export function createMakerRepository({ bots }) {
  const bot = (field) => bots.column(field, "b");

  // Knex: report - a person's bots and group chats, newest first, with their homes (ix_bots_user)
  /**
   * @param {string} userId
   * @param {number} limit
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  async function botsMadeBy(userId, limit, options) {
    const { query } = await bots.scopedQuery({ alias: "b" }, passedOn(options));
    const rows = await query
      .where(bot("userId"), String(userId))
      .orderBy([{ column: bot("createdAt"), order: "desc" }, { column: bot("id"), order: "desc" }])
      .select({ id: bot("id"), name: bot("name"), kind: bot("kind"), sharing: bot("sharing"), workspaceId: bot("workspaceId"), createdAt: bot("createdAt") })
      .limit(limit);
    return rows.map((row) => ({ ...row, id: String(row.id), workspaceId: String(row.workspaceId) }));
  }

  return Object.freeze({ botsMadeBy });
}
