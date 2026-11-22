import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { peopleNamed } from "../mentions.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * A bot's digest of the home's public chats (D-113) as the memory reads it: its text, where it read each chat up to,
 * the home's newest message then, its version, and when it was made; null when the bot has none yet.
 * @typedef {{ botId: string, text: string, covers: Record<string, string>, upTo: string | null, version: number, tokens: number, madeAt: string }} Digest
 */
/**
 * One line of a chat as the memory reads it: words only, with who said them (the name kept on the message) and when.
 * @typedef {{ id: string, chatId: string, speaker: string, text: string, at: string }} Line
 */

/** bot_memories filters beyond its `search: true` fields: some bots' digests. */
export const MEMORY_SEARCH = Object.freeze({
  botIds: Object.freeze({ type: "array", actualField: "botId", filterOperator: "in", items: { type: "id" } })
});

/**
 * bot_memory_queue filters beyond its `search: true` fields: some bots' refreshes, and those due, whose time has come
 * by the database's clock and no server holds the lease of (or its server's lapsed, D-15).
 */
export const MEMORY_QUEUE_SEARCH = Object.freeze({
  ...MEMORY_SEARCH,
  due: Object.freeze({
    type: "boolean",
    applyFilter(query, _due, { column }) {
      query
        .whereRaw("?? <= now()", [column("dueAt")])
        .where((free) => free.whereNull(column("claimedUntil")).orWhereRaw("?? < now()", [column("claimedUntil")]));
    }
  })
});

const DIGEST_FIELDS = Object.freeze(["botId", "text", "covers", "upTo", "version", "tokens", "madeAt"]);
// A refresh's row just made, before its ask sets when it's due: never due on its own.
const NOT_YET = "9999-12-31T00:00:00.000Z";
// Each per-bot table's one row a bot, as a write that may find it there already names it.
const ONE_A_BOT = Object.freeze({ keys: ["botId", "workspaceId"], action: "ignore" });

/**
 * What the bots remember (D-113): each bot's digest of the home's public chats and its refreshes waiting, and the reads
 * the memory makes of the chats. Every read of what was said goes through the caller's options: the digest's input
 * through the memory's reader (records.readers.forHome: public chats only), a turn's "since then", recall and
 * read_chat through the model's reader for the bot in its chat (readable_from, D12), so the row policies decide what
 * each reaches, never this code. The digest and the queue are the home's; the runner claims across homes in its
 * system context and writes in each digest's own.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createMemoryRepository(resources) {
  const { botMemories, botMemoryQueue: queue, messages, conversations, chatBots } = resources;
  const minutesFromNow = (handle, minutes) => handle.raw("now() + make_interval(mins => ?)", [Number(minutes)]);
  const ids = (list) => [...new Set(list.map(String))];

  /** @returns {Digest | null} */
  function asDigest(record) {
    if (!record) return null;
    return {
      botId: String(record.botId),
      text: String(record.text || ""),
      covers: Object.fromEntries(Object.entries(record.covers || {}).map(([chat, upTo]) => [String(chat), String(upTo)])),
      upTo: record.upTo == null ? null : String(record.upTo),
      version: Number(record.version) || 0,
      tokens: Number(record.tokens) || 0,
      madeAt: record.madeAt
    };
  }

  /** A bot's digest, or null. @param {string} botId @param {CallOptions} options */
  async function digestOf(botId, options) {
    const [found] = await botMemories.queryAll({ filters: { botId: String(botId) }, fields: [...DIGEST_FIELDS] }, passedOn(options));
    return asDigest(found ?? null);
  }

  /** The digests of some bots, by bot: one read. @param {string[]} botIds @param {CallOptions} options */
  async function digestsOf(botIds, options) {
    const wanted = ids(botIds);
    if (!wanted.length) return new Map();
    const found = await botMemories.queryAll({ filters: { botIds: wanted }, fields: [...DIGEST_FIELDS] }, passedOn(options));
    return new Map(found.map((record) => [String(record.botId), asDigest(record)]));
  }

  /**
   * A refresh's digest written only while the stored one is still the one it read (`follows`, its version; null when
   * there was none): answers whether it was. A slower server, or a forgetting meanwhile, leaves it unwritten.
   * @param {string} botId
   * @param {number | null} follows
   * @param {{ text: string, covers: Record<string, string>, upTo: string | null, tokens: number }} digest
   * @param {CallOptions} options
   */
  async function saveDigest(botId, follows, { text, covers, upTo, tokens }, options) {
    const written = { text, covers, upTo, tokens };
    if (follows == null) {
      // made_at's default is the database's now(): an insert takes no SQL value.
      const made = await botMemories.createMany([{ botId: String(botId), ...written, version: 1, follows: null }], {
        ...passedOn(options),
        onConflict: ONE_A_BOT,
        returning: "count"
      });
      return made > 0;
    }
    const changed = await botMemories.patchWhere(
      { botId: String(botId), version: Number(follows) },
      { ...written, madeAt: botMemories.raw("now()"), version: Number(follows) + 1, follows: Number(follows) },
      { ...passedOn(options), returning: "count" }
    );
    return changed > 0;
  }

  /**
   * Some bots' digests emptied at once (O23: a chat deleted, a removal): whatever a refresh still running read is
   * refused when it writes (its version is gone), and the next refresh is made from the chats themselves. Two
   * statements for any number of bots.
   * @param {string[]} botIds
   * @param {CallOptions} options
   */
  async function emptyDigests(botIds, options) {
    const wanted = ids(botIds);
    if (!wanted.length) return;
    const empty = { text: "", covers: {}, upTo: null, tokens: 0 };
    await botMemories.createMany(wanted.map((botId) => ({ botId, ...empty, version: 0, follows: null })), {
      ...passedOn(options),
      onConflict: ONE_A_BOT,
      returning: "none"
    });
    await botMemories.patchWhere(
      { botIds: wanted },
      { ...empty, version: botMemories.raw("?? + 1", [botMemories.column("version")]), follows: null, madeAt: botMemories.raw("now()") },
      { ...passedOn(options), returning: "none" }
    );
  }

  /**
   * Refreshes asked for some bots: due in `minutes` (0: now), or sooner if one is already due sooner; `rebuild` asks for
   * one made from the chats. Each ask counts (asks), so a refresh already running doesn't drop it when it ends. Two
   * statements for any number of bots.
   * @param {Array<{ botId: string, minutes: number }>} asked
   * @param {{ rebuild?: boolean }} how
   * @param {CallOptions} options
   */
  async function ask(asked, { rebuild = false } = {}, options) {
    const byBot = new Map();
    for (const { botId, minutes } of asked) {
      byBot.set(String(botId), Math.min(byBot.get(String(botId)) ?? Infinity, Math.max(0, Number(minutes) || 0)));
    }
    if (!byBot.size) return;
    // A bot's row made when missing, not yet due: the patch below sets its time by the database's clock (an insert
    // takes no SQL value), as it does for a row already there.
    await queue.createMany([...byBot.keys()].map((botId) => ({ botId, dueAt: NOT_YET, asks: 0, rebuild })), {
      ...passedOn(options),
      onConflict: ONE_A_BOT,
      returning: "none"
    });
    // One statement per distinct wait (usually one): the due time only ever moves sooner.
    const byWait = new Map();
    for (const [botId, minutes] of byBot) byWait.set(minutes, [...(byWait.get(minutes) || []), botId]);
    for (const [minutes, botIds] of byWait) {
      await queue.patchWhere(
        { botIds },
        {
          asks: queue.raw("?? + 1", [queue.column("asks")]),
          dueAt: queue.raw("least(??, now() + make_interval(mins => ?))", [queue.column("dueAt"), minutes]),
          ...(rebuild ? { rebuild: true } : {})
        },
        { ...passedOn(options), returning: "none" }
      );
    }
  }

  /**
   * The next refresh due that no other server holds, leased to this run for `leaseSeconds`; null when none is due.
   * Runs in the runner's system context, across every home; the refresh answers its hidden workspaceId, so its work
   * runs in its own home.
   * @param {string} runId the run's own id
   * @param {number} leaseSeconds
   * @param {CallOptions} options
   * @returns {Promise<{ botId: string, workspaceId: string, asks: number, attempts: number, rebuild: boolean, runId: string } | null>}
   */
  function claim(runId, leaseSeconds, options) {
    return queue.withTransaction(options, async (txOptions) => {
      const [due] = await queue.claim(
        { filters: { due: true }, sort: ["dueAt"], take: 1 },
        { ...txOptions, fields: ["botId", "asks", "attempts", "rebuild", "workspaceId"] }
      );
      if (!due) return null;
      const lease = { claimedBy: runId, claimedUntil: queue.raw("now() + make_interval(secs => ?)", [Number(leaseSeconds)]) };
      await queue.patchWhere({ botId: String(due.botId) }, lease, { ...txOptions, returning: "none" });
      return {
        botId: String(due.botId),
        workspaceId: String(due.workspaceId),
        asks: Number(due.asks),
        attempts: Number(due.attempts),
        rebuild: Boolean(due.rebuild),
        runId
      };
    });
  }

  const ofRun = (run) => ({ botId: String(run.botId), claimedBy: run.runId });

  /** A run's lease kept for `leaseSeconds` more: false when the refresh is no longer the run's. */
  async function renew(run, leaseSeconds, options) {
    const kept = { claimedUntil: queue.raw("now() + make_interval(secs => ?)", [Number(leaseSeconds)]) };
    return (await queue.patchWhere(ofRun(run), kept, { ...passedOn(options), returning: "count" })) > 0;
  }

  /**
   * A run done: its refresh goes when nothing was asked since it was claimed; one asked meanwhile stays, given up by
   * the run, for its own time.
   */
  async function done(run, options) {
    const gone = await queue.deleteWhere({ ...ofRun(run), asks: run.asks }, { ...passedOn(options), returning: "count" });
    if (gone > 0) return;
    await queue.patchWhere(ofRun(run), { claimedBy: null, claimedUntil: null, attempts: 0, lastError: null }, { ...passedOn(options), returning: "none" });
  }

  /** A run whose digest was refused (another was written first): its refresh is due again now, from the newer one. */
  async function again(run, options) {
    await queue.patchWhere(ofRun(run), { claimedBy: null, claimedUntil: null, dueAt: queue.raw("now()") }, { ...passedOn(options), returning: "none" });
  }

  /** A run that failed: tried again in 1, 2, 4… up to 60 minutes, with what went wrong. */
  async function failed(run, error, options) {
    const wait = Math.min(60, 2 ** run.attempts);
    await queue.patchWhere(ofRun(run), {
      claimedBy: null,
      claimedUntil: null,
      attempts: run.attempts + 1,
      lastError: String(error?.message || error).slice(0, 500),
      dueAt: minutesFromNow(queue, wait)
    }, { ...passedOn(options), returning: "none" });
  }

  /** The bots of some chats, by chat (their seats), through the caller's options. */
  async function botsOfChats(chatIds, options) {
    const wanted = ids(chatIds);
    if (!wanted.length) return [];
    const seats = await chatBots.queryAll({ filters: { conversationIds: wanted }, fields: ["conversationId", "botId"] }, passedOn(options));
    return seats.map((seat) => ({ chatId: String(seat.conversationId), botId: String(seat.botId) }));
  }

  /**
   * The chats a bot is in that the caller reads, newest activity first: the memory's reader reads its public ones.
   * @param {string} botId
   * @param {CallOptions} options
   */
  async function chatsOf(botId, options) {
    const seats = await chatBots.queryAll({ filters: { botId: String(botId) }, fields: ["conversationId"] }, passedOn(options));
    if (!seats.length) return [];
    const found = await conversations.queryAll({
      filters: { id: ids(seats.map((seat) => seat.conversationId)) },
      sort: ["-lastActivityAt", "-id"],
      fields: ["kind", "title", "directUserId", "directBotId", "lastActivityAt", "archivedAt"]
    }, passedOn(options));
    return found.map((chat) => ({
      id: String(chat.id),
      kind: chat.kind,
      title: chat.title ?? null,
      directUserId: chat.directUserId == null ? null : String(chat.directUserId),
      directBotId: chat.directBotId == null ? null : String(chat.directBotId),
      lastActivityAt: chat.lastActivityAt,
      archivedAt: chat.archivedAt ?? null
    }));
  }

  // A line's words and who said them, as the memory reads every line: a person's or a bot's words (no status lines,
  // no Mercbot lines), under the name kept on the message, with the people it mentions (D-114) to read them by name.
  const lineFields = (query, alias) => query
    .select({ id: messages.column("id", alias), chat_id: messages.column("conversationId", alias), at: messages.column("createdAt", alias) })
    .select(messages.raw("?? ->> 'text' as text", [messages.column("body", alias)]))
    .select(messages.raw("?? ->> 'authorName' as speaker", [messages.column("body", alias)]))
    .select(messages.raw("?? -> 'mentionedPeople' as people", [messages.column("body", alias)]));
  const wordsOnly = (query, alias) => query
    .where(messages.column("kind", alias), "text")
    .whereNot(messages.column("role", alias), "system")
    .whereRaw("coalesce(?? ->> 'text', '') <> ''", [messages.column("body", alias)])
    .whereRaw("?? ->> 'lead' is null", [messages.column("body", alias)]);
  // Where each chat is read from: past where the digest read it, or past the home's newest message when it was made.
  const pastRead = (query, alias, { covers = {}, upTo = null }) => query.whereRaw(
    "?? > coalesce((?::jsonb ->> ??::text)::bigint, ?::bigint, 0)",
    [messages.column("id", alias), JSON.stringify(covers), messages.column("conversationId", alias), upTo == null ? null : String(upTo)]
  );
  /** A line as the model reads it, a person's mention as "@Name" as in the bots' turns (botAgent.contentOf). @returns {Line} */
  const asLine = (row) => ({ id: String(row.id), chatId: String(row.chat_id), speaker: row.speaker || "Someone", text: peopleNamed(row.text, row.people), at: row.at });

  /**
   * A chat's newest `cap` lines past where its digest read it, oldest first, as one JSON array: a subquery of the
   * chat's row (alias "c"), through the messages' own scope, so it reads only the lines it keeps. Answered inside an
   * object: a Knex builder an async function answers is awaited, and runs as a statement of its own.
   * @param {{ covers?: Record<string, string>, upTo?: string | null }} read
   * @param {number} cap
   * @param {CallOptions} options
   */
  // Knex: newest-per-group - a chat's newest lines past its digest, a correlated subquery of the chat's row through the
  // (conversation_id, id) index, as one JSON array
  async function linesOfChat(read, cap, options) {
    const { query: newest } = await messages.scopedQuery({ alias: "l" }, passedOn(options));
    pastRead(wordsOnly(newest, "l"), "l", read)
      .whereColumn(messages.column("conversationId", "l"), conversations.column("id", "c"))
      .orderBy(messages.column("id", "l"), "desc")
      .limit(Number(cap))
      .select(messages.column("id", "l"));
    const { query } = await messages.scopedQuery({ alias: "o" }, passedOn(options));
    const [id, chat, body, at] = ["id", "conversationId", "body", "createdAt"].map((field) => messages.column(field, "o"));
    query.join(newest.as("x"), "x.id", id).select(messages.raw(
      "coalesce(json_agg(json_build_object('id', ??, 'chat_id', ??, 'text', ?? ->> 'text', 'speaker', ?? ->> 'authorName', 'people', ?? -> 'mentionedPeople', 'at', ??) order by ??), '[]'::json)",
      [id, chat, body, body, body, at, id]
    ));
    return { query };
  }

  /** How many lines a chat (alias "c") has past where its digest read it, counted up to `cap`: a subquery of its row. */
  // Knex: subquery - a bounded count of a chat's lines past its digest, over a derived table of at most `cap` rows
  async function countOfChat(read, cap, options) {
    const { query: some } = await messages.scopedQuery({ alias: "k" }, passedOn(options));
    pastRead(wordsOnly(some, "k"), "k", read)
      .whereColumn(messages.column("conversationId", "k"), conversations.column("id", "c"))
      .limit(Number(cap))
      .select(messages.column("id", "k"));
    const { query } = await messages.scopedQuery({ alias: "q" }, passedOn(options));
    query.join(some.as("y"), "y.id", messages.column("id", "q")).select(messages.raw("count(*)"));
    return { query };
  }

  /** Whether a chat (alias "c") has any line past where its digest read it: a subquery of its row. */
  // Knex: subquery - whether a chat has a line past where its digest read each chat, which no filter expresses
  async function anyNewIn(read, options) {
    const { query } = await messages.scopedQuery({ alias: "e" }, passedOn(options));
    pastRead(wordsOnly(query, "e"), "e", read)
      .whereColumn(messages.column("conversationId", "e"), conversations.column("id", "c"))
      .select(messages.raw("1"));
    return { query };
  }

  const chatOf = (row) => ({
    id: String(row.id),
    title: row.title ?? null,
    directUserId: row.direct_user_id == null ? null : String(row.direct_user_id),
    directBotId: row.direct_bot_id == null ? null : String(row.direct_bot_id)
  });
  const chatFields = {
    id: conversations.column("id", "c"),
    title: conversations.column("title", "c"),
    direct_user_id: conversations.column("directUserId", "c"),
    direct_bot_id: conversations.column("directBotId", "c")
  };

  /**
   * The newest lines of some chats past where a digest read each (`read`: its covers, or nothing for every line), up to
   * `perChat` a chat, oldest first in each: what a refresh reads. One statement, through the caller's options, which
   * read only the chats their reader may; rows read follow the lines kept.
   * @param {string[]} chatIds
   * @param {{ covers?: Record<string, string>, upTo?: string | null }} read
   * @param {number} perChat
   * @param {CallOptions} options
   * @returns {Promise<Line[]>}
   */
  // Knex: newest-per-group - each chat's newest `perChat` lines past where its digest read it, a correlated subquery
  // of each chat's row through the (conversation_id, id) index
  async function newLines(chatIds, read, perChat, options) {
    const wanted = ids(chatIds);
    if (!wanted.length) return [];
    const lines = await linesOfChat(read, perChat, options);
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    const chats = await query
      .whereIn(conversations.column("id", "c"), wanted)
      .orderBy(conversations.column("id", "c"))
      .select({ id: conversations.column("id", "c") })
      .select(lines.query.as("lines"));
    return chats.flatMap((chat) => (chat.lines || []).map(asLine));
  }

  /**
   * The words written in a bot's chats past where its digest read them (`read`), as characters, counted over at most
   * `rows` lines: whether a refresh is due (D-113's threshold), and whether anything happened at all. One statement.
   * @param {string} botId
   * @param {{ covers?: Record<string, string>, upTo?: string | null }} read
   * @param {number} rows
   * @param {CallOptions} options
   * @returns {Promise<{ lines: number, chars: number }>}
   */
  // Knex: report - the lengths of a bot's new lines in the chats the caller reads, at most `rows` of them: a bounded
  // measure no field or aggregate filter expresses (each chat is read past its own point)
  async function newWords(botId, read, rows, options) {
    const seats = await chatBots.scopedQuery({ alias: "s" }, passedOn(options));
    seats.query.select(chatBots.column("conversationId", "s")).where(chatBots.column("botId", "s"), String(botId));
    const { query } = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    const found = await pastRead(wordsOnly(query, "m"), "m", read)
      .whereIn(messages.column("conversationId", "m"), seats.query)
      .limit(Number(rows))
      .select(messages.raw("length(?? ->> 'text') as chars", [messages.column("body", "m")]));
    return { lines: found.length, chars: found.reduce((sum, row) => sum + Number(row.chars || 0), 0) };
  }

  /**
   * "Since then" (D-113): the bot's other chats the caller reads (the model's reader for the bot in `chatId`, so
   * readable_from(chat)) with lines past where its digest read them, newest activity first, up to `chats` of them, each
   * with its newest `lines` lines (oldest first) and how many it has (counted up to 1,001); and, when more chats have
   * such lines, how many (up to 1,001) and their lines (up to 1,001). One statement, three when more chats have lines.
   * @param {string} botId
   * @param {string} chatId the chat the turn is in, left out
   * @param {{ covers?: Record<string, string>, upTo?: string | null }} read
   * @param {{ chats: number, lines: number }} limits
   * @param {CallOptions} options
   */
  // Knex: newest-per-group - the bot's chats the caller reads with new lines, newest activity first, each with its
  // newest lines and a bounded count as correlated subqueries of its row: rows read follow the lines shown
  async function sinceThen(botId, chatId, read, limits, options) {
    const seats = await chatBots.scopedQuery({ alias: "s" }, passedOn(options));
    seats.query.select(chatBots.column("conversationId", "s")).where(chatBots.column("botId", "s"), String(botId));
    const [lines, counted, anyNew] = await Promise.all([
      linesOfChat(read, limits.lines, options),
      countOfChat(read, 1001, options),
      anyNewIn(read, options)
    ]);
    const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
    const chats = await query
      .whereIn(conversations.column("id", "c"), seats.query)
      .whereNot(conversations.column("id", "c"), String(chatId))
      .whereExists(anyNew.query)
      .orderBy(conversations.column("lastActivityAt", "c"), "desc")
      .orderBy(conversations.column("id", "c"), "desc")
      .limit(Number(limits.chats) + 1)
      .select(chatFields)
      .select(lines.query.as("lines"))
      .select(counted.query.as("total"));
    const kept = chats.slice(0, Number(limits.chats)).map((chat) => ({
      ...chatOf(chat),
      lines: (chat.lines || []).map(asLine),
      total: Number(chat.total)
    }));
    if (chats.length <= Number(limits.chats)) return { chats: kept, rest: { chats: 0, lines: 0 } };
    return { chats: kept, rest: await restOf(botId, [String(chatId), ...kept.map((chat) => chat.id)], read, options) };
  }

  /**
   * How many more of the bot's chats the caller reads have new lines, and how many lines, each counted up to 1,001:
   * the bounded tail of "since then", which names only the counts. Two statements.
   */
  // Knex: report - bounded counts of the bot's other chats with new lines and of their lines, over derived tables of
  // at most 1,001 rows each, which no aggregate's filters express
  async function restOf(botId, besides, read, options) {
    // Knex: subquery - the bot's other chats the caller reads with new lines, at most 1,001 of them
    const restChats = async () => {
      const seats = await chatBots.scopedQuery({ alias: "s" }, passedOn(options));
      seats.query.select(chatBots.column("conversationId", "s")).where(chatBots.column("botId", "s"), String(botId));
      const anyNew = await anyNewIn(read, options);
      const { query } = await conversations.scopedQuery({ alias: "c" }, passedOn(options));
      query
        .whereIn(conversations.column("id", "c"), seats.query)
        .whereNotIn(conversations.column("id", "c"), besides)
        .whereExists(anyNew.query)
        .limit(1001)
        .select(conversations.column("id", "c"));
      return { query };
    };
    const { query: chats } = await conversations.scopedQuery({ alias: "r" }, passedOn(options));
    const [chatCount] = await chats.join((await restChats()).query.as("y"), "y.id", conversations.column("id", "r")).select(conversations.raw("count(*) as n"));
    const { query: some } = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    pastRead(wordsOnly(some, "m"), "m", read)
      .whereIn(messages.column("conversationId", "m"), (await restChats()).query)
      .limit(1001)
      .select(messages.column("id", "m"));
    const { query: counting } = await messages.scopedQuery({ alias: "t" }, passedOn(options));
    const [lineCount] = await counting.join(some.as("z"), "z.id", messages.column("id", "t")).select(messages.raw("count(*) as n"));
    return { chats: Number(chatCount?.n || 0), lines: Number(lineCount?.n || 0) };
  }

  /**
   * Recall (D-113): the lines that best match the words, best first, up to `limit`, in the chats the caller reads (the
   * model's reader: readable_from(chat)), narrowed to `chatIds` when given, or to the bot's own chats when `botId` is.
   * Full-text search through the messages' recall index (migrations/20261122140000).
   * @param {string} words
   * @param {{ chatIds?: string[] | null, botId?: string | null, limit: number }} where
   * @param {CallOptions} options
   */
  // Knex: report - full-text search of the words said in the chats the caller reads, ranked by how well each matches,
  // which no field or filter expresses
  async function recall(words, { chatIds = null, botId = null, limit }, options) {
    const { query } = await messages.scopedQuery({ alias: "m" }, passedOn(options));
    const body = messages.column("body", "m");
    // The words as a tsquery that matches a line holding any of them (plainto_tsquery's would need them all), stemmed
    // and without the stop words, as the recall index makes them.
    lineFields(wordsOnly(query, "m"), "m")
      .whereRaw("to_tsvector('english', ?? ->> 'text') @@ replace(plainto_tsquery('english', ?)::text, ' & ', ' | ')::tsquery", [body, words])
      .orderByRaw("ts_rank(to_tsvector('english', ?? ->> 'text'), replace(plainto_tsquery('english', ?)::text, ' & ', ' | ')::tsquery) desc, ?? desc", [body, words, messages.column("id", "m")])
      .limit(Number(limit));
    if (chatIds) query.whereIn(messages.column("conversationId", "m"), ids(chatIds));
    if (botId) {
      const seats = await chatBots.scopedQuery({ alias: "s" }, passedOn(options));
      query.whereIn(messages.column("conversationId", "m"), seats.query.select(chatBots.column("conversationId", "s")).where(chatBots.column("botId", "s"), String(botId)));
    }
    return (await query).map(asLine);
  }

  /**
   * A window of one chat's lines: up to `before` lines up to `around` (a line's id) and `after` lines past it, or the
   * chat's newest `before` lines without one, oldest first. Two reads at most, through the caller's options.
   * @param {string} chatId
   * @param {{ around?: string | null, before: number, after: number }} window
   * @param {CallOptions} options
   */
  async function window(chatId, { around = null, before, after }, options) {
    const page = async (filters, sort, size) => (size > 0
      ? (await messages.query({ filters: { conversationId: String(chatId), kinds: ["text"], ...filters }, sort, page: { size }, fields: ["conversationId", "role", "body", "createdAt"] }, passedOn(options))).records
      : []);
    const upTo = await page(around ? { atMostId: String(around) } : {}, ["-id"], Number(before));
    const past = around ? await page({ afterId: String(around) }, ["id"], Number(after)) : [];
    return [...upTo.reverse(), ...past]
      .filter((record) => record.role !== "system" && String(record.body?.text || "") && !record.body?.lead)
      .map((record) => asLine({
        id: record.id,
        chat_id: record.conversationId,
        text: record.body.text,
        people: record.body.mentionedPeople,
        speaker: record.body.authorName,
        at: record.createdAt
      }));
  }

  return Object.freeze({
    digestOf,
    digestsOf,
    saveDigest,
    emptyDigests,
    ask,
    claim,
    renew,
    done,
    again,
    failed,
    botsOfChats,
    chatsOf,
    newLines,
    newWords,
    sinceThen,
    recall,
    window
  });
}
