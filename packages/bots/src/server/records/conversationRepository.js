import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { personName } from "@local/homes/server/personName";
import { BotsError } from "../botsError.js";
import { cloudShape } from "../botRows.js";
import { createCallerReaders, fieldsOf } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

// What a summary reads of its conversation: whose it is, and the room it continues (D-36, D-48).
const SUMMARY_FIELDS = Object.freeze(["botId", "userId", "groupId", "parentId", "forkedAtMessageId", "title"]);

// Each person talks to a bot in their own conversation (D-36). What's theirs (onboarding, a
// waiting hand-over, unread, where they read up to, pins, section, hidden, last activity) lives
// on it. A bot loaded with a conversation reads like the bot as that person sees it: user_id is
// the person, created_by who made the bot, conversation_id their conversation.
const PERSONAL = Object.freeze([
  "onboarding_step",
  "waiting_task",
  "unread",
  "read_up_to",
  "pin_position",
  "section_id",
  "hidden",
  "last_activity_at",
  "keep_out_of_notebook"
]);

/**
 * A shared bot (D-36) talks in public conversations ("rooms") instead: the person's own row
 * ("seat", seat_id) still keeps their pins, section and open tab, while conversation_id is the
 * room. Rooms have no onboarding, and what the person has read there is in conversation_reads.
 */
function asSeen(bot, conversation, room = null) {
  const own = Object.fromEntries(PERSONAL.map((field) => [field, conversation[field]]));
  const seen = {
    ...bot,
    ...own,
    created_by: bot.user_id,
    user_id: conversation.user_id,
    conversation_id: conversation.id,
    seat_id: conversation.id,
    room: null
  };
  return room
    ? {
        ...seen,
        onboarding_step: null,
        waiting_task: room.waiting_task,
        read_up_to: room.read_up_to ?? null,
        conversation_id: room.id,
        room
      }
    : seen;
}

/**
 * A shared bot and a group chat (D-46) talk in rooms: conversations everyone in them sees, with a
 * seat per person. A member bot's own computer for a group is a room-like row with group_id set,
 * never a tab.
 */
const isShared = (bot) => bot.kind === "group" || bot.sharing === "shared";

// The notebook's notes a page shows at a time, newest first (D-36).
const NOTEBOOK_PAGE = 50;

/**
 * The bots and their conversations as a person sees them (D-36, D-46): bots, seats, rooms and read
 * points, groups with their bots and people, sections, the notebook and memories. Every
 * method reads through the bots' handles in the call's `options`, so ownership keeps it in the
 * home and the row policies (rowPolicies.js) decide what a person sees; rows answer in the
 * snake_case shape the bots' code reads (asSeen, recordRows.js), with the home as workspace_id.
 * @param {object} dependencies
 * @param {Record<string, ResourceHandle>} dependencies.resources the records feature's handles
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} dependencies.profiles users.profiles
 * @param {import("@jskit-ai/workspaces-core/server/types").WorkspaceMembershipsRepository} dependencies.memberships workspaces.memberships
 * @param {{ lock: (workspaceId: string, options: CallOptions) => Promise<{ id: string } | null> }} dependencies.workspaces workspaces
 */
export function createConversationRepository({ resources, systemContext, profiles, memberships, workspaces }) {
  const {
    bots,
    botConversations: conversations,
    conversationReads: reads,
    botSections: sections,
    botGroupMembers: groupMembers,
    botGroupPeople: groupPeople,
    botNotebook: notebook,
    personMemories: memories
  } = resources;

  const { homeOf, personOf, asRow, personalOptions } = createCallerReaders(systemContext);

  /** One bot of the home the caller sees, or null. */
  async function botOf(botId, options) {
    return asRow(await bots.get(botId, {}, { ...passedOn(options), missing: "skip" }), options);
  }

  /** The person's own conversation with the bot, or null. */
  async function findSeat(botId, person, options) {
    const [seat] = await conversations.queryAll({ filters: { botId, userId: person } }, passedOn(options));
    return seat ?? null;
  }

  /**
   * A conversation row made only when the row `keys` name is missing, then read back with `find`. The insert is an
   * upsert on the unique index those columns have (json-rest-api names it in ON CONFLICT … DO NOTHING), so two
   * first uses at once make it once: the second insert skips the first's row, with no failed statement to retry.
   * The keys carry the home, the conversations' ownership.
   * @param {Record<string, unknown>} row
   * @param {string[]} keys
   * @param {(callOptions: CallOptions) => Promise<object | undefined>} find
   * @param {CallOptions} options
   */
  async function madeOnce(row, keys, find, options) {
    await conversations.createMany([row], { ...passedOn(options), onConflict: { keys: ["workspaceId", ...keys], action: "ignore" }, returning: "none" });
    return asRow(await find(passedOn(options)), options);
  }

  /**
   * The person's own conversation with a bot, made on their first look: a bot someone else made
   * starts its short introduction. Read first; a missing one is made once (madeOnce: unique on
   * bot_id, user_id), so two first looks at once make it once.
   * @param {{ id: string, kind: string }} bot
   * @param {CallOptions} options
   * @param {Record<string, unknown>} [start] the seat's first columns, as its rows name them
   */
  async function conversationOf(bot, options, start = { onboarding_step: bot.kind === "group" ? null : "intro-greet" }) {
    const person = personOf(options);
    const seat = await findSeat(bot.id, person, options);
    if (seat) return asRow(seat, options);
    return madeOnce({ botId: bot.id, userId: person, ...fieldsOf(start) }, ["botId", "userId"], (callOptions) => findSeat(bot.id, person, callOptions), options);
  }

  /** The bot's rooms (no person, no group), in id order: a shared bot's tabs. */
  async function roomsOf(botId, options) {
    const rooms = await conversations.queryAll({ filters: { botId, userId: null, groupId: null }, sort: ["id"] }, passedOn(options));
    return rooms.map((room) => asRow(room, options));
  }

  /** One room of the bot: the one asked for, or with no id its first, else null. */
  async function roomOf(botId, roomId, options) {
    const filters = { botId, userId: null, groupId: null, ...(roomId ? { id: roomId } : {}) };
    const { records: [room] } = await conversations.query({ filters, sort: ["id"], page: { size: 1 } }, passedOn(options));
    return asRow(room ?? null, options);
  }

  /**
   * The room a person is in: the one asked for, else the tab they last had open, else the first.
   * A bot that has just become shared gets its first room, "General".
   */
  async function roomFor(bot, wanted, options) {
    const room =
      (wanted && (await roomOf(bot.id, wanted, options))) ||
      (await roomOf(bot.id, null, options)) ||
      asRow(await conversations.create({ botId: bot.id, title: bot.kind === "group" ? "Group" : "General", createdBy: personOf(options) }, passedOn(options)), options);
    const [read] = await reads.queryAll({ filters: { conversationId: room.id } }, personalOptions(options));
    return { ...room, read_up_to: read?.readUpTo ?? null };
  }

  /**
   * A bot as this person sees it: their own conversation, or for a shared bot a room. With `lock`,
   * inside the caller's transaction, the conversation it answers for is locked first.
   */
  async function seenBy(bot, options, { lock = false, room = null } = {}) {
    let conversation = await conversationOf(bot, options);
    let open = isShared(bot) ? await roomFor(bot, room || conversation.room_id, options) : null;
    // FOR NO KEY UPDATE: a turn holds its conversation while everyone else's messages into it still go in.
    const holding = { ...passedOn(options), lockMode: "noKeyUpdate" };
    if (lock && open) open = { ...open, ...asRow(await conversations.lock(open.id, holding), options) };
    else if (lock) conversation = asRow(await conversations.lock(conversation.id, holding), options);
    return asSeen(bot, conversation, open);
  }

  /** Whether the person is one of a group's people (D-46). */
  async function inGroup(groupId, userId, options) {
    const { records } = await groupPeople.query({ filters: { groupId, userId: String(userId) }, page: { size: 1 } }, passedOn(options));
    return records.length > 0;
  }

  /**
   * A bot of the home the caller sees, with their conversation (the request's home only). The
   * row policy keeps a group chat to its people, for a request and for work done for someone.
   * @param {string} botId
   * @param {CallOptions} options
   * @param {{ lock?: boolean, room?: string | null }} [read]
   */
  async function ownedBot(botId, options, read = {}) {
    const bot = await botOf(botId, options);
    const notFound = () => new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    if (!bot) throw notFound();
    return seenBy(bot, options, read);
  }

  /** Things only a bot has: its computer, templates and teaching (a group only talks). */
  async function ownedSingleBot(botId, options) {
    const row = await ownedBot(botId, options);
    if (row.kind === "group") throw new BotsError(400, "That's a group chat, not a bot.", { code: "bots_group_not_bot" });
    return row;
  }

  /** The same bot and conversation read again, after a change. */
  async function refresh(row, options) {
    const bot = await botOf(row.id, options);
    const seat = asRow(await conversations.get(row.seat_id, {}, passedOn(options)), options);
    return asSeen(bot, seat, row.room ? await roomFor(bot, row.conversation_id, options) : null);
  }

  /**
   * A bot as seen in one conversation: the person's own, a room (with the person's seat), or,
   * without a conversation, the one the person has open with it.
   */
  async function rowOfConversation(botId, conversationId, options) {
    const bot = await botOf(botId, options);
    if (!bot) return null;
    if (!conversationId) return seenBy(bot, options);
    const conversation = asRow(await conversations.get(conversationId, {}, { ...passedOn(options), missing: "skip" }), options);
    if (!conversation) return null;
    return conversation.user_id ? asSeen(bot, conversation) : asSeen(bot, await conversationOf(bot, options), conversation);
  }

  /** One conversation by id, as its row, or null. */
  async function conversationRow(conversationId, options) {
    return asRow(await conversations.get(conversationId, {}, { ...passedOn(options), missing: "skip" }), options);
  }

  /**
   * A member bot's own computer for one group (D-46): a row of its own, made on first use, never a
   * tab, so nothing from its other conversations is open there. Read first; a missing one is made
   * once (madeOnce: unique on bot_id, group_id), so two turns at once make it once.
   */
  async function groupSeatFor(group, bot, options) {
    const find = async (callOptions) => (await conversations.queryAll({ filters: { botId: bot.id, groupId: group.id } }, callOptions))[0];
    const found = await find(passedOn(options));
    if (found) return asRow(found, options);
    return madeOnce({
      botId: bot.id,
      groupId: group.id,
      title: String(group.name || "Group").slice(0, 40),
      createdBy: group.created_by ?? group.user_id
    }, ["botId", "groupId"], find, options);
  }

  /**
   * A shared bot's conversation for one app (owner, 2026-10-30): made fresh the first time, named
   * after the app. Read first; a missing one is made once (madeOnce: unique on bot_id, app_id).
   */
  async function appRoomFor(bot, app, title, options) {
    const find = async (callOptions) =>
      (await conversations.queryAll({ filters: { botId: bot.id, appId: app.id, userId: null, groupId: null } }, callOptions))[0];
    const found = await find(passedOn(options));
    if (found) return asRow(found, options);
    return madeOnce({ botId: bot.id, title, appId: app.id, createdBy: personOf(options) }, ["botId", "appId"], find, options);
  }

  /** A new tab in a shared bot, continuing from another one up to its latest message (D-36). */
  async function createRoom(bot, { title, parentId, forkedAtMessageId }, options) {
    return asRow(await conversations.create({
      botId: bot.id,
      title,
      parentId,
      forkedAtMessageId,
      createdBy: personOf(options)
    }, passedOn(options)), options);
  }

  /** A room's new name. */
  async function renameRoom(roomId, title, options) {
    return asRow(await conversations.patch(roomId, { title }, passedOn(options)), options);
  }

  /** Changes to one conversation (a seat or a room), given in its columns' names. */
  async function updateConversation(conversationId, columns, options) {
    await conversations.patch(conversationId, fieldsOf(columns), { ...passedOn(options), returning: "none" });
  }

  /** The person's seats in the home, keyed by their bot. */
  async function seatsOf(options, { botId } = {}) {
    const seats = await conversations.queryAll({ filters: { userId: personOf(options), ...(botId ? { botId } : {}) } }, passedOn(options));
    return new Map(seats.map((seat) => [String(seat.botId), asRow(seat, options)]));
  }

  /** The next pin position among the person's seats in the home: after the last one. */
  async function nextPinPosition(options) {
    const [totals] = await conversations.aggregate({ measures: { last: { max: "pinPosition" } }, filters: { userId: personOf(options) } }, passedOn(options));
    return totals?.last == null ? 0 : Number(totals.last) + 1;
  }

  /**
   * The person's pinned seats in the home, locked, in the order the caller gives: one UPDATE for
   * them all. Answers false when the pinned bots are not exactly those given.
   */
  async function reorderPins(botIds, txOptions) {
    const pinned = await conversations.lockWhere({ userId: personOf(txOptions), pinned: true }, { ...passedOn(txOptions), lockMode: "noKeyUpdate" });
    const byBot = new Map(pinned.map((seat) => [String(seat.botId), seat]));
    const order = botIds.filter((id) => byBot.has(id));
    if (order.length !== byBot.size) return false;
    await conversations.patchMany(order.map((id, position) => ({ id: byBot.get(id).id, pinPosition: position })), { ...passedOn(txOptions), returning: "none" });
    return true;
  }

  /** The bots of the home the caller sees, in id order: with `botId`, just that one. */
  async function listBots(options, { botId } = {}) {
    const records = await bots.queryAll({ filters: botId ? { id: botId } : {}, sort: ["id"] }, passedOn(options));
    return records.map((record) => asRow(record, options));
  }

  /** The home's bots of one kind among the ids given (a group's picks, a member to add). */
  async function homeBotsOf(ids, options, { kind = "bot" } = {}) {
    if (!ids.length) return [];
    return (await bots.queryAll({ filters: { id: ids, kind } }, passedOn(options))).map((record) => asRow(record, options));
  }

  /** Bots of the home the caller sees among the ids given, of any kind, keyed by id (search's names). */
  async function botsById(ids, options) {
    if (!ids.length) return new Map();
    const records = await bots.queryAll({ filters: { id: [...new Set(ids.map(String))] }, fields: ["name", "kind"] }, passedOn(options));
    return new Map(records.map((record) => [String(record.id), record]));
  }

  /**
   * The home, locked until the transaction ends: the first visits after sign-up wait for each other,
   * so a home gets one first bot.
   */
  async function lockHome(txOptions) {
    await workspaces.lock(homeOf(txOptions), passedOn(txOptions));
  }

  /** The home's first bot, the oldest, or null. */
  async function firstBot(options) {
    const { records: [first] } = await bots.query({ sort: ["id"], page: { size: 1 } }, passedOn(options));
    return asRow(first ?? null, options);
  }

  /**
   * A new bot or group chat, given in its columns' names. Only a group's people see it (D-46), so a
   * group's maker joins it, as its first person, before it is read back.
   */
  async function createBot(columns, options) {
    const id = await bots.create(fieldsOf(columns), { ...passedOn(options), returning: "id" });
    if (columns.kind === "group") {
      await groupPeople.create({ groupId: String(id), userId: String(columns.user_id), addedBy: String(columns.user_id) }, { ...passedOn(options), returning: "none" });
    }
    return botOf(id, options);
  }

  /** Changes to one bot, given in its columns' names. */
  async function updateBot(botId, columns, options) {
    await bots.patch(botId, fieldsOf(columns), { ...passedOn(options), returning: "none" });
  }

  /** The home's main bot is no longer the main one: another becomes it. */
  async function clearMainBot(options) {
    await bots.patchWhere({ isMain: true }, { isMain: false }, passedOn(options));
  }

  async function deleteBot(botId, options) {
    await bots.delete(botId, passedOn(options));
  }

  /**
   * The bots in each group (D-46), in their order, as the page shows them: one read of the
   * memberships and one of their bots, whatever the number of groups.
   * @returns {Promise<Map<string, Array<{ id: string, name: string, color: string, shape: string }>>>}
   */
  async function membersOf(groupIds, options) {
    const byGroup = new Map();
    if (!groupIds.length) return byGroup;
    const rows = await groupMembers.queryAll({ filters: { groupIds: groupIds.map(String) }, sort: ["groupId", "position"] }, passedOn(options));
    const memberBots = rows.length
      ? await bots.queryAll({ filters: { id: [...new Set(rows.map((row) => String(row.botId)))] } }, passedOn(options))
      : [];
    const botsById = new Map(memberBots.map((bot) => [String(bot.id), bot]));
    for (const row of rows) {
      const bot = botsById.get(String(row.botId));
      if (!bot) continue;
      const key = String(row.groupId);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push({ id: String(bot.id), name: bot.name, color: bot.color, shape: cloudShape(bot.shape) });
    }
    return byGroup;
  }

  /** Whether a group has more than one of `handle`'s rows (its bots or its people), counted in the store. */
  async function severalIn(handle, groupId, options) {
    const [{ n = 0 } = {}] = await handle.aggregate({ measures: { n: { count: "*" } }, filters: { groupId: String(groupId) } }, passedOn(options));
    return Number(n) > 1;
  }

  /** Whether a group has more than one bot (D-46). */
  const severalBotsIn = (groupId, options) => severalIn(groupMembers, groupId, options);

  /** Whether a group has more than one person (D-46). */
  const severalPeopleIn = (groupId, options) => severalIn(groupPeople, groupId, options);

  /** A group's member rows, in order (D-46). */
  async function groupMembersOf(groupId, options) {
    return groupMembers.queryAll({ filters: { groupId }, sort: ["position"] }, passedOn(options));
  }

  /** Bots join a group in one write; positions follow the order given. */
  async function addGroupMembers(groupId, members, options) {
    await groupMembers.createMany(members.map(({ botId, position }) => ({ groupId, botId, position })), { ...passedOn(options), returning: "none" });
  }

  async function removeGroupMember(groupId, botId, options) {
    await groupMembers.deleteWhere({ groupId, botId }, passedOn(options));
  }

  /**
   * People's display names and emails, by id. users.profiles reads at most a page of 100 and lists no
   * users by id (a JSKIT engine gap), so the ids are read a page at a time.
   * @param {Array<string | number>} userIds
   * @param {CallOptions} options
   * @returns {Promise<Map<string, { displayName: string | null, email: string | null }>>}
   */
  async function profilesOf(userIds, options) {
    const found = await profiles.listByIds(userIds.filter((id) => id != null), passedOn(options));
    return new Map(found.map((user) => [String(user.id), { displayName: user.displayName || null, email: user.email || null }]));
  }

  /**
   * People's names (D-36, D-46), by id: the display name, else the email's first part.
   * @param {Array<string | number>} userIds
   * @param {CallOptions} options
   * @returns {Promise<Map<string, string>>}
   */
  async function namesOf(userIds, options) {
    const names = new Map();
    for (const [id, user] of await profilesOf(userIds, options)) {
      names.set(id, personName(user) || "Someone");
    }
    return names;
  }

  /** Who wrote a message, where several people read it (D-36, D-46). */
  async function fromOf(userId, options) {
    return { id: String(userId), name: (await namesOf([userId], options)).get(String(userId)) || "Someone" };
  }

  /** The people in a group (D-46), who see it and hear its news, first the one who made it. */
  async function peopleIdsOf(groupId, options) {
    const rows = await groupPeople.queryAll({ filters: { groupId }, sort: ["createdAt"] }, passedOn(options));
    return rows.map((row) => String(row.userId));
  }

  /** The people in each group (D-46), first the one who made it, with their names. */
  async function peopleOf(groupIds, options) {
    const byGroup = new Map();
    if (!groupIds.length) return byGroup;
    const rows = await groupPeople.queryAll({ filters: { groupIds: groupIds.map(String) }, sort: ["groupId", "createdAt"] }, passedOn(options));
    const names = await namesOf(rows.map((row) => row.userId), options);
    for (const row of rows) {
      const name = names.get(String(row.userId));
      if (name === undefined) continue;
      const key = String(row.groupId);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push({ id: String(row.userId), name });
    }
    return byGroup;
  }

  /**
   * Someone joins a group (D-46): their row among its people, and their own seat, already in the
   * group's room. The seat is another person's, which the adder's row policy does not show, so it
   * is written for the home, after the service has checked the adder is in the group.
   */
  async function addGroupPerson(group, personId, addedBy, options) {
    await groupPeople.create({ groupId: group.id, userId: String(personId), addedBy: String(addedBy) }, { ...passedOn(options), returning: "none" });
    const forHome = { ...passedOn(options), context: systemContext("a group's people are added and removed by those in it").forWorkspace(homeOf(options)) };
    const [seat] = await conversations.queryAll({ filters: { botId: group.id, userId: String(personId) } }, forHome);
    if (seat) await conversations.patch(seat.id, { roomId: group.conversation_id }, { ...forHome, returning: "none" });
    else await conversations.create({ botId: group.id, userId: String(personId), roomId: group.conversation_id }, { ...forHome, returning: "none" });
  }

  /**
   * Someone leaves a group, or is removed (D-46): their row, their seat and where they read up to,
   * written for that person's home and person once the service has decided they may go.
   */
  async function removeGroupPerson(group, personId, options) {
    await groupPeople.deleteWhere({ groupId: group.id, userId: String(personId) }, passedOn(options));
    const forHome = { ...passedOn(options), context: systemContext("a group's people are added and removed by those in it").forWorkspace(homeOf(options)) };
    await conversations.deleteWhere({ botId: group.id, userId: String(personId) }, forHome);
    const forPerson = { ...passedOn(options), context: systemContext("a group's people are added and removed by those in it").forUser(String(personId)) };
    await reads.deleteWhere({ conversationId: group.conversation_id }, forPerson);
  }

  /**
   * Where a person has read up to in a room (D-36): the caller's own, or, for someone just added to
   * a group, theirs, so what was said before they joined isn't news to them.
   */
  async function markRead(conversationId, readUpTo, options, { userId = null } = {}) {
    const forPerson = userId === null
      ? personalOptions(options)
      : { ...passedOn(options), context: systemContext("a group's people are added and removed by those in it").forUser(String(userId)) };
    await reads.createMany([{ conversationId, readUpTo: Number(readUpTo) }], {
      ...forPerson,
      onConflict: { keys: ["conversationId", "userId"], action: "merge" },
      returning: "none"
    });
  }

  /** The person's read point in each of the rooms given, keyed by room. */
  async function readsOf(conversationIds, options) {
    if (!conversationIds.length) return new Map();
    const rows = await reads.queryAll({ filters: { conversationIds: conversationIds.map(String) } }, personalOptions(options));
    return new Map(rows.map((row) => [String(row.conversationId), row.readUpTo]));
  }

  /** Every active member of the home (D-15, D-36): who hears a room's news. */
  async function everyoneIn(options) {
    return memberships.activeMemberIds(homeOf(options), passedOn(options));
  }

  /** Whether someone is an active member of the home (a person added to a group, D-46). */
  async function isHomeMember(userId, options) {
    return Boolean(await memberships.findActiveByWorkspaceIdAndUserId(homeOf(options), userId, passedOn(options)));
  }

  /** The person's sections in the home, in their order. */
  async function sectionsOf(options) {
    return (await sections.queryAll({ sort: ["position"] }, passedOn(options))).map((record) => asRow(record, options));
  }

  /** The person's sections in the home, locked, in their order: a change to their order holds them all. */
  async function lockSections(txOptions) {
    const locked = await sections.lockWhere({}, { ...passedOn(txOptions), all: true, lockMode: "noKeyUpdate" });
    return locked.map((record) => asRow(record, txOptions)).sort((a, b) => a.position - b.position);
  }

  /** One of the person's sections, or a 404. */
  async function ownedSection(sectionId, options) {
    const section = asRow(await sections.get(sectionId, {}, { ...passedOn(options), missing: "skip" }), options);
    if (!section) throw new BotsError(404, "Section not found.", { code: "bots_section_not_found" });
    return section;
  }

  /** A new section at `position`, the ones from there on moved down one, in one write each. */
  async function insertSection(name, position, existing, txOptions) {
    const below = existing.filter((section) => section.position >= position);
    if (below.length) {
      await sections.patchMany(below.map((section) => ({ id: section.id, position: section.position + 1 })), { ...passedOn(txOptions), returning: "none" });
    }
    return asRow(await sections.create({ name, position }, passedOn(txOptions)), txOptions);
  }

  async function updateSection(sectionId, changes, options) {
    return asRow(await sections.patch(sectionId, changes, passedOn(options)), options);
  }

  /** Two sections swap places, in one write. */
  async function swapSections(first, second, txOptions) {
    await sections.patchMany([{ id: first.id, position: second.position }, { id: second.id, position: first.position }], { ...passedOn(txOptions), returning: "none" });
  }

  async function deleteSection(sectionId, options) {
    await sections.delete(sectionId, passedOn(options));
  }

  /**
   * A page of the bot's notebook (D-36), newest first, without the notes taken out: `{ notes, next }`,
   * `next` the cursor of the older page (null when there's none), which `after` takes.
   */
  async function notesOf(botId, options, { after = null } = {}) {
    const { records, page } = await notebook.query(
      { filters: { botId, removedAt: null }, sort: ["-id"], page: { size: NOTEBOOK_PAGE, ...(after ? { after } : {}) } },
      passedOn(options)
    );
    return { notes: records.map((note) => asRow(note, options)), next: page.next };
  }

  /** One note still in the bot's notebook, or null. */
  async function noteOf(botId, noteId, options) {
    const [note] = await notebook.queryAll({ filters: { id: noteId, botId, removedAt: null } }, passedOn(options));
    return asRow(note ?? null, options);
  }

  async function removeNote(noteId, options) {
    await notebook.patch(noteId, { removedAt: new Date().toISOString() }, { ...passedOn(options), returning: "none" });
  }

  /** What the person's bots remember about them in this home, newest first. */
  async function memoriesOf(options) {
    return (await memories.queryAll({ sort: ["-id"] }, passedOn(options))).map((record) => asRow(record, options));
  }

  /** Forgets one of the person's memories in the home; false when it isn't there. */
  async function forgetMemory(memoryId, options) {
    return (await memories.delete(memoryId, { ...passedOn(options), missing: "skip" })) !== null;
  }

  /**
   * A conversation the summary worker names by its id alone (agent-runtime's history and track
   * hooks take no options), read wherever it is, with the options for the rest of that work: its
   * home's. Null when it is gone.
   * @param {string | number} conversationId
   * @returns {Promise<{ conversation: object, options: CallOptions } | null>}
   */
  async function summaryOf(conversationId) {
    const found = await conversations.get(String(conversationId), { fields: [...SUMMARY_FIELDS, "workspaceId"] }, {
      context: systemContext("a conversation's summary is written from its own messages, wherever it is"),
      missing: "skip"
    });
    if (!found) return null;
    const options = { context: systemContext("a conversation's summary is written from its own messages, wherever it is").forWorkspace(found.workspaceId) };
    const { workspaceId: _home, ...conversation } = found;
    return { conversation: asRow(conversation, options), options };
  }

  return Object.freeze({
    withTransaction: conversations.withTransaction,
    asSeen,
    isShared,
    personOf,
    homeOf,
    botOf,
    conversationOf,
    roomsOf,
    roomFor,
    seenBy,
    inGroup,
    ownedBot,
    ownedSingleBot,
    refresh,
    rowOf: rowOfConversation,
    conversationRow,
    groupSeatFor,
    appRoomFor,
    createRoom,
    renameRoom,
    updateConversation,
    seatsOf,
    nextPinPosition,
    reorderPins,
    listBots,
    homeBotsOf,
    botsById,
    lockHome,
    firstBot,
    createBot,
    updateBot,
    clearMainBot,
    deleteBot,
    membersOf,
    groupMembersOf,
    severalBotsIn,
    addGroupMembers,
    removeGroupMember,
    profilesOf,
    namesOf,
    fromOf,
    groupPeople: peopleIdsOf,
    severalPeopleIn,
    peopleOf,
    addGroupPerson,
    removeGroupPerson,
    markRead,
    readsOf,
    everyoneIn,
    isHomeMember,
    sectionsOf,
    lockSections,
    ownedSection,
    insertSection,
    updateSection,
    swapSections,
    deleteSection,
    notesOf,
    noteOf,
    removeNote,
    memoriesOf,
    forgetMemory,
    summaryOf
  });
}

/** Pure parts the tests reach directly. */
export const __testables = Object.freeze({ asSeen, isShared });
