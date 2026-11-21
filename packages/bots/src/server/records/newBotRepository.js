import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders, fieldsOf } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/** Rows as a write answered them, in the order they were written: one INSERT numbers its rows in the order given. */
const inIdOrder = (rows) => rows.toSorted((first, second) => Number(first.id) - Number(second.id));

/**
 * New bots, made together (D-105): New bot makes one and a team several through the same writes, each one statement
 * for all of them, so making six costs the statements making one does. Every method takes the call's options last.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the
 *   records feature's handles
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 * @param {import("../types.js").HomeTemplateRepository} dependencies.homeTemplates the home's own templates (D-98), whose
 *   tag and description every bot read here carries
 */
export function createNewBotRepository({ resources, systemContext, homeTemplates }) {
  const { bots, botConversations: conversations, botMessages: messages } = resources;
  const { asRow, personOf } = createCallerReaders(systemContext);

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
   * The person's own conversation with each new bot, in the order given: its first columns, as its rows name them.
   * A bot just made has none yet, so nothing can make one first.
   * @param {Array<Record<string, unknown>>} rows each with bot_id
   * @param {CallOptions} options
   */
  async function createSeats(rows, options) {
    const person = personOf(options);
    const records = await conversations.createMany(rows.map((row) => fieldsOf({ ...row, user_id: person })), {
      ...passedOn(options),
      returning: "records"
    });
    return inIdOrder(records).map((record) => asRow(record, options));
  }

  /**
   * New bots' first messages, in their people's own conversations: what a bot opens with, written as it is made.
   * @param {Array<{ bot_id: string, conversation_id: string, kind: string, role: string, body: object }>} list
   * @param {CallOptions} options
   */
  async function openWith(list, options) {
    if (!list.length) return;
    await messages.createMany(list.map((message) => fieldsOf(message)), { ...passedOn(options), returning: "none" });
  }

  /**
   * New Shared bots' first tabs (D-99, D-100): each bot's General, for everyone in the home, and its maker's own
   * conversation made its open tab, You only. Answers the General tabs in the order of the bots given.
   * @param {Array<{ bot: { id: string }, seat: { id: string } }>} made
   * @param {CallOptions} options
   */
  async function startTabs(made, options) {
    const person = personOf(options);
    const rooms = await conversations.createMany(made.map(({ bot }) => ({ botId: bot.id, title: "General", createdBy: person })), {
      ...passedOn(options),
      returning: "records"
    });
    await conversations.patchMany(made.map(({ seat }) => ({ id: seat.id, roomId: seat.id })), { ...passedOn(options), returning: "none" });
    return inIdOrder(rooms).map((room) => asRow(room, options));
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
   * Whether the home has a bot besides its main one (group chats aside): a new home's first conversation offers a team
   * only while it hasn't (D-105). One read of at most one row.
   * @param {CallOptions} options
   */
  async function anyBesidesMain(options) {
    const { records } = await bots.query({ filters: { isMain: false, kind: "bot" }, page: { size: 1 } }, passedOn(options));
    return records.length > 0;
  }

  return Object.freeze({
    followedOf,
    anyBesidesMain,
    createBots,
    createSeats,
    openWith,
    startTabs
  });
}
