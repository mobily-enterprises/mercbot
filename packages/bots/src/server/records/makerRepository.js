import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/**
 * The bots a person made and the chats they're in, in every home the call's options reach (a system context's), with
 * their homes. A bot's or chat's home is its ownership field, which the handles' own reads keep hidden, so these are
 * reports on the bots' and chats' tables.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources the records feature's handles
 */
export function createMakerRepository({ bots, conversations, chatPeople }) {
  const bot = (field) => bots.column(field, "b");
  const chat = (field) => conversations.column(field, "c");
  const iso = (value) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

  /**
   * @param {string} userId
   * @param {number} limit
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  // Knex: report - the bots a person made, newest first, with their homes (ix_bots_made_by)
  async function botsMadeBy(userId, limit, options) {
    const { query } = await bots.scopedQuery({ alias: "b" }, passedOn(options));
    const rows = await query
      .where(bot("madeBy"), String(userId))
      .orderBy([{ column: bot("createdAt"), order: "desc" }, { column: bot("id"), order: "desc" }])
      .select({ id: bot("id"), name: bot("name"), workspaceId: bot("workspaceId"), createdAt: bot("createdAt") })
      .limit(limit);
    return rows.map((row) => ({ ...row, id: String(row.id), workspaceId: String(row.workspaceId) }));
  }

  /**
   * The chats a person is in, in the homes named, the latest activity first, at most `limit`: only which chat, its
   * kind, where and when, never a title or a message.
   * @param {string} userId
   * @param {ReadonlyArray<string>} workspaceIds
   * @param {number} limit
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @returns {Promise<Array<{ id: string, kind: string, workspaceId: string, createdAt: string, lastActivityAt: string }>>}
   */
  // Knex: report - a person's chats in a few homes, latest activity first (ix_chat_people_person)
  async function chatsOf(userId, workspaceIds, limit, options) {
    const homes = [...new Set(workspaceIds.map(String))];
    if (!homes.length) return [];
    const theirs = await chatPeople.joinSource({ alias: "p" }, passedOn(options));
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    const rows = await query
      .whereRaw("?? = any(?::bigint[])", [chat("workspaceId"), homes])
      .whereExists(theirs.query.select(1).whereColumn(theirs.column("conversationId"), chat("id")).where(theirs.column("userId"), String(userId)))
      .orderBy([{ column: chat("lastActivityAt"), order: "desc" }, { column: chat("id"), order: "desc" }])
      .select({
        id: chat("id"),
        kind: chat("kind"),
        workspaceId: chat("workspaceId"),
        createdAt: chat("createdAt"),
        lastActivityAt: chat("lastActivityAt")
      })
      .limit(limit);
    return rows.map((row) => ({
      id: String(row.id),
      kind: row.kind,
      workspaceId: String(row.workspaceId),
      createdAt: iso(row.createdAt),
      lastActivityAt: iso(row.lastActivityAt)
    }));
  }

  return Object.freeze({
    botsMadeBy,
    chatsOf
  });
}
