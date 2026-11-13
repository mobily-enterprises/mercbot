import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { registerRoutes as registerComputerRoutes } from "../../packages/computer/src/server/registerRoutes.js";
import { registerRoutes as registerFileRoutes } from "../../packages/files/src/server/registerRoutes.js";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Reads that ask the database for the rows they use, against the disposable test database: a shared bot's computer
// reads the room asked for, a bot asking another by name reads that bot, a turn reads the person's three most recent
// group chats, whether a group has several bots or people is counted in the database, the home's Files page reads the home's
// bots alone, and a bot's notebook is read a page at a time. Each answers as before; its cost is counted as the rows the database sends back (a page of n rows
// reads n + 1, to know whether there are more).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const HOUR_MS = 60 * 60 * 1000;

/** How many rows the database sends back, while `work` runs, for the statements that read `table`. */
async function rowsFrom(knex, table, work) {
  const reads = new RegExp(`from "${table}"`, "u");
  let rows = 0;
  const counted = (response, query) => {
    if (reads.test(String(query?.sql || ""))) rows += Array.isArray(response) ? response.length : response?.rows?.length ?? 0;
  };
  knex.on("query-response", counted);
  try {
    await work();
  } finally {
    knex.removeListener("query-response", counted);
  }
  return rows;
}

/** A home of its own the test person owns, their request's options in it, and a way to add bots to it. */
async function setup(context) {
  const knex = await connectTestDatabase();
  const [userId, otherId] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  assert.ok(userId && otherId, "the test database needs two users");
  const [home] = await knex("workspaces")
    .insert({ slug: `narrow-${randomBytes(6).toString("hex")}`, name: "Narrow reads", owner_user_id: userId, is_personal: false })
    .returning("id");
  const homeId = String(home.id ?? home);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: userId, role_sid: "owner", status: "active" });
  context.after(async () => {
    await knex("bots").where({ workspace_id: homeId }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId }).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex.destroy();
  });
  const records = await startBotRecords(knex, context);
  const bot = async (fields = {}) =>
    (await knex("bots").insert({ user_id: userId, workspace_id: homeId, name: "Bot", color: "#1E86FC", ...fields }).returning("*"))[0];
  /** A group chat the person is in, with these member bots. */
  const group = async (name, members, people = [userId]) => {
    const made = await bot({ name, kind: "group" });
    await knex("bot_group_members").insert(members.map((member, position) => ({ workspace_id: homeId, group_id: made.id, bot_id: member.id, position })));
    await knex("bot_group_people").insert(people.map((person) => ({ workspace_id: homeId, group_id: made.id, user_id: person })));
    return made;
  };
  return { knex, records, userId, otherId, homeId, options: memberOptions({ userId, homeId }), bot, group };
}

/** A route registered by `register`, called as a request in the home with `options`: its answer. */
function routeOf(register, key, options) {
  const routes = new Map();
  register({ router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } });
  const handler = routes.get(key);
  assert.ok(handler, `${key} is a route`);
  return async (params, query = {}) => {
    const answer = {};
    const reply = {
      code(status) {
        answer.status = status;
        return reply;
      },
      send(sent) {
        answer.body = sent;
        return reply;
      }
    };
    await handler({ params, query, callOptions: async () => options }, reply);
    return answer;
  };
}

test("a shared bot's computer is found by its room, reading that room and not every room the bot has", async (context) => {
  const { knex, records, userId, homeId, options, bot } = await setup(context);
  const shared = await bot({ name: "Shared", sharing: "shared" });
  const other = await bot({ name: "Other", sharing: "shared" });
  const roomsOf = async (owner, count) =>
    (await knex("bot_conversations").insert(Array.from({ length: count }, (_, index) => ({ workspace_id: homeId, bot_id: owner.id, title: `Room ${index}` }))).returning("id"))
      .map((row) => String(row.id ?? row));
  const rooms = await roomsOf(shared, 30);
  const [elsewhere] = await roomsOf(other, 1);
  // The person's seat with the bot has the tab they last had open.
  const [seat] = await knex("bot_conversations").insert({ workspace_id: homeId, bot_id: shared.id, user_id: userId, room_id: rooms[5] }).returning("id");
  const status = routeOf(
    (http) => registerComputerRoutes(http, {
      computer: { status: async (computerId) => ({ state: "asleep", computerId }) },
      files: {},
      directory: records.directory,
      streams: new Set()
    }),
    "GET /api/w/:workspaceSlug/bots/:botId/computer",
    options
  );
  const computerFor = async (query) => (await status({ botId: String(shared.id) }, query)).body?.computerId;

  let found = null;
  const rows = await rowsFrom(knex, "bot_conversations", async () => (found = await computerFor({ room: rooms[17] })));
  assert.equal(found, rooms[17], "the room asked for");
  assert.ok(rows >= 2 && rows <= 4, `the seat and the room, not the bot's 30 rooms: ${rows} rows`);
  assert.equal(await computerFor({}), rooms[5], "else the tab the person has open");
  assert.equal(await computerFor({ room: elsewhere }), rooms[5], "another bot's room is not this bot's");
  assert.equal(await computerFor({ room: "not-a-room" }), rooms[5]);
  await knex("bot_conversations").where({ id: String(seat.id ?? seat) }).update({ room_id: null });
  assert.equal(await computerFor({}), rooms[0], "else the first room");
});

test("a bot asking another by name reads that bot, in any case, never itself or a group chat", async (context) => {
  const { knex, records, options, bot, group } = await setup(context);
  for (let index = 0; index < 30; index += 1) await bot({ name: `Filler ${index}` });
  // A home's 35 bots and a group chat, where the bot asked for is one.
  const asker = await bot({ name: "Planner" });
  const twin = await bot({ name: "planner" });
  const builder = await bot({ name: "Builder", color: "#E5484D" });
  await group("builder", [builder]);
  const solo = await bot({ name: "Solo" });

  let found = null;
  const rows = await rowsFrom(knex, "bots", async () => (found = await records.directory.botNamed("  bUILDER ", options, { except: asker.id })));
  assert.deepEqual([found?.id, found?.name, found?.color, found?.kind], [String(builder.id), "Builder", "#E5484D", "bot"]);
  assert.ok(rows >= 1 && rows <= 3, `the bot asked for, not the home's 35 bots: ${rows} rows`);
  assert.equal((await records.directory.botNamed("PLANNER", options, { except: asker.id }))?.id, String(twin.id), "a namesake, never the asker");
  assert.equal((await records.directory.botNamed("Planner", options, { except: twin.id }))?.id, String(asker.id));
  assert.equal(await records.directory.botNamed("solo", options, { except: solo.id }), null, "only the asker has that name");
  assert.equal(await records.directory.botNamed("Nobody", options, { except: asker.id }), null);
});

test("a turn reads the person's three most recent group chats from the last 14 days, and no other rows", async (context) => {
  const { knex, records, userId, homeId, options, bot, group } = await setup(context);
  const member = await bot({ name: "Member" });
  // Hours since each group last had news; three are older than 14 days.
  const ages = [5, 1, 9, 3, 7, 2, 20 * 24, 15 * 24, 6, 4, 8, 30 * 24];
  const groups = [];
  for (const [index, hours] of ages.entries()) {
    const made = await group(`Group ${index}`, [member]);
    // A group's own conversation has neither a person nor a group.
    const [room] = await knex("bot_conversations")
      .insert({ workspace_id: homeId, bot_id: made.id, title: "Group", last_activity_at: new Date(Date.now() - hours * HOUR_MS) })
      .returning("id");
    groups.push({ id: String(made.id), name: made.name, hours, conversationId: String(room.id ?? room) });
  }
  const byNews = [...groups].sort((a, b) => a.hours - b.hours);

  let recent = null;
  const rows = await rowsFrom(knex, "bot_conversations", async () => (recent = await records.turns.recentGroupsOf(String(member.id), userId, 3, options)));
  assert.deepEqual(recent, byNews.slice(0, 3).map(({ id, name, conversationId }) => ({ id, name, conversationId })));
  assert.ok(rows >= 3 && rows <= 4, `three rooms read, not the person's 12: ${rows} rows`);
  const all = await records.turns.recentGroupsOf(String(member.id), userId, 20, options);
  assert.deepEqual(all.map((entry) => entry.id), byNews.filter((entry) => entry.hours < 14 * 24).map((entry) => entry.id), "none older than 14 days");
});

test("whether a group has several bots or several people is counted in the database: one row comes back", async (context) => {
  const { knex, records, userId, otherId, options, bot, group } = await setup(context);
  const bots = [];
  for (let index = 0; index < 6; index += 1) bots.push(await bot({ name: `Member ${index}` }));
  const crowded = await group("Crowded", bots, [userId, otherId]);
  const quiet = await group("Quiet", [bots[0]]);
  const { conversations } = records;

  let several = null;
  const rows = await rowsFrom(knex, "bot_group_members", async () => (several = await conversations.severalBotsIn(String(crowded.id), options)));
  assert.equal(several, true);
  assert.equal(rows, 1, `the group's count, not its six bots: ${rows} rows`);
  assert.equal(await conversations.severalBotsIn(String(quiet.id), options), false);
  assert.equal(await conversations.severalPeopleIn(String(crowded.id), options), true);
  assert.equal(await conversations.severalPeopleIn(String(quiet.id), options), false);
});

test("the home's Files page lists the home's bots alone, with how they look, in one read", async (context) => {
  const { knex, records, options, bot, group } = await setup(context);
  const made = [await bot({ name: "Ada", color: "#E5484D" }), await bot({ name: "Bo" })];
  await group("Plans", made);
  const homeBots = routeOf(
    (http) => registerFileRoutes(http, { files: { store: {}, apps: {}, storage: {} }, directory: records.directory, uploads: {} }),
    "GET /api/w/:workspaceSlug/files/bots",
    options
  );
  let answer = null;
  const statements = await queriesDuring(knex, async () => (answer = await homeBots({})));
  assert.deepEqual(answer.body, { bots: made.map((row) => ({ id: String(row.id), name: row.name, color: row.color, shape: row.shape })) });
  assert.equal(statements, 1, "the bots, without seats, rooms, previews or members");
});

test("a bot's notebook is read 50 notes at a time, newest first, each page after the one before", async (context) => {
  const { knex, records, userId, homeId, options, bot } = await setup(context);
  const mixed = await bot({ name: "Mixed", sharing: "mixed" });
  const ids = (await knex("bot_notebook")
    .insert(Array.from({ length: 62 }, (_, index) => ({ workspace_id: homeId, bot_id: mixed.id, text: `Note ${index}`, source_user_id: userId })))
    .returning("id")).map((row) => String(row.id ?? row));
  // A note taken out is never listed.
  await knex("bot_notebook").where({ id: ids[61] }).update({ removed_at: new Date() });
  const newest = [...ids.slice(0, 61)].reverse();

  let first = null;
  const rows = await rowsFrom(knex, "bot_notebook", async () => (first = await records.conversations.notesOf(String(mixed.id), options)));
  assert.deepEqual(first.notes.map((note) => String(note.id)), newest.slice(0, 50));
  assert.equal(first.notes[0].text, "Note 60");
  assert.ok(rows >= 50 && rows <= 51, `one page of the 61 notes: ${rows} rows`);
  assert.ok(first.next, "older notes are on the next page");
  const second = await records.conversations.notesOf(String(mixed.id), options, { after: first.next });
  assert.deepEqual(second.notes.map((note) => String(note.id)), newest.slice(50));
  assert.equal(second.next, null);
});
