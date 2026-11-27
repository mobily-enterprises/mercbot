import { isId } from "./recordRows.js";

// Who may read a chat and everything keyed to it (D-112). These policies are the one place chat privacy is decided;
// ownership already keeps every read in the call's home, and they only narrow inside it. Writes are the services'
// to check (a create is never narrowed by a policy).
//
// A chat can be opened by everyone in its home when it is public, and by its people when it is private. So:
// - a signed-in person, or a job acting for one (`{ actorId }`), reads the chats they can open, and every row keyed to
//   them: their people, bots and messages, the bots' routines, requests and follow-ups;
// - the model's reader (a job context `readerFor` made for one bot in one chat) reads `readable_from(chat)`: the chats
//   everyone who can open its chat can open too (the migration's SQL function), whoever the asker is, and the rows
//   keyed to those chats. It never reads another chat because the asker could;
// - a bot's memory's reader (`homeReaderFor`, D-113) reads what everyone in the home can open: its public chats only,
//   since the digest it makes is read in every chat of the bot;
// - background work for no one (a system context, a home's job without a person) is scoped by ownership alone;
// - an anonymous caller (a public app's visitor) reads none of them.
// Bots are the home's, so every caller in the home but an anonymous one reads every bot.
//
// Other features' tables keyed to a bot in a chat (computers, browser state, tickets, shell runs, app watches and
// jobs) narrow through `chatBotRule`, and a person's own rows (personal skills) through `personalRule`: both read this
// feature's tables through their owners' join sources in the caller's own scope, so the same rule decides.

// The model's reader is a job context carrying, under this module-private symbol, the bot and chat it reads for. Only
// `readerFor` sets it, so no caller can claim to be a reader or name another chat; and since object spread keeps a
// symbol, a copy of a reader's context (json-rest-api copies the context it's given; a service may add to it) is still
// that reader. A context made as a reader that lost it anyway (rebuilt field by field) reads nothing: every rule here
// refuses a job with the reader's reason and no reader, so the reader fails closed, never reading as the asker.
const READER = Symbol("mercbot.bots.modelReader");
const READER_REASON = "the model reads for one bot in one chat";

/** Refuses a reader made without one of its ids (`who` names the reader). @param {string} who @param {Record<string, unknown>} ids */
function requireIds(who, ids) {
  for (const [name, id] of Object.entries(ids)) {
    if (!isId(id)) throw new TypeError(`${who} needs ${name}: got ${id}.`);
  }
}

/**
 * The model's reader for one bot in one chat: the context every model-facing read of that turn passes (R1, D-112).
 * It acts for the asker (`actorId`, for audit fields and for whose approvals a card asks), and reads what the chat may.
 * @param {(reason: string) => { forWorkspaceUser: Function }} systemContext
 * @param {{ homeId: string, botId: string, chatId: string, askerId: string }} reader
 */
export function readerFor(systemContext, { homeId, botId, chatId, askerId }) {
  requireIds("The model's reader", { homeId, botId, chatId, askerId });
  const context = systemContext(READER_REASON)
    .forWorkspaceUser(String(homeId), String(askerId), { actorId: String(askerId) });
  const reader = Object.freeze({ homeId: String(homeId), botId: String(botId), chatId: String(chatId), askerId: String(askerId) });
  return Object.freeze({
    ...context,
    [READER]: reader
  });
}

/**
 * The model's reader for a chat itself, for no one: a chat's summary (R1, D12), which every bot of the chat reads. It
 * reads what the chat may, exactly as a bot's reader there does, and acts for no person, so it borrows no one's reach
 * and leaves no one's name on what it does.
 * @param {(reason: string) => { forWorkspace: Function }} systemContext
 * @param {{ homeId: string, chatId: string }} chat
 */
export function chatReaderFor(systemContext, { homeId, chatId }) {
  requireIds("The chat's reader", { homeId, chatId });
  const context = systemContext(READER_REASON).forWorkspace(String(homeId));
  const reader = Object.freeze({ homeId: String(homeId), botId: null, chatId: String(chatId), askerId: null });
  return Object.freeze({
    ...context,
    [READER]: reader
  });
}

/**
 * The model's reader for a bot's memory of the home, for no one (D-113): what a digest is made from, which every chat
 * of the bot reads, so it reads only what everyone in the home can open, now and later: the home's public chats, as a
 * public chat's reader does, and never a private one, nor anyone's own rows.
 * @param {(reason: string) => { forWorkspace: Function }} systemContext
 * @param {{ homeId: string, botId: string }} memory
 */
export function homeReaderFor(systemContext, { homeId, botId }) {
  requireIds("The memory's reader", { homeId, botId });
  const context = systemContext(READER_REASON).forWorkspace(String(homeId));
  const reader = Object.freeze({ homeId: String(homeId), botId: String(botId), chatId: null, askerId: null, publicOnly: true });
  return Object.freeze({
    ...context,
    [READER]: reader
  });
}

/**
 * The reader a call's context is, or null: a bot's (forBot), a chat's own (forChat, with no bot and no asker), or a
 * bot's memory's (forHome: public chats only, `publicOnly`).
 * @param {unknown} context
 * @returns {Readonly<{ homeId: string, botId: string | null, chatId: string | null, askerId: string | null, publicOnly?: boolean }> | null}
 */
export function readerOf(context) {
  return (context && typeof context === "object" && context[READER]) || null;
}

/**
 * The call's reader, null for a call that isn't one, or false for one made as a reader that no longer carries it.
 * @param {{ kind: string, reason?: string }} caller
 * @param {unknown} context
 */
function readerIn(caller, context) {
  const reader = readerOf(context);
  if (reader) return reader;
  return caller.kind === "job" && String(caller.reason ?? "").endsWith(READER_REASON) ? false : null;
}

/** Whom the call is for: a request's signed-in person, or the person a job works for. */
function personOf(caller) {
  if (caller.kind === "user") return caller.userId;
  return caller.kind === "job" ? caller.actorId ?? null : null;
}

/**
 * Narrows `query` to rows whose chat (`chatColumn`) the call may read. False refuses every row.
 * @param {{ query: any, caller: any, options: any, ownTable: (name: string) => any, value: Function }} args
 * @param {string} chatColumn
 */
function narrowToChats({ query, caller, options, ownTable, value }, chatColumn) {
  if (caller.kind === "anonymous") return false;
  const reader = readerIn(caller, options?.context);
  if (reader === false) return false;
  if (reader?.publicOnly) {
    query.whereIn(chatColumn, ownTable("conversations").select("conversations.id").where("conversations.kind", "public"));
    return true;
  }
  if (reader) {
    query.whereIn(chatColumn, ownTable("conversations")
      .select("conversations.id")
      .whereRaw("conversations.id in (select readable_from(?))", [reader.chatId]));
    return true;
  }
  const person = personOf(caller);
  if (!person) return true;
  const userId = value("userId", person);
  query.where((open) => open
    .whereIn(chatColumn, ownTable("conversations").select("conversations.id").where("conversations.kind", "public"))
    .orWhereIn(chatColumn, ownTable("chatPeople").select("chat_people.conversation_id").where("chat_people.user_id", userId)));
  return true;
}

/** bots: the home's, for every caller in it but an anonymous one. */
export function botVisibility({ caller }) {
  return caller.kind !== "anonymous";
}

/** conversations: the chats the call may read. */
export function conversationVisibility(args) {
  return narrowToChats(args, args.column("id"));
}

/** chat_people, chat_bots, messages and bot_requests: the rows of chats the call may read. */
export function inReadableChat(args) {
  return narrowToChats(args, args.column("conversationId"));
}

/** bot_routines and connect_follow_ups: the rows of a bot in a chat the call may read. */
export function ofReadableChatBot(args) {
  if (args.caller.kind === "anonymous") return false;
  const chatBots = args.ownTable("chatBots").select("chat_bots.id");
  narrowToChats({ ...args, query: chatBots }, "chat_bots.conversation_id");
  args.query.whereIn(args.column("chatBotId"), chatBots);
  return true;
}

/**
 * The rules other features' row policies apply, over this feature's own tables in the caller's scope.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createChatRules(resources) {
  /**
   * A row keyed to a bot in a chat (`field`, its chat_bots id) is read only by a call that may read that chat: the
   * computers, browser states, tickets, shell runs, app watches and app jobs (D-112; a chat's computer is the chat's).
   * With `nullable`, a row with no bot in a chat (an app's own job) is the home's. Use it as a row policy: it returns
   * false for an anonymous caller.
   * @param {{ query: any, caller: any, column: (field: string) => string, options: any }} args
   * @param {string} [field]
   * @param {{ nullable?: boolean }} [settings]
   */
  async function chatBotRule({ query, caller, column, options }, field = "chatBotId", { nullable = false } = {}) {
    if (caller.kind === "anonymous") return false;
    if (caller.kind === "system") return true;
    const chatBots = await resources.chatBots.joinSource({ alias: "readable_chat_bots" }, options);
    const readable = chatBots.query.select(1).whereColumn(chatBots.column("id"), column(field));
    if (nullable) query.where((either) => either.whereNull(column(field)).orWhereExists(readable));
    else query.whereExists(readable);
    return true;
  }

  /**
   * A person's own row (`field`, their user id; a personal skill) is read by that person, and by the model's reader
   * only in a private chat whose one person they are: the only chat everyone who can open it can also open it from
   * (D-112). Ownership "user" or "workspace_user" already keeps it to its person for everyone else.
   * @param {{ query: any, caller: any, column: (field: string) => string, options: any }} args
   * @param {string} [field]
   */
  async function personalRule({ query, caller, column, options }, field = "userId") {
    if (caller.kind === "anonymous") return false;
    const reader = readerIn(caller, options?.context);
    if (reader === false || reader?.publicOnly) return false;
    if (!reader) return true;
    const chat = await resources.conversations.joinSource({ alias: "reader_chat", filters: { id: reader.chatId } }, options);
    const theirs = await resources.chatPeople.joinSource({ alias: "reader_chat_person", filters: { conversationId: reader.chatId } }, options);
    const others = await resources.chatPeople.joinSource({ alias: "reader_chat_other", filters: { conversationId: reader.chatId } }, options);
    query
      .whereExists(chat.query.select(1).where(chat.column("kind"), "private"))
      .whereExists(theirs.query.select(1).whereColumn(theirs.column("userId"), column(field)))
      .whereNotExists(others.query.select(1).whereColumn(others.column("userId"), "<>", column(field)));
    return true;
  }

  return Object.freeze({
    chatBotRule,
    personalRule
  });
}
