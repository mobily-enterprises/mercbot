import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// What the person writes while a reply works reaches the bot with its next tool result (D-48, as
// Claude Code takes messages mid-task), and isn't answered a second time afterwards. Against the
// disposable test database, with a scripted reply standing in for the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a message sent mid-reply reaches the bot at its next step", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Hear ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const results = [];
  let passes = 0;
  let service = null;
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools) => {
      passes += 1;
      results.push(await tools.getGoal.execute({}));
      await service.sendMessage(bot.id, { text: "Actually make it blue, not red", clientId: `m-${Date.now()}` }, as(userId));
      results.push(await tools.getGoal.execute({}));
      results.push(await tools.getGoal.execute({}));
      return { text: "Done, in blue.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bot.id, { text: "Make the banner red", clientId: `s-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  // The drain also waits for what the reply starts as it ends, so a second reply would be counted below.
  await service.drain(10000);

  assert.equal(results[0].personWrote, undefined, "nothing new yet");
  assert.match(results[1].personWrote, /Actually make it blue, not red/u, "the next tool result carries it");
  assert.equal(results[1].goal, null, "the result itself is kept");
  assert.equal(results[2].personWrote, undefined, "said once");
  assert.equal(passes, 1, "and it doesn't get a reply of its own afterwards");
  const mid = await knex("bot_messages").where({ bot_id: bot.id, role: "user", kind: "text" }).orderBy("id", "desc").first();
  const reply = await knex("bot_messages").where({ bot_id: bot.id, role: "bot", kind: "text" }).orderBy("id", "desc").first();
  assert.equal(reply.body.answers, Number(mid.id));
});
