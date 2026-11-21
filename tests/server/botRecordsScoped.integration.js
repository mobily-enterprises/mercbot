import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { expectFlatQueries, expectScoped } from "@jskit-ai/resource-runtime/test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecordsForChecks } from "../support/botRecords.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";

// The bots' reads stay in the request's home (D-112). The same person is a member of two homes, each with a bot of the
// same name in a chat of the same name that was told the same words, so only ownership tells them apart. The Team
// list, the chat list, a chat's messages, search and the directory the other features read answer the same in home A
// whatever home B holds (expectScoped), and a bot, chat or seat of B is not found from A by its id. The Team list and
// the chat list send as many statements for 10 bots in 10 chats as for 200 (expectFlatQueries). A read point is a bigint
// read back as the id it was written.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const WORDS = "scoped-words";

async function setup(context) {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first()).id);
  const homes = [];
  context.after(async () => {
    if (homes.length) await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  const { records, handles, systemContext } = await startBotRecordsForChecks(knex, context);
  const bots = createBotsService(serviceDoubles({ records, systemContext }));

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

  /** The person's bot in the home, in a chat of theirs told WORDS: the bot's id, the chat's and the bot's seat there. */
  async function seedBot(home) {
    const [bot] = await knex("bots").insert({ workspace_id: home.homeId, made_by: userId, name: "Scoped", color: "#1E86FC" }).returning("id");
    const botId = String(bot.id);
    const { chat } = await bots.chats.create({ title: "Scoped", bots: [botId] }, home.options);
    await records.messages.append(chat.id, [{ role: "user", kind: "text", body: { text: `Remember the ${WORDS}` } }], home.options);
    const seat = await records.directory.chatBotOf(botId, chat.id, home.options);
    return { botId, chatId: String(chat.id), chatBotId: String(seat.id) };
  }

  /** `count` bots in the home, each in a chat of its own with the person: one many-row write per table. */
  async function seedChats(home, count) {
    const made = await knex("bots")
      .insert(Array.from({ length: count }, (_, index) => ({ workspace_id: home.homeId, made_by: userId, name: `Many ${index}`, color: "#1E86FC" })))
      .returning("id");
    const chats = await knex("conversations")
      .insert(made.map((_, index) => ({ workspace_id: home.homeId, kind: "public", title: `Chat ${index}`, made_by: userId })))
      .returning("id");
    await knex("chat_people").insert(chats.map((chat) => ({ workspace_id: home.homeId, conversation_id: chat.id, user_id: userId })));
    await knex("chat_bots").insert(chats.map((chat, index) => ({ workspace_id: home.homeId, conversation_id: chat.id, bot_id: made[index].id, position: 0 })));
    return chats.map((chat) => String(chat.id));
  }

  return { knex, records, handles, systemContext, bots, newHome, seedBot, seedChats };
}

test("the Team list, the chat list, a chat, search and the directory read only the request's home", async (context) => {
  const { records, handles, systemContext, bots, newHome, seedBot } = await setup(context);
  const seeded = new Map();
  const seed = async (home) => seeded.set(home, await seedBot(home));
  const touched = [handles.bots, handles.conversations, handles.chatPeople, handles.chatBots, handles.messages];
  // Two new homes each time: the path is run as the first, with the second's rows there or not (expectScoped).
  const scoped = async (run) => {
    seeded.clear();
    const owners = [await newHome(), await newHome()];
    const answer = await expectScoped({ environment: process.env, handles: touched, systemContext: systemContext("read back every home's bots"), owners, seed, run });
    return { answer, mine: seeded.get(owners[0]), theirs: seeded.get(owners[1]), home: owners[0] };
  };

  const team = await scoped(async (home) => (await bots.listBots(home.options)).bots.map((bot) => [bot.id, bot.name]));
  assert.deepEqual(team.answer, [[team.mine.botId, "Scoped"]]);

  const list = await scoped(async (home) => (await bots.chats.list({}, home.options)).chats.map((chat) => [chat.id, chat.title, chat.latest?.preview]));
  assert.deepEqual(list.answer, [[list.mine.chatId, "Scoped", `Remember the ${WORDS}`]]);

  // The cursor is the database's snapshot horizon, which moves on; the messages are the home's.
  const chat = await scoped(async (home) => (await bots.chat.messages(seeded.get(home).chatId, {}, home.options)).messages.map((message) => [message.id, message.kind]));
  assert.ok(chat.answer.some(([, kind]) => kind === "text"));

  const found = await scoped(async (home) => (await bots.search(WORDS, home.options)).messages.map((message) => message.id));
  assert.equal(found.answer.length, 1, "the home's own message only");

  const directory = await scoped(async (home) => ({
    bots: await records.directory.listHomeBots(home.options),
    seats: await records.directory.seatsOfBot(seeded.get(home).botId, home.options)
  }));
  const { mine, theirs, home } = directory;
  assert.deepEqual(directory.answer, { bots: [{ id: mine.botId, name: "Scoped", archived: false }], seats: [{ id: mine.chatBotId, chatId: mine.chatId }] });

  // By id: another home's bot, chat and seat are not found from this one, and a route's guard says so.
  assert.equal((await records.directory.findBot(mine.botId, home.options))?.name, "Scoped");
  assert.equal(await records.directory.findBot(theirs.botId, home.options), null);
  assert.equal(await records.chats.find(theirs.chatId, home.options), null);
  assert.equal(await records.directory.chatBotOf(theirs.botId, theirs.chatId, home.options), null);
  assert.deepEqual(await records.directory.seatsOfBot(theirs.botId, home.options), []);
  assert.equal(await records.directory.computerOf(theirs.chatBotId, home.options), null);
  assert.deepEqual(await records.directory.computerOf(mine.chatBotId, home.options), {
    chatBotId: mine.chatBotId,
    chatId: mine.chatId,
    chatKind: "public",
    botId: mine.botId,
    botName: "Scoped",
    workspaceId: home.homeId
  });
  await assert.rejects(bots.chat.messages(theirs.chatId, {}, home.options), (error) => error.statusCode === 404);
  await assert.rejects(bots.listedBot(theirs.botId, home.options), /not found/iu);
});

test("the Team list and the chat list cost as many statements for 10 bots in 10 chats as for 200", async (context) => {
  const { knex, bots, newHome, seedChats } = await setup(context);
  const homes = new Map();
  const seed = async (size) => {
    const home = await newHome();
    homes.set(size, { home, chatIds: await seedChats(home, size) });
    return homes.get(size);
  };
  await expectFlatQueries({ environment: process.env, knex, seed, run: ({ home }) => bots.listBots(home.options) });
  await expectFlatQueries({ environment: process.env, knex, seed, run: ({ home }) => bots.chats.list({}, home.options) });
  const { home, chatIds } = homes.get(200);
  assert.equal((await bots.listBots(home.options)).bots.length, 200);
  // The list is a page at a time (100): every page, as the page reads them, has all 200.
  const listed = [];
  let after = null;
  do {
    const page = await bots.chats.list({ after }, home.options);
    listed.push(...page.chats.map((chat) => chat.id));
    after = page.next;
  } while (after);
  assert.deepEqual(listed.sort(), [...chatIds].sort());
});

// read_up_to is a PostgreSQL bigint that the generated resource calls an integer, and the driver answers bigint
// as a string. A read point past 2^31 is written and read back as the same id, so unread stays right.
test("a read point is read back as the id it was written, past 2^31 too", async (context) => {
  const { knex, handles, bots, newHome, seedBot } = await setup(context);
  const home = await newHome();
  const { chatId } = await seedBot(home);
  const latest = String((await knex("messages").where({ conversation_id: chatId }).max("id as id").first()).id);
  await bots.chats.markRead(chatId, latest, home.options);
  const { chat } = await bots.chats.get(chatId, home.options);
  assert.equal(chat.place.readUpTo, latest);
  assert.equal(chat.place.unread, false);

  const far = 3_000_000_123;
  await handles.chatPeople.patchWhere({ conversationId: chatId }, { readUpTo: far }, { ...home.job, returning: "none" });
  const stored = await knex("chat_people").where({ conversation_id: chatId }).first("read_up_to");
  assert.equal(String(stored.read_up_to), String(far), "written as the bigint it is");
  assert.equal((await bots.chats.get(chatId, home.options)).chat.place.readUpTo, String(far), "and read back as it was written");
});
