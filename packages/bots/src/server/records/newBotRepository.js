import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders, fieldsOf } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/** Rows as a write answered them, in the order they were written: one INSERT numbers its rows in the order given. */
const inIdOrder = (rows) => rows.toSorted((first, second) => Number(first.id) - Number(second.id));

/**
 * New bots, made together (D-105): New bot makes one and a team several through the same writes, each one statement
 * for all of them, so making six costs the statements making one does. A new bot is in no chat until someone adds it
 * or opens a direct chat with it (records.chats). Every method takes the call's options last.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the
 *   records feature's handles
 * @param {import("../types.js").HomeTemplateRepository} dependencies.homeTemplates the home's own templates (D-98), whose
 *   tag and description every bot read here carries
 */
export function createNewBotRepository({ resources, homeTemplates }) {
  const { bots, messages } = resources;
  const { asRow } = createCallerReaders();

  /**
   * New bots of the home, given in their columns' names, read back in the order given, each with its home template's
   * summary as the bots' repository reads a bot.
   * @param {Array<Record<string, unknown>>} rows
   * @param {CallOptions} options
   */
  async function createBots(rows, options) {
    const records = await bots.createMany(rows.map(fieldsOf), { ...passedOn(options), returning: "records" });
    return homeTemplates.withSummaries(inIdOrder(records).map((record) => asRow(record, options)), options);
  }

  /**
   * New bots' first messages in a chat, written as they're made: unlike messages.append they neither mark the chat
   * unread nor move its activity. Each is the bot's own (author_bot_id).
   * @param {Array<{ chat_id: string, bot_id: string, kind: string, body: object }>} list
   * @param {CallOptions} options
   */
  async function openWith(list, options) {
    if (!list.length) return;
    await messages.createMany(list.map((message) => ({
      conversationId: String(message.chat_id),
      authorBotId: String(message.bot_id),
      role: "bot",
      kind: message.kind,
      body: message.body
    })), { ...passedOn(options), returning: "none" });
  }

  /**
   * Which of Mercbot's templates the home's bots already follow, among the slugs given (D-105): what a team doesn't
   * add again. Each says whether every bot following it is archived (D-108): an archived bot is still in the home, and
   * the team says so rather than adding another. One read, whatever the number of bots.
   * @param {string[]} slugs
   * @param {CallOptions} options
   * @returns {Promise<Map<string, boolean>>} slug → whether all its bots are archived
   */
  async function followedOf(slugs, options) {
    if (!slugs.length) return new Map();
    const records = await bots.queryAll({ filters: { libraryTemplates: slugs }, fields: ["libraryTemplate", "archivedAt"] }, passedOn(options));
    const followed = new Map();
    for (const record of records) {
      followed.set(record.libraryTemplate, (followed.get(record.libraryTemplate) ?? true) && Boolean(record.archivedAt));
    }
    return followed;
  }

  /**
   * Whether the home has a bot besides its main one: a new home's first chat offers a team only while it hasn't
   * (D-105). One read of at most one row.
   * @param {CallOptions} options
   */
  async function anyBesidesMain(options) {
    const { records } = await bots.query({ filters: { isMain: false }, page: { size: 1 } }, passedOn(options));
    return records.length > 0;
  }

  /**
   * The home's bots, newest first, up to `limit` of them, with their names, looks and templates, and
   * whether it has more: what Add bots' suggestions are told of the home (D-109). One read of one page, at most `limit` rows.
   * @param {number} limit
   * @param {CallOptions} options
   */
  async function homeBots(limit, options) {
    const { records, page } = await bots.query(
      { fields: ["name", "shape", "color", "libraryTemplate", "homeTemplateId"], sort: ["-id"], page: { size: limit } },
      passedOn(options)
    );
    return { bots: records.map((record) => asRow(record, options)), more: page.hasMore };
  }

  return Object.freeze({
    followedOf,
    anyBesidesMain,
    homeBots,
    createBots,
    openWith
  });
}
