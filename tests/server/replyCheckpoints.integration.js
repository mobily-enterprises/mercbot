import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { RunTakenOver } from "../../packages/bots/src/server/runLease.js";
import { startChatTurns } from "../support/botDoubles.mjs";
import { testBot } from "./testHome.js";
import { memberOptions } from "../support/botRecords.mjs";

// A reply saves its steps as each one finishes, and one a stopped server left part-way is carried
// on from them by any server, with no page needed (D-48, D-19). Against the disposable test
// database, with scripted replies standing in for the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const call = { type: "tool-call", toolCallId: "c1", toolName: "list_files", input: {} };
const result = { type: "tool-result", toolCallId: "c1", toolName: "list_files", output: { type: "json", value: { mine: ["notes.txt"] } } };
const steps = [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }];

async function setup(context, reply, more = {}) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Resume ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  // A reply a stopped server left is carried on in the bots' system context, for the person it worked for. Its run is
  // the bot's in its chat: the runtime's conversation is its seat (chat_bots.id).
  const kit = await startChatTurns(context, { reply, ...more });
  /** The person's request in the bot's home, as the bots routes make its options. */
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  return { knex, userId, as, bot, service: kit.turns, drain: kit.drain, seatId: bot.chat_bot_id };
}

test("steps are saved while a reply runs, then cleared when it ends", async (context) => {
  let seenWhileRunning = null;
  const { knex, as, userId, bot, service, drain, seatId } = await setup(context, async (_bot, _history, _tools, _state, _prompt, { onSteps }) => {
    await onSteps(steps);
    seenWhileRunning = await knex("agent_runs").where({ conversation_id: seatId }).first();
    return { text: "You have notes.txt.", transcript: [...steps, { role: "assistant", content: [{ type: "text", text: "You have notes.txt." }] }] };
  });
  const sent = await service.chat.sendMessage(bot.conversation_id, { text: "What files do I have?", clientId: `c-${Date.now()}` }, as(userId));
  await service.chat.reply(bot.conversation_id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await drain(10000);
  assert.deepEqual(seenWhileRunning.steps.map((message) => message.role), ["assistant", "tool"]);
  assert.equal(seenWhileRunning.input.human, true);
  assert.equal(seenWhileRunning.input.answers, Number(sent.messages[0].id));
  assert.equal(await knex("agent_runs").where({ conversation_id: seatId }).first(), undefined, "gone once the reply ends");
});

test("a reply a stopped server left part-way carries on from its saved steps", async (context) => {
  const passes = [];
  // Only this test's bot counts: resuming looks across the whole test database, so a reply some
  // other run left part-way may be carried on here too.
  let mine = null;
  const { knex, userId, bot, service, drain, seatId } = await setup(context, async (current, history, _tools, _state, prompt) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push({ history, prompt });
    return { text: "You have notes.txt.", transcript: [{ role: "assistant", content: [{ type: "text", text: "You have notes.txt." }] }] };
  });
  mine = bot.id;
  const [asked] = await knex("messages").insert({ workspace_id: bot.workspace_id, author_user_id: userId, conversation_id: bot.conversation_id, kind: "text", role: "user", body: { text: "What files do I have?" } }).returning("*");
  // What a server that stopped mid-reply leaves behind: its steps, and a heartbeat gone quiet.
  await knex("agent_runs").insert({
    conversation_id: seatId, bot_id: bot.id, user_id: userId, heartbeat_at: knex.raw("now() - interval '5 minutes'"),
    steps: JSON.stringify(steps), input: JSON.stringify({ prompt: "", human: true, goalTurn: false, timeZone: "UTC", language: "", answers: Number(asked.id) })
  });
  await service.resumeStalled();
  await drain(10000);
  assert.equal(passes.length, 1);
  assert.match(passes[0].prompt, /interrupted part-way/u);
  assert.deepEqual(passes[0].history.at(-1).body.transcript.map((message) => message.role), ["assistant", "tool"], "it sees its saved steps");
  const stored = await knex("messages").where({ conversation_id: bot.conversation_id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.text, "You have notes.txt.");
  assert.deepEqual(stored.body.transcript.map((message) => message.role), ["assistant", "tool", "assistant"], "the saved steps stay in its transcript");
  assert.equal(await knex("agent_runs").where({ conversation_id: seatId }).first(), undefined);
  await service.resumeStalled();
  assert.equal(passes.length, 1, "nothing left to resume");
});

test("saved steps for an older message aren't carried into a newer one", async (context) => {
  const passes = [];
  // Only this test's bot counts: resuming looks across the whole test database, so a reply some
  // other run left part-way may be carried on here too.
  let mine = null;
  const { knex, as, userId, bot, service, drain, seatId } = await setup(context, async (current, history, _tools, _state, prompt) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push({ history, prompt });
    return { text: "Hello!", transcript: [] };
  });
  mine = bot.id;
  const [older] = await knex("messages").insert({ workspace_id: bot.workspace_id, author_user_id: userId, conversation_id: bot.conversation_id, kind: "text", role: "user", body: { text: "List my files" } }).returning("*");
  await knex("agent_runs").insert({
    conversation_id: seatId, bot_id: bot.id, user_id: userId, heartbeat_at: knex.raw("now() - interval '5 minutes'"),
    steps: JSON.stringify(steps), input: JSON.stringify({ prompt: "", human: true, timeZone: "UTC", language: "", answers: Number(older.id) })
  });
  const sent = await service.chat.sendMessage(bot.conversation_id, { text: "Actually, just say hello", clientId: `n-${Date.now()}` }, as(userId));
  await service.chat.reply(bot.conversation_id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await drain(10000);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].prompt, "", "a fresh reply to the newer message");
  assert.notEqual(passes[0].history.at(-1).body?.transcript?.length, 2);
});

/** A run row as a server that stopped leaves it behind: as read then, its heartbeat gone quiet. */
const leftBehind = (knex, run) => ({
  ...run,
  heartbeat_at: knex.raw("now() - interval '5 minutes'"),
  steps: run.steps === null ? null : JSON.stringify(run.steps),
  input: run.input === null ? null : JSON.stringify(run.input)
});

test("a reply whose server stopped before its first step finished is started over by any server, from the person's message", async (context) => {
  const passes = [];
  // Only this test's bot counts: resuming looks across the whole test database.
  let mine = null;
  let left = null;
  const { knex, as, userId, bot, service, drain, seatId } = await setup(context, async (current, _history, _tools, _state, prompt) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push({ prompt });
    // The first pass is where the stopped server was: in its first model call, no step finished yet. The run as it is
    // then is what that server leaves behind, and like a stopped server this pass posts nothing.
    if (passes.length === 1) {
      left = await knex("agent_runs").where({ conversation_id: seatId }).first();
      return { text: "", transcript: [] };
    }
    return { text: "You have notes.txt.", transcript: [{ role: "assistant", content: [{ type: "text", text: "You have notes.txt." }] }] };
  });
  mine = bot.id;
  const sent = await service.chat.sendMessage(bot.conversation_id, { text: "What files do I have?", clientId: `s-${Date.now()}` }, as(userId));
  await service.chat.reply(bot.conversation_id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await drain(10000);
  assert.ok(left, "the run, while its first step ran");
  await knex("agent_runs").insert(leftBehind(knex, left));
  await service.resumeStalled();
  await drain(10000);
  assert.equal(passes.length, 2, "another server starts the reply over");
  assert.equal(passes[1].prompt, "", "from the person's message, as the first pass began");
  const answers = await knex("messages").where({ conversation_id: bot.conversation_id, kind: "text", role: "bot" });
  assert.deepEqual(answers.map((message) => message.body.text), ["You have notes.txt."]);
  assert.equal(await knex("agent_runs").where({ conversation_id: seatId }).first(), undefined, "and frees its run");
});

test("a reply's run gives up its steps as the reply is posted, so a server that stopped before freeing it is never answered for twice", async (context) => {
  const passes = [];
  let mine = null;
  let left = null;
  // Set once setup answers: the chat's people hear of the reply once it's posted and before its run is freed, which is
  // where a server that stopped right after posting leaves the run.
  let seen = null;
  const notices = {
    publishEach: async (_topic, _people, event) => {
      if (!seen || left || event.type !== "messages" || !passes.length) return;
      const posted = await seen.knex("messages").where({ conversation_id: seen.bot.conversation_id, kind: "text", role: "bot" }).first();
      if (posted) left = await seen.knex("agent_runs").where({ conversation_id: seen.seatId }).first();
    }
  };
  const kit = await setup(context, async (current, _history, _tools, _state, _prompt, { onSteps }) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push(true);
    await onSteps(steps);
    return { text: "You have notes.txt.", transcript: [...steps, { role: "assistant", content: [{ type: "text", text: "You have notes.txt." }] }] };
  }, { notices });
  const { knex, as, userId, bot, service, drain, seatId } = kit;
  seen = kit;
  mine = bot.id;
  const sent = await service.chat.sendMessage(bot.conversation_id, { text: "What files do I have?", clientId: `p-${Date.now()}` }, as(userId));
  await service.chat.reply(bot.conversation_id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await drain(10000);
  assert.ok(left, "the run was still there as its reply was posted");
  await knex("agent_runs").insert(leftBehind(knex, left));
  await service.resumeStalled();
  await drain(10000);
  assert.equal(passes.length, 1, "nothing answers the message again");
  const answers = await knex("messages").where({ conversation_id: bot.conversation_id, kind: "text", role: "bot" });
  assert.deepEqual(answers.map((message) => message.body.text), ["You have notes.txt."]);
  // The run left behind stays until the bot's next claim takes it over; this test's goes now.
  await knex("agent_runs").where({ conversation_id: seatId }).del();
});

/** Waits for `ready()`, a few milliseconds at a time, failing after `most` tries. */
async function until(ready, what, most = 400) {
  for (let tries = 0; tries < most; tries += 1) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`never: ${what}`);
}

test("a reply whose run another server took over, once its own server stalled past the staleness, stops at its next heartbeat and posts and frees nothing", async (context) => {
  context.mock.method(console, "warn", () => {});
  context.mock.method(console, "error", () => {});
  const passes = [];
  let mine = null;
  let stoppedBy = null;
  let firstSettled;
  const first = new Promise((resolve) => (firstSettled = resolve));
  let answerSecond;
  const second = new Promise((resolve) => (answerSecond = resolve));
  const reply = async (current, _history, _tools, _state, _prompt, { signal }) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push(true);
    if (passes.length === 1) {
      // The stalled server's reply, in its model call: its answer comes 10 s on, unless its heartbeat stops it first.
      try {
        await new Promise((resolve, reject) => {
          const late = setTimeout(resolve, 10_000);
          signal?.addEventListener("abort", () => {
            clearTimeout(late);
            reject(signal.reason);
          }, { once: true });
        });
      } catch (error) {
        stoppedBy = error;
        throw error;
      } finally {
        firstSettled();
      }
      return { text: "The stalled server's answer.", transcript: [] };
    }
    await second;
    return { text: "The answer of the server that took it over.", transcript: [] };
  };
  // This server beats every 300 ms, so its heartbeat finds the run taken over within a beat.
  const { knex, as, userId, bot, service, drain, seatId } = await setup(context, reply, { runLimits: { staleSeconds: 60, heartbeatMs: 300 } });
  const other = await startChatTurns(context, { reply });
  mine = bot.id;
  const sent = await service.chat.sendMessage(bot.conversation_id, { text: "What files do I have?", clientId: `t-${Date.now()}` }, as(userId));
  const replying = service.chat.reply(bot.conversation_id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await until(() => passes.length === 1, "the first server's reply started");
  const claimed = await knex("agent_runs").where({ conversation_id: seatId }).first();
  const startOf = (run) => (run ? new Date(run.started_at).getTime() : null);
  // This server stalls past the staleness: to the other its heartbeat looks old, and between this one's beats the other
  // takes the run over and carries the reply on.
  await until(async () => {
    if (startOf(await knex("agent_runs").where({ conversation_id: seatId }).first()) === startOf(claimed)) {
      await knex("agent_runs").where({ conversation_id: seatId }).update({ heartbeat_at: knex.raw("now() - interval '5 minutes'") });
      await other.turns.resumeStalled();
    }
    return passes.length === 2;
  }, "the other server took the run over");
  await first;
  const afterFirst = await knex("agent_runs").where({ conversation_id: seatId }).first();
  answerSecond();
  await replying;
  await other.drain(10000);
  await drain(10000);
  const answers = await knex("messages").where({ conversation_id: bot.conversation_id, kind: "text", role: "bot" }).orderBy("id");
  assert.deepEqual(answers.map((message) => message.body.text), ["The answer of the server that took it over."], "one answer: the stalled server posts nothing");
  assert.ok(stoppedBy instanceof RunTakenOver, `its heartbeat stopped the stalled server's reply (${stoppedBy})`);
  assert.ok(afterFirst && startOf(afterFirst) !== startOf(claimed), "the stalled server frees nothing: the run is still the other server's");
  assert.equal(await knex("agent_runs").where({ conversation_id: seatId }).first(), undefined, "freed by the server that answered");
});
