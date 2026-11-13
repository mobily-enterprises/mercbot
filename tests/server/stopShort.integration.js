import assert from "node:assert/strict";
import test from "node:test";
import { stoppedShort } from "@jskit-ai/agent/server";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// A reply that stops at "I'll take a look…" carries on from where it got to (D-48): the second
// pass sees the first one's steps instead of starting over, only its answer is shown, and the
// stored transcript keeps every step. Against the disposable test database, with scripted replies.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a reply that stops short carries on from its own steps", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Short ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const call = { type: "tool-call", toolCallId: "c1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "c1", toolName: "list_files", output: { type: "json", value: { mine: ["notes.txt"] } } };
  const passes = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push({ history, prompt });
      if (passes.length === 1) {
        return { text: "I'll take a look at the files.", transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: [{ type: "text", text: "I'll take a look at the files." }] }] };
      }
      return { text: "You have one file, notes.txt.", transcript: [{ role: "assistant", content: [{ type: "text", text: "You have one file, notes.txt." }] }] };
    }
  }));
  const sent = await service.sendMessage(bot.id, { text: "What files do I have?", clientId: `s-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await service.drain(10000);

  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1].prompt, /Carry on now/u);
  const sofar = passes[1].history.at(-1);
  assert.deepEqual(sofar.body.transcript.map((message) => message.role), ["assistant", "tool"], "the second pass has the first one's steps, without its announcement");
  const stored = await knex("bot_messages").where({ bot_id: bot.id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.text, "You have one file, notes.txt.");
  assert.deepEqual(stored.body.transcript.map((message) => message.role), ["assistant", "tool", "assistant"], "every step is kept");
});

test("in a group too, a reply that stops short carries on from its own steps", async (context) => {
  const knex = await connectTestDatabase();
  const owner = String((await knex("users").orderBy("id").first()).id);
  const homeId = await testHome(knex, owner);
  const helper = await testBot(knex, owner, { name: `Grouped ${Date.now().toString(36)}` });
  const made = [];
  context.after(async () => {
    await knex("bots").whereIn("id", [helper.id, ...made]).del();
    await knex.destroy();
  });
  const call = { type: "tool-call", toolCallId: "g1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "g1", toolName: "list_files", output: { type: "json", value: { mine: [] } } };
  const passes = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async () => ({ text: "ok", transcript: [] }),
    groupReply: async (_bot, input) => {
      passes.push(input);
      if (passes.length === 1) return { text: "I'll check the files first.", transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: [{ type: "text", text: "I'll check the files first." }] }] };
      return { text: "There are no files yet.", transcript: [{ role: "assistant", content: [{ type: "text", text: "There are no files yet." }] }] };
    }
  }));
  const { bot: group } = await service.createGroup({ botIds: [helper.id], text: "Hello" }, "Owner", as(owner));
  made.push(group.id);
  const sent = await service.sendMessage(group.id, { text: `<@bot:${helper.id}> what files are there?`, clientId: `g-${Date.now()}` }, as(owner));
  await service.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(owner));
  await service.drain(10000);
  const asked = passes.filter((input) => !input.followUp);
  assert.equal(asked.length, 2, "sent back once");
  assert.match(asked[1].prompt, /Carry on now/u);
  assert.deepEqual(asked[1].timeline.at(-1).body.transcript.map((message) => message.role), ["assistant", "tool"]);
  const said = await knex("bot_messages").where({ bot_id: group.id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(said.body.text, "There are no files yet.");
  assert.deepEqual(said.body.transcript.map((message) => message.role), ["assistant", "tool", "assistant"]);
});

// The engine's fallback account of a reply that failed after some work ends "…and I'll pick it up…",
// which reads as stopping short; the reply ends with it instead of running a second pass.
const ACCOUNT = "I stopped before finishing, because the model service failed. Ask me to carry on and I'll pick it up from where things are.";

test("the engine's own account ends the reply and is not sent back as stopping short", async (context) => {
  assert.equal(stoppedShort(ACCOUNT), true, "the account reads as stopping short");
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Account ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const call = { type: "tool-call", toolCallId: "a1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "a1", toolName: "list_files", output: { type: "json", value: { mine: [] } } };
  const passes = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push({ history, prompt });
      return { text: ACCOUNT, transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: ACCOUNT }], account: ACCOUNT };
    }
  }));
  const sent = await service.sendMessage(bot.id, { text: "What files do I have?", clientId: `a-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await service.drain(10000);

  assert.equal(passes.length, 1, "no second pass after the engine's account");
  const stored = await knex("bot_messages").where({ bot_id: bot.id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.text, ACCOUNT);
});

test("in a group too, the engine's own account ends the turn and is not sent back", async (context) => {
  const knex = await connectTestDatabase();
  const owner = String((await knex("users").orderBy("id").first()).id);
  const homeId = await testHome(knex, owner);
  const helper = await testBot(knex, owner, { name: `Accounted ${Date.now().toString(36)}` });
  const made = [];
  context.after(async () => {
    await knex("bots").whereIn("id", [helper.id, ...made]).del();
    await knex.destroy();
  });
  const call = { type: "tool-call", toolCallId: "ga1", toolName: "list_files", input: {} };
  const result = { type: "tool-result", toolCallId: "ga1", toolName: "list_files", output: { type: "json", value: { mine: [] } } };
  const passes = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async () => ({ text: "ok", transcript: [] }),
    groupReply: async (_bot, input) => {
      passes.push(input);
      return { text: ACCOUNT, transcript: [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }, { role: "assistant", content: ACCOUNT }], account: ACCOUNT };
    }
  }));
  const { bot: group } = await service.createGroup({ botIds: [helper.id], text: "Hello" }, "Owner", as(owner));
  made.push(group.id);
  const sent = await service.sendMessage(group.id, { text: `<@bot:${helper.id}> what files are there?`, clientId: `ga-${Date.now()}` }, as(owner));
  await service.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(owner));
  await service.drain(10000);
  assert.equal(passes.filter((input) => !input.followUp).length, 1, "no second pass after the engine's account");
  const said = await knex("bot_messages").where({ bot_id: group.id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(said.body.text, ACCOUNT);
});

test("a reply with raw markup carries on once, and people never see the markup", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Markup ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const passes = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, _tools, _state, prompt) => {
      passes.push({ history, prompt });
      if (passes.length === 1) return { text: "I'll look at the files first.\n\n<parameter name=\"runCommand\">ls -la /files/mine</parameter>", transcript: [] };
      return { text: "You have one file.<｜end▁of▁sentence｜>", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bot.id, { text: "What files do I have?", clientId: `m-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await service.drain(10000);
  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1].prompt, /raw markup/u);
  const stored = await knex("bot_messages").where({ bot_id: bot.id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.text, "You have one file.", "and the second pass is cleaned too");
});

test("a reply that claims files it didn't attach is sent back, and the person gets real cards without paths", async (context) => {
  const { mkdtemp, writeFile, utimes } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createFileStore } = await import("../../packages/files/src/server/fileStore.js");
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Files ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const store = createFileStore({ root: "", fallback: await mkdtemp(path.join(os.tmpdir(), "mb-claims-")), ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const row = await knex("bots").where({ id: bot.id }).first();
  const place = store.placeFor({ ...row, workspace_id: row.workspace_id, id: row.id }, userId);
  await store.list(place);
  const real = await store.resolve(place, "/files/mine/week-plan-page-2.pdf");
  await writeFile(real, "%PDF-1.4");
  await utimes(real, new Date(Date.now() - 86400000), new Date(Date.now() - 86400000));
  const passes = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    files: { store, apps: { session: () => ({ close() {} }) } },
    // No computer to hand over here: ask_for_help is switched off, so "card below" is about files only.
    integrations: { toolSwitches: async () => ({ skip: {}, removed: ["ask_for_help"], turnedOff: [] }) },
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools, _state, prompt) => {
      passes.push(prompt);
      if (passes.length === 1) return { text: "Here they are again: /files/mine/week-plan-page-2.pdf, attached as a file card below.", transcript: [] };
      await tools.sendFiles.execute({ paths: ["/files/mine/week-plan-page-2.pdf"] });
      return { text: "Here's /files/mine/week-plan-page-2.pdf again.", transcript: [] };
    }
  }));
  const sent = await service.sendMessage(bot.id, { text: "Send me the page 2 file again", clientId: `f-${Date.now()}` }, as(userId));
  await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  await service.drain(10000);
  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1], /no file card will show/u);
  const after = await knex("bot_messages").where({ bot_id: bot.id }).where("id", ">", sent.messages[0].id).orderBy("id");
  const card = after.find((message) => message.kind === "files");
  assert.deepEqual(card?.body.files.map((file) => file.name), ["week-plan-page-2.pdf"], "a real card for the old file");
  assert.equal(after.find((message) => message.kind === "text" && message.role === "bot").body.text, "Here's week-plan-page-2.pdf again.", "and no internal path");
});

test("\"the card below\" runs the reply once when a card really shows there, and is sent back when none does", async (context) => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createFileStore } = await import("../../packages/files/src/server/fileStore.js");
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Cards ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const store = createFileStore({ root: "", fallback: await mkdtemp(path.join(os.tmpdir(), "mb-cards-")), ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  let makesCard = true;
  let passes = [];
  let lastSeen = null;
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    files: {
      store,
      apps: { session: () => ({ close() {} }) },
      // A page saved as the files feature saves it (D-74), without its folder or versions.
      pages: { save: async ({ title }) => ({ path: "/files/bot/Pages/plan.html", title, summary: "", copied: 0, removed: [] }) }
    },
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history, tools, _state, prompt) => {
      assert.ok(tools.askForHelp, "a bot with a computer, as the home's Builder has");
      passes.push(prompt);
      lastSeen = history.at(-1);
      if (makesCard && passes.length === 1) await tools.savePage.execute({ title: "Plan", content: "<h1>Plan</h1><p>The plan.</p>" });
      return { text: passes.length === 1 ? "It's ready: open it from the card below." : "There's no card yet.", transcript: [] };
    }
  }));
  const ask = async (text) => {
    passes = [];
    const sent = await service.sendMessage(bot.id, { text, clientId: `c-${Date.now()}-${text}` }, as(userId));
    await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await service.drain(10000);
  };
  await ask("Make the plan");
  assert.equal(passes.length, 1, "a real card: the work isn't done again");
  makesCard = false;
  await ask("And another");
  assert.equal(passes.length >= 2, true, "no card: sent back");
  assert.match(passes[1], /you didn't call ask_for_help/u);
  assert.equal(lastSeen.body.text, "It's ready: open it from the card below.", "the second pass sees what the first one did");
});

test("the final-reply check sends back a claim the tools don't support, once, and leaves true replies alone", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Claims ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const passes = [];
  const checked = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
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
  }));
  const ask = async (text) => {
    const sent = await service.sendMessage(bot.id, { text, clientId: `c-${Date.now()}-${Math.random()}` }, as(userId));
    await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await service.drain(10000);
  };
  await ask("Make the report and send it to Sam");
  assert.equal(passes.length, 2, "sent back once");
  assert.match(passes[1], /"emailed it to Sam", but no tool in this reply did that/u);
  assert.match(checked[0].record, /no tool ran/u);
  const said = await knex("bot_messages").where({ bot_id: bot.id, kind: "text", role: "bot" }).orderBy("id", "desc").first();
  assert.match(said.body.text, /I haven't emailed Sam/u);
  passes.length = 0;
  checked.length = 0;
  await ask("What's the capital of France?");
  assert.equal(checked.length, 0, "a reply that reports no action isn't checked");
});

test("a check that may be wrong never tells a bot to make something up, and a question isn't a claim", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Checked ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const words = "Only one table exists, and nobody has created a gym visits table yet.";
  const prompts = [];
  let asks = false;
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools, _state, prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1 && asks) {
        await tools.askWithOptions.execute({ question: "How would you like to log visits?", options: ["A form", "A table"] }, {});
      }
      return { text: prompts.length === 1 ? words : "There's no table for that yet.", transcript: [] };
    }
  }));
  const say = async (text) => {
    prompts.length = 0;
    const sent = await service.sendMessage(bot.id, { text, clientId: `c-${Date.now()}-${Math.random()}` }, as(userId));
    await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await service.drain(5000);
  };

  await say("Make me a view of my gym visits.");
  assert.equal(prompts.length, 2, "words that read like a claim are sent back once");
  assert.match(prompts[1], /Check from Mercbot/u);
  assert.match(prompts[1], /Never make up a record/u, "and never told to invent something to make them true");

  asks = true;
  await say("And another one?");
  assert.equal(prompts.length, 1, "a reply that ends by asking the person something isn't sent back");
});
