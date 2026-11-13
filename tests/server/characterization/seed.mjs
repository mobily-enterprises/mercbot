import { randomUUID } from "node:crypto";

// Rows the characterization tests write straight to the database, as tests/server/testHome.js does, shaped the way the
// app's own code writes them. The data-access port gave child tables their own workspace_id; a seed fills it wherever
// the column exists.

const homeColumn = new Map(); // table → Promise<boolean>: whether it has a workspace_id column

/**
 * Inserts `rows` into `table` and returns them, each with `workspace_id` set to `workspaceId` when the table has that
 * column and the row doesn't give one.
 * @param {import("knex").Knex} knex
 * @param {string} table
 * @param {object | object[]} rows
 * @param {string | number} workspaceId
 */
export async function insertRows(knex, table, rows, workspaceId) {
  if (!homeColumn.has(table)) homeColumn.set(table, knex.schema.hasColumn(table, "workspace_id"));
  const list = Array.isArray(rows) ? rows : [rows];
  const homed = (await homeColumn.get(table)) ? list.map((row) => ({ workspace_id: workspaceId, ...row })) : list;
  return knex(table).insert(homed).returning("*");
}

/**
 * A home (a JSKIT workspace, D-36) that `ownerId` owns and each of `members` belongs to as a member.
 * @returns {Promise<{ id: string, slug: string, url: string }>} `url` is the start of its routes' paths.
 */
export async function seedHome(knex, ownerId, members = []) {
  const slug = `char-${randomUUID().slice(0, 12)}`;
  const [home] = await knex("workspaces").insert({ slug, name: `Home ${slug}`, owner_user_id: ownerId, is_personal: false }).returning("id");
  await knex("workspace_memberships").insert([
    { workspace_id: home.id, user_id: ownerId, role_sid: "owner", status: "active" },
    ...members.map((userId) => ({ workspace_id: home.id, user_id: userId, role_sid: "member", status: "active" }))
  ]);
  await knex("workspace_settings").insert({ workspace_id: home.id });
  return Object.freeze({ id: String(home.id), slug, url: `/api/w/${slug}` });
}

/** A bot `makerId` made in `home`, with no conversation yet. */
export async function seedBot(knex, home, makerId, fields = {}) {
  const [bot] = await insertRows(knex, "bots", { user_id: makerId, name: "Bot", color: "#1E86FC", ...fields }, home.id);
  return bot;
}

/** A person's own conversation with `bot` (their seat), as a first look at it makes one. */
export async function seedSeat(knex, bot, userId, fields = {}) {
  const [seat] = await insertRows(knex, "bot_conversations", { bot_id: bot.id, user_id: userId, onboarding_step: null, ...fields }, bot.workspace_id);
  return seat;
}

/** A shared bot's room (a tab everyone in the home sees, D-36). */
export async function seedRoom(knex, bot, title, createdBy) {
  const [room] = await insertRows(knex, "bot_conversations", { bot_id: bot.id, user_id: null, title, created_by: createdBy }, bot.workspace_id);
  return room;
}

/**
 * A group chat as createGroup (packages/bots/src/server/botGroups.js) makes one: a bot of kind "group", its maker its
 * first person, the maker's seat on it, its one room ("Group") that the seat has open, and `members` (bots) in order.
 */
export async function seedGroup(knex, home, makerId, members, name = "Group chat") {
  const group = await seedBot(knex, home, makerId, { kind: "group", name, color: "#000000", shape: "cloud" });
  await insertRows(knex, "bot_group_people", { group_id: group.id, user_id: makerId, added_by: makerId }, home.id);
  const room = await seedRoom(knex, group, "Group", makerId);
  const seat = await seedSeat(knex, group, makerId, { room_id: room.id });
  await insertRows(knex, "bot_group_members", members.map((bot, position) => ({ group_id: group.id, bot_id: bot.id, position })), home.id);
  return { group, room, seat };
}

/** Puts a person in a group (D-46), as Details' "add" does. */
export async function addToGroup(knex, group, userId, addedBy) {
  await insertRows(knex, "bot_group_people", { group_id: group.id, user_id: userId, added_by: addedBy }, group.workspace_id);
}

/** Takes a person out of a group, and drops the seat their visits made. */
export async function removeFromGroup(knex, group, userId) {
  await knex("bot_group_people").where({ group_id: group.id, user_id: userId }).del();
  await knex("bot_conversations").where({ bot_id: group.id, user_id: userId }).del();
}

/**
 * A text message in a conversation (a seat or a room), and its id.
 * @param {{ id: string, bot_id: string, workspace_id: string }} conversation
 */
export async function say(knex, conversation, text, { role = "bot", from = null } = {}) {
  const body = { text, ...(from ? { from } : {}) };
  const [message] = await insertRows(knex, "bot_messages", { bot_id: conversation.bot_id, conversation_id: conversation.id, kind: "text", role, body }, conversation.workspace_id);
  return String(message.id);
}

/**
 * The two homes most files use. Pat owns A and Kim is a member; Sam owns B and Kim is a member there too, so Kim is in
 * both and Sam is outside A. In A: Pat's bot "Mine" with Pat's seat; a shared bot with the rooms General and Plan B;
 * Pat's group chat with Mine in it. In B: Sam's bot "Other" with Sam's seat.
 * @param {import("knex").Knex} knex
 * @param {{ pat: { id: string }, kim: { id: string }, sam: { id: string } }} people
 */
export async function seedTwoHomes(knex, { pat, kim, sam }) {
  const homeA = await seedHome(knex, pat.id, [kim.id]);
  const homeB = await seedHome(knex, sam.id, [kim.id]);
  const mine = await seedBot(knex, homeA, pat.id, { name: "Mine" });
  const patsSeat = await seedSeat(knex, mine, pat.id);
  const shared = await seedBot(knex, homeA, pat.id, { name: "Shared", sharing: "shared" });
  const general = await seedRoom(knex, shared, "General", pat.id);
  const planB = await seedRoom(knex, shared, "Plan B", pat.id);
  const group = await seedGroup(knex, homeA, pat.id, [mine]);
  const other = await seedBot(knex, homeB, sam.id, { name: "Other" });
  const samsSeat = await seedSeat(knex, other, sam.id);
  return { homeA, homeB, mine, patsSeat, shared, general, planB, group, other, samsSeat };
}

/**
 * Removes what a file made: its homes (everything in them goes with them, every foreign key to a home cascades) and the
 * people it signed up (their own homes, sessions and accounts cascade the same way).
 * @param {import("knex").Knex | undefined} knex
 * @param {Array<{ id: string } | undefined>} homes
 * @param {Array<{ id: string } | undefined>} people
 */
export async function forget(knex, homes, people) {
  if (!knex) return;
  const homeIds = homes.filter(Boolean).map((home) => home.id);
  const userIds = people.filter(Boolean).map((person) => person.id);
  if (homeIds.length) await knex("workspaces").whereIn("id", homeIds).del();
  if (userIds.length) await knex("users").whereIn("id", userIds).del();
}
