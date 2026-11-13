import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { APICallError } from "ai";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";
import { startBotsService } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { RunTakenOver } from "../../packages/bots/src/server/runLease.js";
import { refuseWork } from "../../packages/account/src/server/meter.js";

// What a bot says in place of the work its copy refused before it started (meter.js refuseWork).
const PAUSED_NOTICE = "(My home's work is paused, so I didn't do this.)";
const refusal = () => refuseWork("This home's work is paused.", { code: "work_paused", notice: PAUSED_NOTICE });

// Routines that keep failing pause (docs/usage-tracking-design.md, question 4), and runs whose server
// stopped are taken over once (D-59, D-15), against the disposable test database. A task waiting for
// an app is connectFollowUps.integration.js's.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Routines" });
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, cleanup);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  /** The routine runner's own options, as it claims in every home. */
  const runner = { context: parts.systemContext("routine runner") };
  return { knex, cleanup, parts, as, userId, bot, runner };
}

/** A routine in the bot's chat, due now unless `fields` say otherwise. */
async function routineOf(knex, bot, fields = {}) {
  const [row] = await knex("bot_routines").insert({
    workspace_id: bot.workspace_id,
    bot_id: bot.id,
    conversation_id: bot.conversation_id,
    name: "Morning news",
    schedule: "Every day at 8",
    instructions: "Tell me the news.",
    cron: "0 8 * * *",
    timezone: "UTC",
    next_run_at: knex.raw("now() + interval '1 day'"),
    ...fields
  }).returning("*");
  return row;
}

/** The routine as its runner hands it over once it has claimed a run of it (a new run id and lease). */
async function claimedRun(knex, id, attempts = 1) {
  const [row] = await knex("bot_routines")
    .where({ id })
    .update({ run_id: randomUUID(), run_attempts: attempts, run_lease_until: knex.raw("now() + interval '90 seconds'") })
    .returning("*");
  return claimedWork(row);
}

const botTexts = async (knex, bot) =>
  (await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, role: "bot", kind: "text" }).orderBy("id")).map(
    (row) => row.body.text
  );

test("a routine pauses after five failed runs in a row, says how to resume it, and a run that works starts the count again", async (context) => {
  const { knex, cleanup, parts, as, userId, bot } = await setup(context);
  let failing = true;
  let refused = false;
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => {
      if (refused) throw refusal();
      if (failing) throw new Error("The model is down.");
      return { text: "Here's the news.", transcript: [] };
    }
  });
  const routine = await routineOf(knex, bot);
  for (let run = 1; run <= 4; run += 1) await bots.runRoutine(await claimedRun(knex, routine.id));
  let stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.deepEqual([stored.failures, stored.enabled, stored.run_id], [4, true, null], "four failures in a row; each run ended");
  assert.equal((await botTexts(knex, bot)).filter((text) => text.startsWith("I couldn't finish my routine")).length, 4);

  await bots.runRoutine(await claimedRun(knex, routine.id));
  stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.deepEqual([stored.failures, stored.enabled, stored.next_run_at], [5, false, null], "the fifth pauses it");
  const texts = await botTexts(knex, bot);
  assert.equal(texts.filter((text) => text.startsWith("I couldn't finish my routine")).length, 4, "the fifth says it paused instead");
  assert.match(texts.at(-1), /^I've paused my routine "Morning news", because its last 5 runs failed in a row\./u);
  assert.match(texts.at(-1), /switch it back on under Routines in my Details panel, or ask me to resume it/u);
  const event = await knex("bot_messages").where({ bot_id: bot.id, kind: "event" }).orderBy("id", "desc").first();
  assert.deepEqual([event.body.text, event.body.name], ["Paused routine", "Morning news"]);

  // Resuming it starts the count again, and so does a run that works.
  await bots.setRoutineEnabled(bot.id, routine.id, true, as(userId));
  stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.deepEqual([stored.failures, stored.enabled], [0, true], "resumed, with no failures counted");
  await knex("bot_routines").where({ id: routine.id }).update({ failures: 4 });

  // A run its copy refuses (D-73) isn't the routine failing: it says so once, and doesn't pause it.
  refused = true;
  await bots.runRoutine(await claimedRun(knex, routine.id));
  const said = (await botTexts(knex, bot)).length;
  await bots.runRoutine(await claimedRun(knex, routine.id));
  stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.equal(stored.enabled, true, "refused work doesn't pause a routine");
  assert.equal((await botTexts(knex, bot)).at(-1), PAUSED_NOTICE);
  assert.equal((await botTexts(knex, bot)).length, said, "the next run refused says nothing more");
  refused = false;
  await knex("bot_routines").where({ id: routine.id }).update({ failures: 3 });
  failing = false;
  await bots.runRoutine(await claimedRun(knex, routine.id));
  stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.equal(stored.failures, 0, "a run that works starts the count again");
  assert.equal((await botTexts(knex, bot)).at(-1), "Here's the news.");
});

test("Apps tasks and watches its copy refuses (D-73) say so once between them", async (context) => {
  const { knex, cleanup, parts, userId, bot } = await setup(context);
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => {
      throw refusal();
    }
  });
  // Queued jobs as the Apps job runner claims them (apps.jobs), in the bot's home.
  const job = (kind, watchId = null) => claimedWork({
    workspace_id: bot.workspace_id, kind, bot_id: bot.id, conversation_id: bot.conversation_id, user_id: userId, watch_id: watchId,
    title: "Task from Test", prompt: `Do ${kind}`
  });
  // Refused part-way, each ends as it does in a home whose work is paused already: unfailed, with the notice (the owner,
  // 2026-11-12).
  for (const [kind, watchId] of [["watch", "1"], ["watch", "1"], ["task", null]]) await bots.runAppTask(job(kind, watchId));
  assert.deepEqual(await botTexts(knex, bot), [PAUSED_NOTICE]);
});

test("a routine run whose server stopped is taken over once, carries on from its steps, and only the new run posts", async (context) => {
  const { knex, cleanup, parts, bot, runner } = await setup(context);
  let release;
  const stuck = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, _tools, _state, prompt, options) => {
      seen.push({ history, prompt });
      if (seen.length === 1) {
        // The first server saves a step, then stops answering (its machine went away).
        await options.onSteps([{ role: "assistant", content: "Looked up the news." }]);
        await stuck;
        return { text: "The first server's news.", transcript: [] };
      }
      return { text: "The news, carried on.", transcript: [] };
    }
  });
  const routine = await routineOf(knex, bot, { next_run_at: knex.raw("now() - interval '1 minute'") });
  const first = await parts.records.work.claimRoutine(() => new Date(Date.now() + 86_400_000).toISOString(), 90, runner);
  assert.equal(String(first.id), String(routine.id));
  assert.equal(await parts.records.work.claimRoutine(() => null, 90, runner), null, "a routine with a run going isn't due again");
  const running = bots.runRoutine(first);
  while (seen.length < 1) await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await parts.records.work.claimStalledRoutine(90, runner), null, "a run whose lease holds isn't taken over");

  // Its lease lapses: another server takes the run over, once, with a new run id.
  await knex("bot_routines").where({ id: routine.id }).update({ run_lease_until: knex.raw("now() - interval '1 second'") });
  const second = await parts.records.work.claimStalledRoutine(90, runner);
  assert.equal(String(second.id), String(routine.id));
  assert.notEqual(second.runId, first.runId);
  assert.equal(second.runAttempts, 2);
  assert.equal(await parts.records.work.claimStalledRoutine(90, runner), null, "taken over once");
  assert.equal(await parts.records.work.renewRoutineRun(first, 90, runner), false, "the first server's heartbeat finds the run gone");
  await bots.runRoutine(second);
  assert.deepEqual(seen[1].history.at(-1).body.transcript, [{ role: "assistant", content: "Looked up the news." }], "it carries on from the saved step");

  // The first server comes back to life: its result is never posted.
  release();
  await running;
  assert.deepEqual(await botTexts(knex, bot), ["The news, carried on."]);
  const stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.deepEqual([stored.run_id, stored.failures], [null, 0], "the run ended once, as a success");
});

test("a stopped run its routine no longer wants ends unrun, and one tried three times is given up as failed", async (context) => {
  const { knex, cleanup, parts, bot, runner } = await setup(context);
  const replies = [];
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => {
      replies.push(1);
      return { text: "Ran.", transcript: [] };
    }
  });
  // Paused while its run was lost: the run ends, and nothing runs.
  const paused = await routineOf(knex, bot, { enabled: false });
  await knex("bot_routines").where({ id: paused.id }).update({ run_id: randomUUID(), run_attempts: 1, run_lease_until: knex.raw("now() - interval '1 second'") });
  const superseded = await parts.records.work.claimStalledRoutine(90, runner);
  assert.deepEqual([String(superseded.id), superseded.superseded], [String(paused.id), true]);
  assert.equal((await knex("bot_routines").where({ id: paused.id }).first()).run_id, null);

  // A run whose server stopped three times: the fourth try gives it up as a failure.
  const routine = await routineOf(knex, bot);
  await bots.runRoutine(await claimedRun(knex, routine.id, 4));
  assert.equal(replies.length, 0, "it isn't run a fourth time");
  const stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.deepEqual([stored.run_id, stored.failures], [null, 1]);
  assert.match((await botTexts(knex, bot)).at(-1), /^I couldn't finish my routine "Morning news" this time/u);
});

test("a run that loses its lease stops at its next step: it posts nothing, and its run, a one-off's too, is left to the server holding it", async (context) => {
  const { knex, cleanup, parts, bot } = await setup(context);
  let asked = 0;
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    // As the agent loop does: a model call ends at once when the run's signal aborts, with its reason.
    reply: (_bot, _history, _tools, _state, _prompt, options) => {
      asked += 1;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    }
  });
  const routine = await routineOf(knex, bot, { once: true });
  const claimed = await claimedRun(knex, routine.id);
  const lease = new AbortController();
  const running = bots.runRoutine(claimed, lease.signal);
  while (!asked) await new Promise((resolve) => setTimeout(resolve, 20));
  // Another server took the run over (this one was paused): its heartbeat finds out and stops it.
  const theirs = randomUUID();
  await knex("bot_routines").where({ id: routine.id }).update({ run_id: theirs });
  lease.abort(new RunTakenOver(`Routine ${routine.id} ("Morning news")`));
  await running;
  assert.deepEqual(await botTexts(knex, bot), [], "nothing posted");
  const stored = await knex("bot_routines").where({ id: routine.id }).first();
  assert.ok(stored, "a one-off stopped for its lease isn't removed");
  assert.deepEqual([stored.run_id, stored.failures], [theirs, 0], "the other server's run is untouched and nothing counts as failed");
});

test("a routine whose model call fails logs one line with the provider's status, never the request it sent", async (context) => {
  const { knex, cleanup, parts, bot } = await setup(context);
  const logged = context.mock.method(console, "error", () => {});
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => {
      throw new APICallError({
        message: "Invalid API key",
        url: "https://models.example/v1/chat/completions",
        requestBodyValues: { messages: [{ role: "user", content: "My passport number is X1234567" }] },
        statusCode: 401,
        isRetryable: false
      });
    }
  });
  const routine = await routineOf(knex, bot);
  await bots.runRoutine(await claimedRun(knex, routine.id));
  const ours = logged.mock.calls.filter((call) => String(call.arguments[0]).includes(`Routine ${routine.id} `)).map((call) => call.arguments);
  assert.deepEqual(ours, [[`Routine ${routine.id} ("Morning news") failed: its model call failed (status 401): Invalid API key`]], "one line, without the error and its request");
});
