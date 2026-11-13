import assert from "node:assert/strict";
import test from "node:test";
import { currentWork } from "../../packages/account/src/server/meter.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";

// Each kind of work says what it is, which decides what the model runs on (D-59). Against the
// disposable test database, with a scripted reply that notes the work it ran as.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("chats, the Builder and background work each run as their own kind", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Worker ${Date.now().toString(36)}` });
  const builder = await testBot(knex, userId, { name: `Builder ${Date.now().toString(36)}` });
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").whereIn("id", [bot.id, builder.id]).del();
    await knex.destroy();
  });
  const seen = [];
  // Routines and Apps tasks run in the bots' system context, as a job for the person in the bot's home.
  const parts = await startBotParts(knex, cleanup);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    apps: { apps: { builder: async () => ({ id: String(builder.id) }), queueTask: async () => {} } },
    reply: async () => {
      seen.push(currentWork());
      return { text: "Done.", transcript: [{ role: "assistant", content: "Done." }] };
    }
  }));
  const ranAs = async (run) => {
    seen.length = 0;
    await run();
    await bots.drain(10000);
    return seen[0];
  };
  const chatWith = async (who) => {
    const sent = await bots.sendMessage(who.id, { text: "Hello", clientId: `w-${Date.now()}-${who.id}` }, as(userId));
    await bots.replyTo(who.id, { afterMessageId: sent.messages.at(-1).id }, undefined, as(userId));
  };
  const routineOf = async (who) => claimedWork((await knex("bot_routines").insert({
    workspace_id: who.workspace_id, bot_id: who.id, conversation_id: who.conversation_id, name: "Check", schedule: "Every hour", instructions: "Check",
    cron: "0 * * * *", timezone: "UTC", next_run_at: knex.fn.now()
  }).returning("*"))[0]);
  // A queued job as the Apps job runner claims it (apps.jobs), in the bot's home.
  const job = (kind) => claimedWork({
    workspace_id: bot.workspace_id, kind, bot_id: bot.id, conversation_id: bot.conversation_id, user_id: userId, watch_id: "1", title: "Task from Test", prompt: "Do it"
  });

  assert.equal(await ranAs(() => chatWith(bot)), "chat");
  assert.equal(await ranAs(() => chatWith(builder)), "build", "people wait for an app anyway");
  assert.equal(await ranAs(async () => bots.runRoutine(await routineOf(bot))), "background");
  assert.equal(await ranAs(async () => bots.runRoutine(await routineOf(builder))), "background", "a routine stays one on the Builder too");
  assert.equal(await ranAs(() => bots.runAppTask(job("watch"))), "background");
  assert.equal(await ranAs(() => bots.runAppTask(job("shell"))), "background");
  assert.equal(await ranAs(() => bots.runAppTask(job("task"))), "chat", "someone just pressed the button");
  assert.equal(currentWork(), "chat", "nothing leaks out");
});
