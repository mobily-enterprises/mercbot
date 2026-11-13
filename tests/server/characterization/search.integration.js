import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { bootServer, signUp } from "./http.mjs";
import { addToGroup, forget, insertRows, removeFromGroup, say, seedSeat, seedTwoHomes } from "./seed.mjs";

// Search (D-36, D-46), over HTTP: a person finds messages in their own conversations and in the home's shared
// rooms; a group's room only while they are in the group; never another member's own chat, a member bot's computer for
// a group, or anything of another home.

let app;
let knex;
let pat;
let kim;
let sam;
let seeded;
// One word that only these messages hold.
const word = `zq${randomUUID().slice(0, 8)}`;
const found = {};

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  kim = await signUp(app, knex, "kim");
  sam = await signUp(app, knex, "sam");
  seeded = await seedTwoHomes(knex, { pat, kim, sam });
  const { mine, patsSeat, general, group, other } = seeded;
  const from = (person) => ({ id: person.id, name: person.name });
  found.pats = await say(knex, patsSeat, `Pat's own ${word}`, { role: "user" });
  found.kims = await say(knex, await seedSeat(knex, mine, kim.id), `Kim's own ${word}`, { role: "user" });
  found.room = await say(knex, general, `The room's ${word}`, { role: "user", from: from(pat) });
  found.group = await say(knex, group.room, `The group's ${word}`, { role: "user", from: from(pat) });
  // A member bot's own computer for the group (botConversations.js groupSeatFor): a room-like row, never searched.
  const [computer] = await insertRows(knex, "bot_conversations", {
    bot_id: mine.id,
    group_id: group.group.id,
    user_id: null,
    title: "Group",
    created_by: pat.id
  }, seeded.homeA.id);
  found.computer = await say(knex, computer, `The computer's ${word}`);
  found.kimsInB = await say(knex, await seedSeat(knex, other, kim.id), `Kim's own in B ${word}`, { role: "user" });
});

after(async () => {
  await app?.close();
  await forget(knex, [seeded?.homeA, seeded?.homeB], [pat, kim, sam]);
  await knex?.destroy();
});

async function search(person, home) {
  const answer = await person.get(`${home.url}/search?q=${encodeURIComponent(word)}`);
  assert.equal(answer.status, 200, `${person.name}'s search: ${JSON.stringify(answer.body)}`);
  return answer.body;
}

const hits = (result) => result.messages.map((message) => message.id).sort();
const expected = (...names) => names.map((name) => found[name]).sort();

test("a person finds their own conversation, the home's shared room and their group's room", async () => {
  const result = await search(pat, seeded.homeA);
  assert.deepEqual(hits(result), expected("pats", "room", "group"));
  const room = result.messages.find((message) => message.id === found.room);
  assert.equal(room.conversationId, String(seeded.shared.id), "a hit names its bot as conversationId");
  assert.equal(room.text, `The room's ${word}`);
  assert.ok(Array.isArray(result.routines) && Array.isArray(result.files));
});

test("another member finds their own conversation and the shared room, never Pat's chat or a group they are not in", async () => {
  assert.deepEqual(hits(await search(kim, seeded.homeA)), expected("kims", "room"));
});

test("a group's room is found once the person is in the group", async () => {
  const group = seeded.group.group;
  await addToGroup(knex, group, kim.id, pat.id);
  try {
    assert.deepEqual(hits(await search(kim, seeded.homeA)), expected("kims", "room", "group"));
  } finally {
    await removeFromGroup(knex, group, kim.id);
  }
  assert.deepEqual(hits(await search(kim, seeded.homeA)), expected("kims", "room"), "and not once out of it");
});

test("each home's search finds only that home's messages", async () => {
  assert.deepEqual(hits(await search(kim, seeded.homeB)), expected("kimsInB"), "Kim in B finds only her chat in B");
  assert.deepEqual(hits(await search(sam, seeded.homeB)), [], "Sam finds nothing of Kim's chat with Sam's bot");
  const outside = await sam.get(`${seeded.homeA.url}/search?q=${encodeURIComponent(word)}`);
  assert.equal(outside.status, 403, `someone outside A is refused: ${JSON.stringify(outside.body)}`);
});
