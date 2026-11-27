import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

// What a piece of knowledge answers without its text, which a book makes megabytes of: the list, a turn's catalogue.
const KNOWLEDGE_FIELDS = Object.freeze([
  "id", "botId", "title", "kind", "filePath", "chars", "state", "problem", "partsTotal", "partsDone", "createdBy", "createdAt", "updatedAt"
]);
const PART_FIELDS = Object.freeze(["id", "knowledgeId", "position", "heading", "pages", "text"]);

/** A part as the search and a read answer it, its ids as strings and its position a number. */
const partOf = (part) => ({ ...part, id: String(part.id), knowledgeId: String(part.knowledgeId), position: Number(part.position) });

/**
 * bot_knowledge filters beyond its `search: true` fields.
 * - waiting: still to be read or split (reading, indexing), and no server holds its lease, or its server's lease
 *   lapsed (it stopped, D-15), by the database's clock.
 */
export const KNOWLEDGE_SEARCH = Object.freeze({
  waiting: {
    type: "boolean",
    applyFilter(query, _waiting, { column }) {
      query
        .whereIn(column("state"), ["reading", "indexing"])
        .where((free) => free.whereNull(column("leaseUntil")).orWhereRaw("?? < now()", [column("leaseUntil")]));
    }
  },
  ids: { type: "array", actualField: "id", filterOperator: "in" }
});

/** bot_knowledge_parts filters beyond its `search: true` fields: the parts from one on. */
export const KNOWLEDGE_PART_SEARCH = Object.freeze({
  fromPosition: { type: "integer", actualField: "position", filterOperator: ">=" }
});

/**
 * What the bots know (D-107): each bot's pieces of knowledge, whole, and the parts they're split into, which a turn
 * searches. The pieces are read and written in the caller's home (ownership keeps them there); the server reading and
 * splitting a piece holds it under a lease (`leaseBy`, its run's own id, until `leaseUntil`), and writes its progress
 * only while it still holds it, so a piece changed, removed or taken over meanwhile is never written by the run before.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources the records' handles
 */
export function createKnowledgeRepository({ botKnowledge: pieces, botKnowledgeParts: parts }) {
  const secondsFromNow = (seconds) => pieces.raw("now() + make_interval(secs => ?)", [Number(seconds)]);
  const asPiece = (record) => (record ? { ...record, id: String(record.id), botId: String(record.botId) } : null);
  /** Writes of one run: only while the piece is still its own. @param {{ id: string, leaseBy: string }} run */
  const ofRun = ({ id, leaseBy }) => ({ id: [String(id)], leaseBy });

  /**
   * A bot's pieces, oldest first, without their text.
   * @param {string} botId
   * @param {CallOptions} options
   */
  async function list(botId, options) {
    const records = await pieces.queryAll({ filters: { botId: String(botId) }, sort: ["id"], fields: [...KNOWLEDGE_FIELDS] }, passedOn(options));
    return records.map(asPiece);
  }

  /**
   * One piece of a bot's, with its text when `withText`, or null.
   * @param {string} botId
   * @param {string} id
   * @param {CallOptions} options
   * @param {{ withText?: boolean }} [how]
   */
  async function piece(botId, id, options, { withText = false } = {}) {
    const fields = withText ? [...KNOWLEDGE_FIELDS, "text"] : [...KNOWLEDGE_FIELDS];
    const [found] = await pieces.queryAll({ filters: { botId: String(botId), ids: [String(id)] }, fields }, passedOn(options));
    return asPiece(found);
  }

  /**
   * The text of some of a bot's pieces (those a turn keeps in mind), in the order given.
   * @param {string} botId
   * @param {string[]} ids
   * @param {CallOptions} options
   */
  async function texts(botId, ids, options) {
    if (!ids.length) return [];
    const found = await pieces.queryAll({ filters: { botId: String(botId), ids: ids.map(String) }, fields: ["id", "title", "text"] }, passedOn(options));
    const byId = new Map(found.map((record) => [String(record.id), record]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean)
      .map((record) => ({ id: String(record.id), title: record.title, text: record.text }));
  }

  /**
   * Adds a piece, waiting to be read or split; answers its id.
   * @param {{ botId: string, title: string, kind: "text" | "file", text?: string, filePath?: string | null, chars?: number, createdBy?: string | null }} piece
   * @param {CallOptions} options
   */
  async function add({ botId, title, kind, text = "", filePath = null, chars = 0, createdBy = null }, options) {
    const id = await pieces.create({
      botId: String(botId),
      title,
      kind,
      text,
      filePath,
      chars,
      state: kind === "file" ? "reading" : "indexing",
      partsTotal: 0,
      partsDone: 0,
      createdBy: createdBy ? String(createdBy) : null
    }, { ...passedOn(options), returning: "id" });
    return String(id);
  }

  /**
   * Changes a piece's title, or its text, which then waits to be split again: its parts go, and a run splitting it
   * no longer holds it. The piece is written first, under its row's lock, so a run writing parts meanwhile either
   * finished before (and its parts go here) or finds the piece no longer its own (and writes none).
   * @param {string} botId
   * @param {string} id
   * @param {{ title?: string, text?: string }} changes
   * @param {CallOptions} options
   */
  async function change(botId, id, changes, options) {
    return pieces.withTransaction(passedOn(options), async (txOptions) => {
      const patch = { updatedAt: pieces.raw("now()") };
      if (changes.title !== undefined) patch.title = changes.title;
      const reindexed = changes.text !== undefined;
      if (reindexed) {
        Object.assign(patch, {
          text: changes.text, chars: [...changes.text].length, state: "indexing", problem: null, partsTotal: 0, partsDone: 0, leaseUntil: null, leaseBy: null
        });
      }
      const [changed = null] = await pieces.patchWhere({ id: [String(id)], botId: String(botId) }, patch, { ...txOptions, returning: "records" });
      if (changed && reindexed) await parts.deleteWhere({ knowledgeId: String(id) }, txOptions);
      return asPiece(changed);
    });
  }

  /**
   * Starts a failed piece again from the start: a file is read again.
   * @param {string} botId
   * @param {string} id
   * @param {CallOptions} options
   */
  async function retry(botId, id, options) {
    const [changed = null] = await pieces.patchWhere(
      { id: [String(id)], botId: String(botId), state: "failed" },
      { state: pieces.raw("case when ?? = 'file' then 'reading' else 'indexing' end", [pieces.column("kind")]), problem: null, partsTotal: 0, partsDone: 0, leaseUntil: null, leaseBy: null, updatedAt: pieces.raw("now()") },
      { ...passedOn(options), returning: "records" }
    );
    return asPiece(changed);
  }

  /**
   * Removes a piece with its parts; answers whether it was there.
   * @param {string} botId
   * @param {string} id
   * @param {CallOptions} options
   */
  async function remove(botId, id, options) {
    return (await pieces.deleteWhere({ id: [String(id)], botId: String(botId) }, { ...passedOn(options), returning: "count" })) > 0;
  }

  /**
   * The next piece waiting to be read or split that no other server holds, leased to this run for `leaseSeconds`;
   * null when none waits. Runs in the indexer's system context, across every home; the piece answers its hidden
   * workspaceId, so its work runs in its own home.
   * @param {string} leaseBy the run's own id
   * @param {number} leaseSeconds
   * @param {CallOptions} options the indexer's system context
   */
  function claim(leaseBy, leaseSeconds, options) {
    return pieces.withTransaction(options, async (txOptions) => {
      const [waiting] = await pieces.claim(
        { filters: { waiting: true }, sort: ["id"], take: 1 },
        { ...txOptions, fields: [...KNOWLEDGE_FIELDS, "text", "workspaceId"] }
      );
      if (!waiting) return null;
      await pieces.patchWhere({ id: [String(waiting.id)] }, { leaseUntil: secondsFromNow(leaseSeconds), leaseBy }, { ...txOptions, returning: "none" });
      return { ...asPiece(waiting), workspaceId: String(waiting.workspaceId), leaseBy };
    });
  }

  /**
   * Writes a run's progress and keeps its lease, with the parts it wrote (`parts`), and first, when `from` is given,
   * taking away any parts after that position, which a run before it left part-way; answers false when the piece is
   * no longer the run's (changed, removed or taken over), which then stops having written nothing. The piece's row is
   * written first, so its lock keeps a change or a removal from crossing the parts written here.
   * @param {{ id: string, botId: string, leaseBy: string }} run
   * @param {Record<string, unknown>} changes
   * @param {number} leaseSeconds
   * @param {CallOptions} options
   * @param {{ from?: number, parts?: Array<{ position: number, heading: string, pages: string, text: string }> }} [written]
   */
  async function progress(run, changes, leaseSeconds, options, { from, parts: written = [] } = {}) {
    return pieces.withTransaction(passedOn(options), async (txOptions) => {
      const kept = { ...changes, leaseUntil: secondsFromNow(leaseSeconds), updatedAt: pieces.raw("now()") };
      if (!((await pieces.patchWhere(ofRun(run), kept, { ...txOptions, returning: "count" })) > 0)) return false;
      if (from !== undefined) await parts.deleteWhere({ knowledgeId: String(run.id), fromPosition: from + 1 }, txOptions);
      if (written.length) {
        const rows = written.map((part) => ({ ...part, botId: String(run.botId), knowledgeId: String(run.id) }));
        await parts.createMany(rows, { ...txOptions, returning: "none" });
      }
      return true;
    });
  }

  /**
   * Ends a run: the piece ready or failed, its lease given up; false when it was no longer the run's.
   * @param {{ id: string, leaseBy: string }} run
   * @param {Record<string, unknown>} changes
   * @param {CallOptions} options
   */
  async function finish(run, changes, options) {
    const ended = { ...changes, leaseUntil: null, leaseBy: null, updatedAt: pieces.raw("now()") };
    return (await pieces.patchWhere(ofRun(run), ended, { ...passedOn(options), returning: "count" })) > 0;
  }

  /**
   * The parts of a bot's knowledge that best match the words, best first, up to `limit`, leaving out the pieces in
   * `besides` (those it keeps in mind already).
   * @param {string} botId
   * @param {string} words
   * @param {{ limit: number, besides?: string[] }} how
   * @param {CallOptions} options
   */
  // Knex: report - full-text search of the bot's parts by the search vector PostgreSQL keeps for each one (its GIN
  // index), ranked by how well each matches, which no field or filter expresses
  async function search(botId, words, { limit, besides = [] }, options) {
    const { query } = await parts.scopedQuery({ alias: "p" }, passedOn(options));
    query
      .where(parts.column("botId", "p"), String(botId))
      // The words as a tsquery that matches a part holding any of them (plainto_tsquery's would need them all), stemmed
      // and without the stop words, as the parts' search vectors are made (migrations/20261121140000).
      .whereRaw("p.search @@ replace(plainto_tsquery('english', ?)::text, ' & ', ' | ')::tsquery", [words])
      .orderByRaw("ts_rank(p.search, replace(plainto_tsquery('english', ?)::text, ' & ', ' | ')::tsquery, 1) desc, ?? asc", [words, parts.column("id", "p")])
      .limit(limit)
      .select({
        id: parts.column("id", "p"),
        knowledgeId: parts.column("knowledgeId", "p"),
        position: parts.column("position", "p"),
        heading: parts.column("heading", "p"),
        pages: parts.column("pages", "p"),
        text: parts.column("text", "p")
      });
    if (besides.length) query.whereNotIn(parts.column("knowledgeId", "p"), besides.map(String));
    return (await query).map(partOf);
  }

  /**
   * Up to `count` parts of a piece in order, from `from` on.
   * @param {string} botId
   * @param {string} id
   * @param {number} from
   * @param {number} count
   * @param {CallOptions} options
   */
  async function readParts(botId, id, from, count, options) {
    const { records } = await parts.query({
      filters: { botId: String(botId), knowledgeId: String(id), fromPosition: Number(from) },
      sort: ["position"],
      fields: [...PART_FIELDS],
      page: { size: count }
    }, passedOn(options));
    return records.map(partOf);
  }

  return Object.freeze({
    list,
    piece,
    texts,
    add,
    change,
    retry,
    remove,
    claim,
    progress,
    finish,
    search,
    readParts
  });
}
