import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { toMessage } from "../botRows.js";
import { createCallerReaders } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

// How many messages a chat shows at first, and reads at a time as the person scrolls back
// (timeline): the platform tables' page limit.
const PAGE = 100;
// The messages a bot's row in the list can show as its preview.
const PREVIEW_KINDS = Object.freeze(["text", "choice", "connect", "handover", "files", "page", "view", "chart", "pictures", "voice"]);
// What the bots made, for the Library and search.
export const MADE_KINDS = Object.freeze(["files", "page", "chart", "pictures", "view"]);
// What search finds among them by name; views are the home's, found among its apps (D-55).
const SEARCHED_MADE = Object.freeze(MADE_KINDS.filter((kind) => kind !== "view"));
/**
 * A chat's messages (D-15, D-48, D-112): written, paged, caught up on, previewed, searched and read back for a reply.
 * A message is a person's (author_user_id), a bot's (author_bot_id) or Mercbot's own (neither); role says which.
 * Every method reads through the bots' handles in the call's `options`, so a message is reached only where its chat is
 * (rowPolicies.js inReadableChat); rows answer in the snake_case shape the bots' code reads (toMessage,
 * toHistoryMessage take them).
 * @param {object} dependencies
 * @param {Record<string, ResourceHandle>} dependencies.resources the records feature's handles
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
export function createMessageRepository({ resources, systemContext, pushQueue }) {
  const { conversations, messages, chatPeople, chatBots, botRoutines: routines } = resources;
  const { homeOf, personOf, asRow } = createCallerReaders();
  const rowsOf = (records, options) => records.map((record) => asRow(record, options));
  // An ILIKE pattern for text containing the words, its wildcards taken literally.
  const containing = (text) => `%${text.replace(/[\\%_]/gu, (char) => `\\${char}`)}%`;

  /**
   * Messages written in a chat, in order: each `{ role, kind, body, authorUserId?, authorBotId? }`, a person's message
   * written by the caller's person unless it names its author. They count as the chat's activity, and anything by
   * someone (a person or a bot, not Mercbot's own lines) is unread for the chat's other people until they open it.
   * @param {string} chatId
   * @param {Array<{ role: "user" | "bot" | "system", kind: string, body: object, authorUserId?: string | null, authorBotId?: string | null }>} list
   * @param {CallOptions} options
   */
  async function append(chatId, list, options) {
    if (!list.length) return [];
    const rows = list.map((message) => ({
      conversationId: String(chatId),
      kind: message.kind,
      role: message.role,
      body: message.body,
      authorUserId: message.role === "user" ? String(message.authorUserId ?? personOf(options)) : null,
      authorBotId: message.role === "bot" && message.authorBotId != null ? String(message.authorBotId) : null
    }));
    const created = await messages.createMany(rows, { ...passedOn(options), returning: "records" });
    const home = { ...passedOn(options), context: systemContext("a chat's new messages are its activity, unread for its other people").forWorkspace(homeOf(options)) };
    // One UPDATE that answers the chat: whether it's two people's direct chat, for its notifications (D-133).
    const chat = await conversations.patch(String(chatId), { lastActivityAt: new Date().toISOString() }, { ...home, missing: "skip", returning: "record" });
    const authors = rows.filter((row) => row.role !== "system");
    if (authors.length) {
      const onlyBy = new Set(authors.map((row) => row.authorUserId));
      const author = onlyBy.size === 1 ? [...onlyBy][0] : null;
      await chatPeople.patchWhere(
        { conversationId: String(chatId), unread: false, ...(author ? { notUserId: author } : {}) },
        { unread: true },
        { ...home, returning: "none" }
      );
    }
    const added = rowsOf(created, options).sort((a, b) => Number(a.id) - Number(b.id)).map(toMessage);
    // The chat's people it concerns are notified a little later, if they haven't read it by then (D-133).
    await pushQueue.notePosted(String(chatId), homeOf(options), added, home, { direct: chat?.directPersonId != null });
    return added;
  }

  /**
   * A page of a chat: its newest messages, or with `before` (a message id) those just before that one, oldest first;
   * `more` says whether older ones are left. A chat opens on its newest page and reads older ones as the person scrolls
   * up, so opening an old chat doesn't read its whole history.
   * @param {string} chatId
   * @param {{ before?: string }} page
   * @param {CallOptions} options
   */
  async function timeline(chatId, { before } = {}, options) {
    const filters = { conversationId: String(chatId), ...(before ? { beforeId: before } : {}) };
    const { records, page } = await messages.query({ filters, sort: ["-id"], page: { size: PAGE } }, passedOn(options));
    return { messages: rowsOf(records, options).reverse().map(toMessage), more: page.hasMore };
  }

  /**
   * The conversation's messages changed since a catch-up point, in id order.
   * @param {string} conversationId
   * @param {string} since a catch-up point (changeHorizon)
   * @param {CallOptions} options
   */
  async function catchUp(conversationId, since, options) {
    const records = await messages.queryAll({ filters: { conversationId, changedSince: since }, sort: ["id"] }, passedOn(options));
    return rowsOf(records, options).map(toMessage);
  }

  /** Where the next catch-up starts: the database's change horizon, read before the messages. @param {CallOptions} options */
  const changeHorizon = (options) => messages.changeHorizon(passedOn(options));

  /**
   * @param {string[]} conversationIds
   * @param {CallOptions} options
   * @returns {Promise<object[]>} message rows, one per conversation that has one
   */
  // Knex: newest-per-group - each chat's latest message the list can preview (a person's or a bot's, never Mercbot's
  // own lines), found from its newest end through the (conversation_id, id) index: one row per chat
  async function latestPerConversation(conversationIds, options) {
    if (!conversationIds.length) return [];
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    const latest = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    const newest = latest.query
      .select(messages.column("id", "m"))
      .whereColumn(messages.column("conversationId", "m"), conversations.column("id", "c"))
      .whereIn(messages.column("kind", "m"), PREVIEW_KINDS)
      .whereNot(messages.column("role", "m"), "system")
      .orderBy(messages.column("id", "m"), "desc")
      .limit(1)
      .as("message_id");
    const found = await query.whereIn(conversations.column("id", "c"), conversationIds.map(String)).select(newest);
    const ids = found.map((row) => row.message_id).filter((id) => id != null).map(String);
    return ids.length ? rowsOf(await messages.queryAll({ filters: { id: ids } }, passedOn(options)), options) : [];
  }

  /** One message of a conversation (of one kind, when given), or null. */
  async function messageIn(conversationId, messageId, options, { kind } = {}) {
    const [message] = await messages.queryAll({ filters: { id: messageId, conversationId, ...(kind ? { kind } : {}) } }, passedOn(options));
    return asRow(message ?? null, options);
  }

  /** One message, locked until the transaction ends, when it is in that conversation (and of that kind), or null. */
  async function lockMessageIn(conversationId, messageId, txOptions, { kind } = {}) {
    const [message] = await messages.lockWhere({ id: messageId, conversationId, ...(kind ? { kind } : {}) }, passedOn(txOptions));
    return asRow(message ?? null, txOptions);
  }

  /** A message's body replaced; answers the message as the page shows it. */
  async function setBody(messageId, body, options) {
    return toMessage(asRow(await messages.patch(messageId, { body }, passedOn(options)), options));
  }

  /**
   * A card's body replaced only while its status is still `status`: of two presses (or two
   * servers) only one claims it. Answers whether this one did.
   */
  async function claimBody(messageId, status, body, options) {
    const claimed = await messages.patchWhere({ id: messageId, bodyStatus: status }, { body }, { ...passedOn(options), returning: "ids" });
    return claimed.length > 0;
  }

  /** The conversation's latest message of a kind (a choice card), or null. */
  async function latestOfKind(conversationId, kind, options) {
    const { records: [latest] } = await messages.query({ filters: { conversationId, kind }, sort: ["-id"], page: { size: 1 } }, passedOn(options));
    return asRow(latest ?? null, options);
  }

  /** Whether the person has written anything yet in the conversation. */
  async function hasUserText(conversationId, options) {
    const { records } = await messages.query({ filters: { conversationId, kind: "text", role: "user" }, page: { size: 1 } }, passedOn(options));
    return records.length > 0;
  }

  /** The person's message already stored with this client id, after a retry (D-19), or null. */
  async function byClientId(conversationId, clientId, options) {
    const { records: [found] } = await messages.query({ filters: { conversationId, role: "user", clientId }, page: { size: 1 } }, passedOn(options));
    return asRow(found ?? null, options);
  }

  /** The id of the conversation's latest message, or null. */
  async function latestId(conversationId, options) {
    const { records: [latest] } = await messages.query({ filters: { conversationId }, sort: ["-id"], fields: ["conversationId"], page: { size: 1 } }, passedOn(options));
    return latest?.id ?? null;
  }

  /** One message by id, or null. */
  async function messageById(messageId, options) {
    return asRow(await messages.get(messageId, {}, { ...passedOn(options), missing: "skip" }), options);
  }

  /** Every message after `after` (a message id; 0 for all), oldest first: what a reply reads past its summary (D-48). */
  async function messagesAfter(conversationId, after, options) {
    const filters = { conversationId, ...(Number(after) > 0 ? { afterId: String(after) } : {}) };
    return rowsOf(await messages.queryAll({ filters, sort: ["id"] }, passedOn(options)), options);
  }

  /** Up to `limit` messages of a conversation at or before one message, newest first: what a room it continues knew (D-36). */
  async function messagesUpTo(conversationId, messageId, limit, options) {
    const { records } = await messages.query({ filters: { conversationId, atMostId: String(messageId) }, sort: ["-id"], page: { size: limit } }, passedOn(options));
    return rowsOf(records, options);
  }

  /** A routine's last few runs in its chat, newest first (D-57). */
  async function routineRuns(conversationId, routineId, limit, options) {
    const filters = { conversationId, role: "bot", kind: "text", routineId: String(routineId) };
    return rowsOf((await messages.query({ filters, sort: ["-id"], page: { size: limit } }, passedOn(options))).records, options);
  }

  /** The chat's last few messages in words, newest first (D-60). */
  async function recentText(conversationId, limit, options) {
    return rowsOf((await messages.query({ filters: { conversationId, kind: "text" }, sort: ["-id"], page: { size: limit } }, passedOn(options))).records, options);
  }

  /** Which made messages a Library read: in one chat, or with no chat every chat the caller reads; one bot's with `botId`. */
  const madeFilters = (conversationId, botId) => ({
    ...(conversationId == null ? {} : { conversationId: String(conversationId) }),
    kinds: [...MADE_KINDS],
    ...(botId ? { madeBy: String(botId) } : {})
  });

  /**
   * What the bots made (the Library), newest first, up to `limit`: one page. In one chat, or with `conversationId` null
   * in every chat the caller may read (a bot's card on Team, D-112); with `botId`, one bot's.
   */
  async function madeIn(conversationId, limit, options, { botId = null } = {}) {
    const { records } = await messages.query({ filters: madeFilters(conversationId, botId), sort: ["-id"], page: { size: limit } }, passedOn(options));
    return rowsOf(records, options);
  }

  /**
   * What was made before a message, holding a pin (the Library's Pinned), newest first: in one chat, or with
   * `conversationId` null in every chat the caller may read; with `botId`, one bot's.
   */
  async function pinnedBefore(conversationId, before, options, { botId = null } = {}) {
    const filters = { ...madeFilters(conversationId, botId), pinned: true, beforeId: before };
    return rowsOf(await messages.queryAll({ filters, sort: ["-id"] }, passedOn(options)), options);
  }

  /**
   * @param {string | number} conversationId
   * @param {string} text the words as the person typed them
   * @param {string} before a message id: the oldest message the page has
   * @param {CallOptions} options
   * @returns {Promise<{ count: number, newest: string | null, oldest: string | null }>}
   */
  // Knex: totals - find in chat in the part of a conversation the page hasn't read: how many times the words
  // appear in the messages before one, case-insensitively as the page counts them, and the newest and oldest message
  // holding them, in one statement; a substring count over the message text is no aggregate() field
  async function findBefore(conversationId, text, before, options) {
    const { query } = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    const id = messages.column("id", "m");
    const body = messages.column("body", "m");
    const [found] = await query
      .where(messages.column("conversationId", "m"), conversationId)
      .where(id, "<", before)
      .whereRaw("?? ->> 'text' ilike ?", [body, containing(text)])
      .select(
        messages.raw(
          "coalesce(sum((length(lower(?? ->> 'text')) - length(replace(lower(?? ->> 'text'), lower(?::text), ''))) / length(lower(?::text))), 0) as count",
          [body, body, text, text]
        ),
        messages.raw("max(??) as newest", [id]),
        messages.raw("min(??) as oldest", [id])
      );
    const idOf = (value) => (value === null || value === undefined ? null : String(value));
    return { count: Number(found?.count || 0), newest: idOf(found?.newest), oldest: idOf(found?.oldest) };
  }

  /** @param {CallOptions} options */
  // Knex: subquery - the ids of the chats the caller searches: the ones it may read (the row policy) that aren't
  // archived, for the search reports below to read inside
  async function searchedConversations(options) {
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    return { query: query.whereNull(conversations.column("archivedAt", "c")).select(conversations.column("id", "c")) };
  }

  /**
   * @param {string} text the words, at least two characters
   * @param {CallOptions} options
   */
  // Knex: report - up to 5 text messages containing the words, earliest match in the text first, from the conversations
  // the person searches (searchedConversations): a substring match and ordering on the message text no field expresses
  async function searchText(text, options) {
    const searched = await searchedConversations(options);
    const { query } = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    const body = messages.column("body", "m");
    return query
      .whereIn(messages.column("conversationId", "m"), searched.query)
      .where(messages.column("kind", "m"), "text")
      .whereRaw("?? ->> 'text' ilike ?", [body, containing(text)])
      .orderByRaw("strpos(lower(?? ->> 'text'), lower(?)), ?? desc", [body, text, messages.column("id", "m")])
      .limit(5)
      .select({
        id: messages.column("id", "m"),
        author_bot_id: messages.column("authorBotId", "m"),
        author_user_id: messages.column("authorUserId", "m"),
        conversation_id: messages.column("conversationId", "m"),
        role: messages.column("role", "m"),
        body,
        created_at: messages.column("createdAt", "m")
      });
  }

  /**
   * @param {string} text the words, at least two characters
   * @param {number} limit
   * @param {CallOptions} options
   * @returns {Promise<Array<{ id: string, author_bot_id: string | null, conversation_id: string, kind: string, created_at: string, part: object }>>}
   */
  // Knex: newest-per-group - the newest things the bots made whose name holds the words, in the
  // chats the caller searches (searchedConversations): each made message's parts (a files card's files, a
  // pictures card's pictures, or the card itself), matched by name and numbered newest first per path, so search reaches
  // anything ever made and reads only the `limit` entries it shows, one per path
  async function searchMade(text, limit, options) {
    const searched = await searchedConversations(options);
    const { query: parts } = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    const kind = messages.column("kind", "m");
    const body = messages.column("body", "m");
    parts
      .whereIn(messages.column("conversationId", "m"), searched.query)
      .whereIn(kind, SEARCHED_MADE)
      .select({
        id: messages.column("id", "m"),
        author_bot_id: messages.column("authorBotId", "m"),
        conversation_id: messages.column("conversationId", "m"),
        kind,
        created_at: messages.column("createdAt", "m")
      })
      .select(messages.raw(
        "jsonb_array_elements(case ?? when 'files' then ?? -> 'files' when 'pictures' then ?? -> 'images' else jsonb_build_array(??) end) as part",
        [kind, body, body, body]
      ));
    const { query: numbered } = await messages.scopedQuery({ alias: "n" }, passedOn(options));
    numbered
      .join(parts.as("p"), "p.id", messages.column("id", "n"))
      .whereRaw("(case p.kind when 'files' then p.part ->> 'name' else p.part ->> 'title' end) ilike ?", [containing(text)])
      .select("p.*")
      .select(messages.raw("row_number() over (partition by p.part ->> 'path' order by p.id desc) as newest"));
    const { query } = await messages.scopedQuery({ alias: "o" }, passedOn(options));
    return query
      .join(numbered.as("found"), "found.id", messages.column("id", "o"))
      .where("found.newest", 1)
      // A page deleted from the Library is found no more.
      .whereRaw("found.part ->> 'removed' is null")
      .orderBy("found.id", "desc")
      .limit(limit)
      .select({
        id: "found.id",
        author_bot_id: "found.author_bot_id",
        conversation_id: "found.conversation_id",
        kind: "found.kind",
        created_at: "found.created_at",
        part: "found.part"
      });
  }

  /** @param {CallOptions} options */
  // Knex: report - every routine of the bots in the chats the caller searches (searchedConversations), in id order,
  // for the search palette to match: each with its bot and its chat
  async function searchRoutines(options) {
    const searched = await searchedConversations(options);
    const seats = await chatBots.joinSource({ alias: "s" }, passedOn(options));
    // The bots' seats in those chats, shaped and named as a derived table: a join source is joined through .as().
    const seated = seats.query
      .whereIn(seats.column("conversationId"), searched.query)
      .select({ id: seats.column("id"), bot_id: seats.column("botId"), conversation_id: seats.column("conversationId") })
      .as("seat");
    const { query } = await routines.scopedQuery({ alias: "r" }, passedOn(options));
    return query
      .join(seated, "seat.id", routines.column("chatBotId", "r"))
      .orderBy(routines.column("id", "r"))
      .select({
        id: routines.column("id", "r"),
        name: routines.column("name", "r"),
        schedule: routines.column("schedule", "r"),
        enabled: routines.column("enabled", "r"),
        chat_bot_id: routines.column("chatBotId", "r"),
        bot_id: "seat.bot_id",
        conversation_id: "seat.conversation_id"
      });
  }

  /** The messages `filters` names, each given `body` (SQL over its old body); answers them. */
  async function rewriteBodies(filters, body, options) {
    const lines = await messages.patchWhere(filters, { body }, { ...passedOn(options), returning: "records" });
    return lines.map((line) => toMessage(asRow(line, options)));
  }

  /** A body with `fields` merged in. */
  const mergedBody = (fields) => messages.raw("?? || ?::jsonb", [messages.column("body"), JSON.stringify(fields)]);

  /**
   * A page's every card, marked deleted from the Library, wherever the same file shows (`where`): in one chat
   * (`conversationId`), every card one bot made of it (`madeBy`: in all its chats), or the home's. The person deleting
   * it may not read every chat the cards are in, so the mark reaches the whole home (D-66): the caller has already
   * checked the page is theirs to delete. Answers the cards in `shownIn`, the chat the person is looking at; the
   * others catch up by themselves.
   */
  async function markPageRemoved(where, path, shownIn, options) {
    const home = { ...passedOn(options), context: systemContext("a deleted page's cards say so wherever its file showed").forWorkspace(homeOf(options)) };
    const filters = { ...where, kind: "page", bodyPath: String(path) };
    const lines = await messages.patchWhere(filters, { body: mergedBody({ removed: true }) }, { ...home, returning: "records" });
    return rowsOf(lines, options).filter((row) => String(row.conversation_id) === String(shownIn)).map(toMessage);
  }

  /** A card's body with `fields` merged in by the database, so a change made meanwhile (a page's deleted mark) stays. */
  async function mergeBody(messageId, fields, options) {
    const [line] = await rewriteBodies({ id: String(messageId) }, mergedBody(fields), options);
    return line || null;
  }

  /**
   * One reaction on a message (`body.reactions[who]`), set to `emoji` or taken away (null) by the database, so of
   * several people reacting at once every reaction stays (D-114). Answers the message as the page shows it.
   */
  async function setReaction(messageId, who, emoji, options) {
    const body = messages.column("body");
    const changed = emoji
      ? messages.raw("jsonb_set(??, '{reactions}', coalesce(?? -> 'reactions', '{}'::jsonb) || ?::jsonb)", [body, body, JSON.stringify({ [who]: emoji })])
      : messages.raw("?? #- array['reactions', ?]::text[]", [body, String(who)]);
    const [line] = await rewriteBodies({ id: String(messageId) }, changed, options);
    return line || null;
  }

  /**
   * The cards of one kind that name one slug (`body.slug`), that a bot wrote in any chat of a home (`homeId`, else the
   * call's), given `merge`'s fields and without `drop`'s: a change one person makes that every chat with the bot must
   * show, though nobody reads all of them, as a deleted page's mark does. The caller has already checked the change is
   * theirs to make. Answers the cards the caller reads, each with its chat (`chatId`), so a caller tells each chat's
   * people without reading the cards again; the others catch up by themselves.
   * @param {{ botId: string, kind: string, slug: string, homeId?: string | null }} where
   * @param {{ merge?: object, drop?: string[] }} change
   * @param {CallOptions} options
   */
  async function rewriteCards({ botId, kind, slug, homeId = null }, { merge = {}, drop = [] }, options) {
    const filters = { madeBy: String(botId), kind: String(kind), bodySlug: String(slug) };
    const home = String(homeId ?? homeOf(options));
    const everywhere = { ...passedOn(options), context: systemContext("a card's change reaches every chat of its bot").forWorkspace(home) };
    const body = messages.raw("(?? - array(select jsonb_array_elements_text(?::jsonb))) || ?::jsonb", [
      messages.column("body"),
      JSON.stringify(drop),
      JSON.stringify(merge)
    ]);
    const changed = await messages.patchWhere(filters, { body }, { ...everywhere, returning: "records" });
    if (!changed.length) return [];
    const seen = await messages.queryAll({ filters: { id: changed.map((line) => String(line.id)) }, sort: ["id"] }, passedOn(options));
    return rowsOf(seen, options).map((row) => ({ ...toMessage(row), chatId: String(row.conversation_id) }));
  }

  return Object.freeze({
    append,
    timeline,
    catchUp,
    changeHorizon,
    latestPerConversation,
    messageIn,
    lockMessageIn,
    // readable-check: allow setter-seam - not a slot: saves a message's new body
    setBody,
    mergeBody,
    // readable-check: allow setter-seam - not a slot: writes one reaction on a message
    setReaction,
    claimBody,
    latestOfKind,
    hasUserText,
    byClientId,
    latestId,
    messageById,
    messagesAfter,
    messagesUpTo,
    routineRuns,
    recentText,
    madeIn,
    pinnedBefore,
    findBefore,
    searchText,
    searchMade,
    searchRoutines,
    markPageRemoved,
    rewriteCards
  });
}
