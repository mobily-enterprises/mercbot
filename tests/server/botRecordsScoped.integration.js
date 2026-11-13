import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { expectFlatQueries, expectScoped } from "@jskit-ai/resource-runtime/test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecordsForChecks } from "../support/botRecords.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";

// The bots' reads stay in the request's home. The same person is a
// member of two homes, each with a bot of the same name that was told the same words, so only ownership tells them
// apart. The list, a chat, search and the directory the other features read answer the same in home A whatever home
// B holds (expectScoped), and a bot or conversation of B is not found from A by its id. The list and the directory's
// own-seat read send as many statements for 10 bots as for 200 (expectFlatQueries). A read point is a bigint
// read back as the id it was written.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const WORDS = "scoped-words";

async function setup(context) {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first()).id);
  const homes = [];
  context.after(async () => {
    if (homes.length) {
      await knex("bots").whereIn("workspace_id", homes).del();
      await knex("workspace_memberships").whereIn("workspace_id", homes).del();
      await knex("workspaces").whereIn("id", homes).del();
    }
    await knex.destroy();
  });
  const { records, handles, systemContext } = await startBotRecordsForChecks(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, records, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) }));

  /** A home of its own the person belongs to, with their request's options in it. */
  async function newHome() {
    const [row] = await knex("workspaces")
      .insert({ slug: `bots-scoped-${randomBytes(6).toString("hex")}`, name: "Scoped test", owner_user_id: userId, is_personal: false })
      .returning("id");
    const homeId = String(row.id ?? row);
    homes.push(homeId);
    await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: userId, role_sid: "owner", status: "active" });
    return { homeId, options: memberOptions({ userId, homeId }), job: { context: systemContext("seed a bots test's home").forWorkspace(homeId) } };
  }

  /** The person's bot in the home, told WORDS: its id and their seat's. */
  async function seedBot(home) {
    const made = await bots.createBot({ name: "Scoped", color: "#1E86FC" }, home.options);
    await bots.sendMessage(made.id, { text: `Remember the ${WORDS}` }, home.options);
    const seat = await records.directory.seatOf(made.id, home.options);
    return { botId: String(made.id), conversationId: String(seat.id) };
  }

  /** `count` bots in the home, each with the person's seat, written as two many-row writes. */
  async function seedBots(home, count) {
    const ids = await handles.bots.createMany(
      Array.from({ length: count }, (_, index) => ({ userId, name: `Many ${index}`, color: "#1E86FC" })),
      { ...home.job, returning: "ids" }
    );
    await handles.botConversations.createMany(ids.map((botId) => ({ botId: String(botId), userId })), { ...home.job, returning: "none" });
    return ids.map(String);
  }

  return { knex, records, handles, systemContext, bots, userId, newHome, seedBot, seedBots };
}

test("the list, a chat, search and the directory read only the request's home", async (context) => {
  const { records, handles, systemContext, bots, userId, newHome, seedBot } = await setup(context);
  const [a, b] = [await newHome(), await newHome()];
  const seeded = new Map();
  const seed = async (home) => seeded.set(home, await seedBot(home));
  const touched = [handles.bots, handles.botConversations, handles.botMessages, handles.conversationReads, handles.botGroupPeople];
  const scoped = (run) => expectScoped({ environment: process.env, handles: touched, systemContext: systemContext("read back every home's bots"), owners: [a, b], seed, run });

  const listed = await scoped(async (home) => (await bots.listBots(home.options)).bots.map((bot) => [bot.id, bot.name, bot.preview]));
  assert.deepEqual(listed.map(([id, name]) => [id, name]), [[seeded.get(a).botId, "Scoped"]]);

  seeded.clear();
  const [c, d] = [await newHome(), await newHome()];
  const chat = await expectScoped({
    environment: process.env,
    handles: touched,
    systemContext: systemContext("read back every home's bots"),
    owners: [c, d],
    seed,
    // The cursor is the database's snapshot horizon, which moves on; the messages are the home's.
    run: async (home) => (await bots.messages(seeded.get(c).botId, null, {}, home.options)).messages.map((message) => [message.id, message.kind])
  });
  assert.ok(chat.some(([, kind]) => kind === "text"));

  seeded.clear();
  const [e, f] = [await newHome(), await newHome()];
  const found = await expectScoped({
    environment: process.env,
    handles: touched,
    systemContext: systemContext("read back every home's bots"),
    owners: [e, f],
    seed,
    run: async (home) => (await bots.search(WORDS, home.options)).messages.map((message) => message.id)
  });
  assert.equal(found.length, 1, "the home's own message only");

  seeded.clear();
  const [g, h] = [await newHome(), await newHome()];
  const directory = await expectScoped({
    environment: process.env,
    handles: touched,
    systemContext: systemContext("read back every home's bots"),
    owners: [g, h],
    seed,
    run: async (home) => ({
      bots: await records.directory.listHomeBots(home.options),
      seats: await records.directory.ownSingleBotSeatIds(home.options)
    })
  });
  assert.deepEqual(directory, { bots: [{ id: seeded.get(g).botId, name: "Scoped" }], seats: [seeded.get(g).conversationId] });

  // By id: another home's bot and conversation are not found from this one, and a route's guard says so.
  const [mine, theirs] = [seeded.get(g), seeded.get(h)];
  assert.equal((await records.directory.findBot(mine.botId, g.options))?.name, "Scoped");
  assert.equal(await records.directory.findBot(theirs.botId, g.options), null);
  assert.equal(await records.directory.botOwner(theirs.botId, g.options), null);
  assert.equal(await records.directory.seatOf(theirs.botId, g.options), null);
  assert.equal(await records.directory.computerOf(theirs.conversationId, g.options), null);
  assert.deepEqual(await records.directory.computerOf(mine.conversationId, g.options), {
    conversationId: mine.conversationId,
    botId: mine.botId,
    botName: "Scoped",
    botKind: "bot",
    botSharing: "mixed",
    userId,
    groupId: null,
    workspaceId: g.homeId
  });
  await assert.rejects(bots.messages(theirs.botId, null, {}, g.options), (error) => error.code === "bots_bot_not_found");
  await assert.rejects(bots.listedBot(theirs.botId, g.options), /not found/iu);
});

test("the list and the person's own seats cost as many statements for 10 bots as for 200", async (context) => {
  const { knex, records, bots, newHome, seedBots } = await setup(context);
  const homes = new Map();
  const seed = async (size) => {
    const home = await newHome();
    homes.set(size, { home, ids: await seedBots(home, size) });
    return homes.get(size);
  };
  await expectFlatQueries({ environment: process.env, knex, seed, run: ({ home }) => bots.listBots(home.options) });
  await expectFlatQueries({ environment: process.env, knex, seed, run: ({ home }) => records.directory.ownSingleBotSeatIds(home.options) });
  const { home, ids } = homes.get(200);
  assert.equal((await bots.listBots(home.options)).bots.length, 200);
  assert.equal((await records.directory.ownSingleBotSeatIds(home.options)).length, ids.length);
});

// read_up_to is a PostgreSQL bigint that the generated resource calls an integer, and the driver answers bigint
// as a string. A read point past 2^31 is written and read back as the same id, so unread stays right.
test("a read point is read back as the id it was written, past 2^31 too", async (context) => {
  const { knex, handles, bots, newHome, seedBot } = await setup(context);
  const home = await newHome();
  const { botId, conversationId } = await seedBot(home);
  await bots.updateBot(botId, { unread: false }, home.options);
  const latest = String((await knex("bot_messages").where({ conversation_id: conversationId }).max("id as id").first()).id);
  const listed = await bots.listedBot(botId, home.options);
  assert.equal(listed.readUpTo, latest);
  assert.equal(listed.unread, false);

  const far = 3_000_000_123;
  await handles.botConversations.patch(conversationId, { readUpTo: far }, { ...home.job, returning: "none" });
  const stored = await knex("bot_conversations").where({ id: conversationId }).first("read_up_to");
  assert.equal(String(stored.read_up_to), String(far), "written as the bigint it is");
  assert.equal((await bots.listedBot(botId, home.options)).readUpTo, String(far), "and read back as it was written");
});
