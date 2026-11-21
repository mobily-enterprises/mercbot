import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LIMITS } from "@jskit-ai/agent/server";
import { claimedWork } from "../support/botRecords.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// The glass wall's canary, prompt half (D-112, D12, D13; the plan's test 9, R12). The records half
// (glassWall.integration.js) proves what the model's reader reaches; this half runs the turns' model paths that read a
// chat (a reply asked by a person, a routine's run in the background, the chat's summary) and keeps everything each
// hands the model: its history, summary, Current state note and prompt. Every chat of the home carries a unique string in
// each place a chat keeps something, and each model input may hold only what D12 grants the chat it reads from, while
// the reading chat's own strings are there (so the capture is live). A request's asked bot reads the brief alone
// (botRequestsBrief.integration.js). Against the disposable test database, stand-ins for the model and the summariser.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const CANARY = /CANARY-[a-z]+-[a-z]+/gu;
const CARRIERS = ["message", "todo", "notes", "waiting", "routine", "instructions"];

/**
 * The Rossi home: Anna, Ben and Carla, Anna's bots Chef and Shopper, and its chats, each with Chef (and Shopper beside
 * it but in Anna's direct chat) and a canary in every carrier a turn reads. Family is public, and so is Anna's direct
 * chat with Chef (D15); the rest are private. Each chat's routine is made by its first person.
 */
async function rossiHome(kit) {
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const [chef, shopper] = await botsOf(kit, homeId, anna, ["Chef", "Shopper"]);
  const shapes = {
    family: { kind: "public", people: [anna, ben] },
    direct: { direct: { userId: anna, botId: chef } },
    plans: { kind: "private", people: [anna, ben] },
    diary: { kind: "private", people: [anna] },
    secret: { kind: "private", people: [anna, carla] },
    trio: { kind: "private", people: [anna, ben, carla] }
  };
  const chats = {};
  for (const [name, shape] of Object.entries(shapes)) {
    const chat = await seedChat(kit.knex, { homeId, title: shape.direct ? null : name, bots: shape.direct ? [] : [chef, shopper], ...shape });
    const seat = chat.chatBotIds.get(chef);
    const people = shape.people ?? [anna];
    const said = (carrier) => `CANARY-${name}-${carrier}`;
    await seedMessage(kit.knex, { homeId, chatId: chat.id, userId: people[0], body: { text: said("message") } });
    await seedMessage(kit.knex, { homeId, chatId: chat.id, kind: "todos", botId: chef, body: { list: seat, items: [{ text: said("todo"), done: false }] } });
    await kit.knex("chat_bots").where({ id: seat }).update({ job_notes: JSON.stringify([said("notes")]), waiting_task: said("waiting") });
    const [routine] = await kit.knex("bot_routines").insert({
      workspace_id: homeId, chat_bot_id: seat, made_by: people[0], name: said("routine"), schedule: "Every day at 9:00", cron: "0 9 * * *", timezone: "UTC",
      instructions: said("instructions"), enabled: true
    }).returning("*");
    chats[name] = { id: chat.id, seat, people, kind: shape.kind ?? "public", routine };
  }
  return { homeId, anna, ben, carla, chef, chats };
}

/** The canaries D12 grants a chat (glassWall.integration.js's rule): public chats', its own, and for a private chat the private chats whose people include all of its people. */
function granted(chats, reading) {
  const names = Object.entries(chats).filter(([, chat]) => chat.kind === "public" || chat === reading ||
    (reading.kind === "private" && chat.kind === "private" && reading.people.every((person) => chat.people.includes(person))));
  return new Set(names.flatMap(([name]) => CARRIERS.map((carrier) => `CANARY-${name}-${carrier}`)));
}

/** A model input's canaries, each checked against what its chat is granted. */
function checkInput(chats, input) {
  const found = [...new Set(input.text.match(CANARY) ?? [])].sort();
  const reading = Object.values(chats).find((chat) => chat.id === input.chatId);
  const allowed = granted(chats, reading);
  assert.deepEqual(found.filter((canary) => !allowed.has(canary)), [], `${input.path} in ${input.chatId} holds only what D12 grants it`);
  return found;
}

test("every model input a chat's turns make holds only what D12 grants that chat", async (context) => {
  const inputs = [];
  // The chat being summarised: only the test's own compact() below summarises, as no chat outgrows a reply here.
  let summarising = null;
  const kit = await startChatTurns(context, {
    compactionLimits: { ...SUMMARY_LIMITS, compactAt: 1_000_000, keepTurns: 1, keepTokens: 50, minTokens: 1 },
    summarize: async ({ previous, text }) => {
      inputs.push({ path: "summary", chatId: summarising, text: JSON.stringify({ previous, text }) });
      return "A summary.";
    },
    reply: async (bot, history, _tools, state, prompt, options) => {
      inputs.push({ path: prompt ? "routine" : "reply", chatId: String(bot.chat_id), text: JSON.stringify({ history, state, prompt, summary: options.summary }) });
      return { text: "Noted.", transcript: [] };
    }
  });
  const { homeId, anna, ben, chats } = await rossiHome(kit);
  const ask = async (chat, person, text) => {
    const options = kit.as(person, homeId);
    const sent = await kit.turns.chat.sendMessage(chat.id, { text: `Chef, ${text}` }, options);
    await kit.turns.chat.reply(chat.id, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
    await kit.drain();
  };

  // A person's turn in a public chat, in a private chat with someone else, and in their own private chat.
  await ask(chats.family, anna, "what's for dinner?");
  await ask(chats.plans, anna, "what's the plan?");
  await ask(chats.diary, anna, "what did I write?");
  // Background work, as the person who set it up: Anna's routine in Plans, and Ben's in Family.
  await kit.knex("bot_routines").where({ id: chats.family.routine.id }).update({ made_by: ben });
  for (const name of ["plans", "family"]) {
    await kit.turns.runRoutine(claimedWork(await kit.knex("bot_routines").where({ id: chats[name].routine.id }).first()));
    await kit.drain();
  }
  // The chat's summary, which every bot in it reads from then on.
  for (let index = 0; index < 4; index += 1) await seedMessage(kit.knex, { homeId, chatId: chats.plans.id, userId: ben, body: { text: `Ben's line ${index}` } });
  summarising = chats.plans.id;
  await kit.turns.compaction.compact(chats.plans.id);

  const paths = inputs.map((input) => `${input.path} ${Object.keys(chats).find((name) => chats[name].id === input.chatId)}`);
  for (const path of ["reply family", "reply plans", "reply diary", "routine plans", "routine family", "summary plans"]) {
    assert.ok(paths.includes(path), `the ${path} path ran (${paths.join(", ")})`);
  }
  // A reply and a summary read the chat's messages; a routine's run, its own instructions and its last runs (D-57).
  const ownCarrier = { reply: "message", summary: "message", routine: "instructions" };
  for (const input of inputs) {
    const found = checkInput(chats, input);
    const own = Object.keys(chats).find((name) => chats[name].id === input.chatId);
    assert.ok(found.includes(`CANARY-${own}-${ownCarrier[input.path]}`), `${input.path} in ${own} reads its own chat`);
  }
  // Each turn's note holds its own seat's carriers: the capture sees what a leak would carry.
  const reply = inputs.find((input) => input.path === "reply" && input.chatId === chats.plans.id);
  for (const carrier of ["todo", "notes", "waiting", "routine"]) assert.ok(reply.text.includes(`CANARY-plans-${carrier}`), carrier);
});
