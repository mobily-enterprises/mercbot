import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { registerRoutes as registerComputerRoutes } from "../../packages/computer/src/server/registerRoutes.js";
import { registerRoutes as registerFileRoutes } from "../../packages/files/src/server/registerRoutes.js";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Reads that ask the database for the rows they use, against the disposable test database: a bot's computer in a chat
// reads that bot's seat there, not every chat the bot is in; a bot asking another by name reads that bot; and the
// home's Files page reads the home's bots alone. Each answers as before; its cost is counted as the rows the database
// sends back (a page of n rows reads n + 1, to know whether there are more). The group chats' and the notebook's reads
// went with their tables (D-112).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

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
  const userId = String((await knex("users").orderBy("id").first("id")).id);
  const [home] = await knex("workspaces")
    .insert({ slug: `narrow-${randomBytes(6).toString("hex")}`, name: "Narrow reads", owner_user_id: userId, is_personal: false })
    .returning("id");
  const homeId = String(home.id ?? home);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: userId, role_sid: "owner", status: "active" });
  context.after(async () => {
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId }).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex.destroy();
  });
  const records = await startBotRecords(knex, context);
  const bot = async (fields = {}) =>
    (await knex("bots").insert({ made_by: userId, workspace_id: homeId, name: "Bot", color: "#1E86FC", ...fields }).returning("*"))[0];
  /** `count` public chats the person is in, each with `member` in it: the chats' ids, one many-row write per table. */
  const chatsWith = async (member, count) => {
    const chats = (await knex("conversations")
      .insert(Array.from({ length: count }, (_, index) => ({ workspace_id: homeId, kind: "public", title: `Chat ${index}`, made_by: userId })))
      .returning("id")).map((row) => String(row.id ?? row));
    await knex("chat_people").insert(chats.map((id) => ({ workspace_id: homeId, conversation_id: id, user_id: userId })));
    await knex("chat_bots").insert(chats.map((id) => ({ workspace_id: homeId, conversation_id: id, bot_id: member.id, position: 0 })));
    return chats;
  };
  return { knex, records, options: memberOptions({ userId, homeId }), bot, chatsWith };
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

test("a bot's computer in a chat is found by its seat there, reading that seat and not every chat the bot is in", async (context) => {
  const { knex, records, options, bot, chatsWith } = await setup(context);
  const busy = await bot({ name: "Busy" });
  const other = await bot({ name: "Other" });
  const chats = await chatsWith(busy, 30);
  const [elsewhere] = await chatsWith(other, 1);
  const status = routeOf(
    (http) => registerComputerRoutes(http, {
      computer: { status: async (computerId) => ({ state: "asleep", computerId }) },
      files: {},
      records,
      streams: new Set()
    }),
    "GET /api/w/:workspaceSlug/bots/:botId/computer",
    options
  );
  const asked = (chat, botId = busy.id) => status({ botId: String(botId) }, chat === undefined ? {} : { chat });
  const seatIn = async (chatId) => String((await knex("chat_bots").where({ conversation_id: chatId, bot_id: busy.id }).first("id")).id);

  let found = null;
  const rows = await rowsFrom(knex, "chat_bots", async () => (found = (await asked(chats[17])).body?.computerId));
  assert.equal(found, await seatIn(chats[17]), "the bot's computer in the chat asked for");
  assert.ok(rows >= 2 && rows <= 4, `the seat, found and then read, not the bot's 30: ${rows} rows`);
  // A chat that isn't one of this bot's is refused, never another of its computers instead (D-99), and so is no chat.
  assert.equal((await asked(elsewhere)).status, 404, "another bot's chat has no computer of this bot");
  assert.equal((await asked(elsewhere, other.id)).body?.computerId, String((await knex("chat_bots").where({ conversation_id: elsewhere }).first("id")).id));
  assert.equal((await asked("not-a-chat")).status, 404);
  assert.equal((await asked(undefined)).status, 404, "a computer is its bot's in one chat: the chat is named");
});

test("a bot asking another by name reads that bot, in any case, never itself", async (context) => {
  const { knex, records, options, bot } = await setup(context);
  for (let index = 0; index < 30; index += 1) await bot({ name: `Filler ${index}` });
  // A home's 34 bots, the one asked for among them.
  const asker = await bot({ name: "Planner" });
  const twin = await bot({ name: "planner" });
  const builder = await bot({ name: "Builder", color: "#E5484D" });
  const solo = await bot({ name: "Solo" });

  let found = null;
  const rows = await rowsFrom(knex, "bots", async () => (found = await records.directory.botNamed("  bUILDER ", options, { except: asker.id })));
  assert.deepEqual([found?.id, found?.name, found?.color], [String(builder.id), "Builder", "#E5484D"]);
  assert.ok(rows >= 1 && rows <= 3, `the bot asked for, not the home's 35 bots: ${rows} rows`);
  assert.equal((await records.directory.botNamed("PLANNER", options, { except: asker.id }))?.id, String(twin.id), "a namesake, never the asker");
  assert.equal((await records.directory.botNamed("Planner", options, { except: twin.id }))?.id, String(asker.id));
  assert.equal(await records.directory.botNamed("solo", options, { except: solo.id }), null, "only the asker has that name");
  assert.equal(await records.directory.botNamed("Nobody", options, { except: asker.id }), null);
});

test("the home's Files page lists the home's bots alone, with how they look, in one read", async (context) => {
  const { knex, records, options, bot, chatsWith } = await setup(context);
  const made = [await bot({ name: "Ada", color: "#E5484D" }), await bot({ name: "Bo" })];
  for (const member of made) await chatsWith(member, 3);
  const homeBots = routeOf(
    (http) => registerFileRoutes(http, { files: { store: {}, apps: {}, storage: {} }, records, uploads: {} }),
    "GET /api/w/:workspaceSlug/files/bots",
    options
  );
  let answer = null;
  const statements = await queriesDuring(knex, async () => (answer = await homeBots({})));
  assert.deepEqual(answer.body, { bots: made.map((row) => ({ id: String(row.id), name: row.name, color: row.color, shape: row.shape })) });
  assert.equal(statements, 1, "the bots, without their chats, seats or previews");
});
