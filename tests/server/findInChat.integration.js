import assert from "node:assert/strict";
import test, { after } from "node:test";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// Find in chat past the pages the page has read, on chats (D-112): the records count, on the server, how many times
// the words appear before the oldest message the page has, and name the newest and oldest message holding them, so the
// page brings older pages down only to the match the person goes to. A chat's row policy decides whose they are: a
// private chat's people only, never another home's. The route's own checks (GET /chats/:chatId/find: a place that is
// no message, words too long) are the chat's, proved with it.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const word = "zqfind";

test("the matches before a message: each one counted, in any case, with the newest and oldest; a wildcard is a character", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, ben, as, bot } = await seedHome(knex, context);
  const chef = await bot("Chef");
  const kitchen = await seedChat(knex, { homeId, title: "Kitchen", people: [anna, ben], bots: [chef] });
  const say = (text, author = { botId: chef }) => seedMessage(knex, { homeId, chatId: kitchen.id, body: { text }, ...author });
  const first = await say(`${word} at the start, and ${word.toUpperCase()} again`);
  const percent = await say("100% sure");
  const second = await say(`Then ${word}`, { userId: ben });
  const last = await say(`The newest ${word}`);
  const find = (text, before, person = "anna") => kit.records.messages.findBefore(kitchen.id, text, before, as(person));

  assert.deepEqual(await find(word, last), { count: 3, newest: second, oldest: first });
  assert.deepEqual(await find(word.toUpperCase(), second, "ben"), { count: 2, newest: first, oldest: first });
  assert.deepEqual(await find(word, first), { count: 0, newest: null, oldest: null });
  assert.deepEqual(await find("%", last), { count: 1, newest: percent, oldest: percent }, "a wildcard is a character");
});

test("a private chat's words are found by its people only, and no home finds another's", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, as, bot } = await seedHome(knex, context);
  const chef = await bot("Chef");
  const secret = await seedChat(knex, { homeId, kind: "private", title: "Surprise", people: [anna], bots: [chef] });
  const said = await seedMessage(knex, { homeId, chatId: secret.id, userId: anna, body: { text: `The party ${word}` } });
  const last = await seedMessage(knex, { homeId, chatId: secret.id, userId: anna, body: { text: "Shh" } });
  const none = { count: 0, newest: null, oldest: null };
  assert.deepEqual(await kit.records.messages.findBefore(secret.id, word, last, as("anna")), { count: 1, newest: said, oldest: said });
  assert.deepEqual(await kit.records.messages.findBefore(secret.id, word, last, as("ben")), none, "Ben isn't in it");

  const elsewhere = await seedHome(knex, context, { name: "Elsewhere" });
  assert.deepEqual(await kit.records.messages.findBefore(secret.id, word, last, elsewhere.as("anna")), none, "Anna in another home");
});
