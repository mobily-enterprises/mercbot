import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Who may read a chat and what's keyed to it (D-112, records/rowPolicies.js): a person the chats they can open (every
// public chat of their home, and the private chats they're in), a job for a person what that person may, the model's
// reader `readable_from` its chat whoever asked, an anonymous caller nothing. Read through the records the services
// use, and the computers' and personal skills' tables under their own features' policies.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// One connection pool for the file, closed after every test's own cleanup has run.
const knex = await connectTestDatabase();
after(() => knex.destroy());

/**
 * A home with the three test people and two bots, and its chats: Family (public: Anna, Ben), Plans (private: Anna,
 * Ben) and Diary (private: Anna alone), each with both bots, a message, a routine and a computer.
 */
async function rossiHome(knex, context) {
  const people = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.equal(people.length, 3, "the test database needs three users");
  const [anna, ben, carla] = people;
  const [row] = await knex("workspaces").insert({ slug: `rossi-${randomBytes(5).toString("hex")}`, name: "Rossi", owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert(people.map((id, index) => ({ workspace_id: homeId, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
  const bots = [];
  for (const name of ["Chef", "Shopper"]) {
    bots.push(String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC" }).returning("id"))[0].id));
  }
  const chats = {};
  for (const [name, kind, members] of [["Family", "public", [anna, ben]], ["Plans", "private", [anna, ben]], ["Diary", "private", [anna]]]) {
    const chat = await seedChat(knex, { homeId, kind, title: name, people: members, bots });
    const seat = chat.chatBotIds.get(bots[0]);
    await seedMessage(knex, { homeId, chatId: chat.id, userId: anna, body: { text: `said in ${name}` } });
    await knex("bot_routines").insert({ workspace_id: homeId, chat_bot_id: seat, made_by: anna, name: `${name} routine`, schedule: "every day", instructions: "x" });
    await knex("bot_computers").insert({ workspace_id: homeId, chat_bot_id: seat, server_id: "s1", state: "asleep" });
    chats[name] = { id: chat.id, seat };
  }
  await knex("user_skills").insert({ workspace_id: homeId, user_id: anna, name: "Anna's skill", instructions: "x" });
  return { homeId, anna, ben, carla, bots, chats };
}

const ids = (rows) => rows.map((row) => String(row.id)).sort((a, b) => a - b);
const sorted = (...list) => list.map(String).sort((a, b) => a - b);

test("a person reads the chats they can open, and what's in them; nobody else's private chat", async (context) => {
  const { records, computer } = await startChatRecords(knex, context);
  const { homeId, anna, ben, carla, bots, chats } = await rossiHome(knex, context);
  const as = (userId) => memberOptions({ userId, homeId });

  // Anna is in all three; Ben in Family and Plans; Carla in none, but Family is public, so she can open it.
  assert.deepEqual(ids(await records.chats.ofPerson(as(anna))), sorted(chats.Family.id, chats.Plans.id, chats.Diary.id));
  assert.deepEqual(ids(await records.chats.ofPerson(as(ben))), sorted(chats.Family.id, chats.Plans.id));
  assert.ok(await records.chats.find(chats.Family.id, as(carla)), "a public chat is open to everyone in the home");
  assert.equal(await records.chats.find(chats.Plans.id, as(carla)), null);
  assert.equal(await records.chats.find(chats.Diary.id, as(ben)), null, "Anna's own private chat stays hers");
  await assert.rejects(records.chats.get(chats.Diary.id, as(ben)), { statusCode: 404 });
  assert.deepEqual(ids(await records.chats.publicChats(as(carla))), [chats.Family.id], "what Carla may join");

  // What's keyed to a chat follows it: messages, people, bots, routines and its computers (D14).
  assert.equal((await records.messages.timeline(chats.Plans.id, {}, as(carla))).messages.length, 0);
  assert.equal((await records.messages.timeline(chats.Plans.id, {}, as(ben))).messages.length, 1);
  assert.deepEqual(await records.chats.people(chats.Diary.id, as(ben)), []);
  assert.deepEqual(await records.chats.bots(chats.Diary.id, as(ben)), []);
  assert.deepEqual(await records.work.routinesOf(chats.Diary.seat, as(ben)), []);
  assert.equal((await records.work.routinesOf(chats.Family.seat, as(carla))).length, 1);
  const computers = async (userId) => ids(await computer.botComputers.queryAll({}, as(userId)));
  assert.deepEqual(await computers(carla), [chats.Family.seat], "Carla can use the public chat's computer, no other");
  assert.deepEqual(await computers(ben), sorted(chats.Family.seat, chats.Plans.seat));
  assert.equal(await records.directory.computerOf(chats.Diary.seat, as(ben)), null);
  // A bot's seats, and seats by id, only in the chats the caller can open.
  const allSeats = [chats.Family.seat, chats.Plans.seat, chats.Diary.seat];
  assert.deepEqual((await records.directory.seats([...allSeats, "999999999"], as(ben))).map((seat) => seat.chatId), [chats.Family.id, chats.Plans.id]);
  assert.deepEqual(await records.directory.seats([chats.Plans.seat], as(ben)), [{ id: chats.Plans.seat, botId: bots[0], chatId: chats.Plans.id }]);
  assert.deepEqual(await records.directory.seatsOfBot(bots[0], as(ben)), [{ id: chats.Family.seat, chatId: chats.Family.id }, { id: chats.Plans.seat, chatId: chats.Plans.id }]);
  assert.deepEqual((await records.directory.seatsOfBot(bots[0], as(anna))).map((seat) => seat.id), allSeats);
  assert.equal((await records.directory.computerOf(chats.Plans.seat, as(ben))).chatKind, "private");

  // Search reads only what the person may: Ben never finds Diary's words.
  assert.deepEqual((await records.messages.searchText("said in", as(ben))).map((row) => row.body.text).sort(), ["said in Family", "said in Plans"]);
});

test("a job for a person reads what they may; an anonymous caller reads no chat", async (context) => {
  const { records, systemContext } = await startChatRecords(knex, context);
  const { homeId, ben, chats } = await rossiHome(knex, context);
  const forBen = { context: systemContext("work done for Ben").forWorkspaceUser(homeId, ben, { actorId: ben }) };
  assert.equal(await records.chats.find(chats.Diary.id, forBen), null);
  assert.ok(await records.chats.find(chats.Plans.id, forBen));
  const homeJob = { context: systemContext("the home's own work").forWorkspace(homeId) };
  assert.ok(await records.chats.find(chats.Diary.id, homeJob), "work for no one is scoped by its home alone");
  // A sign-in follow-up runs as its person (R4): its start reads who that is.
  const said = await knex("messages").where({ conversation_id: chats.Plans.id }).first("id");
  const [followUp] = await knex("connect_follow_ups").insert({ workspace_id: homeId, message_id: said.id, chat_bot_id: chats.Plans.seat, user_id: ben, plugin_id: "google", status: "ready" }).returning("id");
  assert.equal(String((await records.followUps.startable(String(followUp.id), homeJob)).userId), ben);

  const anonymous = { context: { workspace: { id: homeId }, visibilityContext: { visibility: "workspace", scopeKind: "workspace", scopeOwnerId: homeId } } };
  const seen = await records.chats.find(chats.Family.id, anonymous).catch((error) => ({ refused: error.message }));
  assert.ok(seen === null || seen.refused, "an anonymous caller reads no chat, not even a public one");
});

test("the model's reader reads readable_from its chat, whoever asked, and nothing more", async (context) => {
  const { records, computer, integrations, systemContext } = await startChatRecords(knex, context);
  const { homeId, anna, ben, bots, chats } = await rossiHome(knex, context);
  const reader = (chat, askerId = anna) => ({ context: records.readers.forBot({ homeId, botId: bots[0], chatId: chat.id, askerId }) });

  // From Family (public), Anna's asking doesn't open her private chats: public chats only.
  const fromFamily = reader(chats.Family);
  assert.equal(records.readers.of(fromFamily.context).chatId, chats.Family.id);
  assert.deepEqual(await records.chats.readableFrom(chats.Family.id, fromFamily), [chats.Family.id]);
  assert.equal(await records.chats.find(chats.Plans.id, fromFamily), null);
  assert.equal((await records.messages.timeline(chats.Diary.id, {}, fromFamily)).messages.length, 0);
  assert.deepEqual(await records.work.routinesOf(chats.Plans.seat, fromFamily), []);
  assert.deepEqual(ids(await computer.botComputers.queryAll({}, fromFamily)), [chats.Family.seat]);
  assert.deepEqual(await integrations.userSkills.queryAll({}, fromFamily), [], "a person's own skills aren't read in a public chat");
  assert.deepEqual((await records.messages.searchText("said in", fromFamily)).map((row) => row.body.text), ["said in Family"]);

  // From Plans (Anna and Ben): Family and Plans; not Diary, which Ben can't open.
  const fromPlans = reader(chats.Plans);
  assert.deepEqual((await records.chats.readableFrom(chats.Plans.id, fromPlans)).sort((a, b) => a - b), sorted(chats.Family.id, chats.Plans.id));
  assert.equal(await records.chats.find(chats.Diary.id, fromPlans), null);
  assert.deepEqual(await integrations.userSkills.queryAll({}, fromPlans), [], "nor in a chat someone else can open");

  // From Diary (Anna alone): everything Anna can open in the home, and her own skills.
  const fromDiary = reader(chats.Diary);
  assert.deepEqual((await records.chats.readableFrom(chats.Diary.id, fromDiary)).sort((a, b) => a - b), sorted(chats.Family.id, chats.Plans.id, chats.Diary.id));
  assert.equal((await integrations.userSkills.queryAll({}, fromDiary)).length, 1);

  // Who asked doesn't widen it: Ben asking in Family reads what Anna asking there does.
  assert.deepEqual(await records.chats.readableFrom(chats.Family.id, reader(chats.Family, ben)), [chats.Family.id]);
  // A copy of a reader's context is still that reader (it fails closed), and a reader can't name a made-up chat.
  const copied = { context: { ...fromFamily.context, reason: "a service added to it" } };
  assert.equal(records.readers.of(copied.context).chatId, chats.Family.id);
  assert.equal(await records.chats.find(chats.Diary.id, copied), null);
  assert.throws(() => records.readers.forBot({ homeId, botId: bots[0], chatId: "x", askerId: anna }), /chatId/u);
  // A context made as a reader that lost its reader (rebuilt field by field) reads nothing, never what the asker could.
  const lost = { context: systemContext("the model reads for one bot in one chat").forWorkspaceUser(homeId, anna, { actorId: anna }) };
  assert.equal(records.readers.of(lost.context), null);
  assert.equal(await records.chats.find(chats.Family.id, lost), null);
  assert.deepEqual(await computer.botComputers.queryAll({}, lost), []);
  assert.deepEqual(await integrations.userSkills.queryAll({}, lost), []);
});
