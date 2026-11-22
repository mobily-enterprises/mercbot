import assert from "node:assert/strict";
import test, { after } from "node:test";
import { seedChat } from "../support/chatFixtures.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// A whole bot archived and unarchived (D-108), reworked onto chats as a member of the home who has left (D-112, plan
// 5.1): who may and what's refused, a bot staying a member of its chats and shown as archived, its work paused in every
// chat it's in and its computers put to sleep, the home hearing it, and the Team list's statements however many are
// archived. The turns' pauseWork, which pauses the routines and watches and writes the lines, is proved with the turns.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

test("a bot is archived for everyone and unarchived as it was, by its maker and the home's owners and admins only", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { anna, ben, as, bot } = await seedHome(knex, context);
  const pulse = await bot("Pulse", { made_by: ben });
  const chef = await bot("Chef");
  const other = await seedHome(knex, context);
  const theirs = await other.bot("Theirs");

  await assert.rejects(kit.archive.archiveBot(chef, as("ben")), { statusCode: 403, code: "bots_archive_forbidden" }, "Ben didn't make Chef");
  await assert.rejects(kit.archive.archiveBot(theirs, as("anna")), { statusCode: 404 }, "another home's bot isn't there");

  const archived = (await kit.archive.archiveBot(pulse, as("ben"))).bot;
  assert.ok(archived.archivedAt, "Ben made Pulse, so he archives it");
  assert.equal(archived.archivedBy, "you");
  const seenByAnna = (await kit.botList.listBots(as("anna"))).bots.find((entry) => entry.id === pulse);
  assert.ok(seenByAnna.archivedBy && seenByAnna.archivedBy !== "you", "Anna sees who archived it");
  assert.equal(seenByAnna.canArchive, true, "and, an owner, may unarchive it");
  assert.equal((await kit.botList.listBots(as("ben"))).bots.find((entry) => entry.id === chef).canArchive, false);
  await assert.rejects(kit.settings.updateBot(pulse, { name: "Renamed" }, as("ben")), { statusCode: 409, code: "bots_bot_archived" });

  const heard = kit.calls.told.filter((notice) => notice.event.type === "bot" && notice.event.botId === pulse);
  assert.deepEqual(heard.map((notice) => notice.event.change), ["archived"]);
  assert.deepEqual(heard[0].keys.sort(), [anna, ben].sort(), "everyone in the home hears it");

  const back = (await kit.archive.unarchiveBot(pulse, as("anna"))).bot;
  assert.equal(back.archivedAt, null);
  assert.equal(back.archivedBy, null);
  assert.deepEqual(kit.calls.told.filter((notice) => notice.event.botId === pulse).map((notice) => notice.event.change), ["archived", "unarchived"]);
  await kit.archive.unarchiveBot(pulse, as("anna"));
  assert.equal(kit.calls.told.filter((notice) => notice.event.botId === pulse).length, 2, "unarchiving one that isn't archived tells no one");
});

test("the home's main bot and its Builder aren't archived, each saying what to do first", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { as, bot } = await seedHome(knex, context);
  const main = await bot("Mercbot", { is_main: true });
  const builder = await bot("Builder");
  kit.builder.id = builder;
  await assert.rejects(kit.archive.archiveBot(main, as("anna")), { statusCode: 409, code: "bots_archive_main", message: /Make another bot the main bot in Settings first/u });
  await assert.rejects(kit.archive.archiveBot(builder, as("anna")), { statusCode: 409, code: "bots_archive_builder", message: /Make another bot the Builder in Settings first\./u });
  assert.equal((await kit.botList.listedBot(builder, as("anna"))).isBuilder, true);
});

test("the home's main bot can't be deleted either, even by an owner; another bot can", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { as, bot } = await seedHome(knex, context);
  const main = await bot("Mercbot", { is_main: true });
  const chef = await bot("Chef");
  await assert.rejects(kit.settings.deleteBot(main, as("anna")), { statusCode: 409, code: "bots_main_bot_delete" });
  assert.ok(await knex("bots").where({ id: main }).first(), "the main bot is kept");
  await kit.settings.deleteBot(chef, as("anna"));
  assert.equal(await knex("bots").where({ id: chef }).first(), undefined, "an ordinary bot is deleted");
});

test("archiving pauses its work in every chat it's in, private ones too, and puts its computers to sleep, once", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, ben, as, bot } = await seedHome(knex, context);
  const chef = await bot("Chef");
  const kitchen = await seedChat(knex, { homeId, title: "Kitchen", people: [anna, ben], bots: [chef] });
  const bens = await seedChat(knex, { homeId, kind: "private", title: "Ben's plans", people: [ben], bots: [chef] });
  const annas = await seedChat(knex, { homeId, direct: { userId: anna, botId: chef } });
  const seats = [kitchen, bens, annas].map((chat) => ({ id: chat.chatBotIds.get(chef), chatId: chat.id }));

  await kit.archive.archiveBot(chef, as("anna"));
  assert.deepEqual(kit.calls.paused, [{ seats, text: "Paused while archived" }], "every chat with it, Ben's private one too");
  assert.deepEqual(kit.calls.sleeps, [{ homeId, chatBotIds: seats.map((seat) => seat.id) }], "and each of its computers sleeps");

  // It stays a member of each chat, shown as archived: it has left, and never speaks there (R3).
  const shown = (await kit.chats.get(kitchen.id, as("ben"))).chat.bots;
  assert.deepEqual(shown.map((entry) => [entry.botId, entry.archived]), [[chef, true]]);

  await kit.archive.archiveBot(chef, as("anna"));
  assert.equal(kit.calls.paused.length, 1, "archiving it again pauses nothing more");
  assert.equal(kit.calls.sleeps.length, 1);
});

test("the Team list reads the same statements however many bots are archived", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { ben, as, bot } = await seedHome(knex, context);
  const archive = async (count) => {
    for (let index = 0; index < count; index++) await bot(`Old ${index}`, { archived_at: new Date(), archived_by: ben });
  };
  await archive(2);
  const count = async () => queriesDuring(knex, () => kit.botList.listBots(as("anna")));
  const few = await count();
  await archive(10);
  assert.equal(await count(), few);
  const listed = (await kit.botList.listBots(as("anna"))).bots;
  assert.equal(listed.filter((entry) => entry.archivedAt).length, 12);
  assert.ok(listed.every((entry) => entry.archivedBy && entry.archivedBy !== "you"));
});
