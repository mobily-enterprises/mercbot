import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { createShellRuns } from "../../packages/files/src/server/shellRuns.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// What a bot does belongs to the bot in a chat (R7, D14): its computer, saved browser and screen tickets, its command
// runs, its watches and app jobs, its routines, its requests and sign-in follow-ups, and the agent engine's reply runs,
// goals and commands are each keyed by its chat_bots row. Two bots in one chat have two of each, the same bot in another
// chat has its own, and a bot leaving a chat takes what it had there and nothing else. On the migrated test database;
// each test makes its own home, so it runs beside any other file.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

// Each carrier and the column that names its bot in a chat.
const CARRIERS = Object.freeze([
  ["bot_computers", "chat_bot_id"],
  ["bot_browser_state", "chat_bot_id"],
  ["computer_tickets", "chat_bot_id"],
  ["shell_runs", "chat_bot_id"],
  ["app_watches", "chat_bot_id"],
  ["app_jobs", "chat_bot_id"],
  ["bot_routines", "chat_bot_id"],
  ["bot_requests", "from_chat_bot_id"],
  ["connect_follow_ups", "chat_bot_id"],
  ["agent_runs", "conversation_id"],
  ["agent_goals", "conversation_id"],
  ["agent_commands", "conversation_id"]
]);

test("every carrier of a bot's work is keyed by the bot in its chat, and goes with it", async () => {
  const { rows } = await knex.raw(`
    select c.conrelid::regclass::text as "table", a.attname as "column", c.confrelid::regclass::text as "references", c.confdeltype as "onDelete"
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.confrelid = 'chat_bots'::regclass`);
  const keys = new Map(rows.map((row) => [`${row.table}.${row.column}`, row]));
  for (const [table, column] of CARRIERS) {
    const key = keys.get(`${table}.${column}`);
    assert.ok(key, `${table}.${column} references chat_bots`);
    assert.equal(key.onDelete, "c", `${table}.${column} is ON DELETE CASCADE`);
  }
  // A bot has one computer in each chat: the computer's key is its bot's seat.
  const [primary] = (await knex.raw(`
    select a.attname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'p' and c.conrelid = 'bot_computers'::regclass`)).rows;
  assert.equal(primary.attname, "chat_bot_id");
  // The old keys are gone: nothing is keyed by a bot alone, or by a whole chat, where its bot in the chat is meant.
  const columns = async (table) => new Set(await knex("information_schema.columns").where({ table_schema: "public", table_name: table }).pluck("column_name"));
  for (const [table, gone] of [["bot_computers", ["conversation_id"]], ["bot_browser_state", ["conversation_id"]], ["computer_tickets", ["conversation_id"]],
    ["shell_runs", ["bot_id", "conversation_id"]], ["app_watches", ["bot_id", "conversation_id"]], ["app_jobs", ["conversation_id"]]]) {
    const has = await columns(table);
    for (const column of gone) assert.equal(has.has(column), false, `${table}.${column} is gone`);
  }
});

// The carriers the second test seeds a row of for each seat (a request and a follow-up need a whole exchange: the
// catalog check above covers their keys).
const SEEDED = CARRIERS.filter(([table]) => table !== "bot_requests" && table !== "connect_follow_ups");

/**
 * A home with Anna and Ben, Chef and Shopper in Family (public: Anna) and Chef in Plans (private: Anna), each seat with
 * one row of every carrier.
 */
async function home(context) {
  const [anna, ben] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  const [row] = await knex("workspaces").insert({ slug: `keys-${randomBytes(5).toString("hex")}`, name: "Keys", owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert([{ workspace_id: homeId, user_id: anna, role_sid: "owner", status: "active" }, { workspace_id: homeId, user_id: ben, role_sid: "member", status: "active" }]);
  const bot = async (name) => String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC" }).returning("id"))[0].id);
  const chef = await bot("Chef");
  const shopper = await bot("Shopper");
  const family = await seedChat(knex, { homeId, kind: "public", title: "Family", people: [anna], bots: [chef, shopper] });
  const plans = await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna], bots: [chef] });
  const seats = { familyChef: family.chatBotIds.get(chef), familyShopper: family.chatBotIds.get(shopper), plansChef: plans.chatBotIds.get(chef) };
  const botOf = { familyChef: chef, familyShopper: shopper, plansChef: chef };
  const runs = {};
  for (const [name, seat] of Object.entries(seats)) {
    const keyed = { workspace_id: homeId, chat_bot_id: seat };
    await knex("bot_computers").insert({ ...keyed, server_id: "s1", state: "asleep" });
    await knex("bot_browser_state").insert(keyed);
    await knex("computer_tickets").insert({ ...keyed, ticket: `t-${randomBytes(8).toString("hex")}`, expires_at: knex.raw("now() + interval '1 minute'") });
    await knex("app_watches").insert({ ...keyed, created_by: anna, name: `${name} watch`, table_id: "t1", on: "create", instructions: "x", cursor: knex.raw("pg_current_xact_id()") });
    await knex("app_jobs").insert({ ...keyed, kind: "watch", bot_id: botOf[name], title: `${name} job`, prompt: "x" });
    await knex("bot_routines").insert({ ...keyed, made_by: anna, name: `${name} routine`, schedule: "every day", instructions: "x" });
    await knex("agent_runs").insert({ conversation_id: seat, bot_id: botOf[name], user_id: anna });
    await knex("agent_goals").insert({ conversation_id: seat, workspace_id: homeId, bot_id: botOf[name], user_id: anna, objective: `${name}'s goal` });
    await knex("agent_commands").insert({ conversation_id: seat, script: "true", server: "s1" });
    runs[name] = String((await knex("shell_runs").insert({ ...keyed, user_id: anna, script: `echo ${name}`, server: "s1" }).returning("id"))[0].id);
  }
  return { homeId, anna, ben, chef, family, seats, runs };
}

/** How many rows each seeded carrier has for a seat. */
async function rowsOf(seat) {
  const counts = {};
  for (const [table, column] of SEEDED) counts[table] = Number((await knex(table).where({ [column]: seat }).count({ n: "*" }))[0].n);
  return counts;
}

test("two bots in one chat have their own computer and work, and a bot leaving a chat takes only its own there", async (context) => {
  const { files, systemContext } = await startChatRecords(knex, context);
  const { homeId, anna, ben, chef, family, seats, runs } = await home(context);
  const as = (userId) => memberOptions({ userId, homeId });

  // Each seat has its own computer: three rows for two bots, one per bot in each chat it's in (D14).
  const computers = await knex("bot_computers").whereIn("chat_bot_id", Object.values(seats)).pluck("chat_bot_id");
  assert.deepEqual(computers.map(String).sort(), Object.values(seats).sort());
  await assert.rejects(knex("bot_computers").insert({ workspace_id: homeId, chat_bot_id: seats.familyChef, server_id: "s2", state: "asleep" }),
    { constraint: "bot_computers_pkey" }, "a bot has one computer in a chat");

  // A command run is read as its bot's in its chat: by that seat, by someone who can open the chat (R1).
  const shell = createShellRuns({ shellRuns: files.shellRuns, systemContext });
  const output = await shell.commandOutput(runs.familyChef, seats.familyChef, as(ben));
  assert.equal(output?.chatBotId, seats.familyChef, "Ben can open Family, so Chef's command there");
  assert.equal(await shell.commandOutput(runs.familyChef, seats.familyShopper, as(anna)), null, "Shopper's run isn't Chef's");
  assert.equal(await shell.commandOutput(runs.plansChef, seats.plansChef, as(ben)), null, "Ben isn't in Plans");
  assert.equal((await shell.commandOutput(runs.plansChef, seats.plansChef, as(anna)))?.chatBotId, seats.plansChef);
  const begun = await shell.begin(homeId, { chatBotId: seats.familyShopper, userId: anna, why: "list", script: "ls", server: "s1" });
  assert.equal(String(begun.chat_bot_id), seats.familyShopper, "a run begins as its bot's in the chat");

  // Chef leaves Family: what it had there goes, Shopper's there and Chef's in Plans stay.
  const every = (count) => Object.fromEntries(SEEDED.map(([table]) => [table, count]));
  assert.deepEqual(await rowsOf(seats.familyChef), every(1));
  await knex("chat_bots").where({ conversation_id: family.id, bot_id: chef }).del();
  assert.deepEqual(await rowsOf(seats.familyChef), every(0));
  assert.deepEqual(await rowsOf(seats.plansChef), every(1), "Chef's own work in Plans is Plans'");
  assert.deepEqual(await rowsOf(seats.familyShopper), { ...every(1), shell_runs: 2 }, "Shopper's in Family is Shopper's");
});
