import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The glass wall's canary, records half (D-112, D12, D13; the plan's test 9). Every chat of a home carries a unique
// string in each place a chat keeps something (its messages, a to-do card, a bot's job notes, a routine, a request to
// another bot, a sign-in follow-up, its computer, a command run) and the asker has a personal skill. The model's
// reader for a bot in one chat then reads everything a model-facing read can reach at the records level: every handle
// of the bots' tables, every chat and every bot's seat by id (as a prompt could name any), search, and the computers',
// command runs' and skills' tables under their own features' policies. Exactly the strings D12 grants must come back:
// none from a chat someone in the reading chat can't open, and all from the chats everyone in it can. Step 2 (agent A)
// extends this to the prompts of every R12 path (modelInputs.js) as the turns move onto the reader.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// One connection pool for the file, closed after every test's own cleanup has run.
const knex = await connectTestDatabase();
after(() => knex.destroy());

const CANARY = /CANARY-[a-z]+-[a-z]+/gu;
const BOTS_TABLES = ["conversations", "chatPeople", "chatBots", "messages", "botRequests", "botRoutines", "connectFollowUps"];

/**
 * The Rossi home: Anna, Ben and Carla, Chef and Shopper, and its chats, each with both bots and a canary in every
 * carrier. Family is public, and so is Anna's direct chat with Chef (D15); the rest are private.
 */
async function rossiHome(knex, context) {
  const [anna, ben, carla] = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.ok(carla, "the test database needs three users");
  const [row] = await knex("workspaces").insert({ slug: `glass-${randomBytes(5).toString("hex")}`, name: "Rossi", owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert([anna, ben, carla].map((id, index) => ({ workspace_id: homeId, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
  const bot = async (name) => String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC" }).returning("id"))[0].id);
  const [chef, shopper] = [await bot("Chef"), await bot("Shopper")];

  const chats = {};
  const shapes = {
    family: { kind: "public", people: [anna, ben] },
    direct: { direct: { userId: anna, botId: chef }, bots: [shopper] },
    plans: { kind: "private", people: [anna, ben] },
    diary: { kind: "private", people: [anna] },
    secret: { kind: "private", people: [anna, carla] },
    trio: { kind: "private", people: [anna, ben, carla] }
  };
  for (const [name, shape] of Object.entries(shapes)) {
    const chat = await seedChat(knex, { homeId, title: shape.direct ? null : name, bots: shape.direct ? shape.bots : [chef, shopper], ...shape });
    const seat = chat.chatBotIds.get(chef);
    const people = shape.people ?? [anna];
    const said = (text) => `CANARY-${name}-${text}`;
    await seedMessage(knex, { homeId, chatId: chat.id, userId: people[0], body: { text: said("message") } });
    const todo = await seedMessage(knex, { homeId, chatId: chat.id, kind: "todos", botId: chef, body: { list: seat, items: [{ text: said("todo") }] } });
    await knex("chat_bots").where({ id: seat }).update({ job_notes: JSON.stringify([said("notes")]), waiting_task: said("waiting") });
    await knex("bot_routines").insert({ workspace_id: homeId, chat_bot_id: seat, made_by: people[0], name: said("routine"), schedule: "every day", instructions: said("instructions") });
    await knex("bot_requests").insert({ workspace_id: homeId, user_id: people[0], from_chat_bot_id: seat, to_bot_id: shopper, conversation_id: chat.id, brief: said("request") });
    await knex("connect_follow_ups").insert({ workspace_id: homeId, message_id: todo, chat_bot_id: seat, user_id: people[0], plugin_id: said("followup") });
    await knex("bot_computers").insert({ workspace_id: homeId, chat_bot_id: seat, server_id: "s1", url: `https://example.test/${said("computer")}` });
    await knex("shell_runs").insert({ workspace_id: homeId, chat_bot_id: seat, user_id: people[0], script: `echo ${said("shell")}`, server: "s1" });
    chats[name] = { id: chat.id, seat, people, kind: shape.kind ?? "public" };
  }
  await knex("user_skills").insert({ workspace_id: homeId, user_id: anna, name: "CANARY-anna-skill", instructions: "x" });
  return { homeId, anna, ben, carla, chef, chats };
}

/** The canaries D12 grants a bot in `reading`: public chats', its own, and for a private chat the private chats whose people include all of its people; Anna's skill only in her own private chat. */
function granted(chats, reading) {
  const names = Object.entries(chats).filter(([, chat]) => chat.kind === "public" || chat === reading ||
    (reading.kind === "private" && chat.kind === "private" && reading.people.every((person) => chat.people.includes(person))));
  const strings = new Set();
  for (const [name] of names) for (const carrier of ["message", "todo", "notes", "waiting", "routine", "instructions", "request", "followup", "computer", "shell"]) strings.add(`CANARY-${name}-${carrier}`);
  if (reading.kind === "private" && reading.people.length === 1) strings.add("CANARY-anna-skill");
  return [...strings].sort();
}

/** Everything the reader reaches at the records level, as one string, and the canaries in it. */
async function reached({ records, handles, computer, files, integrations }, chats, options) {
  const read = [];
  const keep = async (work) => read.push(await work.catch((error) => ({ refused: error.statusCode ?? error.message })));
  for (const name of BOTS_TABLES) await keep(handles[name].queryAll({}, options));
  await keep(computer.botComputers.queryAll({}, options));
  await keep(files.shellRuns.queryAll({}, options));
  await keep(integrations.userSkills.queryAll({}, options));
  const planning = records.turns.planning(options);
  for (const chat of Object.values(chats)) {
    await keep(records.chats.readableFrom(chat.id, options));
    await keep(records.chats.find(chat.id, options));
    await keep(records.messages.timeline(chat.id, {}, options));
    await keep(records.turns.messages(chat.id, {}, {}, options));
    await keep(records.chats.people(chat.id, options));
    await keep(records.chats.bots(chat.id, options));
    await keep(records.chats.chatBot(chat.seat, options));
    await keep(records.work.routinesOf(chat.seat, options));
    await keep(records.followUps.startableIn(chat.seat, options));
    await keep(records.directory.computerOf(chat.seat, options));
    await keep(planning.currentTodos(chat.seat));
    await keep(planning.jobNotes(chat.seat));
  }
  await keep(records.messages.searchText("CANARY", options));
  return [...new Set(JSON.stringify(read).match(CANARY) ?? [])].sort();
}

test("the model's reader reaches exactly what D12 grants, from a public chat, a private chat with others and background work", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { homeId, anna, ben, chef, chats } = await rossiHome(knex, context);
  const reader = (chat, askerId) => ({ context: parts.records.readers.forBot({ homeId, botId: chef, chatId: chat.id, askerId }) });

  // Anna asks Chef in Family: only public chats, though Anna can open every chat in the home.
  assert.deepEqual(await reached(parts, chats, reader(chats.family, anna)), granted(chats, chats.family));
  // Anna asks in Plans (Anna and Ben): public chats, Plans and Trio, never Diary or Secret, which Ben can't open.
  assert.deepEqual(await reached(parts, chats, reader(chats.plans, anna)), granted(chats, chats.plans));
  // Background work runs as the person who set it up, and reads what its chat may: Ben's routines in Family and Plans.
  assert.deepEqual(await reached(parts, chats, reader(chats.family, ben)), granted(chats, chats.family));
  assert.deepEqual(await reached(parts, chats, reader(chats.plans, ben)), granted(chats, chats.plans));
  // Anna's own private chat with Chef reads everything Anna can open, and her skill: no one else can open it.
  assert.deepEqual(await reached(parts, chats, reader(chats.diary, anna)), granted(chats, chats.diary));
  // A sanity check on the fixture: the canaries are there to leak (the whole home's, read as the home's own work).
  const homeJob = { context: parts.systemContext("the canary's own check").forWorkspace(homeId) };
  assert.ok((await reached(parts, chats, homeJob)).includes("CANARY-diary-message"));
});

test("mutation: a reader that saw every chat of its asker fails the wall", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { homeId, anna, chats } = await rossiHome(knex, context);
  // What the reader would read if it read as the asker: Anna's own view, from Family.
  const asAsker = await reached(parts, chats, memberOptions({ userId: anna, homeId }));
  assert.notDeepEqual(asAsker, granted(chats, chats.family));
  assert.ok(asAsker.includes("CANARY-diary-message") && asAsker.includes("CANARY-secret-computer"), "the asker's private chats leak");
});

test("mutation: readable_from without \"every person of the chat is in it\" fails the wall", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { homeId, anna, chef, chats } = await rossiHome(knex, context);
  const fromPlans = { context: parts.records.readers.forBot({ homeId, botId: chef, chatId: chats.plans.id, askerId: anna }) };
  // This file's own copy of the test database: the function is replaced here, and restored before the test ends.
  const { rows: [{ definition }] } = await knex.raw("select pg_get_functiondef('readable_from(bigint)'::regprocedure) as definition");
  const subset = /AND NOT EXISTS \(\s*SELECT 1 FROM chat_people p\s+WHERE p\.conversation_id = y\.id\s+AND NOT EXISTS \(SELECT 1 FROM chat_people q WHERE q\.conversation_id = x\.id AND q\.user_id = p\.user_id\)\s*\)/u;
  assert.match(definition, subset, "the reading rule's subset condition, as the migration wrote it");
  try {
    await knex.raw(definition.replace(subset, ""));
    const leaked = await reached(parts, chats, fromPlans);
    assert.notDeepEqual(leaked, granted(chats, chats.plans));
    assert.ok(leaked.includes("CANARY-diary-message") && leaked.includes("CANARY-secret-message"), "private chats Ben can't open leak");
  } finally {
    await knex.raw(definition);
  }
  assert.deepEqual(await reached(parts, chats, fromPlans), granted(chats, chats.plans), "restored, the wall holds");
});
