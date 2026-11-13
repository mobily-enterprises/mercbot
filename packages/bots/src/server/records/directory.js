import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders } from "./recordRows.js";

// The bots' read-only directory for the features that need a bot or a conversation but not the
// rest of the bots (apps, computer, files, account).
// Every method reads through the bots' handles in the caller's `options`, so ownership keeps it in
// the request's home and the row policies (rowPolicies.js) decide which bots and conversations the
// caller sees. Records are { id, ...fields } with string ids. The signatures are frozen.

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {{ id: string, name: string, color: string, shape: string, kind: "bot" | "group", sharing: string, userId: string }} DirectoryBot */
/** @typedef {{ conversationId: string, botId: string, botName: string, botKind: string, botSharing: string, userId: string | null, groupId: string | null, workspaceId: string }} ComputerPlace */

const BOT_FIELDS = Object.freeze(["name", "color", "shape", "kind", "sharing", "userId"]);

/**
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} systemContext
 */
export function createBotDirectory(resources, systemContext) {
  const { bots, botConversations: conversations, botGroupMembers: groupMembers, botGroupPeople: groupPeople } = resources;
  const { personOf } = createCallerReaders(systemContext);
  const first = async (handle, filters, options) =>
    (await handle.query({ filters, page: { size: 1 } }, passedOn(options))).records[0] ?? null;
  /** @returns {DirectoryBot | null} */
  const asBot = (record) =>
    (record ? { id: String(record.id), ...Object.fromEntries(BOT_FIELDS.map((field) => [field, record[field]])) } : null);
  const idOrNull = (value) => (value == null ? null : String(value));

  /** The home's bots, not group chats, in id order (apps.js:108-109). */
  async function listHomeBots(options) {
    const records = await bots.queryAll({ filters: { kind: "bot" }, sort: ["id"], fields: ["name"] }, passedOn(options));
    return records.map((record) => ({ id: String(record.id), name: record.name }));
  }

  /** The home's bots, not group chats, in id order, with how they look: the home's Files page (files registerRoutes.js). */
  async function homeBotFaces(options) {
    const records = await bots.queryAll({ filters: { kind: "bot" }, sort: ["id"], fields: ["name", "color", "shape"] }, passedOn(options));
    return records.map((record) => ({ id: String(record.id), name: record.name, color: record.color, shape: record.shape }));
  }

  /**
   * One bot the caller sees, in the home, of one kind when given (apps.js:309,314, views.js:207,
   * computers.js:94, the bots, computer and files routes).
   * @param {string} botId
   * @param {CallOptions} options
   * @param {{ kind?: "bot" | "group" }} [only]
   */
  async function findBot(botId, options, { kind } = {}) {
    if (kind) return asBot(await first(bots, { id: String(botId), kind }, options));
    return asBot(await bots.get(String(botId), { fields: [...BOT_FIELDS] }, { ...passedOn(options), missing: "skip" }));
  }

  /**
   * The home's bot (not a group chat) with this name, in any case, other than `except`, or null
   * (botRequests.js: a bot asks another by name). One row: the store skips `except`.
   * @param {string} name
   * @param {CallOptions} options
   * @param {{ except?: string | null }} [skip]
   */
  async function botNamed(name, options, { except = null } = {}) {
    const { records } = await bots.query(
      {
        filters: { kind: "bot", nameInAnyCase: String(name).trim(), ...(except ? { notId: String(except) } : {}) },
        sort: ["id"],
        fields: [...BOT_FIELDS],
        page: { size: 1 }
      },
      passedOn(options)
    );
    return asBot(records[0] ?? null);
  }

  /**
   * The bot's maker, home and name, for recording what its work uses (account usage.js): it names the hidden
   * workspaceId, in the caller's system context.
   */
  async function botOwner(botId, options) {
    const bot = await bots.get(String(botId), { fields: ["userId", "workspaceId", "name"] }, { ...passedOn(options), missing: "skip" });
    return bot ? { userId: String(bot.userId), workspaceId: String(bot.workspaceId), name: String(bot.name || "") } : null;
  }

  /** The caller's own conversation with the bot (computer registerRoutes.js:38). */
  const seatOf = (botId, options) => first(conversations, { botId: String(botId), userId: personOf(options) }, options);

  /**
   * One room of the bot (no person, no group): the one asked for, or with no id its first, else
   * null (computer registerRoutes.js: a shared bot's computer).
   */
  async function roomOf(botId, roomId, options) {
    const filters = { botId: String(botId), userId: null, groupId: null, ...(roomId == null ? {} : { id: String(roomId) }) };
    const { records: [room] } = await conversations.query({ filters, sort: ["id"], fields: ["botId"], page: { size: 1 } }, passedOn(options));
    return room ?? null;
  }

  /**
   * A member bot's own computer for a group (computer registerRoutes.js:28-29), or null. The row
   * policy shows it to the group's people only.
   */
  const groupSeat = (botId, groupId, options) => first(conversations, { botId: String(botId), groupId: String(groupId) }, options);

  /** The bot is in the group and the caller is one of its people (files registerRoutes.js:53-54). */
  async function isGroupMember(groupId, botId, options) {
    const [member, person] = await Promise.all([
      first(groupMembers, { groupId: String(groupId), botId: String(botId) }, options),
      first(groupPeople, { groupId: String(groupId), userId: personOf(options) }, options)
    ]);
    return Boolean(member && person);
  }

  /**
   * A computer's conversation and bot (computers.js:43), or null: its home is the hidden
   * workspaceId, read in the caller's system context.
   * @returns {Promise<ComputerPlace | null>}
   */
  async function computerOf(conversationId, options) {
    const conversation = await conversations.get(
      String(conversationId),
      { fields: ["botId", "userId", "groupId", "workspaceId"] },
      { ...passedOn(options), missing: "skip" }
    );
    if (!conversation) return null;
    const bot = await bots.get(String(conversation.botId), { fields: ["name", "kind", "sharing"] }, { ...passedOn(options), missing: "skip" });
    if (!bot) return null;
    return {
      conversationId: String(conversation.id),
      botId: String(conversation.botId),
      botName: bot.name,
      botKind: bot.kind,
      botSharing: bot.sharing,
      userId: idOrNull(conversation.userId),
      groupId: idOrNull(conversation.groupId),
      workspaceId: String(conversation.workspaceId)
    };
  }

  /** Which of the conversation ids still exist, read in the caller's system context (computers.js:208). */
  async function liveConversationIds(ids, options) {
    if (!ids.length) return new Set();
    const records = await conversations.queryAll({ filters: { id: ids.map(String) }, fields: ["botId"] }, passedOn(options));
    return new Set(records.map((record) => String(record.id)));
  }

  /** The caller's own conversations with single bots in the home (computer registerRoutes.js:102). */
  async function ownSingleBotSeatIds(options) {
    const seats = await conversations.queryAll({ filters: { userId: personOf(options) }, fields: ["botId"] }, passedOn(options));
    if (!seats.length) return [];
    const botIds = [...new Set(seats.map((seat) => String(seat.botId)))];
    const single = new Set((await bots.queryAll({ filters: { id: botIds, kind: "bot" }, fields: ["kind"] }, passedOn(options))).map((bot) => String(bot.id)));
    return seats.filter((seat) => single.has(String(seat.botId))).map((seat) => String(seat.id));
  }

  return Object.freeze({
    listHomeBots,
    homeBotFaces,
    findBot,
    botNamed,
    botOwner,
    seatOf,
    roomOf,
    groupSeat,
    isGroupMember,
    computerOf,
    liveConversationIds,
    ownSingleBotSeatIds
  });
}
