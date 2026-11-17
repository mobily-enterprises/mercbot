import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/**
 * The bots a person made and the conversations they have, in every home the call's options reach (a system context's),
 * with their homes. A bot's or conversation's home is its ownership field, which the handles' own reads keep hidden, so
 * these are reports on the bots' and conversations' tables.
 * @param {{
 *   bots: import("@jskit-ai/resource-runtime/server/types").ResourceHandle,
 *   botConversations: import("@jskit-ai/resource-runtime/server/types").ResourceHandle
 * }} resources the records feature's handles
 */
export function createMakerRepository({ bots, botConversations }) {
  const bot = (field) => bots.column(field, "b");
  const conversation = (field) => botConversations.column(field, "c");
  const iso = (value) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

  /**
   * @param {string} userId
   * @param {number} limit
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  // Knex: report - a person's bots and group chats, newest first, with their homes (ix_bots_user)
  async function botsMadeBy(userId, limit, options) {
    const { query } = await bots.scopedQuery({ alias: "b" }, passedOn(options));
    const rows = await query
      .where(bot("userId"), String(userId))
      .orderBy([{ column: bot("createdAt"), order: "desc" }, { column: bot("id"), order: "desc" }])
      .select({ id: bot("id"), name: bot("name"), kind: bot("kind"), sharing: bot("sharing"), workspaceId: bot("workspaceId"), createdAt: bot("createdAt") })
      .limit(limit);
    return rows.map((row) => ({ ...row, id: String(row.id), workspaceId: String(row.workspaceId) }));
  }

  /**
   * A person's own conversations (those that are theirs, user_id) in the homes named, the latest activity first, at most
   * `limit`: only which bot, where and when, never a title or a message.
   * @param {string} userId
   * @param {ReadonlyArray<string>} workspaceIds
   * @param {number} limit
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @returns {Promise<Array<{ id: string, botId: string, workspaceId: string, createdAt: string, lastActivityAt: string }>>}
   */
  // Knex: report - a person's conversations in a few homes, latest activity first (bot_conversations_workspace_id_user_id_index)
  async function conversationsOf(userId, workspaceIds, limit, options) {
    const homes = [...new Set(workspaceIds.map(String))];
    if (!homes.length) return [];
    const { query } = await botConversations.scopedQuery({ alias: "c" }, passedOn(options));
    const rows = await query
      .whereRaw("?? = any(?::bigint[])", [conversation("workspaceId"), homes])
      .where(conversation("userId"), String(userId))
      .orderBy([{ column: conversation("lastActivityAt"), order: "desc" }, { column: conversation("id"), order: "desc" }])
      .select({
        id: conversation("id"),
        botId: conversation("botId"),
        workspaceId: conversation("workspaceId"),
        createdAt: conversation("createdAt"),
        lastActivityAt: conversation("lastActivityAt")
      })
      .limit(limit);
    return rows.map((row) => ({
      id: String(row.id),
      botId: String(row.botId),
      workspaceId: String(row.workspaceId),
      createdAt: iso(row.createdAt),
      lastActivityAt: iso(row.lastActivityAt)
    }));
  }

  return Object.freeze({
    botsMadeBy,
    conversationsOf
  });
}
