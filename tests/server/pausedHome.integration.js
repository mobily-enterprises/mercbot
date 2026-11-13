import assert from "node:assert/strict";
import test from "node:test";
import { refuseWork } from "../../packages/account/src/server/meter.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";

// A home whose work its copy has paused (D-73; Mercbot's own recorder never does, a copy built on it may): its bots
// start nothing new and say why, to each message a person sends and once for work no one waits on; nothing is deleted,
// and they carry on once it's resumed. Work refused part-way says the same. Against the disposable test database, with
// a scripted reply.
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
    const sent = await bots.sendMessage(bot.id, { text, clientId: `p-${Date.now()}-${text}` }, as);
    await bots.replyTo(bot.id, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
    await bots.drain(10000);
  };
  const botTexts = async () => (await knex("bot_messages").where({ conversation_id: bot.conversation_id, role: "bot", kind: "text" }).orderBy("id"))
    .map((row) => ({ text: row.body.text, paused: Boolean(row.body.paused) }));
  // Each routine's run is claimed, as the routine runner claims it (D-77).
  const routine = async () => claimedWork((await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, name: "Check", schedule: "Every hour", instructions: "Check",
    cron: "0 * * * *", timezone: "UTC", next_run_at: knex.fn.now(),
    run_id: `paused-${Date.now().toString(36)}`, run_attempts: 1, run_lease_until: knex.raw("now() + interval '90 seconds'")
  }).returning("*"))[0]);

  await bots.runRoutine(await routine());
  await bots.drain(10000);
  await bots.runRoutine(await routine());
  await bots.drain(10000);
  await say("Hello");
  await say("Are you there?");
  assert.deepEqual(await botTexts(), [
    { text: PAUSED, paused: true },
    { text: PAUSED, paused: true },
    { text: PAUSED, paused: true }
  ], "the routines say why once between them, and each message a person sends is answered with why");
  assert.ok(asked.every((homeId) => homeId === String(bot.workspace_id)), "it asks about the bot's own home");
  const runs = await knex("bot_routines").where({ conversation_id: bot.conversation_id }).select("run_id", "failures");
  assert.deepEqual(runs, [{ run_id: null, failures: 0 }, { run_id: null, failures: 0 }], "each run ends there, unfailed, so no server carries it on");

  paused = null;
  await say("Resumed");
  assert.deepEqual((await botTexts()).at(-1), { text: "Here you are.", paused: false });
  const said = (await knex("bot_messages").where({ conversation_id: bot.conversation_id, role: "user", kind: "text" }).orderBy("id")).map((row) => row.body.text);
  assert.deepEqual(said.slice(-3), ["Hello", "Are you there?", "Resumed"], "nothing anyone said is lost");
});

test("work refused part-way says what a paused home says: a routine, a person's reply and a group's", async (context) => {
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
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    meter: { pausedMessage: async () => null },
    approvals: { decide: async () => "ask" },
    reply: async () => { throw refused(); },
    // A group's bot is refused after it has asked to set up a routine.
    groupReply: async (_bot, { tools }) => {
      await tools.createRoutine.execute({ acknowledgement: "Setting it up", name: "Plans", schedule: "Every day at 9:00 (UTC)", cron: "0 9 * * *", timezone: "UTC", instructions: "Plan." });
      throw refused();
    }
  }));
  const ask = async (target, text) => {
    const sent = await bots.sendMessage(target.id, { text, clientId: `r-${Date.now()}-${text}` }, as);
    await bots.replyTo(target.id, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
    await bots.drain(10000);
  };
  const [routine] = await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, name: "Check", schedule: "Every hour", instructions: "Check",
    cron: "0 * * * *", timezone: "UTC", next_run_at: knex.fn.now(),
    run_id: `refused-${tag}`, run_attempts: 1, run_lease_until: knex.raw("now() + interval '90 seconds'")
  }).returning("*");

  await bots.runRoutine(await claimedWork(routine));
  await bots.drain(10000);
  await ask(bot, "Hello");
  const texts = await knex("bot_messages").where({ conversation_id: bot.conversation_id, role: "bot", kind: "text" }).orderBy("id");
  assert.deepEqual(texts.map((row) => [row.body.text, row.body.paused]), [[NOTICE, true], [NOTICE, true]]);
  const [run] = await knex("bot_routines").where({ id: routine.id }).select("run_id", "failures");
  assert.deepEqual(run, { run_id: null, failures: 0 }, "the routine's run ends unfailed");

  const { bot: group } = await bots.createGroup({ botIds: [bot.id, other.id], text: "Plans?" }, "Owner", as);
  made.push(group.id);
  await bots.drain(10000);
  await ask(group, "Anyone?");
  const room = await knex("bot_conversations").where({ bot_id: group.id }).whereNull("user_id").whereNull("group_id").first();
  const said = await knex("bot_messages").where({ conversation_id: room.id }).whereIn("role", ["bot", "system"]).orderBy("id");
  assert.deepEqual(
    said.slice(-2).map((row) => [row.kind, row.body.paused ? row.body.text : ""]),
    [["choice", ""], ["event", NOTICE]],
    "the group keeps the card its bot made before it was refused, then gets the paused home's line, not a bot's apology"
  );
  assert.ok(!said.some((row) => /couldn't answer/u.test(row.body.text || "")));
});
