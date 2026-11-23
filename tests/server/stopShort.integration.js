import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stoppedShort } from "@jskit-ai/agent/server";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// A reply that stops at "I'll take a look…" carries on from where it got to (D-48): the second
// pass sees the first one's steps instead of starting over, only its answer is shown, and the
// stored transcript keeps every step. Against the disposable test database, with scripted replies.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/**
 * Pat's bots, named, in Pat's chat (a direct chat for one bot, a chat of all of them for more), and the turns with
 * `parts` over the neutral ones. `ask(text)` is Pat writing and the bots answering, drained; `said()` is the newest
 * text a bot said in the chat.
 */
async function setup(context, parts, names = ["Bot"]) {
  const kit = await startChatTurns(context, parts);
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  const bots = await botsOf(kit, homeId, pat, names);
  const { id: chat } = await seedChat(kit.knex, names.length === 1 ? { homeId, direct: { userId: pat, botId: bots[0] } } : { homeId, people: [pat], bots });
  const as = kit.as(pat, homeId);
  async function ask(text) {
    const sent = await kit.turns.chat.sendMessage(chat, { text }, as);
    await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
    await kit.drain(10000);
    return sent.messages.at(-1);
  }
  const said = () => kit.knex("messages").where({ conversation_id: chat, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  return { ...kit, homeId, pat, bots, chat, ask, said };
}

/** A file store in a folder of the test's own. */
const fileStore = async (prefix) =>
  createFileStore({ root: "", fallback: await mkdtemp(path.join(os.tmpdir(), prefix)), ownStorage: async () => null, settle: async () => {}, explain: async () => {} });

/** The first bot's place in its chat (R6), as its turns read it. */
const placeIn = (store, { homeId, chat, bots }) => store.placeFor({ homeId, chatId: chat, chatKind: "public", botId: bots[0] });

test("a reply that stops short carries on from its own steps", async (context) => {
  const call = { type: "tool-call", toolCallId: "c1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "c1", toolName: "list_files", output: { type: "json", value: { chat: ["notes.txt"] } } };
  const passes = [];
  const { ask, said } = await setup(context, {
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push({ history, prompt });
      if (passes.length === 1) {
        return { text: "I'll take a look at the files.", transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: [{ type: "text", text: "I'll take a look at the files." }] }] };
      }
      return { text: "You have one file, notes.txt.", transcript: [{ role: "assistant", content: [{ type: "text", text: "You have one file, notes.txt." }] }] };
    }
  });
  await ask("What files do I have?");

  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1].prompt, /Carry on now/u);
  const sofar = passes[1].history.at(-1);
  assert.deepEqual(sofar.body.transcript.map((message) => message.role), ["assistant", "tool"], "the second pass has the first one's steps, without its announcement");
  const stored = await said();
  assert.equal(stored.body.text, "You have one file, notes.txt.");
  assert.deepEqual(stored.body.transcript.map((message) => message.role), ["assistant", "tool", "assistant"], "every step is kept");
});

test("a reply the provider cut off part-way is written again, whole, once, and only the whole one is posted", async (context) => {
  const passes = [];
  const cutOff = "I looked, and there's nothing I can read.\n\nWhat I do have on record is the state of the por";
  const whole = "I looked, and there's nothing I can read.\n\nWhat I do have on record is the state of the port files.";
  const { ask, said, chat, knex } = await setup(context, {
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push({ history, prompt });
      return passes.length === 1
        ? { text: cutOff, transcript: [{ role: "assistant", content: [{ type: "text", text: cutOff }] }], cut: true }
        : { text: whole, transcript: [{ role: "assistant", content: [{ type: "text", text: whole }] }], cut: true };
    }
  });
  await ask("What's on record?");
  assert.equal(passes.length, 2, "written again once, even when the second is cut too");
  assert.match(passes[1].prompt, /cut off before it ended/u);
  assert.equal(passes[1].history.at(-1).body.text, cutOff, "the second pass sees what the first wrote");
  assert.equal((await said()).body.text, whole);
  assert.equal(await knex("messages").where({ conversation_id: chat, kind: "text", role: "bot" }).count("* as n").first().then((row) => Number(row.n)), 1, "the cut reply isn't posted");
});

test("in a chat with other bots too, a reply that stops short carries on from its own steps", async (context) => {
  const call = { type: "tool-call", toolCallId: "g1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "g1", toolName: "list_files", output: { type: "json", value: { chat: [] } } };
  const passes = [];
  const { ask, said, bots: [helper] } = await setup(context, {
    reply: async (bot, history, _tools, _state, prompt, options) => {
      passes.push({ bot: String(bot.id), history, prompt, followUp: Boolean(options.followUp) });
      if (passes.length === 1) return { text: "I'll check the files first.", transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: [{ type: "text", text: "I'll check the files first." }] }] };
      return { text: "There are no files yet.", transcript: [{ role: "assistant", content: [{ type: "text", text: "There are no files yet." }] }] };
    }
  }, ["Helper", "Other"]);
  await ask(`<@bot:${helper}> what files are there?`);
  assert.deepEqual(passes.map((pass) => [pass.bot, pass.followUp]), [[helper, false], [helper, false]], "only the bot asked, sent back once");
  assert.match(passes[1].prompt, /Carry on now/u);
  assert.deepEqual(passes[1].history.at(-1).body.transcript.map((message) => message.role), ["assistant", "tool"]);
  const stored = await said();
  assert.equal(String(stored.author_bot_id), helper);
  assert.equal(stored.body.text, "There are no files yet.");
  assert.deepEqual(stored.body.transcript.map((message) => message.role), ["assistant", "tool", "assistant"]);
});

// The engine's fallback account of a reply that failed after some work ends "…and I'll pick it up…",
// which reads as stopping short; the reply ends with it instead of running a second pass.
const ACCOUNT = "I stopped before finishing, because the model service failed. Ask me to carry on and I'll pick it up from where things are.";

test("the engine's own account ends the reply and is not sent back as stopping short, alone or with other bots", async (context) => {
  assert.equal(stoppedShort(ACCOUNT), true, "the account reads as stopping short");
  const call = { type: "tool-call", toolCallId: "a1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "a1", toolName: "list_files", output: { type: "json", value: { chat: [] } } };
  const passes = [];
  const parts = {
    reply: async (bot) => {
      passes.push(String(bot.id));
      return { text: ACCOUNT, transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: ACCOUNT }], account: ACCOUNT };
    }
  };
  const alone = await setup(context, parts);
  await alone.ask("What files do I have?");
  assert.deepEqual(passes, alone.bots, "no second pass after the engine's account");
  assert.equal((await alone.said()).body.text, ACCOUNT);

  passes.length = 0;
  const together = await setup(context, parts, ["Accounted", "Other"]);
  await together.ask(`<@bot:${together.bots[0]}> what files are there?`);
  assert.deepEqual(passes, [together.bots[0]], "nor in a chat with other bots");
  assert.equal((await together.said()).body.text, ACCOUNT);
});

test("a reply with raw markup carries on once, and people never see the markup", async (context) => {
  const passes = [];
  const { ask, said } = await setup(context, {
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push({ history, prompt });
      if (passes.length === 1) return { text: "I'll look at the files first.\n\n<parameter name=\"runCommand\">ls -la /files/chat</parameter>", transcript: [] };
      return { text: "You have one file.<｜end▁of▁sentence｜>", transcript: [] };
    }
  });
  await ask("What files do I have?");
  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1].prompt, /raw markup/u);
  assert.equal((await said()).body.text, "You have one file.", "and the second pass is cleaned too");
});

test("a reply that claims files it didn't attach is sent back, and the person gets real cards without paths", async (context) => {
  const passes = [];
  const store = await fileStore("mb-claims-");
  const kit = await setup(context, {
    files: { store, apps: { session: () => ({ close() {} }) } },
    // No computer to hand over here: ask_for_help is switched off, so "card below" is about files only.
    integrations: { toolSwitches: async () => ({ skip: {}, removed: ["ask_for_help"], turnedOff: [], connected: [] }) },
    reply: async (_bot, _history, tools, _state, prompt) => {
      passes.push(prompt);
      if (passes.length === 1) return { text: "Here they are again: /files/chat/week-plan-page-2.pdf, attached as a file card below.", transcript: [] };
      await tools.sendFiles.execute({ paths: ["/files/chat/week-plan-page-2.pdf"] });
      return { text: "Here's /files/chat/week-plan-page-2.pdf again.", transcript: [] };
    }
  });
  const place = placeIn(store, kit);
  await store.list(place);
  const real = await store.resolve(place, "/files/chat/week-plan-page-2.pdf");
  await writeFile(real, "%PDF-1.4");
  await utimes(real, new Date(Date.now() - 86400000), new Date(Date.now() - 86400000));
  const sent = await kit.ask("Send me the page 2 file again");
  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1], /no file card will show/u);
  const after = await kit.knex("messages").where({ conversation_id: kit.chat }).where("id", ">", sent.id).orderBy("id");
  const card = after.find((message) => message.kind === "files");
  assert.deepEqual(card?.body.files.map((file) => file.name), ["week-plan-page-2.pdf"], "a real card for the old file");
  assert.equal(after.find((message) => message.kind === "text" && message.role === "bot").body.text, "Here's week-plan-page-2.pdf again.", "and no internal path");
});

test("\"the card below\" runs the reply once when a card really shows there, and is sent back when none does", async (context) => {
  let makesCard = true;
  let passes = [];
  let lastSeen = null;
  const { ask } = await setup(context, {
    files: {
      store: await fileStore("mb-cards-"),
      apps: { session: () => ({ close() {} }) },
      // A page saved as the files feature saves it (D-74), without its folder or versions.
      pages: { save: async ({ title }) => ({ path: "/files/bot/Pages/plan.html", title, summary: "", copied: 0, removed: [] }) }
    },
    reply: async (_bot, history, tools, _state, prompt) => {
      assert.ok(tools.askForHelp, "a bot with a computer, as the home's Builder has");
      passes.push(prompt);
      lastSeen = history.at(-1);
      if (makesCard && passes.length === 1) await tools.savePage.execute({ title: "Plan", content: "<h1>Plan</h1><p>The plan.</p>" });
      return { text: passes.length === 1 ? "It's ready: open it from the card below." : "There's no card yet.", transcript: [] };
    }
  });
  const asked = async (text) => {
    passes = [];
    await ask(text);
  };
  await asked("Make the plan");
  assert.equal(passes.length, 1, "a real card: the work isn't done again");
  makesCard = false;
  await asked("And another");
  assert.equal(passes.length >= 2, true, "no card: sent back");
  assert.match(passes[1], /you didn't call ask_for_help/u);
  assert.equal(lastSeen.body.text, "It's ready: open it from the card below.", "the second pass sees what the first one did");
});

test("the final-reply check sends back a claim the tools don't support, once, and leaves true replies alone", async (context) => {
  const passes = [];
  const checked = [];
  const { ask, said } = await setup(context, {
    checkClaims: async (reply, record) => {
      checked.push({ reply, record });
      return /emailed/u.test(reply) ? ["emailed it to Sam"] : [];
    },
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push(prompt);
      if (/capital of France/u.test(history.at(-1)?.body?.text || "")) return { text: "Paris.", transcript: [] };
      return passes.length === 1
        ? { text: "I've made the report and emailed it to Sam.", transcript: [] }
        : { text: "I've made the report. I haven't emailed Sam: want me to draft it?", transcript: [] };
    }
  });
  await ask("Make the report and send it to Sam");
  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1], /"emailed it to Sam", but no tool in this reply did that/u);
  assert.match(checked[0].record, /no tool ran/u);
  assert.match((await said()).body.text, /I haven't emailed Sam/u);
  passes.length = 0;
  checked.length = 0;
  await ask("What's the capital of France?");
  assert.equal(checked.length, 0, "a reply that reports no action isn't checked");
});

test("a check that may be wrong never tells a bot to make something up, and a question isn't a claim", async (context) => {
  const words = "Only one table exists, and nobody has created a gym visits table yet.";
  const prompts = [];
  let asks = false;
  const { ask } = await setup(context, {
    reply: async (_bot, _history, tools, _state, prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1 && asks) {
        await tools.askWithOptions.execute({ question: "How would you like to log visits?", options: ["A form", "A table"] }, {});
      }
      return { text: prompts.length === 1 ? words : "There's no table for that yet.", transcript: [] };
    }
  });
  const say = async (text) => {
    prompts.length = 0;
    await ask(text);
  };

  await say("Make me a view of my gym visits.");
  assert.equal(prompts.length, 2, "words that read like a claim are sent back once");
  assert.match(prompts[1], /Check from Mercbot/u);
  assert.match(prompts[1], /Never make up a record/u, "and never told to invent something to make them true");

  asks = true;
  await say("And another one?");
  assert.equal(prompts.length, 1, "a reply that ends by asking the person something isn't sent back");
});
