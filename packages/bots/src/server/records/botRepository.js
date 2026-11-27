import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "../botsError.js";
import { createCallerReaders, fieldsOf, isId } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * The home's bots (D-112): members of its chats as people are, the home's, read by every caller in the home. Rows
 * answer in the snake_case shape the bots' code reads (recordRows.js), each with its home template's summary (D-98).
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 * @param {{ lock: (workspaceId: string, options: CallOptions) => Promise<{ id: string } | null> }} dependencies.workspaces
 * @param {import("../types.js").HomeTemplateRepository} dependencies.homeTemplates
 */
export function createBotRepository({ resources, workspaces, homeTemplates }) {
  const { bots } = resources;
  const { homeOf, asRow } = createCallerReaders();
  const withSummaries = (records, options) => homeTemplates.withSummaries(records.map((record) => asRow(record, options)), options);

  /** One bot of the home, or null. */
  async function find(botId, options) {
    if (!isId(botId)) return null;
    const [bot] = await withSummaries([await bots.get(String(botId), {}, { ...passedOn(options), missing: "skip" })], options);
    return bot ?? null;
  }

  /** One bot of the home, or a 404. */
  async function get(botId, options) {
    const bot = await find(botId, options);
    if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    return bot;
  }

  /** The home's bots in id order: archived ones too unless `archived` is false, or only them when it's true. */
  async function list(options, { archived } = {}) {
    const filters = archived === undefined ? {} : { archived };
    return withSummaries(await bots.queryAll({ filters, sort: ["id"] }, passedOn(options)), options);
  }

  /** The home's bots among the ids given, in id order. */
  async function byIds(ids, options) {
    const wanted = [...new Set(ids.map(String))].filter(isId);
    if (!wanted.length) return [];
    return withSummaries(await bots.queryAll({ filters: { id: wanted }, sort: ["id"] }, passedOn(options)), options);
  }

  /** The home's first bot, the oldest, or null. */
  async function first(options) {
    const { records: [oldest] } = await bots.query({ sort: ["id"], page: { size: 1 } }, passedOn(options));
    return oldest ? (await withSummaries([oldest], options))[0] : null;
  }

  /** The home's main bot, or null. */
  async function main(options) {
    const { records: [found] } = await bots.query({ filters: { isMain: true }, page: { size: 1 } }, passedOn(options));
    return found ? (await withSummaries([found], options))[0] : null;
  }

  /** A new bot, given in its columns' names (made_by: who made it), read back. */
  async function create(columns, options) {
    const id = await bots.create(fieldsOf(columns), { ...passedOn(options), returning: "id" });
    return get(id, options);
  }

  /** Changes to one bot, given in its columns' names. */
  async function update(botId, columns, options) {
    await bots.patch(String(botId), fieldsOf(columns), { ...passedOn(options), returning: "none" });
  }

  /** The home's main bot is no longer the main one: another becomes it. */
  async function clearMain(options) {
    await bots.patchWhere({ isMain: true }, { isMain: false }, { ...passedOn(options), returning: "none" });
  }

  /** A bot gone, with every chat seat, computer and run it had (ON DELETE CASCADE). */
  async function remove(botId, options) {
    await bots.delete(String(botId), passedOn(options));
  }

  /** The home, locked until the transaction ends: the first visits after sign-up wait for each other. */
  async function lockHome(txOptions) {
    await workspaces.lock(homeOf(txOptions), passedOn(txOptions));
  }

  return Object.freeze({
    find,
    get,
    list,
    byIds,
    first,
    main,
    create,
    update,
    clearMain,
    remove,
    lockHome
  });
}
