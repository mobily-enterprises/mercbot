import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// Goal rounds (D-48, after DeepSeek Harness P3–P5), against the disposable test database, with
// scripted replies in place of the model: a bot that stops short is sent another round until it
// marks the goal complete; "blocked" needs real attempts; the cap ends it; only the person opens one.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context, reply, goalLimits = { retryMs: 200 }) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Goal ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  // Goal rounds run in the bots' system context, as a job for the goal's person, and read what it has spent from the meter.
  const service = createBotsService(serviceDoubles({ knex, ...(await startBotParts(knex, context)), approvals: { decide: async () => "allow" }, reply, goalLimits }));
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  async function ask(text) {
    const sent = await service.sendMessage(bot.id, { text, clientId: `g-${Date.now()}-${Math.random()}` }, as(userId));
    await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    // Rounds run until none is due and no reply runs. A round due later (a retry while a reply
    // runs) is waited for until it can be claimed, by the database's clock (agent-runtime goals:
    // round_at and lease_until past); 15 s of waiting in all.
    let waited = 0;
    for (let round = 0; round < 60; round += 1) {
      await service.drain(10000);
      await service.goals.runDue();
      const { due, ms } = await knex("agent_goals")
        .where({ bot_id: bot.id, status: "active" })
        .whereNotNull("round_at")
        .first(
          knex.raw("count(*)::int as due"),
          knex.raw("ceil(greatest(0, extract(epoch from min(greatest(round_at, coalesce(lease_until, round_at))) - now()) * 1000))::int as ms")
        );
      if (!due && !await knex("agent_runs").where({ bot_id: bot.id }).first()) break;
      if (waited + (ms || 0) > 15_000) break;
      waited += ms || 0;
      await new Promise((resolve) => setTimeout(resolve, (ms || 0) + 1));
    }
  }
  return { knex, userId, bot, service, ask };
}

const goalOf = (knex, bot) => knex("agent_goals").where({ bot_id: bot.id }).orderBy("id", "desc").first();

test("a bot that stops short gets another round and finishes the goal", async (context) => {
  const prompts = [];
  const { knex, bot, ask } = await setup(context, async (_bot, _history, tools, _state, prompt) => {
    prompts.push(prompt);
    if (!prompt) {
      await tools.createGoal.execute({ objective: "Make the report and check it." });
      return { text: "I'll start by reading the file.", transcript: [] };
    }
    assert.match(prompt, /<goal_round>/u);
    assert.match(prompt, /inspect them instead of assuming earlier narration/u);
    const done = await tools.updateGoal.execute({ action: "complete" });
    assert.match(done.note, /closing message/u);
    return { text: "The report is made and checked.", transcript: [] };
  });
  await ask("Make the report");
  const goal = await goalOf(knex, bot);
  assert.equal(goal.status, "complete");
  assert.equal(goal.rounds, 1, "one round was enough");
  const texts = (await knex("bot_messages").where({ bot_id: bot.id, kind: "text", role: "bot" }).orderBy("id")).map((message) => message.body.text);
  assert.deepEqual(texts, ["I'll start by reading the file.", "The report is made and checked."]);
});

test("blocked is refused before three rounds, and the cap ends a goal that never finishes", async (context) => {
  const answers = [];
  const { knex, bot, ask } = await setup(context, async (_bot, _history, tools, _state, prompt) => {
    if (!prompt) await tools.createGoal.execute({ objective: "Do something hard." });
    else answers.push(await tools.updateGoal.execute({ action: "blocked", reason: "stuck" }));
    return { text: "Working on it.", transcript: [] };
  }, { retryMs: 200, maxRounds: 5 });
  await ask("Do the hard thing");
  assert.match(answers[0].error, /at least 3 rounds/u, "round 1 can't give up");
  assert.match(answers[1].error, /at least 3 rounds/u, "nor round 2");
  assert.equal(answers[2].status, "blocked", "round 3 can");
  const goal = await goalOf(knex, bot);
  assert.equal(goal.status, "blocked");
  assert.equal(goal.rounds, 3);
});

test("the round cap stops a goal that never completes", async (context) => {
  const { knex, bot, ask } = await setup(context, async (_bot, _history, tools, _state, prompt) => {
    if (!prompt) await tools.createGoal.execute({ objective: "Endless." });
    return { text: "Still going.", transcript: [] };
  }, { retryMs: 200, maxRounds: 3 });
  await ask("Go");
  const goal = await goalOf(knex, bot);
  assert.equal(goal.status, "blocked");
  assert.equal(goal.rounds, 3);
  assert.match(goal.reason, /limit of 3 rounds/u);
  const line = await knex("bot_messages").where({ bot_id: bot.id, kind: "event" }).orderBy("id", "desc").first();
  assert.equal(line.body.text, "Stopped working on the goal", "the person is told");
});

test("only the person's own turn opens a goal, and a quick answer needs none", async (context) => {
  let seen = null;
  const { knex, bot, ask } = await setup(context, async (_bot, _history, tools, _state, prompt) => {
    seen = Object.keys(tools);
    if (prompt) return { text: "Routine done.", transcript: [] };
    return { text: "Hi!", transcript: [] };
  });
  await ask("Hello");
  assert.ok(seen.includes("createGoal"), "the person's turn has the goal tools");
  assert.equal(await goalOf(knex, bot), undefined, "nothing opened a goal");
});

test("a reply that runs out of steps carries on by itself, without the person asking", async (context) => {
  const prompts = [];
  const { knex, bot, ask } = await setup(context, async (_bot, _history, tools, _state, prompt, options = {}) => {
    prompts.push({ prompt, carriesOn: options.carriesOn });
    if (!prompt) return { text: "I've read half the files; I'm carrying on by myself now.", transcript: [], unfinished: "I reached the most steps I take in one go" };
    await tools.updateGoal.execute({ action: "complete" });
    return { text: "All the files are done.", transcript: [] };
  });
  await ask("Tidy up all my files");
  const goal = await goalOf(knex, bot);
  assert.match(goal.objective, /Finish what the person asked: Tidy up all my files/u, "a goal opened for the request");
  assert.equal(goal.status, "complete", "and its round finished the job");
  assert.equal(prompts[0].carriesOn, true, "the first reply was told it carries on by itself");
  assert.match(prompts[1].prompt, /<goal_round>/u, "carried on in a round, not by the person");
});

test("a job stops at its cost limit and says so", async (context) => {
  let goalBot = null;
  const { knex, userId, bot, ask } = await setup(context, async (_bot, _history, tools, _state, prompt) => {
    if (!prompt) {
      await tools.createGoal.execute({ objective: "A big job." });
      // What the job has cost so far, as the meter records it ($0.75 in nanodollars).
      await knex("usage_events").insert({
        workspace_id: goalBot.workspace_id,
        created_at: new Date(),
        user_id: userId,
        bot_id: goalBot.id,
        kind: "premium",
        cost_nano: 750000000
      });
    }
    return { text: "Working on it.", transcript: [] };
  }, { retryMs: 200, costUsd: 0.5 });
  goalBot = bot;
  await ask("Do the big job");
  const goal = await goalOf(knex, bot);
  assert.equal(goal.status, "blocked");
  assert.equal(goal.rounds, 0, "no round after the limit");
  assert.match(goal.reason, /cost limit of \$0.5/u);
  const line = await knex("bot_messages").where({ bot_id: bot.id, kind: "event" }).orderBy("id", "desc").first();
  assert.match(line.body.detail, /cost limit \(\$0.5\)/u);
  await knex("usage_events").where({ bot_id: bot.id }).del();
});
