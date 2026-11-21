import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LIMITS as LIMITS } from "@jskit-ai/agent/server";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// Compacting chats in the background (owner, 2026-10-30; one summary per chat, D-112): past a size, a chat is queued;
// one server summarises all but its latest turns, folding in the previous summary; replies read the summary plus every
// message after it word for word, transcripts included; messages that arrive while it runs stay as they are; failures
// wait and try again. A chat's only bot reads it alone, so its tool calls are kept; with several bots, each one's words
// are under its name and no bot's tool calls are in it (R5).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const limits = { ...LIMITS, compactAt: 500, keepTurns: 2, keepTokens: 400, minTokens: 50 };

/** Pat's home, with Pat's bots of `names` and a chat of Pat and them. */
async function chatOf(kit, names) {
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  const bots = await botsOf(kit, homeId, pat, names);
  const { id: chat } = await seedChat(kit.knex, { homeId, people: [pat], bots });
  return { homeId, pat, bots, chat };
}

test("long chats are summarised in the background and replies read the summary", async (context) => {
  const seen = [];
  const summaries = [];
  let summarizer = async ({ previous, text }) => {
    summaries.push({ previous, text });
    return `SUMMARY ${summaries.length}`;
  };
  const kit = await startChatTurns(context, {
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
  });
  const { knex } = kit;
  const bots = kit.turns;
  const { homeId, pat, chat } = await chatOf(kit, ["Memo"]);
  // A reply, and the check it starts in the background for whether the chat now needs a summary.
  const say = async (text) => {
    const sent = await bots.chat.sendMessage(chat, { text }, kit.as(pat, homeId));
    await bots.chat.reply(chat, { afterMessageId: sent.messages[0].id }, undefined, kit.as(pat, homeId));
    await kit.drain(5000);
  };
  const queued = () => knex("agent_summary_queue").where({ conversation_id: chat }).first();

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
  const [summary] = await knex("agent_summaries").where({ conversation_id: chat });
  assert.equal(summaries.length, 1);
  assert.match(summaries[0].text, /^Pat: My name is Ada and my budget is 4,200 euros\./mu, "each person under their name");
  assert.match(summaries[0].text, /Bot used lookUp\(\{"q":"question 1"\}\)/u, "the chat's only bot reads it alone: the summariser reads what it did");
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
  await knex("agent_summary_queue").where({ conversation_id: chat }).update({ run_after: knex.fn.now() });
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
  const { messages: all } = await bots.chat.messages(chat, {}, kit.as(pat, homeId));
  assert.ok(all.some((message) => /My name is Ada/u.test(message.body?.text || "")));
});

test("a chat with several bots is summarised with who said what, and none of their tool calls", async (context) => {
  const captured = [];
  const kit = await startChatTurns(context, {
    compactionLimits: { ...limits, minTokens: 1 },
    summarize: async ({ text }) => {
      captured.push(text);
      return "GROUP SUMMARY";
    },
    reply: async () => ({ text: "ok", transcript: [] })
  });
  const { homeId, pat, bots: [ana, ben], chat } = await chatOf(kit, ["Ana", "Ben"]);
  const looked = [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "searchMail", input: { q: "venues" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "searchMail", output: { type: "text", value: "Kim's mail" } }] }
  ];
  for (let index = 0; index < 3; index += 1) {
    await seedMessage(kit.knex, { homeId, chatId: chat, userId: pat, body: { text: `Plan step ${index}?` } });
    await seedMessage(kit.knex, { homeId, chatId: chat, botId: ana, body: { text: `Ana's idea ${index}`, transcript: [...looked, { role: "assistant", content: [{ type: "text", text: `Ana's idea ${index}` }] }] } });
    await seedMessage(kit.knex, { homeId, chatId: chat, botId: ben, body: { text: `Ben's idea ${index}` } });
  }
  await kit.turns.compaction.compact(chat);
  assert.match(captured[0], /^Ana \(bot\): Ana's idea 0$/mu, "each bot by name");
  assert.match(captured[0], /^Ben \(bot\): Ben's idea 0$/mu);
  assert.match(captured[0], /^Pat: Plan step 0\?$/mu, "and each person");
  assert.doesNotMatch(captured[0], /searchMail|Kim's mail/u, "Ben reads this summary too: Ana's tool calls and results aren't in it");
  assert.equal((await kit.knex("agent_summaries").where({ conversation_id: chat }).first()).summary, "GROUP SUMMARY");
});

test("a reply summarises first, rather than dropping messages unseen, when summarising fell behind", async (context) => {
  const summaries = [];
  const seen = [];
  const kit = await startChatTurns(context, {
    compactionLimits: { ...LIMITS, compactAt: 1000000, summariseNowAt: 1500, keepTurns: 2, keepTokens: 400, minTokens: 50 },
    summarize: async ({ text }) => {
      summaries.push(text);
      return `SUMMARY: ${/Lucia's birthday is 14 March/u.test(text) ? "Lucia's birthday is 14 March." : "nothing"}`;
    },
    reply: async (_bot, timeline, _tools, _state, _prompt, options = {}) => {
      seen.push({ timeline, summary: options.summary });
      return { text: "14 March.", transcript: [] };
    }
  });
  const { homeId, pat, bots: [catchup], chat } = await chatOf(kit, ["Catchup"]);
  // A long chat no background summary has caught up with (none queued, none run).
  const filler = "We talked about the garden, the weather and the week ahead. ".repeat(14);
  for (let n = 0; n < 12; n += 1) {
    await seedMessage(kit.knex, { homeId, chatId: chat, userId: pat, body: { text: `${n === 0 ? "My sister Lucia's birthday is 14 March. " : ""}${filler}` } });
    await seedMessage(kit.knex, { homeId, chatId: chat, botId: catchup, body: { text: `Noted. ${filler}` } });
  }
  const sent = await kit.turns.chat.sendMessage(chat, { text: "When is Lucia's birthday?", clientId: `c-${Date.now()}` }, kit.as(pat, homeId));
  await kit.turns.chat.reply(chat, { afterMessageId: sent.messages[0].id }, undefined, kit.as(pat, homeId));
  await kit.drain(10000);
  assert.ok(summaries.length >= 1, "it summarised before the reply");
  assert.match(seen[0].summary, /Lucia's birthday is 14 March/u, "and the reply read the summary, so the oldest fact isn't lost");
  assert.ok(seen[0].timeline.length < 25, "while reading fewer messages word for word");
  assert.equal(seen[0].timeline.at(-1).body.text, "When is Lucia's birthday?");
});
