import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { seedChat, seedMessage } from "../../support/chatFixtures.mjs";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { bootServer, signUp } from "./http.mjs";
import { forget, seedBot, seedHome } from "./seed.mjs";

// Who sees which bots and chats (D-112), over HTTP, as people see them: a home's bots are everyone's in it; a person's
// chat list is the chats they're in, and the home's Public chats they aren't in are offered to join; a Public chat
// opens for every member and a Private one only for its people, while they're in it; someone outside the home is
// answered as a home that isn't there; and a home's address reaches only that home's chats, even for someone in both.
// Pat owns home A and Kim is a member; Sam owns home B and Kim is a member there too.

let app;
let knex;
let pat;
let kim;
let sam;
let homeA;
let homeB;
const bots = {};
const chats = {};
const notes = {};

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  kim = await signUp(app, knex, "kim");
  sam = await signUp(app, knex, "sam");
  homeA = await seedHome(knex, pat.id, [kim.id]);
  homeB = await seedHome(knex, sam.id, [kim.id]);
  bots.mine = String((await seedBot(knex, homeA, pat.id, { name: "Mine" })).id);
  bots.other = String((await seedBot(knex, homeB, sam.id, { name: "Other" })).id);
  chats.patsDirect = await seedChat(knex, { homeId: homeA.id, direct: { userId: pat.id, botId: bots.mine } });
  chats.kitchen = await seedChat(knex, { homeId: homeA.id, title: "Kitchen", people: [pat.id], bots: [bots.mine] });
  chats.plans = await seedChat(knex, { homeId: homeA.id, kind: "private", title: "Plans", people: [pat.id], bots: [bots.mine] });
  chats.samsDirect = await seedChat(knex, { homeId: homeB.id, direct: { userId: sam.id, botId: bots.other } });
  chats.lounge = await seedChat(knex, { homeId: homeB.id, title: "Lounge", people: [sam.id], bots: [bots.other] });
  const say = (home, chat, text) => seedMessage(knex, { homeId: home.id, chatId: chat.id, body: { text }, userId: home === homeA ? pat.id : sam.id });
  notes.kitchen = await say(homeA, chats.kitchen, "In the kitchen");
  notes.plans = await say(homeA, chats.plans, "Pat's plans");
  notes.samsDirect = await say(homeB, chats.samsDirect, "Sam's own chat");
  notes.lounge = await say(homeB, chats.lounge, "In the lounge");
});

after(async () => {
  await app?.close();
  await forget(knex, [homeA, homeB], [pat, kim, sam]);
  await knex?.destroy();
});

/** A GET that must answer 200, and its body. */
async function read(person, path) {
  const answer = await person.get(path);
  assert.equal(answer.status, 200, `${person.name} ${path}: ${JSON.stringify(answer.body)}`);
  return answer.body;
}

const ids = (rows) => rows.map((row) => String(row.id));
const messageIds = async (person, home, chat) => ids((await read(person, `${home.url}/chats/${chat.id}/messages`)).messages);

test("a home's bots are everyone's in it, and each home's Team list holds only its own", async () => {
  assert.deepEqual(ids((await read(pat, `${homeA.url}/bots`)).bots), [bots.mine]);
  assert.deepEqual(ids((await read(kim, `${homeA.url}/bots`)).bots), [bots.mine], "Kim sees the bot Pat made");
  assert.deepEqual(ids((await read(kim, `${homeB.url}/bots`)).bots), [bots.other], "and in B only B's");
});

test("a person's chats are the ones they're in; the Public ones they aren't in are offered to join, never a Private one", async () => {
  const patsList = ids((await read(pat, `${homeA.url}/chats`)).chats);
  for (const name of ["patsDirect", "kitchen", "plans"]) assert.ok(patsList.includes(chats[name].id), `Pat's list has ${name}`);
  const kitchen = (await read(pat, `${homeA.url}/chats`)).chats.find((chat) => chat.id === chats.kitchen.id);
  assert.deepEqual([kitchen.title, kitchen.kind, kitchen.latest?.preview], ["Kitchen", "public", "In the kitchen"]);

  const kimsList = ids((await read(kim, `${homeA.url}/chats`)).chats);
  for (const name of ["patsDirect", "kitchen", "plans"]) assert.ok(!kimsList.includes(chats[name].id), `Kim isn't in ${name}`);
  const offered = ids((await read(kim, `${homeA.url}/chats/public`)).chats);
  assert.ok(offered.includes(chats.kitchen.id), "Kim is offered the Kitchen");
  assert.ok(!offered.includes(chats.plans.id), "never Pat's Private chat");
});

test("a Public chat opens for every member; a Private one only for its people, while they're in it", async () => {
  const kitchen = (await read(kim, `${homeA.url}/chats/${chats.kitchen.id}`)).chat;
  assert.deepEqual([kitchen.id, kitchen.place], [chats.kitchen.id, null], "the Kitchen opens for Kim, who has no place in it");
  assert.deepEqual(await messageIds(kim, homeA, chats.kitchen), [notes.kitchen], "Kim reads the Kitchen without being in it");

  const refused = async () => {
    for (const path of [`${homeA.url}/chats/${chats.plans.id}`, `${homeA.url}/chats/${chats.plans.id}/messages`]) {
      const answer = await kim.get(path);
      assert.equal(answer.status, 404, `${path}: ${JSON.stringify(answer.body)}`);
      assert.equal(answer.body.code, "bots_chat_not_found");
    }
  };
  await refused();
  await knex("chat_people").insert({ conversation_id: chats.plans.id, workspace_id: homeA.id, user_id: kim.id });
  try {
    assert.ok((await read(kim, `${homeA.url}/chats/${chats.plans.id}`)).chat.place, "Plans opens for Kim once she's in it, with her place");
    assert.deepEqual(await messageIds(kim, homeA, chats.plans), [notes.plans], "and she reads it");
  } finally {
    await knex("chat_people").where({ conversation_id: chats.plans.id, user_id: kim.id }).del();
  }
  await refused();
});

test("someone outside the home is answered as a home that isn't there", async () => {
  const chat = `${homeA.url}/chats/${chats.kitchen.id}`;
  for (const path of [`${homeA.url}/bots`, `${homeA.url}/chats`, chat, `${chat}/messages`]) {
    const answer = await sam.get(path);
    assert.equal(answer.status, 404, `${path}: ${JSON.stringify(answer.body)}`);
  }
});

test("a home's address reaches only its own chats, even for someone in both homes", async () => {
  // There is no cross-home path: another home's chat answers 404 bots_chat_not_found, as one nobody made does.
  const paths = [
    `${homeA.url}/chats/${chats.lounge.id}`,
    `${homeA.url}/chats/${chats.lounge.id}/messages`,
    `${homeB.url}/chats/${chats.kitchen.id}`,
    `${homeB.url}/chats/${chats.kitchen.id}/messages`
  ];
  for (const path of paths) {
    const answer = await kim.get(path);
    assert.equal(answer.status, 404, `${path}: ${JSON.stringify(answer.body)}`);
    assert.equal(answer.body?.code, "bots_chat_not_found", path);
  }
  assert.deepEqual(await messageIds(kim, homeB, chats.lounge), [notes.lounge], "through B's own address, B's Public chat opens");
  // Sam's chat with a bot is Private, his alone, through any address.
  for (const home of [homeA, homeB]) {
    const answer = await kim.get(`${home.url}/chats/${chats.samsDirect.id}/messages`);
    assert.deepEqual([answer.status, answer.body?.code], [404, "bots_chat_not_found"]);
  }
});
