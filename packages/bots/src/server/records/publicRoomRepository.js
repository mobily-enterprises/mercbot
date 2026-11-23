import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

// A page of the home's public rooms a person isn't in.
const ROOMS_PAGE = 100;

/**
 * The home's public rooms a person isn't in, a page at a time (chatRepository.js publicRooms).
 * @param {ResourceHandle} conversations
 * @param {ResourceHandle} chatPeople
 */
// Knex: report - the home's public rooms with no place of the person's, newest first (chat_people_person_unique)
export function roomsToVisit(conversations, chatPeople) {
  const { personOf, asRow } = createCallerReaders();
  const chat = (field) => conversations.column(field, "c");
  /**
   * A page of the home's public rooms the person isn't in (not a direct chat, not archived), newest made first, an order
   * no room moves in while the pages are read (`after`: the page before's `next`, its last room's id; null after the
   * last page): what the list shows faded. One read of the page's ids, whose rooms have no place of the person's
   * (chat_people_person_unique), and one of its rooms, whatever the person's history.
   * @param {CallOptions} options
   * @param {{ after?: string | null }} [page]
   * @returns {Promise<{ chats: object[], next: string | null }>}
   */
  return async function publicRooms(options, { after = null } = {}) {
    const seated = await chatPeople.joinSource({ alias: "p" }, passedOn(options));
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    query
      .where(chat("kind"), "public")
      .whereNull(chat("archivedAt"))
      .whereNull(chat("directBotId"))
      .whereNull(chat("directPersonId"))
      .whereNotExists(seated.query.select(1)
        .whereColumn(seated.column("conversationId"), chat("id"))
        .where(seated.column("userId"), String(personOf(options))));
    if (after) query.where(chat("id"), "<", String(after));
    // One more than a page: whether there is a page after it.
    const found = await query.orderBy(chat("id"), "desc").select({ id: chat("id") }).limit(ROOMS_PAGE + 1);
    const more = found.length > ROOMS_PAGE;
    if (more) found.pop();
    if (!found.length) return { chats: [], next: null };
    const records = await conversations.queryAll({ filters: { id: found.map((row) => String(row.id)) }, sort: ["-id"] }, passedOn(options));
    return { chats: records.map((record) => asRow(record, options)), next: more ? String(records.at(-1).id) : null };
  };
}
