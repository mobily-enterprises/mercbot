import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { bootServer, signUp } from "./characterization/http.mjs";
import { forget, say, seedSeat, seedTwoHomes } from "./characterization/seed.mjs";

// Find in chat past the pages the page has read, over HTTP: GET /bots/:botId/find counts, on the server, how
// many times the words appear before the oldest message the page has, and names the newest and oldest message holding
// them, so the page brings older pages down only to the match the person goes to instead of reading the whole chat.

let app;
let knex;
let pat;
let kim;
let sam;
let seeded;
const word = `zq${randomUUID().slice(0, 8)}`;
const said = {};

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  kim = await signUp(app, knex, "kim");
  sam = await signUp(app, knex, "sam");
  seeded = await seedTwoHomes(knex, { pat, kim, sam });
  const { patsSeat, general, planB } = seeded;
  const from = { id: pat.id, name: pat.name };
  said.first = await say(knex, patsSeat, `${word} at the start, and ${word.toUpperCase()} again`);
  said.percent = await say(knex, patsSeat, "100% sure");
  said.second = await say(knex, patsSeat, `Then ${word}`, { role: "user" });
  said.last = await say(knex, patsSeat, `The newest ${word}`);
  said.room = await say(knex, general, `The room's ${word}`, { role: "user", from });
  said.roomLast = await say(knex, general, "The room's last line", { role: "user", from });
  said.planB = await say(knex, planB, `Plan B's ${word}`, { role: "user", from });
  await seedSeat(knex, seeded.mine, kim.id);
});

after(async () => {
  await app?.close();
  await forget(knex, [seeded?.homeA, seeded?.homeB], [pat, kim, sam]);
  await knex?.destroy();
});

async function find(person, bot, query, { home = seeded.homeA, room = null } = {}) {
  const params = new URLSearchParams({ ...query, ...(room ? { room: String(room.id) } : {}) });
  return person.get(`${home.url}/bots/${bot.id}/find?${params}`);
}

async function found(person, bot, query, where) {
  const answer = await find(person, bot, query, where);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body;
}

test("the matches before the oldest message the page has: each one counted, in any case, with the newest and oldest", async () => {
  const { mine } = seeded;
  assert.deepEqual(await found(pat, mine, { q: word, before: said.last }), { count: 3, newest: said.second, oldest: said.first });
  assert.deepEqual(await found(pat, mine, { q: word.toUpperCase(), before: said.second }), { count: 2, newest: said.first, oldest: said.first });
  assert.deepEqual(await found(pat, mine, { q: word, before: said.first }), { count: 0, newest: null, oldest: null });
  assert.deepEqual(await found(pat, mine, { q: "%", before: said.last }), { count: 1, newest: said.percent, oldest: said.percent }, "a wildcard is a character");
});

test("a shared bot's room is found in its own tab, by everyone in the home, and nowhere else", async () => {
  const { shared, general, mine } = seeded;
  const inRoom = { count: 1, newest: said.room, oldest: said.room };
  assert.deepEqual(await found(pat, shared, { q: word, before: said.roomLast }, { room: general }), inRoom);
  assert.deepEqual(await found(kim, shared, { q: word, before: said.roomLast }, { room: general }), inRoom);
  assert.deepEqual(await found(kim, mine, { q: word, before: said.last }), { count: 0, newest: null, oldest: null }, "Kim's own chat with Pat's bot, never Pat's");
  assert.equal((await find(sam, mine, { q: word, before: said.last })).status, 403, "nor anyone outside the home");
});

test("a place that is no message, or words too long to find, are refused", async () => {
  const { mine } = seeded;
  assert.equal((await find(pat, mine, { q: word, before: "abc" })).status, 400);
  assert.equal((await find(pat, mine, { q: word })).status, 400);
  assert.equal((await find(pat, mine, { q: "x".repeat(201), before: said.last })).status, 400);
});
