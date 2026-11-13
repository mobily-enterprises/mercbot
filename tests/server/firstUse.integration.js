import assert from "node:assert/strict";
import test from "node:test";
import { startBotRecordsForChecks } from "../support/botRecords.mjs";
import { statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";

// Rows made on first use (a person's seat with a bot, a member bot's computer for a group, a shared
// bot's room for an app) are upserts on their unique keys: several first uses
// at once make one row, every caller gets that row, and no insert fails on the key and has to be run
// again (json-rest-api 3.1 names the plain unique index on the keys in ON CONFLICT).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const AT_ONCE = 6;

/** What `work` answers, the inserts into `table` it sent, and the statements that failed meanwhile. */
async function watched(knex, table, work) {
  const failed = [];
  const onError = (error, query) => failed.push(`${String(query?.sql || "")}: ${error.message}`);
  knex.on("query-error", onError);
  let answers;
  try {
    const inserts = await statementsDuring(knex, async () => { answers = await work(); }, new RegExp(`^\\s*insert into "${table}"`, "iu"));
    return { answers, inserts: inserts.map((statement) => statement.sql), failed };
  } finally {
    knex.removeListener("query-error", onError);
  }
}

async function botsSetup(context) {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first("id")).id);
  const { records, systemContext } = await startBotRecordsForChecks(knex, context);
  const made = { bots: [], apps: [] };
  // After the records feature stops (its own after hook, added first): the test's rows, then the connection.
  context.after(async () => {
    await knex("bots").whereIn("id", made.bots).del();
    await knex("apps").whereIn("id", made.apps).del();
    await knex.destroy();
  });
  const bot = async (fields) => {
    const row = await testBot(knex, userId, { name: `First ${Date.now().toString(36)}`, ...fields });
    made.bots.push(row.id);
    return row;
  };
  return { knex, userId, records, systemContext, bot, made };
}

test("a person's first look at a bot makes their seat once, however many look at once", async (context) => {
  const { knex, userId, records, systemContext, bot } = await botsSetup(context);
  const scout = await bot();
  await knex("bot_conversations").where({ bot_id: scout.id, user_id: userId }).del();
  const options = { context: systemContext("look at a bot as its person does").forWorkspaceUser(String(scout.workspace_id), userId, { actorId: userId }) };

  const { answers, inserts, failed } = await watched(knex, "bot_conversations", () =>
    Promise.all(Array.from({ length: AT_ONCE }, () => records.conversations.conversationOf(scout, options))));
  const seats = await knex("bot_conversations").where({ bot_id: scout.id, user_id: userId });
  assert.equal(seats.length, 1, "one seat");
  assert.deepEqual(new Set(answers.map((seat) => String(seat.id))), new Set([String(seats[0].id)]), "everyone got that seat");
  assert.equal(seats[0].onboarding_step, "intro-greet", "made as a first look makes it");
  assert.ok(inserts.length >= 1);
  for (const sql of inserts) assert.match(sql, /on conflict \("bot_id", "user_id"\) do nothing/iu, "an upsert on the seat's key");
  assert.deepEqual(failed, [], "no insert failed on the key");

  // Found again: no insert.
  const again = await watched(knex, "bot_conversations", () => records.conversations.conversationOf(scout, options));
  assert.equal(String(again.answers.id), String(seats[0].id));
  assert.deepEqual(again.inserts, []);
});

test("a member bot's computer for a group, and a shared bot's room for an app, are each made once", async (context) => {
  const { knex, userId, records, systemContext, bot, made } = await botsSetup(context);
  const member = await bot();
  const group = await bot({ kind: "group", name: "Planning" });
  const homeId = String(member.workspace_id);
  const forHome = { context: systemContext("run a home's group and app work").forWorkspace(homeId) };

  const groupRow = { id: group.id, name: group.name, user_id: userId, created_by: userId };
  const computers = await watched(knex, "bot_conversations", () =>
    Promise.all(Array.from({ length: AT_ONCE }, () => records.conversations.groupSeatFor(groupRow, member, forHome))));
  const stored = await knex("bot_conversations").where({ bot_id: member.id, group_id: group.id });
  assert.equal(stored.length, 1, "one computer for the group");
  assert.deepEqual(new Set(computers.answers.map((row) => String(row.id))), new Set([String(stored[0].id)]));
  assert.equal(stored[0].title, "Planning");
  for (const sql of computers.inserts) assert.match(sql, /on conflict \("bot_id", "group_id"\) do nothing/iu);
  assert.deepEqual(computers.failed, []);

  const [app] = await knex("apps").insert({ id: `a_first${Date.now()}`.slice(0, 24), workspace_id: homeId, slug: `first-${Date.now()}`, name: "Stock", icon: "apps", color: "#1E5BD8" }).returning("*");
  made.apps.push(app.id);
  await knex("bots").where({ id: member.id }).update({ sharing: "shared" });
  const forPerson = { context: systemContext("open an app's room as its person does").forWorkspaceUser(homeId, userId, { actorId: userId }) };
  const rooms = await watched(knex, "bot_conversations", () =>
    Promise.all(Array.from({ length: AT_ONCE }, () => records.conversations.appRoomFor(member, app, "Stock", forPerson))));
  const appRooms = await knex("bot_conversations").where({ bot_id: member.id, app_id: app.id });
  assert.equal(appRooms.length, 1, "one room for the app");
  assert.deepEqual(new Set(rooms.answers.map((row) => String(row.id))), new Set([String(appRooms[0].id)]));
  for (const sql of rooms.inserts) assert.match(sql, /on conflict \("bot_id", "app_id"\) do nothing/iu);
  assert.deepEqual(rooms.failed, []);

  // The keys allow what they allowed before: any number of rooms with no app, and of rows with no group.
  await knex("bot_conversations").insert([1, 2].map((n) => ({ workspace_id: homeId, bot_id: member.id, title: `Room ${n}` })));
  assert.equal((await knex("bot_conversations").where({ bot_id: member.id }).whereNull("app_id").whereNull("group_id").whereNull("user_id")).length, 2);
});
