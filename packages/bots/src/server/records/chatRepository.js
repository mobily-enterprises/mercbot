import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { personName } from "@local/homes/server/personName";
import { BotsError, archivedBotRefusal, directChatRefusal } from "../botsError.js";
import { cloudShape } from "../botRows.js";
import { createCallerReaders, fieldsOf, isId } from "./recordRows.js";
import { builderChanger } from "./builderSeats.js";
import { createSeatWindows } from "./seatWindows.js";
import { createSectionRecords } from "./sectionRepository.js";
import { roomsToVisit } from "./publicRoomRepository.js";
import { createSharedChatRepository } from "./sharedChatRepository.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

// Chats are the core (D-112): a chat is a row of conversations, Public (everyone in the home can open it) or Private
// (its people only), chosen when it's made and fixed from then on; a new chat is Public unless Private was chosen.
// Its members are people (chat_people, each with their own place in it) and bots (chat_bots, "this bot in this
// chat"). A direct chat is the one chat a person's [Message] to a bot reopens, or the one chat between two people:
// Private, readable only from itself (readable_from), it takes no more members. A room is any other chat. The
// everyone chat has every active member of the home. An app's chat is its Builder's.

const KINDS = new Set(["public", "private"]);
// A person's own place in a chat, as its chat_people row names it: since when someone mentioned them there unread too
// (D-114), which only a message sets and only reading clears.
const PLACE = Object.freeze(["readUpTo", "unread", "mentionedAt", "pinPosition", "sectionId", "hidden", "muted"]);
// What a person may change of their place.
const PLACE_CHANGES = new Set(PLACE.filter((field) => field !== "mentionedAt"));
// The most people or bots one call adds to a chat; a home's everyone chat adds its members in pages of this size.
const ADD_LIMIT = 200;
// A page of a person's chat list (their places, at most the resource's page limit): the page reads on while `next`.
const LIST_PAGE = 100;

const notFound = () => new BotsError(404, "Chat not found.", { code: "bots_chat_not_found" });
const archivedRefusal = () =>
  new BotsError(409, "This chat is archived. Unarchive it to continue.", { code: "bots_chat_archived" });
const personNotFound = () => new BotsError(404, "Person not found.", { code: "bots_person_not_found" });
/** Whether a chat is a direct one: a person's with a bot, or two people's. */
export const isDirect = (chat) => Boolean(chat.direct_bot_id || chat.direct_person_id);

/**
 * The chats among `ids` the caller may read, in id order: what routines and search results name as their chat.
 * @param {ResourceHandle} conversations
 */
function chatsByIds(conversations) {
  const { asRow } = createCallerReaders();
  return async function byIds(ids, options) {
    const wanted = [...new Set(ids.map(String))].filter(isId);
    if (!wanted.length) return [];
    const records = await conversations.queryAll({ filters: { id: wanted }, sort: ["id"] }, passedOn(options));
    return records.map((record) => asRow(record, options));
  };
}

/**
 * A chat made once on its unique key (`find` finds it), else made by `make`: two first uses at once make one, the
 * second waiting on the first's unique index and then finding it.
 */
async function madeOnce(find, make, options) {
  const found = await find(options);
  if (found) return found;
  try {
    return await make();
  } catch (error) {
    const again = await find(options);
    if (again) return again;
    throw error;
  }
}

/**
 * A chat's onboarding script moving on (onboarding.js): from step `from` to `to` (null when it's over), only while it
 * is still `from`, so of two pages moving it at once one does. Answers whether this one did.
 * @param {ResourceHandle} conversations
 */
function onboardingMover(conversations) {
  return async function moveOnboarding(chatId, from, to, options) {
    if (!isId(chatId) || !from) return false;
    const filters = { id: String(chatId), onboardingStep: String(from) };
    const moved = await conversations.patchWhere(filters, { onboardingStep: to ?? null }, { ...passedOn(options), returning: "ids" });
    return moved.length > 0;
  };
}

/** What a message leaves on its chat's places: one UPDATE each, however many it reaches, as the home's system. */
function messageMarks(chatPeople, homeWide, systemContext) {
  /** Every other person in the chat has something new to read (a message by someone else). */
  async function markUnreadForOthers(chatId, authorUserId, options) {
    await chatPeople.patchWhere(
      { conversationId: String(chatId), unread: false, ...(authorUserId ? { notUserId: String(authorUserId) } : {}) },
      { unread: true },
      { ...homeWide(options, systemContext("a new message is unread for the chat's other people")), returning: "none" }
    );
  }

  /** Some of the chat's people mentioned (D-114): each with none waiting there has one from now. */
  async function markMentioned(chatId, userIds, options) {
    const filters = { conversationId: String(chatId), userIds: [...new Set(userIds.map(String))].filter(isId), mentioned: false };
    const home = homeWide(options, systemContext("a mention waits for the people it names in the chat"));
    if (filters.userIds.length) await chatPeople.patchWhere(filters, { mentionedAt: new Date().toISOString() }, { ...home, returning: "none" });
  }

  return { markUnreadForOthers, markMentioned };
}

/**
 * A change to a chat the caller may read (`get`), never a direct chat's: its title shows its bot's or the other person's
 * name, and a chat with a bot has one person, so its bot always answers. Answers the chat's row.
 * @param {(chatId: string, options: object) => Promise<object>} get
 * @param {ResourceHandle} conversations
 * @param {(record: object, options: object) => object} asRow
 */
function chatChanger(get, conversations, asRow) {
  return async function changeChat(chatId, changes, options) {
    const chat = await get(chatId, options);
    if (isDirect(chat)) throw directChatRefusal(chat);
    return asRow(await conversations.patch(String(chat.id), changes, passedOn(options)), options);
  };
}

/**
 * The chats as the home's people and bots see them (D-112): chats, their people and bots, a person's place in each,
 * sections, and the chat seam a home's joins and leaves call. Every method reads through the bots' handles in the
 * call's `options`, so ownership keeps it in the home and the row policies (rowPolicies.js) decide what the caller
 * may read: a person the chats they can open, the model's reader `readable_from` its chat. Writes check what the
 * caller may change themselves. Rows answer in the snake_case shape the bots' code reads (recordRows.js).
 * @param {object} dependencies
 * @param {Record<string, ResourceHandle>} dependencies.resources the records feature's handles
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} dependencies.profiles users.profiles
 * @param {import("@jskit-ai/workspaces-core/server/types").WorkspaceMembershipsRepository} dependencies.memberships workspaces.memberships
 */
export function createChatRepository({ resources, systemContext, profiles, memberships }) {
  const { bots, conversations, chatPeople, chatBots, conversationSections: sections } = resources;
  const windows = createSeatWindows(resources);
  const { homeOf, personOf, asRow } = createCallerReaders();
  /** The first record of `handle` matching `filters` the caller may read, or null. */
  const firstOf = async (handle, filters, options) =>
    (await handle.query({ filters, page: { size: 1 } }, passedOn(options))).records[0] ?? null;
  /**
   * The home's own context, from a system context given its reason at the call: the writes a chat's change makes to
   * rows the caller may not read (other people's places).
   */
  const homeWide = (options, system) => ({ ...passedOn(options), context: system.forWorkspace(homeOf(options)) });

  /** Work on the chats in one transaction: the caller's, or one of its own. */
  const withTransaction = (options, work) => conversations.withTransaction(passedOn(options), work);

  /** One chat the caller may read, or null. */
  async function find(chatId, options) {
    if (!isId(chatId)) return null;
    return asRow(await conversations.get(String(chatId), {}, { ...passedOn(options), missing: "skip" }), options);
  }

  /** One chat the caller may read, or a 404. */
  async function get(chatId, options) {
    const chat = await find(chatId, options);
    if (!chat) throw notFound();
    return chat;
  }

  /**
   * One chat the caller may read, locked FOR NO KEY UPDATE until the transaction ends (a turn holds its chat while
   * everyone's messages still go in), or a 404; with `writing`, an archived one is refused.
   */
  async function lock(chatId, txOptions, { writing = false } = {}) {
    if (!isId(chatId) || !(await find(chatId, txOptions))) throw notFound();
    const chat = asRow(await conversations.lock(String(chatId), { ...passedOn(txOptions), lockMode: "noKeyUpdate" }), txOptions);
    if (writing && chat.archived_at) throw archivedRefusal();
    return chat;
  }

  /** People's names, by id: the display name, else the email's first part. */
  async function names(userIds, options) {
    const ids = [...new Set(userIds.filter((id) => id != null).map(String))];
    if (!ids.length) return new Map();
    const found = await profiles.listByIds(ids, passedOn(options));
    return new Map(found.map((user) => [String(user.id), personName({ displayName: user.displayName || null, email: user.email || null }) || "Someone"]));
  }

  /** Whether someone is an active member of the home. */
  async function isHomeMember(userId, options) {
    return Boolean(isId(userId) && await memberships.findActiveByWorkspaceIdAndUserId(homeOf(options), String(userId), passedOn(options)));
  }

  /** Every active member of the home, by id. */
  const everyoneIn = (options) => memberships.activeMemberIds(homeOf(options), passedOn(options));

  /** Someone's role in the home ("owner", "admin", "member" or another the home gives), or null when they aren't in it. */
  async function roleIn(userId, options) {
    if (!isId(userId)) return null;
    return (await memberships.findActiveByWorkspaceIdAndUserId(homeOf(options), String(userId), passedOn(options)))?.roleSid ?? null;
  }

  /**
   * The people in some chats, in the order they joined, by chat: one read for them all.
   * @returns {Promise<Map<string, Array<{ user_id: string, name: string, added_by: string | null, joined_at: string }>>>}
   */
  async function peopleOf(chatIds, options) {
    const byChat = new Map(chatIds.map((id) => [String(id), []]));
    if (!byChat.size) return byChat;
    const records = await chatPeople.queryAll({ filters: { conversationIds: [...byChat.keys()] }, sort: ["id"], fields: ["conversationId", "userId", "addedBy", "joinedAt"] }, passedOn(options));
    const named = await names(records.map((record) => record.userId), options);
    for (const record of records) {
      byChat.get(String(record.conversationId))?.push({
        user_id: String(record.userId),
        name: named.get(String(record.userId)) || "Someone",
        added_by: record.addedBy == null ? null : String(record.addedBy),
        joined_at: record.joinedAt
      });
    }
    return byChat;
  }

  /** The people in one chat. */
  const people = async (chatId, options) => (await peopleOf([String(chatId)], options)).get(String(chatId)) ?? [];

  /**
   * The bots in some chats, in their order, by chat, as the page shows them (an archived one marked: it stays and
   * doesn't answer, D-108): two reads for them all.
   * @returns {Promise<Map<string, Array<{ chat_bot_id: string, bot_id: string, position: number, waiting_task: string | null, name: string, color: string, shape: string, archived_at: string | null }>>>}
   */
  async function botsOf(chatIds, options) {
    const byChat = new Map(chatIds.map((id) => [String(id), []]));
    if (!byChat.size) return byChat;
    const seats = await chatBots.queryAll({ filters: { conversationIds: [...byChat.keys()] }, sort: ["position", "id"], fields: ["conversationId", "botId", "position", "waitingTask"] }, passedOn(options));
    const ids = [...new Set(seats.map((seat) => String(seat.botId)))];
    const faces = new Map(ids.length
      ? (await bots.queryAll({ filters: { id: ids }, fields: ["name", "color", "shape", "archivedAt"] }, passedOn(options))).map((bot) => [String(bot.id), bot])
      : []);
    for (const seat of seats) {
      const bot = faces.get(String(seat.botId));
      if (!bot) continue;
      byChat.get(String(seat.conversationId))?.push({
        chat_bot_id: String(seat.id),
        bot_id: String(seat.botId),
        position: seat.position,
        waiting_task: seat.waitingTask ?? null,
        name: bot.name,
        color: bot.color,
        shape: cloudShape(bot.shape),
        archived_at: bot.archivedAt ?? null
      });
    }
    return byChat;
  }

  /** The bots in one chat. */
  const botsIn = async (chatId, options) => (await botsOf([String(chatId)], options)).get(String(chatId)) ?? [];

  /**
   * A page of the person's chats in the home, each with their place in it (`place`): what the chat list shows, read a
   * page of their places at a time (`after`: the page before's `next`, null after the last), newest chat first, an
   * order no chat moves in while a list is read page by page, as it would by activity. Hidden ones come with `hidden`,
   * archived ones with `archived` (the page asks for both and arranges them itself); without `archived` a page leaves
   * its archived chats out, so it can be short. One read of the page's places and one of their chats.
   * @param {CallOptions} options
   * @param {{ hidden?: boolean, archived?: boolean, after?: string | null }} [only]
   * @returns {Promise<{ chats: object[], next: string | null }>}
   */
  async function ofPerson(options, { hidden = false, archived = false, after = null } = {}) {
    const { records: places, page } = await chatPeople.query({
      filters: { userId: personOf(options), ...(hidden ? {} : { hidden: false }) },
      sort: ["-conversationId"],
      page: { size: LIST_PAGE, ...(after ? { after: String(after) } : {}) }
    }, passedOn(options));
    if (!places.length) return { chats: [], next: null };
    const placeOf = new Map(places.map((place) => [String(place.conversationId), place]));
    const filters = { id: [...placeOf.keys()], ...(archived ? {} : { archived: false }) };
    const found = await conversations.queryAll({ filters, sort: ["-id"] }, passedOn(options));
    const chats = found.map((chat) => ({
      ...asRow(chat, options),
      place: Object.fromEntries(PLACE.map((field) => [field, placeOf.get(String(chat.id))?.[field] ?? null]))
    }));
    return { chats, next: page.next };
  }

  /** The caller's own place in a chat (their chat_people row), or null when they aren't in it. */
  async function place(chatId, options) {
    if (!isId(chatId)) return null;
    return asRow(await firstOf(chatPeople, { conversationId: String(chatId), userId: personOf(options) }, options), options);
  }

  /** Whether someone is one of the chat's people. */
  async function isPerson(chatId, userId, options) {
    if (!isId(chatId) || !isId(userId)) return false;
    const { records } = await chatPeople.query({ filters: { conversationId: String(chatId), userId: String(userId) }, fields: ["userId"], page: { size: 1 } }, passedOn(options));
    return records.length > 0;
  }

  /** The next position for a bot in the chat: after the last. */
  async function nextBotPosition(chatId, options) {
    const [totals] = await chatBots.aggregate({ measures: { last: { max: "position" } }, filters: { conversationId: String(chatId) } }, passedOn(options));
    return totals?.last == null ? 0 : Number(totals.last) + 1;
  }

  /** People rows added to a chat, skipping anyone already in it (chat_people_person_unique). */
  async function seatPeople(chatId, userIds, addedBy, txOptions) {
    const rows = [...new Set(userIds.map(String))].map((userId) => ({ conversationId: String(chatId), userId, addedBy }));
    for (let start = 0; start < rows.length; start += ADD_LIMIT) {
      await chatPeople.createMany(rows.slice(start, start + ADD_LIMIT), {
        ...homeWide(txOptions, systemContext("a chat's people are added by whoever may add them")),
        onConflict: { keys: ["conversationId", "workspaceId", "userId"], action: "ignore" },
        returning: "none"
      });
    }
  }

  /**
   * Bot rows added to a chat after the ones it has, skipping a bot already in it, each reading the chat from
   * `readsFrom` (a message id; null for its beginning).
   */
  async function seatBots(chatId, botIds, addedBy, txOptions, readsFrom = null) {
    const wanted = [...new Set(botIds.map(String))];
    if (!wanted.length) return;
    const found = await bots.queryAll({ filters: { id: wanted }, fields: ["name", "archivedAt"] }, passedOn(txOptions));
    const byId = new Map(found.map((bot) => [String(bot.id), bot]));
    for (const id of wanted) {
      const bot = byId.get(id);
      if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
      if (bot.archivedAt) throw archivedBotRefusal({ name: bot.name });
    }
    const start = await nextBotPosition(chatId, txOptions);
    const at = (index) => ({ addedBy, position: start + index, readsFromMessageId: readsFrom });
    const seat = (botId, index) => ({ conversationId: String(chatId), botId, ...at(index) });
    await chatBots.createMany(wanted.map(seat), {
      ...passedOn(txOptions),
      onConflict: { keys: ["conversationId", "workspaceId", "botId"], action: "ignore" },
      returning: "none"
    });
  }

  /** Refuses people who aren't active members of the home: one read of those people's memberships in it. */
  async function requireHomeMembers(userIds, options) {
    if (!userIds.length) return;
    if (userIds.some((id) => !isId(id))) throw personNotFound();
    const home = String(homeOf(options));
    const homesOf = await memberships.listActiveWorkspaceIdsByUserIdsAmong(userIds.map(String), [home], passedOn(options));
    if (userIds.some((id) => !(homesOf.get(String(id)) ?? []).map(String).includes(home))) throw personNotFound();
  }

  /**
   * A new chat, with its first people and bots, read back. Public unless `kind` is "private" (D15). The maker (the
   * caller's person, when there is one) is one of its people. In the caller's transaction, or one of its own.
   * @param {{ kind?: string, title?: string | null, people?: string[], bots?: string[], appId?: string | null, everyone?: boolean, onboardingStep?: string | null, directBotId?: string | null }} chat
   * @param {CallOptions} options
   */
  async function create(chat, options) {
    const kind = chat.kind ?? "public";
    if (!KINDS.has(kind)) throw new BotsError(400, "A chat is Public or Private.", { code: "bots_chat_kind" });
    const maker = personOrNull(options);
    const peopleIds = [...new Set([...(maker ? [maker] : []), ...(chat.people ?? []).map(String)])];
    if (peopleIds.length > ADD_LIMIT || (chat.bots ?? []).length > ADD_LIMIT) {
      throw new BotsError(400, `A chat starts with up to ${ADD_LIMIT} people and ${ADD_LIMIT} bots.`, { code: "bots_chat_too_many" });
    }
    const title = chat.title == null || chat.title === "" ? null : String(chat.title).trim().slice(0, 80) || null;
    return conversations.withTransaction(passedOn(options), async (txOptions) => {
      await requireHomeMembers(peopleIds.filter((id) => id !== maker), txOptions);
      const id = await conversations.create({
        kind,
        title: chat.directBotId ? null : title,
        everyone: Boolean(chat.everyone),
        appId: chat.appId ?? null,
        onboardingStep: chat.onboardingStep ?? null,
        madeBy: maker,
        ...(chat.directBotId ? { directBotId: String(chat.directBotId), directUserId: maker } : {})
      }, { ...homeWide(txOptions, systemContext("a new chat is made before its people are in it")), returning: "id" });
      await seatPeople(id, peopleIds, maker, txOptions);
      await seatBots(id, chat.bots ?? [], maker, txOptions);
      return get(id, txOptions);
    });
  }

  /** The caller's person, or null for work done for no one. */
  function personOrNull(options) {
    try {
      return personOf(options);
    } catch {
      return null;
    }
  }

  /**
   * The person's direct chat with a bot, made on their first [Message]: Private, readable only from itself, the person
   * and the bot its members, one per person and bot (ux_conversations_direct).
   */
  async function direct(botId, options, { onboardingStep = null } = {}) {
    const make = () => create({ kind: "private", directBotId: String(botId), bots: [String(botId)], onboardingStep }, options);
    return madeOnce((callOptions) => directWith(botId, callOptions), make, options);
  }

  /** The person's direct chat with a bot, or null: read only, never made (a template drafted from the bot). */
  async function directWith(botId, options) {
    return asRow(await firstOf(conversations, { directUserId: personOf(options), directBotId: String(botId) }, options), options);
  }

  /**
   * The person's chat with another person of the home, made on first use: Private, readable only from itself, the two
   * of them its people, one per pair in the home, kept with the lower id first (ux_conversations_person_direct). An
   * insert that skips the pair when it's there, then a read of it, so two first uses at once make one; a new chat seats
   * them both, and an old one seats the caller again if they had left it. In the caller's transaction, or one of its own.
   * @param {string} userId the other person: an active member of the home, not the caller
   * @param {CallOptions} options
   */
  async function personDirect(userId, options) {
    const me = personOf(options);
    const other = String(userId ?? "");
    if (other === String(me)) throw new BotsError(400, "That's you.", { code: "bots_direct_self" });
    if (!isId(other)) throw personNotFound();
    const [low, high] = BigInt(me) < BigInt(other) ? [String(me), other] : [other, String(me)];
    // Read before the transaction, whose insert may wait on another first use of the same pair.
    if (!(await isHomeMember(other, options))) throw personNotFound();
    return conversations.withTransaction(passedOn(options), async (txOptions) => {
      const home = homeWide(txOptions, systemContext("a chat between two people is made once, before they're in it"));
      const made = await conversations.createMany([{ kind: "private", directUserId: low, directPersonId: high, madeBy: String(me) }], {
        ...home,
        onConflict: { keys: ["directUserId", "directPersonId", "workspaceId"], action: "ignore" },
        returning: "count"
      });
      const pair = await firstOf(conversations, { directUserId: low, directPersonId: high }, home);
      await seatPeople(pair.id, made ? [low, high] : [String(me)], String(me), txOptions);
      return get(pair.id, txOptions);
    });
  }

  /** The home's everyone chat, or null. */
  async function everyoneChat(options) {
    return asRow(await firstOf(conversations, { everyone: true }, options), options);
  }

  /** The home's everyone chat, made once with every active member of the home and the bots given. */
  async function makeEveryoneChat({ title, bots: botIds = [] }, options) {
    return madeOnce(everyoneChat, async () => {
      const chat = await create({ kind: "public", everyone: true, title, bots: botIds }, options);
      await seatPeople(chat.id, await everyoneIn(options), personOrNull(options), options);
      return chat;
    }, options);
  }

  /** An app's chat with its Builder (D-41), made once per app: Public, the person who asked and the bot its members. */
  async function appChat({ appId, botId, title }, options) {
    const findIt = async (callOptions) => asRow(await firstOf(conversations, { appId: String(appId) }, callOptions), callOptions);
    return madeOnce(findIt, () => create({ kind: "public", appId: String(appId), title, bots: [String(botId)] }, options), options);
  }

  /** A chat that takes members: one the caller may read, not archived, not a direct chat. */
  async function openForMembers(chatId, txOptions) {
    const chat = await lock(chatId, txOptions, { writing: true });
    if (isDirect(chat)) throw directChatRefusal(chat);
    return chat;
  }

  /** A person added to a chat by the caller (an active member of the home); answers whether they were new to it. */
  async function addPerson(chatId, userId, options) {
    return conversations.withTransaction(passedOn(options), async (txOptions) => {
      await openForMembers(chatId, txOptions);
      if (!(await isHomeMember(userId, txOptions))) throw personNotFound();
      const before = await isPerson(chatId, userId, homeWide(txOptions, systemContext("whether someone is already in a chat")));
      await seatPeople(chatId, [String(userId)], personOrNull(txOptions), txOptions);
      return !before;
    });
  }

  /** The caller seated in a public room by writing in it, in the message's transaction (none when there already). */
  async function joinByWriting(chatId, txOptions) {
    await seatPeople(chatId, [String(personOf(txOptions))], String(personOf(txOptions)), txOptions);
  }

  /**
   * A bot added to a chat by the caller, reading only the chat's latest messages and what is said after (its window,
   * seatWindows.js). Answers its seat there (its chat_bots row; the one it has when it was already in the chat) and
   * whether the chat had more before it (`windowed`), for the line that says so.
   * @returns {Promise<{ seat: object | null, windowed: boolean }>}
   */
  async function addBot(chatId, botId, options) {
    return conversations.withTransaction(passedOn(options), async (txOptions) => {
      await openForMembers(chatId, txOptions);
      const already = await chatBotOf(botId, chatId, txOptions);
      if (already) return { seat: already, windowed: false };
      const readsFrom = await windows.startFor(chatId, txOptions);
      await seatBots(chatId, [String(botId)], personOrNull(txOptions), txOptions, readsFrom);
      return { seat: await chatBotOf(botId, chatId, txOptions), windowed: readsFrom !== null };
    });
  }

  /**
   * A person out of a chat (removed, or leaving). A private chat whose last person goes is deleted: nobody could open
   * it any more (D-112). Answers whether the chat was deleted.
   */
  async function removePerson(chatId, userId, options) {
    return conversations.withTransaction(passedOn(options), async (txOptions) => {
      const chat = await lock(chatId, txOptions);
      const home = homeWide(txOptions, systemContext("a person leaves a chat"));
      await chatPeople.deleteWhere({ conversationId: String(chat.id), userId: String(userId) }, { ...home, returning: "none" });
      if (chat.kind !== "private") return false;
      const { records: left } = await chatPeople.query({ filters: { conversationId: String(chat.id) }, fields: ["userId"], page: { size: 1 } }, home);
      if (left.length) return false;
      await conversations.delete(String(chat.id), home);
      return true;
    });
  }

  /** A bot out of a chat, with its runs, computer and routines there (ON DELETE CASCADE). */
  async function removeBot(chatId, botId, options) {
    return conversations.withTransaction(passedOn(options), async (txOptions) => {
      const chat = await lock(chatId, txOptions);
      const removed = await chatBots.deleteWhere({ conversationId: String(chat.id), botId: String(botId) }, { ...passedOn(txOptions), returning: "count" });
      return Number(removed) > 0;
    });
  }

  const changeChat = chatChanger(get, conversations, asRow);
  /** A chat's new title (not a direct chat's, which shows its bot's name). */
  const rename = (chatId, title, options) => changeChat(chatId, { title: String(title ?? "").trim().slice(0, 80) || null }, options);
  /** Whether a chat's bots join in when useful (D-115); never a direct chat's, which has one person. */
  const switchJoinIn = (chatId, on, options) => changeChat(chatId, { botsJoinIn: Boolean(on) }, options);

  /** A chat archived (read-only for everyone in it) or unarchived. */
  async function setArchived(chatId, archived, options) {
    const chat = await get(chatId, options);
    const changes = archived
      ? { archivedAt: new Date().toISOString(), archivedBy: personOrNull(options) }
      : { archivedAt: null, archivedBy: null };
    return asRow(await conversations.patch(String(chat.id), changes, passedOn(options)), options);
  }

  /** A chat archived for everyone in it. */
  const archive = (chatId, options) => setArchived(chatId, true, options);

  /** An archived chat back in use. */
  const unarchive = (chatId, options) => setArchived(chatId, false, options);

  /** A chat deleted, with its people, bots, messages and everything keyed to them (ON DELETE CASCADE). */
  async function remove(chatId, options) {
    const chat = await get(chatId, options);
    await conversations.delete(String(chat.id), passedOn(options));
  }

  /** Changes to the caller's own place in a chat (read point, unread, pin, section, hidden, muted); read clears a mention. */
  async function updatePlace(chatId, changes, options) {
    const fields = Object.fromEntries(Object.entries(changes).filter(([field]) => PLACE_CHANGES.has(field)));
    if (!Object.keys(fields).length) return place(chatId, options);
    if (fields.unread === false) fields.mentionedAt = null;
    const mine = await place(chatId, options);
    if (!mine) throw notFound();
    return asRow(await chatPeople.patch(String(mine.id), fields, passedOn(options)), options);
  }

  /** The caller has read the chat up to a message: no longer unread. */
  const markRead = (chatId, messageId, options) => updatePlace(chatId, { readUpTo: Number(messageId) || null, unread: false }, options);

  /** The next pin position among the person's chats: after the last one. */
  async function nextPinPosition(options) {
    const [totals] = await chatPeople.aggregate({ measures: { last: { max: "pinPosition" } }, filters: { userId: personOf(options) } }, passedOn(options));
    return totals?.last == null ? 0 : Number(totals.last) + 1;
  }

  /**
   * The person's pinned chats in the order given, locked while it's written: one UPDATE for them all, in the caller's
   * transaction or one of its own. False when the pinned chats are not exactly those given.
   */
  async function reorderPins(chatIds, options) {
    return chatPeople.withTransaction(passedOn(options), async (txOptions) => {
      const pinned = await chatPeople.lockWhere({ userId: personOf(txOptions), pinned: true }, { ...passedOn(txOptions), lockMode: "noKeyUpdate" });
      const byChat = new Map(pinned.map((row) => [String(row.conversationId), row]));
      const order = [...new Set(chatIds.map(String))].filter((id) => byChat.has(id));
      if (order.length !== byChat.size) return false;
      const positions = order.map((id, position) => ({ id: byChat.get(id).id, pinPosition: position }));
      await chatPeople.patchMany(positions, { ...passedOn(txOptions), returning: "none" });
      return true;
    });
  }

  /** A bot in a chat the caller may read (its chat_bots row), by the bot and the chat, or null. */
  async function chatBotOf(botId, chatId, options) {
    if (!isId(botId) || !isId(chatId)) return null;
    return asRow(await firstOf(chatBots, { botId: String(botId), conversationId: String(chatId) }, options), options);
  }

  /** A bot in a chat by its chat_bots id, or null. */
  async function chatBot(chatBotId, options) {
    if (!isId(chatBotId)) return null;
    return asRow(await chatBots.get(String(chatBotId), {}, { ...passedOn(options), missing: "skip" }), options);
  }

  /** Changes to a bot in a chat (its waiting hand-over, its job notes), given in its columns' names. */
  async function updateChatBot(chatBotId, columns, options) {
    await chatBots.patch(String(chatBotId), fieldsOf(columns), { ...passedOn(options), returning: "none" });
  }

  /**
   * The ids of the chats a bot in this chat may read (D-112): `readable_from(chat)`, everyone who can open the chat
   * can open each, and the caller's scope narrows them further. The files, computers and memory read by it.
   */
  async function readableFrom(chatId, options) {
    if (!isId(chatId)) return [];
    const records = await conversations.queryAll({ filters: { readableFrom: String(chatId) }, fields: ["kind"] }, passedOn(options));
    return records.map((record) => String(record.id));
  }

  /** Someone joined the home: they're in its everyone chat (the home's own joins and a copy's invitations call it). */
  async function personJoined(userId, options) {
    const chat = await everyoneChat(homeWide(options, systemContext("a person joins the home's everyone chat")));
    if (chat) await seatPeople(chat.id, [String(userId)], null, options);
    return Boolean(chat);
  }

  /**
   * Someone left the home: they're out of every chat, and the private chats only they were in are deleted (nobody could
   * open them any more). What they made is paused before, with its line (chatMembers.homeChanged's `leaving`, the one
   * path, workPause.js). Their messages stay, under their name. Answers the
   * chats they're no longer in (`left`) and those deleted, each with its bots' seats as they were (`deleted`), for the
   * computers and files that go with them. In the home's own context: what they leave is read as the home's.
   * @param {string} userId
   * @param {CallOptions} options
   * @returns {Promise<{ left: string[], deleted: Array<{ chatId: string, chatBotIds: string[] }> }>}
   */
  async function personLeft(userId, options) {
    const home = homeWide(options, systemContext("a person leaves the home's chats"));
    return conversations.withTransaction(home, async (txOptions) => {
      const places = await chatPeople.queryAll({ filters: { userId: String(userId) }, fields: ["conversationId"] }, txOptions);
      const chatIds = [...new Set(places.map((row) => String(row.conversationId)))];
      await chatPeople.deleteWhere({ userId: String(userId) }, { ...txOptions, returning: "none" });
      const gone = chatIds.length ? await emptiedPrivateChats(chatIds, txOptions) : [];
      const seatQuery = { filters: { conversationIds: gone }, fields: ["conversationId"] };
      const seats = gone.length ? await chatBots.queryAll(seatQuery, txOptions) : [];
      if (gone.length) await conversations.deleteWhere({ id: gone }, { ...txOptions, returning: "none" });
      const seatsOf = (chatId) => seats.filter((seat) => String(seat.conversationId) === chatId).map((seat) => String(seat.id));
      return {
        left: chatIds.filter((id) => !gone.includes(id)),
        deleted: gone.map((chatId) => ({ chatId, chatBotIds: seatsOf(chatId) }))
      };
    });
  }

  /** Of these chats, the private ones nobody is in any more: two reads. */
  async function emptiedPrivateChats(chatIds, txOptions) {
    const privateChats = await conversations.queryAll({ filters: { id: chatIds, kind: "private" }, fields: ["kind"] }, txOptions);
    const privateIds = privateChats.map((chat) => String(chat.id));
    if (!privateIds.length) return [];
    const stillIn = await chatPeople.queryAll({ filters: { conversationIds: privateIds }, fields: ["conversationId"] }, txOptions);
    const occupied = new Set(stillIn.map((row) => String(row.conversationId)));
    return privateIds.filter((id) => !occupied.has(id));
  }

  /**
   * What a change of the home's people leaves to do: who has a place in its chats but is no longer an active member
   * (`departed`), and the active members its everyone chat was missing, now seated in it (`joined`). The members' list
   * and two reads, bounded by the home's people; in the home's own context.
   * @param {CallOptions} options
   * @returns {Promise<{ departed: string[], joined: string[], everyoneChatId: string | null }>}
   */
  async function syncMembers(options) {
    const home = homeWide(options, systemContext("the home's people join and leave its chats"));
    const active = (await everyoneIn(home)).map(String);
    const stale = await chatPeople.queryAll({ filters: { notUserIds: active }, fields: ["userId"] }, home);
    const departed = [...new Set(stale.map((row) => String(row.userId)))];
    const everyone = await everyoneChat(home);
    if (!everyone) return { departed, joined: [], everyoneChatId: null };
    const seated = new Set((await people(everyone.id, home)).map((person) => String(person.user_id)));
    const joined = active.filter((id) => !seated.has(id));
    if (joined.length) await seatPeople(everyone.id, joined, null, home);
    return { departed, joined, everyoneChatId: String(everyone.id) };
  }

  return Object.freeze({
    withTransaction,
    find,
    get,
    byIds: chatsByIds(conversations),
    lock,
    names,
    isHomeMember,
    everyoneIn,
    roleIn,
    people,
    peopleOf,
    bots: botsIn,
    botsOf,
    ofPerson,
    publicRooms: roomsToVisit(conversations, chatPeople),
    tuckedAwayWith: createSharedChatRepository(resources).tuckedAwayWith,
    place,
    isPerson,
    create,
    direct,
    directWith,
    personDirect,
    everyoneChat,
    makeEveryoneChat,
    appChat,
    changeAppBuilder: builderChanger(conversations, chatBots, personOrNull),
    addPerson,
    joinByWriting,
    addBot,
    readFurtherBack: windows.readFurtherBack,
    windowOf: windows.windowOf,
    removePerson,
    removeBot,
    rename,
    switchJoinIn,
    archive,
    unarchive,
    remove,
    updatePlace,
    markRead,
    moveOnboarding: onboardingMover(conversations),
    ...messageMarks(chatPeople, homeWide, systemContext),
    nextPinPosition,
    reorderPins,
    chatBotOf,
    chatBot,
    updateChatBot,
    readableFrom,
    personJoined,
    personLeft,
    syncMembers,
    sections: createSectionRecords(sections)
  });
}
