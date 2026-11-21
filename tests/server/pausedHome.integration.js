import assert from "node:assert/strict";
import test from "node:test";
import { refuseWork } from "../../packages/account/src/server/meter.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";

// A home whose work its copy has paused (D-73; Mercbot's own recorder never does, a copy built on it may): its bots
// start nothing new and Mercbot says why in the chat (one line of its own, R3), to each message a person sends and once
// for work no one waits on; nothing is deleted, and they carry on once it's resumed. Work refused part-way says the
// same. Each bot is in its direct chat with the person (testBot, D-112). Against the disposable test database, with a
// scripted reply.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const PAUSED = "This home's work is paused, so I can't start anything new.";
const NOTICE = "(This home's work is paused.)";
const refused = () => refuseWork("This home's work is paused.", { code: "work_paused", notice: NOTICE });

test("a paused home's bot says why instead of replying, once for routines, and replies again once it's resumed", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Paused ${Date.now().toString(36)}` });
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, cleanup);
  const as = memberOptions({ userId, homeId: bot.workspace_id });
  const asked = [];
  let paused = PAUSED;
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    meter: { pausedMessage: async (homeId) => (asked.push(String(homeId)), paused) },
    reply: async () => ({ text: "Here you are.", transcript: [{ role: "assistant", content: "Here you are." }] })
  }));
  const say = async (text) => {
    const sent = await bots.chat.sendMessage(bot.conversation_id, { text, clientId: `p-${Date.now()}-${text}` }, as);
    await bots.chat.reply(bot.conversation_id, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
    await bots.drain(10000);
  };
  // What the chat shows after the person's words: the bot's replies and Mercbot's paused lines.
  const answers = async () => (await knex("messages").where({ conversation_id: bot.conversation_id }).whereIn("role", ["bot", "system"]).orderBy("id"))
    .map((row) => ({ kind: row.kind, text: row.body.text, paused: Boolean(row.body.paused) }));
  const pausedLine = { kind: "event", text: PAUSED, paused: true };
  // Each routine's run is claimed, as the routine runner claims it (D-77).
  const routine = async () => claimedWork((await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, chat_bot_id: bot.chat_bot_id, made_by: userId, name: "Check", schedule: "Every hour", instructions: "Check",
    cron: "0 * * * *", timezone: "UTC", next_run_at: knex.fn.now(),
    run_id: `paused-${Date.now().toString(36)}`, run_attempts: 1, run_lease_until: knex.raw("now() + interval '90 seconds'")
  }).returning("*"))[0]);

  await bots.runRoutine(await routine());
  await bots.drain(10000);
  await bots.runRoutine(await routine());
  await bots.drain(10000);
  await say("Hello");
  await say("Are you there?");
  assert.deepEqual(await answers(), [pausedLine, pausedLine, pausedLine],
    "the routines say why once between them, and each message a person sends is answered with why");
  assert.ok(asked.every((homeId) => homeId === String(bot.workspace_id)), "it asks about the bot's own home");
  const runs = await knex("bot_routines").where({ chat_bot_id: bot.chat_bot_id }).select("run_id", "failures");
  assert.deepEqual(runs, [{ run_id: null, failures: 0 }, { run_id: null, failures: 0 }], "each run ends there, unfailed, so no server carries it on");

  paused = null;
  await say("Resumed");
  assert.deepEqual((await answers()).at(-1), { kind: "text", text: "Here you are.", paused: false });
  const said = (await knex("messages").where({ conversation_id: bot.conversation_id, role: "user", kind: "text" }).orderBy("id")).map((row) => row.body.text);
  assert.deepEqual(said.slice(-3), ["Hello", "Are you there?", "Resumed"], "nothing anyone said is lost");
});

test("work refused part-way says what a paused home says: a routine, a person's reply and a chat of two bots", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const tag = Date.now().toString(36);
  const [bot, other] = [await testBot(knex, userId, { name: `Refused ${tag}` }), await testBot(knex, userId, { name: `Other ${tag}` })];
  const made = [bot.id, other.id];
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").whereIn("id", made).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, cleanup);
  const as = memberOptions({ userId, homeId: bot.workspace_id });
  // In the chat of both bots, the first is refused after it has asked to set up a routine.
  let together = false;
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    meter: { pausedMessage: async () => null },
    approvals: { decide: async () => "ask" },
    reply: async (_bot, _history, tools) => {
      if (together) {
        await tools.createRoutine.execute({ acknowledgement: "Setting it up", name: "Plans", schedule: "Every day at 9:00 (UTC)", cron: "0 9 * * *", timezone: "UTC", instructions: "Plan." });
      }
      throw refused();
    }
  }));
  const ask = async (chatId, text) => {
    const sent = await bots.chat.sendMessage(chatId, { text, clientId: `r-${Date.now()}-${text}` }, as);
    await bots.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
    await bots.drain(10000);
  };
  const [routine] = await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, chat_bot_id: bot.chat_bot_id, made_by: userId, name: "Check", schedule: "Every hour", instructions: "Check",
    cron: "0 * * * *", timezone: "UTC", next_run_at: knex.fn.now(),
    run_id: `refused-${tag}`, run_attempts: 1, run_lease_until: knex.raw("now() + interval '90 seconds'")
  }).returning("*");

  await bots.runRoutine(await claimedWork(routine));
  await bots.drain(10000);
  await ask(bot.conversation_id, "Hello");
  const lines = await knex("messages").where({ conversation_id: bot.conversation_id }).whereIn("role", ["bot", "system"]).orderBy("id");
  assert.deepEqual(lines.map((row) => [row.kind, row.body.text, row.body.paused]), [["event", NOTICE, true], ["event", NOTICE, true]]);
  const [run] = await knex("bot_routines").where({ id: routine.id }).select("run_id", "failures");
  assert.deepEqual(run, { run_id: null, failures: 0 }, "the routine's run ends unfailed");

  const { id: both } = await seedChat(knex, { homeId: bot.workspace_id, title: "Plans", people: [userId], bots: [bot.id, other.id] });
  cleanup.after(() => knex("conversations").where({ id: both }).del());
  together = true;
  await ask(both, "Anyone?");
  const said = await knex("messages").where({ conversation_id: both }).whereIn("role", ["bot", "system"]).orderBy("id");
  assert.deepEqual(
    said.slice(-2).map((row) => [row.kind, row.body.paused ? row.body.text : ""]),
    [["choice", ""], ["event", NOTICE]],
    "the chat keeps the card its first bot made before it was refused, then gets the paused home's line, not a bot's apology"
  );
  assert.ok(!said.some((row) => /couldn't answer/u.test(row.body.text || "")));
});
