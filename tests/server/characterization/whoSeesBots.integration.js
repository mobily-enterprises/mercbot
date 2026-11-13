import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { bootServer, signUp } from "./http.mjs";
import { addToGroup, forget, removeFromGroup, say, seedTwoHomes } from "./seed.mjs";

// Who sees which bots (D-36, D-46), over HTTP, as people see them: everyone in a home sees its bots and talks to each in
// a seat of their own; a shared bot's rooms are everyone's; a group chat is only its people's; someone outside the home
// is refused; and a home's address reaches only that home's bots.

let app;
let knex;
let pat;
let kim;
let sam;
let seeded;
const notes = {};

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  kim = await signUp(app, knex, "kim");
  sam = await signUp(app, knex, "sam");
  seeded = await seedTwoHomes(knex, { pat, kim, sam });
  const { patsSeat, general, planB, group, samsSeat } = seeded;
  notes.pats = await say(knex, patsSeat, "Pat's own chat");
  notes.general = await say(knex, general, "In General");
  notes.planB = await say(knex, planB, "In Plan B");
  notes.group = await say(knex, group.room, "In the group", { role: "user", from: { id: pat.id, name: "Pat" } });
  notes.sams = await say(knex, samsSeat, "Sam's own chat");
});

after(async () => {
  await app?.close();
  await forget(knex, [seeded?.homeA, seeded?.homeB], [pat, kim, sam]);
  await knex?.destroy();
});

async function listed(person, home) {
  const answer = await person.get(`${home.url}/bots`);
  assert.equal(answer.status, 200, `${person.name}'s list: ${JSON.stringify(answer.body)}`);
  return answer.body.bots;
}

const ids = (rows) => rows.map((row) => String(row.id)).sort();
const seats = (bot, person) => knex("bot_conversations").where({ bot_id: bot.id, user_id: person.id });

test("the maker and every other member see the home's bots; a group chat only its people", async () => {
  const { mine, shared, group } = seeded;
  const patsList = await listed(pat, seeded.homeA);
  assert.deepEqual(ids(patsList), ids([mine, shared, group.group]), "Pat sees Mine, Shared and Pat's group chat");
  const patsMine = patsList.find((bot) => bot.id === String(mine.id));
  assert.equal(patsMine.preview, "Pat's own chat", "Pat's preview is Pat's own chat");
  assert.equal(patsMine.onboardingStep, null);
  const patsGroup = patsList.find((bot) => bot.id === String(group.group.id));
  assert.equal(patsGroup.kind, "group");
  assert.deepEqual(patsGroup.members.map((member) => String(member.id)), [String(mine.id)], "the group's bots");
  assert.deepEqual(patsGroup.people.map((person) => person.id), [pat.id], "the group's people");

  const kimsList = await listed(kim, seeded.homeA);
  assert.deepEqual(ids(kimsList), ids([mine, shared]), "Kim sees the home's bots, not Pat's group chat");
  const kimsMine = kimsList.find((bot) => bot.id === String(mine.id));
  assert.equal(kimsMine.preview, "", "nothing from Pat's chat");
  assert.equal(kimsMine.onboardingStep, "intro-greet", "the bot will introduce itself to Kim");
  assert.equal(kimsMine.name, "Mine");
});

test("a member's first look at a bot gives them a seat of their own, once", async () => {
  const { mine } = seeded;
  assert.equal((await seats(mine, kim)).length, 0, "Kim has no seat before opening the bot");
  const opened = await kim.get(`${seeded.homeA.url}/bots/${mine.id}/messages`);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.deepEqual(opened.body.messages, [], "Kim's chat is empty: Pat's is Pat's");
  const made = await seats(mine, kim);
  assert.equal(made.length, 1, "opening the bot made Kim's seat");
  assert.equal(made[0].onboarding_step, "intro-greet");
  assert.equal((await kim.get(`${seeded.homeA.url}/bots/${mine.id}/messages`)).status, 200);
  assert.equal((await seats(mine, kim)).length, 1, "opening it again keeps the one seat");

  const patsChat = await pat.get(`${seeded.homeA.url}/bots/${mine.id}/messages`);
  assert.equal(patsChat.status, 200);
  assert.deepEqual(patsChat.body.messages.map((message) => message.id), [notes.pats], "Pat's chat holds Pat's message");
  const one = await kim.get(`${seeded.homeA.url}/bots/${mine.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.bot.id, String(mine.id), "one bot as the list shows it");
  assert.equal(one.body.bot.preview, "");
});

test("a shared bot's rooms are listed the same for every member, and each member reads them", async () => {
  const { shared, general, planB } = seeded;
  for (const person of [pat, kim]) {
    const entry = (await listed(person, seeded.homeA)).find((bot) => bot.id === String(shared.id));
    assert.deepEqual(entry.rooms.map((room) => [room.id, room.title]), [[String(general.id), "General"], [String(planB.id), "Plan B"]], person.name);
    assert.equal(entry.roomId, String(general.id), `${person.name} has the first room open`);
    const room = await person.get(`${seeded.homeA.url}/bots/${shared.id}/messages?room=${planB.id}`);
    assert.equal(room.status, 200, JSON.stringify(room.body));
    const read = room.body.messages.map((message) => message.id);
    assert.ok(read.includes(notes.planB), `${person.name} reads Plan B`);
    assert.ok(!read.includes(notes.general), "and only Plan B");
  }
});

test("someone outside the home is refused its bots", async () => {
  const { homeA, mine } = seeded;
  for (const path of [`${homeA.url}/bots`, `${homeA.url}/bots/${mine.id}`, `${homeA.url}/bots/${mine.id}/messages`]) {
    const answer = await sam.get(path);
    assert.equal(answer.status, 403, `${path}: ${JSON.stringify(answer.body)}`);
  }
  assert.equal((await seats(mine, sam)).length, 0, "and gets no seat");
});

test("a group chat is found only by the people in it", async () => {
  const { homeA, group } = seeded;
  const groupBot = group.group;
  for (const path of [`${homeA.url}/bots/${groupBot.id}`, `${homeA.url}/bots/${groupBot.id}/messages`]) {
    const answer = await kim.get(path);
    assert.equal(answer.status, 404, `${path}: ${JSON.stringify(answer.body)}`);
    assert.equal(answer.body.code, "bots_bot_not_found");
  }
  assert.equal((await seats(groupBot, kim)).length, 0, "a refused look makes no seat");

  await addToGroup(knex, groupBot, kim.id, pat.id);
  try {
    const one = await kim.get(`${homeA.url}/bots/${groupBot.id}`);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.bot.id, String(groupBot.id));
    const room = await kim.get(`${homeA.url}/bots/${groupBot.id}/messages`);
    assert.equal(room.status, 200, JSON.stringify(room.body));
    assert.ok(room.body.messages.some((message) => message.id === notes.group), "Kim reads the group's room once in it");
    assert.ok(ids(await listed(kim, homeA)).includes(String(groupBot.id)), "and it is in Kim's list");
  } finally {
    await removeFromGroup(knex, groupBot, kim.id);
  }
  const again = await kim.get(`${homeA.url}/bots/${groupBot.id}/messages`);
  assert.equal(again.status, 404, "out of the group, Kim is refused again");
  assert.ok(!ids(await listed(kim, homeA)).includes(String(groupBot.id)));
});

test("another home's bot is not found through this home's address, even for someone in both homes", async () => {
  const { homeA, homeB, mine, other } = seeded;
  // There is no cross-home path: another home's bot answers 404 with code bots_bot_not_found, as a stranger's bot does.
  const paths = [`${homeA.url}/bots/${other.id}`, `${homeA.url}/bots/${other.id}/messages`, `${homeB.url}/bots/${mine.id}`, `${homeB.url}/bots/${mine.id}/messages`];
  const answers = [];
  for (const path of paths) answers.push(await kim.get(path));
  answers.forEach((answer, index) => assert.equal(answer.status, 404, `${paths[index]}: ${JSON.stringify(answer.body)}`));
  assert.equal((await seats(other, kim)).length, 0, "the refused looks make no seat");
  answers.forEach((answer, index) => assert.equal(answer.body?.code, "bots_bot_not_found", `${paths[index]}: ${JSON.stringify(answer.body)}`));
});

test("each home lists and reaches its own bots, for someone in both homes", async () => {
  const { homeB, other } = seeded;
  assert.deepEqual(ids(await listed(kim, homeB)), [String(other.id)], "B lists only B's bots");
  const throughB = await kim.get(`${homeB.url}/bots/${other.id}`);
  assert.equal(throughB.status, 200, "through its own home's address Kim reaches it");
  assert.equal(throughB.body.bot.id, String(other.id));
  assert.equal(throughB.body.bot.preview, "", "nothing from Sam's chat");
  const kimsChat = await kim.get(`${homeB.url}/bots/${other.id}/messages`);
  assert.equal(kimsChat.status, 200, JSON.stringify(kimsChat.body));
  assert.ok(!kimsChat.body.messages.some((message) => message.id === notes.sams), "Kim's chat with Sam's bot is Kim's own");
});
