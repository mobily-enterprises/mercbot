import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders } from "./recordRows.js";

// A page of the chats a bot's or person's card lists under "Show hidden and archived".
const SHARED_PAGE = 20;
// A person's own place in a chat, as chatRepository.js's chat list reads it.
const PLACE = Object.freeze(["readUpTo", "unread", "mentionedAt", "pinPosition", "sectionId", "hidden", "muted"]);

/**
 * The caller's hidden and archived chats that a bot or another person is in too: what a card adds under "Show hidden
 * and archived", a page at a time, narrowed in one statement however many chats the caller has tucked away.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources the records feature's handles
 */
export function createSharedChatRepository({ conversations, chatPeople, chatBots }) {
  const { personOf, asRow } = createCallerReaders();
  const chat = (field) => conversations.column(field, "c");

  /**
   * A page of the caller's chats they've hidden (their place's `hidden`) or that are archived, with the bot
   * (`botId`, a seat of it) or the person (`userId`, a place of theirs) in them, newest chat first, an order no chat
   * moves in while the pages are read (`after`: the page before's `next`, null after the last), each with the caller's
   * place (`place`). The row policies keep it to chats the caller can open. One read of the page's ids, one of its
   * chats and one of the caller's places in them.
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @param {{ botId?: string | null, userId?: string | null, after?: string | null }} shared
   * @returns {Promise<{ chats: object[], next: string | null }>}
   */
  // Knex: report - the caller's hidden or archived chats a bot or person shares, newest first (ix_chat_people_person)
  async function tuckedAwayWith(options, { botId = null, userId = null, after = null }) {
    const me = String(personOf(options));
    const mine = await chatPeople.joinSource({ alias: "p" }, passedOn(options));
    const theirs = botId
      ? await chatBots.joinSource({ alias: "s" }, passedOn(options))
      : await chatPeople.joinSource({ alias: "o" }, passedOn(options));
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    query
      .whereExists(mine.query.select(1)
        .whereColumn(mine.column("conversationId"), chat("id"))
        .where(mine.column("userId"), me)
        .where((tucked) => tucked.where(mine.column("hidden"), true).orWhereNotNull(chat("archivedAt"))))
      .whereExists(theirs.query.select(1)
        .whereColumn(theirs.column("conversationId"), chat("id"))
        .where(theirs.column(botId ? "botId" : "userId"), String(botId ?? userId)));
    if (after) query.where(chat("id"), "<", String(after));
    // One more than a page: whether there is a page after it.
    const found = await query.orderBy(chat("id"), "desc").select({ id: chat("id") }).limit(SHARED_PAGE + 1);
    const more = found.length > SHARED_PAGE;
    if (more) found.pop();
    if (!found.length) return { chats: [], next: null };
    const ids = found.map((row) => String(row.id));
    const [records, places] = await Promise.all([
      conversations.queryAll({ filters: { id: ids }, sort: ["-id"] }, passedOn(options)),
      chatPeople.queryAll({ filters: { conversationIds: ids, userId: me }, fields: ["conversationId", ...PLACE] }, passedOn(options))
    ]);
    const placeOf = new Map(places.map((place) => [String(place.conversationId), place]));
    const chats = records.map((record) => ({
      ...asRow(record, options),
      place: Object.fromEntries(PLACE.map((field) => [field, placeOf.get(String(record.id))?.[field] ?? null]))
    }));
    return { chats, next: more ? ids.at(-1) : null };
  }

  return Object.freeze({ tuckedAwayWith });
}
