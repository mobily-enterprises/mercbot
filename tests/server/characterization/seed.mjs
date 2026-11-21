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

/** A bot `makerId` made in `home`, in no chat yet (a chat's own tests seed it with tests/support/chatFixtures.mjs). */
export async function seedBot(knex, home, makerId, fields = {}) {
  const [bot] = await insertRows(knex, "bots", { made_by: makerId, name: "Bot", color: "#1E86FC", ...fields }, home.id);
  return bot;
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
