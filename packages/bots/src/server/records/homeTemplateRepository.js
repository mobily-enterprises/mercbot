// A home's own bot templates (D-98) and what changed in them. Every read goes through the home's handles, so another
// home's template is none. Every method takes the call's options last.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders, fieldsOf } from "./recordRows.js";
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

// What a list of the home's templates carries of each: never its instructions or skills.
const SUMMARY = Object.freeze(["tag", "description", "updatedAt"]);

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 */
export function createHomeTemplateRepository({ resources }) {
  const { homeTemplates, homeTemplateChanges, bots } = resources;
  const { asRow } = createCallerReaders();

  /** One of the home's templates in full, or null. @param {string} id @param {CallOptions} options */
  async function find(id, options) {
    return asRow(await homeTemplates.get(String(id), {}, { ...passedOn(options), missing: "skip" }), options);
  }

  /**
   * Bots (rows, any of them null) with the tag and description of the home template each points at, as
   * `home_template`: one read for all of them however many there are, and none when none points at one. A bot of
   * Mercbot's library finds its own in the library (botTemplate.js).
   * @param {Array<Record<string, any> | null>} rows
   * @param {CallOptions} options
   */
  async function withSummaries(rows, options) {
    const wanted = [...new Set(rows.filter((row) => row?.home_template_id).map((row) => String(row.home_template_id)))];
    if (!wanted.length) return rows;
    const records = await homeTemplates.queryAll({ filters: { id: wanted }, fields: SUMMARY }, passedOn(options));
    const found = new Map(records.map((record) => [String(record.id), asRow(record, options)]));
    return rows.map((row) => (row?.home_template_id ? { ...row, home_template: found.get(String(row.home_template_id)) || null } : row));
  }

  /** Every one of the home's templates, by tag, as summaries. @param {CallOptions} options */
  async function list(options) {
    return (await homeTemplates.queryAll({ fields: SUMMARY, sort: ["tag"] }, passedOn(options))).map((record) => asRow(record, options));
  }

  /** The tags the home's templates use. @param {CallOptions} options */
  async function tagsOf(options) {
    return new Set((await homeTemplates.queryAll({ fields: ["tag"] }, passedOn(options))).map((record) => record.tag));
  }

  /** A new template of the home, given in its columns' names, read back in full. */
  async function create(columns, options) {
    const id = await homeTemplates.create(fieldsOf(columns), { ...passedOn(options), returning: "id" });
    return find(id, options);
  }

  /** One of the home's templates in full, its row locked until the transaction ends, or null. */
  async function lock(id, options) {
    return asRow(await homeTemplates.lock(String(id), { ...passedOn(options), missing: "skip" }), options);
  }

  /** Changes to one of the home's templates, given in its columns' names, read back in full. */
  async function update(id, columns, options) {
    return asRow(await homeTemplates.patch(String(id), fieldsOf(columns), passedOn(options)), options);
  }

  /** Deletes one of the home's templates and what changed in it; a bot pointing at it stops it (ON DELETE RESTRICT). */
  async function remove(id, options) {
    await homeTemplates.delete(String(id), passedOn(options));
  }

  /** Records what changed in one of the home's templates, its line written by Mercbot ("Instructions changed by Ada"). */
  async function addChange(id, columns, options) {
    await homeTemplateChanges.create(fieldsOf({ home_template_id: String(id), ...columns }), { ...passedOn(options), returning: "none" });
  }

  /** How many of the home's bots use each of the templates among `ids`, by id; one statement. */
  async function usedBy(ids, options) {
    const wanted = [...new Set(ids.map(String))];
    if (!wanted.length) return new Map();
    const rows = await bots.aggregate(
      { measures: { n: { count: "*" } }, groupBy: ["homeTemplateId"], filters: { homeTemplateIds: wanted } },
      passedOn(options)
    );
    return new Map(rows.map((row) => [String(row.homeTemplateId), Number(row.n)]));
  }

  /** The newest change of a template after a moment, or null: a bot's "what changed" since it started to use it. */
  async function newestChangeAfter(id, after, options) {
    const { records: [change] } = await homeTemplateChanges.query(
      { filters: { homeTemplateId: String(id) }, sort: ["-id"], page: { size: 1 } },
      passedOn(options)
    );
    if (!change || (after && new Date(change.changedAt) <= new Date(after))) return null;
    return asRow(change, options);
  }

  return Object.freeze({
    find,
    withSummaries,
    list,
    tagsOf,
    create,
    lock,
    update,
    remove,
    addChange,
    usedBy,
    newestChangeAfter
  });
}
