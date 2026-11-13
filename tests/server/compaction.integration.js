import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { SUMMARY_LIMITS as LIMITS } from "@jskit-ai/agent/server";
import { testBot } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// Compacting bots' chats in the background (owner, 2026-10-30): past a size, a conversation is
// queued; one server summarises all but its latest turns, folding in the previous summary; replies
// read the summary plus every message after it word for word, transcripts included; messages that
// arrive while it runs stay as they are; failures wait and try again; a room's first summary takes
// in what it inherited.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const limits = { ...LIMITS, compactAt: 500, keepTurns: 2, keepTokens: 400, minTokens: 50 };

test("long chats are summarised in the background and replies read the summary", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: "Memo" });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });

  const seen = [];
  const summaries = [];
  let summarizer = async ({ previous, text }) => {
    summaries.push({ previous, text });
    return `SUMMARY ${summaries.length}`;
  };
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const bots = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    compactionLimits: limits,
    summarize: (input) => summarizer(input),
    reply: async (_bot, timeline, _tools, _state, _prompt, options = {}) => {
      seen.push({ timeline, summary: options.summary });
      const n = seen.length;
      return {
        text: `Answer ${n}`,
        transcript: [
          { role: "assistant", content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "lookUp", input: { q: `question ${n}` } }] },
          { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: "lookUp", output: { type: "text", value: `found ${n}` } }] },
          { role: "assistant", content: [{ type: "text", text: `Answer ${n}` }] }
        ]
      };
    }
  }));
  // A reply, and the check it starts in the background for whether the chat now needs a summary.
  const say = async (text) => {
    const sent = await bots.sendMessage(bot.id, { text }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await bots.drain(5000);
  };
  const queued = () => knex("agent_summary_queue").where({ conversation_id: bot.conversation_id }).first();

  // Below the size nothing is queued; past it, the conversation is.
  await say("My name is Ada and my budget is 4,200 euros. " + "Some detail. ".repeat(20));
  assert.equal(await queued(), undefined);
  for (let index = 2; index <= 6; index += 1) await say(`Message ${index}. ` + "More detail. ".repeat(30));
  assert.ok(await queued(), "queued once the chat grew past the limit");
  assert.equal(seen.at(-1).summary, "", "no summary yet: the reply read everything");
  assert.ok(seen.at(-1).timeline.some((message) => Array.isArray(message.body.transcript)), "replies are read with their transcripts");

  // Two servers try at once: one summarises.
  let release;
  let claimed;
  const gate = new Promise((resolve) => (release = resolve));
  const summarising = new Promise((resolve) => (claimed = resolve));
  summarizer = async ({ previous, text }) => {
    claimed();
    await gate;
    summaries.push({ previous, text });
    return `SUMMARY ${summaries.length}`;
  };
  const first = bots.compaction.runOne();
  await Promise.race([summarising, first]); // a run that never summarises fails below instead of waiting
  assert.equal(await bots.compaction.runOne(), false, "the other server finds nothing to claim");
  // A message arriving while the summary is written stays word for word after it.
  await say("Arrived during the summary.");
  release();
  await first;
  const [summary] = await knex("agent_summaries").where({ conversation_id: bot.conversation_id });
  assert.equal(summaries.length, 1);
  assert.match(summaries[0].text, /^Person: My name is Ada and my budget is 4,200 euros\./mu);
  assert.match(summaries[0].text, /Bot used lookUp\(\{"q":"question 1"\}\)/u, "the summariser reads what the bot did");
  assert.ok(!summaries[0].text.includes("Arrived during the summary."));
  assert.equal(await queued(), undefined, "done, and nothing more queued while the rest is small");

  // The next reply reads the summary and only the messages after it, the newest included.
  await say("What is my budget?");
  const last = seen.at(-1);
  assert.equal(last.summary, "SUMMARY 1");
  assert.ok(last.timeline.every((message) => Number(message.id) > Number(summary.covers_up_to)));
  assert.ok(last.timeline.some((message) => message.body.text === "Arrived during the summary."));
  assert.equal(last.timeline[0].role, "user", "it starts at a turn");
  assert.ok(!last.timeline.some((message) => /My name is Ada/u.test(message.body.text || "")), "summarised messages aren't read again");

  // A failure waits and tries again later; the chat goes on as it was.
  for (let index = 0; index < 6; index += 1) await say(`Later ${index}. ` + "Even more. ".repeat(30));
  assert.ok(await queued());
  summarizer = async () => {
    throw new Error("model unavailable");
  };
  await bots.compaction.runOne();
  const failed = await queued();
  assert.equal(failed.attempts, 1);
  assert.match(failed.last_error, /model unavailable/u);
  assert.ok(new Date(failed.run_after) > new Date(), "tried again later");
  assert.equal(await bots.compaction.runOne(), false, "not before its time");

  // The next summary folds in the previous one.
  await knex("agent_summary_queue").where({ conversation_id: bot.conversation_id }).update({ run_after: knex.fn.now() });
  summarizer = async ({ previous, text }) => {
    summaries.push({ previous, text });
    return `SUMMARY ${summaries.length}`;
  };
  await bots.compaction.runOne();
  assert.equal(summaries.at(-1).previous, "SUMMARY 1");
  assert.ok(!summaries.at(-1).text.includes("My name is Ada"), "only what came after the previous summary");
  await say("And now?");
  assert.equal(seen.at(-1).summary, "SUMMARY 2");
  // The page still shows the whole conversation.
  const { messages: all } = await bots.messages(bot.id, null, {}, as(userId));
  assert.ok(all.some((message) => /My name is Ada/u.test(message.body?.text || "")));
});

test("a room's first summary takes in what it inherited", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: "Roomy" });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const captured = [];
  const records = await startBotRecords(knex, context);
  const bots = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    compactionLimits: { ...limits, minTokens: 1 },
    summarize: async ({ text }) => {
      captured.push(text);
      return "ROOM SUMMARY";
    },
    reply: async () => ({ text: "ok", transcript: [] })
  }));
  const [general] = await knex("bot_conversations").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, user_id: null, title: "General" }).returning("*");
  const [fork] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: general.id, kind: "text", role: "user", body: { text: "Inherited: the launch is on 3 March.", from: { id: String(userId), name: "Ada" } } }).returning("*");
  const [room] = await knex("bot_conversations").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, user_id: null, title: "Launch", parent_id: general.id, forked_at_message_id: fork.id }).returning("*");
  for (let index = 0; index < 4; index += 1) {
    await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: room.id, kind: "text", role: "user", body: { text: `Room message ${index}`, from: { id: String(userId), name: "Ada" } } });
    await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: room.id, kind: "text", role: "bot", body: { text: `Room answer ${index}` } });
  }
  await bots.compaction.compact(room.id);
  assert.match(captured[0], /^Ada: Inherited: the launch is on 3 March\./mu, "inherited, with the person's name");
  assert.match(captured[0], /^Ada: Room message 0$/mu);
  assert.match(captured[0], /^Bot: Room answer 0$/mu);
  assert.equal((await knex("agent_summaries").where({ conversation_id: room.id }).first()).summary, "ROOM SUMMARY");
});

test("a group chat is summarised with who said what", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const ana = await testBot(knex, userId, { name: "Ana" });
  const ben = await testBot(knex, userId, { name: "Ben" });
  const captured = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: ana.workspace_id });
  const bots = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    compactionLimits: { ...limits, minTokens: 1 },
    summarize: async ({ text }) => {
      captured.push(text);
      return "GROUP SUMMARY";
    },
    reply: async () => ({ text: "ok", transcript: [] })
  }));
  const { bot: group } = await bots.createGroup({ botIds: [String(ana.id), String(ben.id)] }, "Pat", as(userId));
  context.after(async () => {
    await knex("bots").whereIn("id", [ana.id, ben.id, group.id]).del();
    await knex.destroy();
  });
  const conversation = await knex("bot_conversations").where({ bot_id: group.id, user_id: userId }).first();
  for (let index = 0; index < 3; index += 1) {
    await knex("bot_messages").insert({ workspace_id: conversation.workspace_id, bot_id: group.id, conversation_id: conversation.id, kind: "text", role: "user", body: { text: `Plan step ${index}?` } });
    await knex("bot_messages").insert({ workspace_id: conversation.workspace_id, bot_id: group.id, conversation_id: conversation.id, kind: "text", role: "bot", body: { text: `Ana's idea ${index}`, speaker: { id: String(ana.id), name: "Ana" } } });
    await knex("bot_messages").insert({ workspace_id: conversation.workspace_id, bot_id: group.id, conversation_id: conversation.id, kind: "text", role: "bot", body: { text: `Ben's idea ${index}`, speaker: { id: String(ben.id), name: "Ben" } } });
  }
  await bots.compaction.compact(conversation.id);
  assert.match(captured[0], /^Ana \(bot\): Ana's idea 0$/mu, "each bot by name");
  assert.match(captured[0], /^Ben \(bot\): Ben's idea 0$/mu);
  assert.match(captured[0], /^[^:]+: Plan step 0\?$/mu);
});

test("a reply summarises first, rather than dropping messages unseen, when summarising fell behind", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: "Catchup" });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const conversationId = (await knex("bot_conversations").where({ bot_id: bot.id }).first()).id;
  // A long chat no background summary has caught up with (none queued, none run).
  const filler = "We talked about the garden, the weather and the week ahead. ".repeat(14);
  for (let n = 0; n < 12; n += 1) {
    await knex("bot_messages").insert([
      { workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: "text", role: "user", body: { text: `${n === 0 ? "My sister Lucia's birthday is 14 March. " : ""}${filler}` } },
      { workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: "text", role: "bot", body: { text: `Noted. ${filler}` } }
    ]);
  }
  const summaries = [];
  const seen = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const bots = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    compactionLimits: { ...LIMITS, compactAt: 1000000, summariseNowAt: 1500, keepTurns: 2, keepTokens: 400, minTokens: 50 },
    summarize: async ({ text }) => {
      summaries.push(text);
      return `SUMMARY: ${/Lucia's birthday is 14 March/u.test(text) ? "Lucia's birthday is 14 March." : "nothing"}`;
    },
    reply: async (_bot, timeline, _tools, _state, _prompt, options = {}) => {
      seen.push({ timeline, summary: options.summary });
      return { text: "14 March.", transcript: [] };
    }
  }));
  const sent = await bots.sendMessage(bot.id, { text: "When is Lucia's birthday?", clientId: `c-${Date.now()}` }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await bots.drain(10000);
  assert.ok(summaries.length >= 1, "it summarised before the reply");
  assert.match(seen[0].summary, /Lucia's birthday is 14 March/u, "and the reply read the summary, so the oldest fact isn't lost");
  assert.ok(seen[0].timeline.length < 25, "while reading fewer messages word for word");
  assert.equal(seen[0].timeline.at(-1).body.text, "When is Lucia's birthday?");
});
