import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

// The bots' read-only directory for the features that need a bot, a chat or a bot in a chat but not the rest of the
// bots (apps, computer, files, account, integrations). Every method reads through the bots' handles in the caller's
// `options`, so ownership keeps it in the call's home and the row policies (rowPolicies.js) decide which chats and
// bots in chats the caller reads. Records are { id, ...fields } with string ids.

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/**
 * A bot as the directory answers it; `archivedAt` is when it was archived (D-108), null while it isn't; `madeBy` who
 * made it, null once their account went.
 * @typedef {{ id: string, name: string, color: string, shape: string, madeBy: string | null, archivedAt: string | null }} DirectoryBot
 */
/**
 * Where a bot's computer is (D-112): one bot in one chat. `chatKind` says who can open the chat, so who may use the
 * computer and what's signed in on it.
 * @typedef {{ chatBotId: string, chatId: string, chatKind: "public" | "private", botId: string, botName: string, workspaceId: string }} ComputerPlace
 */

const BOT_FIELDS = Object.freeze(["name", "color", "shape", "madeBy", "archivedAt"]);

/**
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createBotDirectory(resources) {
  const { bots, conversations, chatBots } = resources;
  const idOrNull = (value) => (value == null ? null : String(value));
  /** @returns {DirectoryBot | null} */
  function asBot(record) {
    if (!record) return null;
    return {
      id: String(record.id),
      name: record.name,
      color: record.color,
      shape: record.shape,
      madeBy: idOrNull(record.madeBy),
      archivedAt: record.archivedAt ?? null
    };
  }

  /**
   * The home's bots in id order, each saying whether it's archived (D-108): an app still names an archived bot, which
   * its turns never offer to ask.
   */
  async function listHomeBots(options) {
    const records = await bots.queryAll({ sort: ["id"], fields: ["name", "archivedAt"] }, passedOn(options));
    return records.map((record) => ({ id: String(record.id), name: record.name, archived: Boolean(record.archivedAt) }));
  }

  /** The home's bots in id order, with how they look: the home's Files page. */
  async function homeBotFaces(options) {
    const records = await bots.queryAll({ sort: ["id"], fields: ["name", "color", "shape"] }, passedOn(options));
    return records.map((record) => ({ id: String(record.id), name: record.name, color: record.color, shape: record.shape }));
  }

  /** One bot of the home, or null. @param {string} botId @param {CallOptions} options */
  async function findBot(botId, options) {
    if (!/^\d+$/u.test(String(botId ?? ""))) return null;
    return asBot(await bots.get(String(botId), { fields: [...BOT_FIELDS] }, { ...passedOn(options), missing: "skip" }));
  }

  /**
   * The home's bot with this name, in any case, other than `except`, or null (a bot asks another by name). One row: the
   * store skips `except`.
   * @param {string} name
   * @param {CallOptions} options
   * @param {{ except?: string | null }} [skip]
   */
  async function botNamed(name, options, { except = null } = {}) {
    const { records } = await bots.query({
      filters: { nameInAnyCase: String(name).trim(), ...(except ? { notId: String(except) } : {}) },
      sort: ["id"],
      fields: [...BOT_FIELDS],
      page: { size: 1 }
    }, passedOn(options));
    return asBot(records[0] ?? null);
  }

  /**
   * The bot's maker, home and name, for recording what its work uses (account usage.js): it names the hidden
   * workspaceId, in the caller's system context. The maker is null once their account went.
   */
  async function botMaker(botId, options) {
    const bot = await bots.get(String(botId), { fields: ["madeBy", "workspaceId", "name"] }, { ...passedOn(options), missing: "skip" });
    return bot ? { madeBy: idOrNull(bot.madeBy), workspaceId: String(bot.workspaceId), name: String(bot.name || "") } : null;
  }

  /** A bot in a chat the caller may read, by the bot and the chat, or null. */
  async function chatBotOf(botId, chatId, options) {
    if (![botId, chatId].every((id) => /^\d+$/u.test(String(id ?? "")))) return null;
    const { records: [found] } = await chatBots.query(
      { filters: { botId: String(botId), conversationId: String(chatId) }, fields: ["botId", "conversationId"], page: { size: 1 } },
      passedOn(options)
    );
    return found ? { id: String(found.id), botId: String(found.botId), chatId: String(found.conversationId) } : null;
  }

  /**
   * A computer's place: its bot in its chat (D-112), or null when the caller may not read that chat. Its home is the
   * hidden workspaceId, read in the caller's context.
   * @param {string} chatBotId
   * @param {CallOptions} options
   * @returns {Promise<ComputerPlace | null>}
   */
  async function computerOf(chatBotId, options) {
    if (!/^\d+$/u.test(String(chatBotId ?? ""))) return null;
    const seat = await chatBots.get(String(chatBotId), { fields: ["botId", "conversationId", "workspaceId"] }, { ...passedOn(options), missing: "skip" });
    if (!seat) return null;
    const [bot, chat] = await Promise.all([
      bots.get(String(seat.botId), { fields: ["name"] }, { ...passedOn(options), missing: "skip" }),
      conversations.get(String(seat.conversationId), { fields: ["kind"] }, { ...passedOn(options), missing: "skip" })
    ]);
    if (!bot || !chat) return null;
    return {
      chatBotId: String(seat.id),
      chatId: String(seat.conversationId),
      chatKind: chat.kind,
      botId: String(seat.botId),
      botName: bot.name,
      workspaceId: String(seat.workspaceId)
    };
  }

  /** Which of the bots in chats still exist, read in the caller's context (the computers' sweep). */
  async function liveChatBotIds(ids, options) {
    if (!ids.length) return new Set();
    const records = await chatBots.queryAll({ filters: { id: ids.map(String) }, fields: ["botId"] }, passedOn(options));
    return new Set(records.map((record) => String(record.id)));
  }

  /** The bots in one chat the caller may read, in their order: { id (the chat_bots id), botId }. */
  async function botsInChat(chatId, options) {
    const records = await chatBots.queryAll({ filters: { conversationId: String(chatId) }, sort: ["position", "id"], fields: ["botId"] }, passedOn(options));
    return records.map((record) => ({ id: String(record.id), botId: String(record.botId) }));
  }

  return Object.freeze({
    listHomeBots,
    homeBotFaces,
    findBot,
    botNamed,
    botMaker,
    chatBotOf,
    computerOf,
    liveChatBotIds,
    botsInChat
  });
}
