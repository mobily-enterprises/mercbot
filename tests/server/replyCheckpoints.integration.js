import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// A reply saves its steps as each one finishes, and one a stopped server left part-way is carried
// on from them by any server, with no page needed (D-48, D-19). Against the disposable test
// database, with scripted replies standing in for the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const call = { type: "tool-call", toolCallId: "c1", toolName: "list_files", input: {} };
const result = { type: "tool-result", toolCallId: "c1", toolName: "list_files", output: { type: "json", value: { mine: ["notes.txt"] } } };
const steps = [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }];

async function setup(context, reply) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Resume ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  // A reply a stopped server left is carried on in the bots' system context, for the conversation's person.
  const service = createBotsService(serviceDoubles({ knex, ...(await startBotParts(knex, context)), approvals: { decide: async () => "allow" }, reply }));
  const conversationId = (await knex("bot_conversations").where({ bot_id: bot.id }).first()).id;
  /** The person's request in the bot's home, as the bots routes make its options. */
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  return { knex, userId, as, bot, service, conversationId };
}

test("steps are saved while a reply runs, then cleared when it ends", async (context) => {
  let seenWhileRunning = null;
  const { knex, as, userId, bot, service, conversationId } = await setup(context, async (_bot, _history, _tools, _state, _prompt, { onSteps }) => {
    await onSteps(steps);
    seenWhileRunning = await knex("agent_runs").where({ conversation_id: conversationId }).first();
    return { text: "You have notes.txt.", transcript: [...steps, { role: "assistant", content: [{ type: "text", text: "You have notes.txt." }] }] };
  });
  const sent = await service.sendMessage(bot.id, { text: "What files do I have?", clientId: `c-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await service.drain(10000);
  assert.deepEqual(seenWhileRunning.steps.map((message) => message.role), ["assistant", "tool"]);
  assert.equal(seenWhileRunning.input.human, true);
  assert.equal(seenWhileRunning.input.answers, Number(sent.messages[0].id));
  assert.equal(await knex("agent_runs").where({ conversation_id: conversationId }).first(), undefined, "gone once the reply ends");
});

test("a reply a stopped server left part-way carries on from its saved steps", async (context) => {
  const passes = [];
  // Only this test's bot counts: resuming looks across the whole test database, so a reply some
  // other run left part-way may be carried on here too.
  let mine = null;
  const { knex, userId, bot, service, conversationId } = await setup(context, async (current, history, _tools, _state, prompt) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push({ history, prompt });
    return { text: "You have notes.txt.", transcript: [{ role: "assistant", content: [{ type: "text", text: "You have notes.txt." }] }] };
  });
  mine = bot.id;
  const [asked] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: "text", role: "user", body: { text: "What files do I have?" } }).returning("*");
  // What a server that stopped mid-reply leaves behind: its steps, and a heartbeat gone quiet.
  await knex("agent_runs").insert({
    conversation_id: conversationId, bot_id: bot.id, heartbeat_at: knex.raw("now() - interval '5 minutes'"),
    steps: JSON.stringify(steps), input: JSON.stringify({ prompt: "", human: true, goalTurn: false, timeZone: "UTC", language: "", answers: Number(asked.id) })
  });
  await service.resumeStalled();
  await service.drain(10000);
  assert.equal(passes.length, 1);
  assert.match(passes[0].prompt, /interrupted part-way/u);
  assert.deepEqual(passes[0].history.at(-1).body.transcript.map((message) => message.role), ["assistant", "tool"], "it sees its saved steps");
  const stored = await knex("bot_messages").where({ conversation_id: conversationId, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.text, "You have notes.txt.");
  assert.deepEqual(stored.body.transcript.map((message) => message.role), ["assistant", "tool", "assistant"], "the saved steps stay in its transcript");
  assert.equal(await knex("agent_runs").where({ conversation_id: conversationId }).first(), undefined);
  await service.resumeStalled();
  assert.equal(passes.length, 1, "nothing left to resume");
  void userId;
});

test("saved steps for an older message aren't carried into a newer one", async (context) => {
  const passes = [];
  // Only this test's bot counts: resuming looks across the whole test database, so a reply some
  // other run left part-way may be carried on here too.
  let mine = null;
  const { knex, as, userId, bot, service, conversationId } = await setup(context, async (current, history, _tools, _state, prompt) => {
    if (String(current.id) !== String(mine)) return { text: "", transcript: [] };
    passes.push({ history, prompt });
    return { text: "Hello!", transcript: [] };
  });
  mine = bot.id;
  const [older] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: "text", role: "user", body: { text: "List my files" } }).returning("*");
  await knex("agent_runs").insert({
    conversation_id: conversationId, bot_id: bot.id, heartbeat_at: knex.raw("now() - interval '5 minutes'"),
    steps: JSON.stringify(steps), input: JSON.stringify({ prompt: "", human: true, timeZone: "UTC", language: "", answers: Number(older.id) })
  });
  const sent = await service.sendMessage(bot.id, { text: "Actually, just say hello", clientId: `n-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await service.drain(10000);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].prompt, "", "a fresh reply to the newer message");
  assert.notEqual(passes[0].history.at(-1).body?.transcript?.length, 2);
});
