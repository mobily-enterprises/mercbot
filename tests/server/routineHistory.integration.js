import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";
import { startBotsService } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";

// A routine run reads its instructions and its own last few runs, never the whole chat (D-57): a
// headline check every ten minutes must cost the same in week three as on day one.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a routine reads only its own last three runs, however long the chat", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: "Routine reader" });
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const seen = [];
  let run = 0;
  // Routines run in the bots' system context, as a job for the conversation's person.
  const parts = await startBotParts(knex, cleanup);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, _tools, _state, prompt, options) => {
      seen.push({ history, prompt, summary: options.summary });
      run += 1;
      return { text: `Headline ${run}`, transcript: [{ role: "assistant", content: `Headline ${run}` }] };
    }
  });
  const routine = async (name) => claimedWork((await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, name, schedule: "Every 10 minutes", instructions: `Do ${name}`,
    cron: "*/10 * * * *", timezone: "UTC", next_run_at: knex.fn.now()
  }).returning("*"))[0]);
  const words = (entry) => entry.history.map((message) => message.body.text);

  // A long chat, a summary of it, and a second routine in the same chat.
  await knex("bot_messages").insert(Array.from({ length: 40 }, (_, n) => ({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "text", role: n % 2 ? "bot" : "user", body: JSON.stringify({ text: `Chat ${n}` }) })));
  await knex("agent_summaries").insert({ conversation_id: bot.conversation_id, covers_up_to: 1, summary: "Weeks of chat", messages: 1 });
  const headline = await routine("Headline");
  const other = await routine("Other job");

  await bots.runRoutine(headline);
  assert.deepEqual(words(seen[0]), [], "its first run reads nothing old");
  assert.equal(seen[0].summary, "", "and no summary of the chat");
  assert.match(seen[0].prompt, /Instructions: Do Headline/u);

  await bots.runRoutine(other);
  for (let times = 0; times < 4; times += 1) await bots.runRoutine(headline);
  const last = seen.at(-1);
  assert.deepEqual(words(last), ["Headline 3", "Headline 4", "Headline 5"], "its own last three, oldest first");
  assert.ok(!words(last).includes("Headline 2"), "another routine's run isn't its business");

  // Its reply is still in the chat, marked as its run; and it doesn't count as answering the person.
  const saved = await knex("bot_messages").where({ bot_id: bot.id, role: "bot" }).orderBy("id", "desc").first();
  assert.equal(saved.body.routine, String(headline.id));
  assert.equal(saved.body.answers, 0);
  await new Promise((resolve) => setImmediate(resolve));
  await bots.drain(1000);

  // The person's own message still reads the whole chat, routine runs included.
  seen.length = 0;
  const sent = await bots.sendMessage(bot.id, { text: "What did you find?", clientId: `c-${Date.now()}` }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await bots.drain(5000);
  assert.ok(words(seen[0]).includes("Chat 5"), "a person's reply reads the chat");
  assert.ok(words(seen[0]).includes("Headline 6"));
});

test("a watch run reads only its own last runs, and a finished command the chat's latest words", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: "Task reader" });
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const seen = [];
  let run = 0;
  // Apps tasks run in the bots' system context, as a job for the person in the bot's home.
  const parts = await startBotParts(knex, cleanup);
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, _tools, _state, prompt, options) => {
      seen.push({ history, prompt, summary: options.summary });
      run += 1;
      return { text: `Task ${run}`, transcript: [{ role: "assistant", content: `Task ${run}` }] };
    }
  });
  // A queued job as the Apps job runner claims it (apps.jobs), in the bot's home.
  const job = (kind, watchId = null) => claimedWork({
    workspace_id: bot.workspace_id, kind, bot_id: bot.id, conversation_id: bot.conversation_id, user_id: userId, watch_id: watchId, title: "Task from Test", prompt: `Do ${kind}`
  });
  const texts = (entry) => entry.history.map((message) => message.body.text);
  const transcript = [{ role: "assistant", content: [{ type: "text", text: "An old step" }] }];
  await knex("bot_messages").insert(Array.from({ length: 12 }, (_, n) => ({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "text", role: n % 2 ? "bot" : "user",
    body: JSON.stringify({ text: `Chat ${n}`, ...(n % 2 ? { transcript } : {}) })
  })));
  await knex("agent_summaries").insert({ conversation_id: bot.conversation_id, covers_up_to: 1, summary: "Weeks of chat", messages: 1 });

  await bots.runAppTask(job("watch", "1"));
  assert.deepEqual(texts(seen[0]), [], "its first run reads nothing old");
  assert.equal(seen[0].summary, "");
  for (let times = 0; times < 3; times += 1) await bots.runAppTask(job("watch", "1"));
  await bots.runAppTask(job("watch", "2"));
  assert.deepEqual(texts(seen.at(-1)), [], "another watch's runs aren't its business");
  await bots.runAppTask(job("watch", "1"));
  assert.deepEqual(texts(seen.at(-1)), ["Task 2", "Task 3", "Task 4"], "its own last three, oldest first");
  const stored = await knex("bot_messages").where({ bot_id: bot.id, role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.routine, "watch:1");
  assert.equal(stored.body.answers, 0, "a watch run doesn't answer the person");

  await bots.runAppTask(job("shell"));
  const command = seen.at(-1);
  assert.equal(command.history.length, 6, "the latest few messages");
  assert.equal(command.summary, "");
  assert.ok(command.history.every((message) => !message.body.transcript), "in words only, without old tool calls");

  await bots.runAppTask(job("task"));
  assert.ok(texts(seen.at(-1)).includes("Chat 5"), "a button's hand-off reads the chat");
  assert.equal(seen.at(-1).summary, "Weeks of chat");
});
