import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { seedChat, seedMessage } from "../../support/chatFixtures.mjs";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { bootServer, signUp } from "./http.mjs";
import { forget, seedHome } from "./seed.mjs";

// Search (D-36, D-46) on chats (D-112), over HTTP: a person finds messages in the home's chats they can open: every
// Public one and a Private one only while they are in it (a person's chat with a bot is Private, theirs alone); never
// an archived chat or anything of another home, and someone outside the home is answered as a home that isn't there.

let app;
let knex;
let pat;
let kim;
let sam;
let homeA;
let homeB;
let plans;
// One word that only these messages hold.
const word = `zq${randomUUID().slice(0, 8)}`;
const found = {};

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  kim = await signUp(app, knex, "kim");
  sam = await signUp(app, knex, "sam");
  homeA = await seedHome(knex, pat.id, [kim.id]);
  homeB = await seedHome(knex, sam.id, [kim.id]);
  const botIn = async (home, makerId, name) => String((await knex("bots")
    .insert({ workspace_id: home.id, made_by: makerId, name, color: "#1E86FC", library_template: "general" }).returning("id"))[0].id);
  const chef = await botIn(homeA, pat.id, "Chef");
  const other = await botIn(homeB, sam.id, "Other");
  const kitchen = await seedChat(knex, { homeId: homeA.id, title: "Kitchen", people: [pat.id, kim.id], bots: [chef] });
  plans = await seedChat(knex, { homeId: homeA.id, kind: "private", title: "Pat's plans", people: [pat.id], bots: [chef] });
  const kimsDirect = await seedChat(knex, { homeId: homeA.id, direct: { userId: kim.id, botId: chef } });
  const old = await seedChat(knex, { homeId: homeA.id, title: "Old", people: [pat.id, kim.id], bots: [chef] });
  await knex("conversations").where({ id: old.id }).update({ archived_at: new Date() });
  const kimsInB = await seedChat(knex, { homeId: homeB.id, direct: { userId: kim.id, botId: other } });
  const say = (home, chat, text, author) => seedMessage(knex, { homeId: home.id, chatId: chat.id, body: { text }, ...author });
  found.kitchen = await say(homeA, kitchen, `The kitchen's ${word}`, { userId: pat.id });
  found.plans = await say(homeA, plans, `Pat's plans ${word}`, { userId: pat.id });
  found.kims = await say(homeA, kimsDirect, `Kim's own ${word}`, { userId: kim.id });
  found.old = await say(homeA, old, `The archived ${word}`, { userId: pat.id });
  found.kimsInB = await say(homeB, kimsInB, `Kim's own in B ${word}`, { userId: kim.id });
});

after(async () => {
  await app?.close();
  await forget(knex, [homeA, homeB], [pat, kim, sam]);
  await knex?.destroy();
});

async function search(person, home) {
  const answer = await person.get(`${home.url}/search?q=${encodeURIComponent(word)}`);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body;
}

const hits = (result) => result.messages.map((message) => message.id).sort();
const expected = (...names) => names.map((name) => found[name]).sort();

test("a person finds the home's Public chats and their own Private one, never someone else's chat with a bot or an archived one", async () => {
  const result = await search(pat, homeA);
  assert.deepEqual(hits(result), expected("kitchen", "plans"));
  const kitchen = result.messages.find((message) => message.id === found.kitchen);
  assert.deepEqual([kitchen.chatName, kitchen.chatKind, kitchen.authorName, kitchen.text], ["Kitchen", "public", "you", `The kitchen's ${word}`]);
  assert.ok(Array.isArray(result.routines) && Array.isArray(result.files));
});

test("another member finds the Public chats, never a Private chat they aren't in, until they're added to it", async () => {
  assert.deepEqual(hits(await search(kim, homeA)), expected("kitchen", "kims"));
  await knex("chat_people").insert({ conversation_id: plans.id, workspace_id: homeA.id, user_id: kim.id });
  try {
    assert.deepEqual(hits(await search(kim, homeA)), expected("kitchen", "plans", "kims"));
  } finally {
    await knex("chat_people").where({ conversation_id: plans.id, user_id: kim.id }).del();
  }
  assert.deepEqual(hits(await search(kim, homeA)), expected("kitchen", "kims"), "and not once out of it");
});

test("each home's search finds only that home's messages", async () => {
  assert.deepEqual(hits(await search(kim, homeB)), expected("kimsInB"), "Kim in B finds only her chat in B");
  assert.deepEqual(hits(await search(sam, homeB)), [], "it's Kim's own chat with a bot, so Sam finds nothing");
  const outside = await sam.get(`${homeA.url}/search?q=${encodeURIComponent(word)}`);
  assert.equal(outside.status, 404, `someone outside A is answered as a home that isn't there: ${JSON.stringify(outside.body)}`);
});
