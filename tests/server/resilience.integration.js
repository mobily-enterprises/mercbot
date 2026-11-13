import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { APICallError } from "ai";
import { ownedHandles, startIntegrations } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";
import { startBotsService, turnDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts, startBotRecordsWithAccount } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Disposable machines (D-19), against the disposable test database: a bot's browser state comes
// back on another machine, and repeated sends and replies don't double up.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
process.env.MERCBOT_VAULT_KEY = process.env.MERCBOT_VAULT_KEY || randomBytes(32).toString("base64");
const { createBrowserState } = await import("../../packages/computer/src/server/browserState.js");
const { COMPUTER_OWNS } = await import("../../packages/computer/src/server/ComputerFeature.js");
const { createComputerRecords } = await import("../../packages/computer/src/server/computerRecords.js");
const { createFileStore } = await import("../../packages/files/src/server/fileStore.js");

async function setup(context) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Disposable" });
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  // The bots service's records, users.profiles, workspaces and system context, as BotsFeature is given them.
  const parts = await startBotParts(knex, cleanup);
  /** The person's request in the bot's home, as the bots routes make its options. */
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  return { knex, parts, as, userId, bot, cleanup };
}

/**
 * A live copy's environment (SIDE_EFFECTS=live, D-69): what the bots send from connected accounts goes out for real,
 * to the stand-ins for the providers here. Without it, as in a test copy, the sends are only logged.
 */
const live = () => ({ ...process.env, SIDE_EFFECTS: "live" });

/** The accounts a call reaches, as the integrations service reads them (the person's own connected apps), on the test's Knex. */
async function connectedAccounts(knex, context) {
  return (await startIntegrations(knex, context, { catalogue: [] })).integrations.reachableAccounts;
}

/**
 * The integrations service's reads with `catalogue` as its apps, on the test's Knex: the accounts a call reaches, and
 * the apps' entries and names (no provider is called).
 */
async function connectAppsReads(knex, context, catalogue) {
  const { reachableAccounts, app, appName, appNamed, hasConnected } = (await startIntegrations(knex, context, { catalogue })).integrations;
  return { reachableAccounts, app, appName, appNamed, hasConnected };
}

test("a bot's browser profile and newer cookies come back on another machine", async (context) => {
  const { knex, bot, cleanup } = await setup(context);
  // The saved browser is sealed files on the shared volume, never in the database (D-50).
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // The saved browsers' records as the computers keep them, in the bot's home.
  const { resources, systemContext } = (await ownedHandles(knex, cleanup, { "mercbot.computer": COMPUTER_OWNS })).features["mercbot.computer"];
  const records = createComputerRecords({
    resources,
    system: () => ({ context: systemContext("save and restore the test bot's browser") }),
    homeOf: async () => String(bot.workspace_id)
  });
  const state = createBrowserState({ records, env: process.env, folderOf: (id) => store.computerFolder(id) });
  const machineA = await mkdtemp(path.join(os.tmpdir(), "mercbot-a-"));
  const machineB = await mkdtemp(path.join(os.tmpdir(), "mercbot-b-"));
  context.after(() => Promise.all([machineA, machineB, volume].map((dir) => rm(dir, { recursive: true, force: true }))));
  const folder = path.join(volume, "computers", String(bot.conversation_id));
  await mkdir(path.join(machineA, "Default", "Cache"), { recursive: true });
  await writeFile(path.join(machineA, "Default", "Cookies"), "signed-in");
  await writeFile(path.join(machineA, "Default", "Cache", "big"), "x".repeat(10000));
  await writeFile(path.join(machineA, "SingletonLock"), "machine-a");

  await state.save(String(bot.conversation_id), machineA, "https://example.com/inbox");
  let row = await knex("bot_browser_state").where({ conversation_id: bot.conversation_id }).first();
  assert.equal("profile" in row, false, "no profile bytes in the database");
  assert.ok(!(await readFile(path.join(folder, row.profile_file))).toString("latin1").includes("signed-in"), "the saved profile is sealed");
  // Saving again replaces the file, and only then removes the old one.
  const first = row.profile_file;
  await state.save(String(bot.conversation_id), machineA, "https://example.com/inbox");
  row = await knex("bot_browser_state").where({ conversation_id: bot.conversation_id }).first();
  assert.notEqual(row.profile_file, first);
  assert.deepEqual((await readdir(folder)).filter((name) => name.startsWith("profile-")), [row.profile_file]);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await state.snapshotCookies(String(bot.conversation_id), [{ name: "session", value: "abc", domain: "example.com", path: "/" }], "https://example.com/inbox");
  const restored = await state.restore(String(bot.conversation_id), machineB);
  assert.equal(await readFile(path.join(machineB, "Default", "Cookies"), "utf8"), "signed-in");
  await assert.rejects(stat(path.join(machineB, "Default", "Cache", "big")), "caches aren't kept");
  await assert.rejects(stat(path.join(machineB, "SingletonLock")), "the other machine's lock isn't kept");
  assert.deepEqual(restored.cookies.map((cookie) => cookie.name), ["session"]);
  assert.equal(restored.url, "https://example.com/inbox");

  // A file that isn't the one recorded is ignored rather than restored.
  await writeFile(path.join(folder, "cookies.sealed"), "tampered");
  const machineC = await mkdtemp(path.join(os.tmpdir(), "mercbot-c-"));
  context.after(() => rm(machineC, { recursive: true, force: true }));
  assert.deepEqual((await state.restore(String(bot.conversation_id), machineC)).cookies, []);

  await state.forget(String(bot.conversation_id));
  assert.equal(await knex("bot_browser_state").where({ conversation_id: bot.conversation_id }).first(), undefined);
  assert.deepEqual(await readdir(folder), []);
});

test("a repeated send stores one message, and a repeated reply returns the first answer", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  let replies = 0;
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => {
      replies += 1;
      return { text: `Answer ${replies}`, transcript: [] };
    }
  });
  const first = await bots.sendMessage(bot.id, { text: "Hello", clientId: "pending-1" }, as(userId));
  const again = await bots.sendMessage(bot.id, { text: "Hello", clientId: "pending-1" }, as(userId));
  assert.equal(again.messages[0].id, first.messages[0].id);
  const userMessageId = first.messages[0].id;

  const answer = await bots.replyTo(bot.id, { afterMessageId: userMessageId }, undefined, as(userId));
  const retried = await bots.replyTo(bot.id, { afterMessageId: userMessageId }, undefined, as(userId));
  assert.equal(replies, 1);
  assert.deepEqual(retried.messages.map((message) => message.id), answer.messages.map((message) => message.id));
  const texts = (await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "text" }).orderBy("id")).map((row) => row.body.text);
  assert.deepEqual(texts, ["Hello", "Answer 1"]);
});

// A bot always finishes a reply with a message, and never runs two at once.
test("two requests at once make one reply, and a failed reply still posts a message", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  let replies = 0;
  let failure = null;
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => {
      replies += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (failure) throw failure;
      return { text: `Answer ${replies}`, transcript: [] };
    }
  });
  const sent = await bots.sendMessage(bot.id, { text: "Hello", clientId: "pending-a" }, as(userId));
  const after = sent.messages[0].id;
  const [one, two] = await Promise.all([bots.replyTo(bot.id, { afterMessageId: after }, undefined, as(userId)), bots.replyTo(bot.id, { afterMessageId: after }, undefined, as(userId))]);
  assert.equal(replies, 1, "only one reply ran");
  assert.equal([one, two].filter((result) => result.pending).length, 1, "the second request was told it's pending");
  assert.equal(await knex("agent_runs").where({ conversation_id: bot.conversation_id }).first(), undefined, "the claim is released");

  const logged = context.mock.method(console, "error", () => {});
  failure = new Error("the model went away");
  const second = await bots.sendMessage(bot.id, { text: "Again", clientId: "pending-b" }, as(userId));
  const failed = await bots.replyTo(bot.id, { afterMessageId: second.messages[0].id }, undefined, as(userId));
  assert.match(failed.messages.at(-1).body.text, /something went wrong on my side/u);

  // A model call's failure is logged as its status and message, never the error, which carries the person's message.
  failure = new APICallError({ message: "Invalid API key", url: "https://models.example/v1/chat/completions", requestBodyValues: { messages: [{ role: "user", content: "Once more" }] }, statusCode: 401, isRetryable: false });
  const third = await bots.sendMessage(bot.id, { text: "Once more", clientId: "pending-c" }, as(userId));
  const refused = await bots.replyTo(bot.id, { afterMessageId: third.messages[0].id }, undefined, as(userId));
  assert.match(refused.messages.at(-1).body.text, /something went wrong on my side/u);
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments).filter(([line]) => String(line).includes("reply failed")), [
    [`Bot ${bot.id}'s reply failed: the model went away`],
    [`Bot ${bot.id}'s reply failed: its model call failed (status 401): Invalid API key`]
  ]);
});

test("a reply whose server stopped is taken over by the next request", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => ({ text: "Taken over", transcript: [] })
  });
  const sent = await bots.sendMessage(bot.id, { text: "Hello", clientId: "pending-c" }, as(userId));
  const after = sent.messages[0].id;
  await knex("agent_runs").insert({ conversation_id: bot.conversation_id, bot_id: bot.id });
  assert.equal((await bots.replyTo(bot.id, { afterMessageId: after }, undefined, as(userId))).pending, true, "a live reply isn't doubled");
  await knex("agent_runs").where({ conversation_id: bot.conversation_id }).update({ heartbeat_at: knex.raw("now() - interval '5 minutes'") });
  const result = await bots.replyTo(bot.id, { afterMessageId: after }, undefined, as(userId));
  assert.equal(result.messages.at(-1).body.text, "Taken over");
});

test("a bot that says it handed its screen over without doing it is sent back to do it", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const calls = [];
  const computer = { status: async () => ({ state: "awake", url: "https://example.com/login" }), screenshot: async () => null, hold: async () => {} };
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    computer,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools, _state, prompt) => {
      calls.push(prompt || "");
      if (!prompt.includes("Check from Mercbot")) return { text: "I'm handing the screen over now — you'll see the card below.", transcript: [] };
      await tools.askForHelp.execute({ task: "Sign in to example.com" });
      return { text: "The sign-in page is open and the screen is yours now.", transcript: [] };
    }
  });
  const sent = await bots.sendMessage(bot.id, { text: "Hand me the screen please", clientId: "pending-h" }, as(userId));
  const result = await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  assert.equal(calls.length, 2, "the reply was sent back once");
  assert.ok(result.messages.some((message) => message.kind === "handover"), "the hand-over card exists");
  assert.equal(result.messages.find((message) => message.kind === "text").body.text, "The sign-in page is open and the screen is yours now.");
});

test("a one-off routine runs once and then removes itself", async (context) => {
  const { knex, parts, bot, cleanup } = await setup(context);
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, _tools, _state, prompt) => ({ text: prompt.includes("one-off") ? "Time to call Rui!" : "?", transcript: [] })
  });
  // The routine as its runner claims it (records.work), in the bot's home.
  const [routine] = (await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, name: "Call Rui", schedule: "Once, at 14:35", instructions: "Remind them to call Rui.",
    cron: "35 14 25 10 *", timezone: "UTC", next_run_at: knex.fn.now(), once: true
  }).returning("*")).map(claimedWork);
  await bots.runRoutine(routine);
  assert.equal(await knex("bot_routines").where({ id: routine.id }).first(), undefined, "the routine is gone");
  const messages = await knex("bot_messages").where({ bot_id: bot.id }).orderBy("id");
  assert.equal(messages.at(-2).body.text, "Time to call Rui!");
  assert.equal(messages.at(-1).body.text, "Routine finished and removed");
});

test("a message that arrives while a reply is running gets its own reply afterwards", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // The second message is sent once the first reply has read the chat, however long that takes on a busy machine.
  let read;
  const firstRead = new Promise((resolve) => { read = resolve; });
  const seen = [];
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, history) => {
      const last = [...history].reverse().find((message) => message.role === "user");
      seen.push(last.body.text);
      if (seen.length === 1) {
        read();
        await gate;
      }
      return { text: `Answer to ${last.body.text}`, transcript: [] };
    }
  });
  const first = await bots.sendMessage(bot.id, { text: "First", clientId: "pending-x1" }, as(userId));
  const running = bots.replyTo(bot.id, { afterMessageId: first.messages[0].id }, undefined, as(userId));
  await firstRead;
  const second = await bots.sendMessage(bot.id, { text: "Second", clientId: "pending-x2" }, as(userId));
  const meanwhile = await bots.replyTo(bot.id, { afterMessageId: second.messages[0].id }, undefined, as(userId));
  assert.equal(meanwhile.pending, true);
  release();
  await running;
  // Nobody asks again (the page went away): the server answers the waiting message on its own.
  await bots.drain(10000);
  const texts = (await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, role: "bot", kind: "text" }).orderBy("id")).map((row) => row.body.text);
  assert.deepEqual(texts, ["Answer to First", "Answer to Second"]);
  assert.deepEqual(seen, ["First", "Second"]);
  const later = await bots.replyTo(bot.id, { afterMessageId: second.messages[0].id }, undefined, as(userId));
  assert.ok(later.messages.some((message) => message.body.text === "Answer to Second"));
});

test("a secure form fills the bot's page, can save to the vault, and closing it means no", async (context) => {
  const { knex, as, userId, bot, cleanup } = await setup(context);
  const filled = [];
  const computer = { fill: async (_botId, values) => { filled.push(values); return { filled: ["username", "password"], url: values.url || "", screenshot: "s" }; } };
  // The login is saved through the account feature, in the person's own Vault.
  const { records, account } = await startBotRecordsWithAccount(knex, cleanup);
  const bots = startBotsService(cleanup, { knex, records, account, computer, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
  const [card] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "secure_form", role: "bot", body: { site: "practice.example", form: "login", status: "pending", url: "https://practice.example/login" } }).returning("*");
  const result = await bots.settleSecureForm(bot.id, card.id, { action: "submit", username: "tester", password: "s3cret!", save: true }, as(userId));
  assert.equal(result.messages[0].body.status, "submitted");
  assert.equal(filled[0].password, "s3cret!");
  assert.equal(filled[0].url, "https://practice.example/login");
  const saved = await knex("vault_items").where({ user_id: userId, kind: "login", label: "practice.example" }).orderBy("id", "desc").first();
  assert.ok(saved, "the login was saved to the vault");
  assert.ok(!JSON.stringify(saved.data).includes("s3cret!"), "the saved password is sealed");
  assert.ok(!JSON.stringify(result).includes("s3cret!"), "the password never comes back");
  await assert.rejects(bots.settleSecureForm(bot.id, card.id, { action: "submit", username: "x", password: "y" }, as(userId)), /already been dealt/);
  await knex("vault_items").where({ id: saved.id }).del();

  const [second] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "secure_form", role: "bot", body: { site: "practice.example", form: "login", status: "pending" } }).returning("*");
  const closed = await bots.settleSecureForm(bot.id, second.id, { action: "close" }, as(userId));
  assert.equal(closed.messages[0].body.status, "closed");
  assert.equal(filled.length, 1, "closing fills nothing");
});

test("a bot passes a task to another bot, which answers in its own chat", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  await knex("bots").where("name", "like", "Handoff Helper%").del();
  const helper = `Handoff Helper ${Date.now()}`;
  const other = await testBot(knex, userId, { name: helper });
  const bots = startBotsService(cleanup, {
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async (current, _history, tools, _state, prompt) => {
      if (String(current.id) === String(bot.id)) {
        await tools.messageBot.execute({ bot: helper, task: "Work out 15% of 84 euros." });
        return { text: "I've passed it to Handoff Helper.", transcript: [] };
      }
      return { text: prompt.includes("passed on a task") ? "Bot A passed this on: 15% of €84 is €12.60." : "?", transcript: [] };
    }
  });
  const sent = await bots.sendMessage(bot.id, { text: "Ask Handoff Helper to work out 15% of 84 euros", clientId: "pending-ho" }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  const mine = await knex("bot_messages").where({ conversation_id: bot.conversation_id, kind: "bot_request" }).orderBy("id", "desc").first();
  assert.equal(mine.body.side, "asker");
  assert.equal(mine.body.other.name, helper);
  await bots.drain(10000);
  const theirs = await knex("bot_messages").where({ bot_id: other.id }).orderBy("id");
  assert.equal(theirs[0].kind, "bot_request");
  assert.equal(theirs[0].body.kind, "pass");
  assert.equal((await knex("bot_requests").where({ to_bot_id: other.id }).first()).status, "done");
  assert.equal(theirs.at(-1).body.text, "Bot A passed this on: 15% of €84 is €12.60.");
  await knex("bots").where({ id: other.id }).del();
});

test("the Library lists what the bot made, newest version once, and keeps pins; search finds files", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const bots = startBotsService(cleanup, { knex, ...parts, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
  const tag = `lib${Date.now()}`;
  await knex("bot_messages").insert([
    { workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "files", role: "bot", body: { files: [{ path: `/files/mine/${tag}-sales.xlsx`, name: `${tag}-sales.xlsx`, size: 4000 }] } },
    { workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "page", role: "bot", body: { path: `/files/mine/Pages/${tag}.md`, title: `${tag} guide`, summary: "Old" } },
    { workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "chart", role: "bot", body: { path: `/files/mine/Charts/${tag}.png`, title: `${tag} chart`, caption: "A chart" } },
    { workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "page", role: "bot", body: { path: `/files/mine/Pages/${tag}.md`, title: `${tag} guide`, summary: "New" } }
  ]);
  const { items } = await bots.library(bot.id, as(userId));
  assert.deepEqual(items.map((item) => item.kind), ["page", "chart", "file"]);
  assert.equal(items[0].summary, "New", "an updated page shows once, newest");
  const file = items.find((item) => item.kind === "file");
  const pinned = await bots.pinItem(bot.id, { messageId: file.messageId, path: file.path, pinned: true }, as(userId));
  assert.equal(pinned.items.find((item) => item.path === file.path).pinned, true);
  const found = await bots.search(tag, as(userId));
  assert.ok(found.files.some((entry) => entry.path === file.path && entry.botName === bot.name));
});

test("asking again after a card was answered returns the same reply instead of starting new ones", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  let replies = 0;
  const bots = startBotsService(cleanup, { knex, ...parts, approvals: { decide: async () => "allow" }, reply: async () => ({ text: `Reply ${++replies}`, transcript: [] }) });
  const sent = await bots.sendMessage(bot.id, { text: "Sign me in", clientId: "pending-card" }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  const [event] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "event", role: "system", body: { text: "Done on the web page" } }).returning("*");
  const afterCard = await bots.replyTo(bot.id, { afterMessageId: event.id }, undefined, as(userId));
  const again = await bots.replyTo(bot.id, { afterMessageId: event.id }, undefined, as(userId));
  const third = await bots.replyTo(bot.id, { afterMessageId: event.id }, undefined, as(userId));
  assert.equal(replies, 2, "one reply for the message, one after the card, then none");
  assert.deepEqual(again.messages.map((message) => message.id), afterCard.messages.map((message) => message.id));
  assert.deepEqual(third.messages.map((message) => message.id), afterCard.messages.map((message) => message.id));
});

test("a vault password never shows in a bot's reply", async (context) => {
  const { knex, as, userId, bot, cleanup } = await setup(context);
  const { records, account } = await startBotRecordsWithAccount(knex, cleanup);
  const { saveLogin } = await import("../../packages/bots/src/server/vaultLogins.js");
  const saved = await saveLogin(account, process.env, "secret-test.example", "tester", "Zebra-Quartz-77", as(userId));
  const bots = startBotsService(cleanup, { knex, records, account, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "Signed in as tester with Zebra-Quartz-77.", transcript: [] }) });
  const sent = await bots.sendMessage(bot.id, { text: "Sign me in", clientId: "pending-secret" }, as(userId));
  const result = await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  assert.equal(result.messages.find((message) => message.kind === "text").body.text, "Signed in as tester with •••.");
  await knex("vault_items").where({ id: saved.id }).del();
});

test("a bot only types a password the person gave it, and sign-in clicks never wait for approval", async (context) => {
  const { knex, parts, as, userId, bot } = await setup(context);
  const { buildTools } = await import("../../packages/bots/src/server/botTools.js");
  const acted = [];
  const computer = { act: async (_botId, instruction) => { acted.push(instruction); return { success: true, message: "", url: "", title: "", screenshot: "s" }; }, screenshot: async () => "s" };
  let asked = 0;
  // The tools read the chat's messages in the person's call in the bot's home.
  const run = buildTools(turnDoubles({ records: parts.records, call: as(userId), approvals: { decide: async () => { asked += 1; return "ask"; } }, computer, homeId: bot.workspace_id, userId, botId: bot.id, conversationId: bot.conversation_id }));
  const refused = await run.tools.useWebPage.execute({ instruction: "Type PagePassword123 into the Password field", final: false });
  assert.match(refused.error, /Only type a password the person gave you/u);
  await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "text", role: "user", body: { text: "Use password GivenPass456 please" } });
  await run.tools.useWebPage.execute({ instruction: "Type GivenPass456 into the Password field", final: false });
  await run.tools.useWebPage.execute({ instruction: "Click the Login button", final: true });
  assert.deepEqual(acted, ["Type GivenPass456 into the Password field", "Click the Login button"]);
  assert.equal(asked, 0, "signing in didn't ask for approval");
});

test("a draft card sends only what the person approved, and Discard sends nothing", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const bots = startBotsService(cleanup, { knex, ...parts, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
  const [card] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "draft", role: "bot", body: { to: "Landlord", via: "Gmail", text: "Hi, the boiler is broken.", status: "pending" } }).returning("*");
  const sent = await bots.settleDraft(bot.id, card.id, { action: "send", text: "Hi Ana, the boiler is broken again." }, as(userId));
  assert.equal(sent.messages[0].body.status, "send");
  assert.equal(sent.messages[0].body.text, "Hi Ana, the boiler is broken again.");
  await assert.rejects(bots.settleDraft(bot.id, card.id, { action: "discard" }, as(userId)), /already been dealt/);
  const [other] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "draft", role: "bot", body: { to: "Team", via: "Slack", text: "Hello", status: "pending" } }).returning("*");
  const discarded = await bots.settleDraft(bot.id, other.id, { action: "discard", text: "changed" }, as(userId));
  assert.equal(discarded.messages[0].body.status, "discarded");
  assert.equal(discarded.messages[0].body.text, "Hello");
});

// Seeing pictures: a picture attached to the message being answered reaches the model
// as an image; an older one stays a note to look again with read_file.
test("a picture attached to the latest message is shown to the model", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-picture-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const picture = Buffer.from("not really a png");
  await writeFile(path.join(dir, "receipt.png"), picture);
  const files = {
    store: { existingFile: async (_place, virtualPath) => ({ real: path.join(dir, path.basename(virtualPath)) }), list: async () => ({ mine: [], shared: [] }), placeFor: () => ({}) },
    apps: { session: () => ({ close() {} }) }
  };
  const seen = [];
  const bots = startBotsService(cleanup, {
    knex, ...parts, files, approvals: { decide: async () => "allow" },
    reply: async (_bot, history) => {
      seen.push(history.filter((message) => message.kind === "text" && message.role === "user").map((message) => message.body.attachments?.[0]?.picture?.data.toString() ?? null));
      return { text: "ok", transcript: [] };
    }
  });
  const attachment = { name: "receipt.png", size: picture.length, type: "image/png", path: "/files/mine/Uploads/receipt.png" };
  const first = await bots.sendMessage(bot.id, { text: "What's this?", attachments: [attachment] }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: first.messages[0].id }, undefined, as(userId));
  const second = await bots.sendMessage(bot.id, { text: "Thanks" }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: second.messages[0].id }, undefined, as(userId));
  assert.deepEqual(seen, [["not really a png"], [null, null]]);
});

// Bots using a connected Google Calendar (D-31): an event with an invitation waits on the
// approval card, and "Go ahead" adds it with the person's own key.
test("a calendar event with guests waits for approval, then goes on the connected calendar", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "google-calendar", name: "", status: "connected", label: "pat@example.com" }).returning("*");
  const posted = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") posted.push({ url: String(url), auth: options.headers?.authorization, body: JSON.parse(options.body || "{}") });
    return new Response(JSON.stringify({ summary: "Lunch with Ana", start: { dateTime: "2026-11-03T13:00:00+11:00" } }), { status: 200 });
  };
  try {
    const integrations = {
      ...await connectAppsReads(knex, cleanup, [{ id: "google-calendar", name: "Google Calendar" }]),
      connections: { accessToken: async (reach, accountId) => ({ accessToken: `key-${reach.userId}-${accountId}` }) },
      skills: async () => []
    };
    let state = "";
    const bots = startBotsService(cleanup, {
      knex, ...parts, integrations, env: live(),
      approvals: { decide: async (_action, { reversible }) => (reversible ? "allow" : "ask") },
      reply: async (_bot, _history, tools, note) => {
        state = note;
        await tools.addCalendarEvent.execute({ title: "Lunch with Ana", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timezone: "Australia/Sydney", attendees: ["ana@example.com"] });
        return { text: "It's waiting for your OK on the card below.", transcript: [] };
      }
    });
    const sent = await bots.sendMessage(bot.id, { text: "Lunch with Ana next Tuesday at 1, invite her" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    assert.match(state, /Connected accounts: Google Calendar: pat@example\.com\./u);
    assert.equal(posted.length, 0, "nothing is added before approval");
    const card = await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "choice" }).first();
    assert.match(card.body.question, /invite ana@example\.com/u);
    await bots.answerChoice(bot.id, card.id, ["Go ahead"], as(userId));
    assert.equal(posted.length, 1);
    assert.equal(posted[0].auth, `Bearer key-${userId}-${account.id}`);
    assert.deepEqual(posted[0].body.attendees, [{ email: "ana@example.com" }]);
    const event = await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "event" }).orderBy("id", "desc").first();
    assert.equal(event.body.text, "Added to your calendar: Lunch with Ana");
  } finally {
    globalThis.fetch = original;
    await knex("plugin_accounts").where({ id: account.id }).del();
  }
});

// Which account a bot uses stays in its own chat: remember refuses it.
test("a choice of mailbox isn't saved for all bots", async (context) => {
  const { knex, as, userId, bot, cleanup } = await setup(context);
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "gmail", name: "", status: "connected", label: "pat@example.com" }).returning("*");
  try {
    const { buildTools } = await import("../../packages/bots/src/server/botTools.js");
    // The person's own connected addresses, as the integrations service reads them in their call.
    const { integrations } = await startIntegrations(knex, cleanup, { catalogue: [] });
    const run = buildTools(turnDoubles({ integrations, call: as(userId), approvals: { decide: async () => "allow" }, computer: null, homeId: bot.workspace_id, userId, botId: bot.id }));
    const refused = await run.tools.remember.execute({ fact: "Only check pat@example.com when asked about email." });
    assert.match(refused.error, /this chat only/u);
    assert.match((await run.tools.remember.execute({ fact: "Use just their own inbox." })).error, /this chat only/u);
    assert.equal(await knex("person_memories").where({ user_id: userId }).whereILike("fact", "%pat@example.com%").first(), undefined);
  } finally {
    await knex("plugin_accounts").where({ id: account.id }).del();
  }
});


// An email draft from a connected mailbox goes straight out on Send (D-31), once, exactly as
// edited; a failure leaves the card waiting so it can be tried again.
test("Send on an email draft sends it from the connected mailbox, once", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "gmail", name: "", status: "connected", label: "pat@example.com" }).returning("*");
  const sends = [];
  let fail = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    sends.push({ url: String(url), raw: JSON.parse(options.body || "{}").raw });
    return fail
      ? new Response(JSON.stringify({ error: { message: "Backend Error" } }), { status: 500 })
      : new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  };
  try {
    const integrations = { reachableAccounts: await connectedAccounts(knex, cleanup), connections: { accessToken: async () => ({ accessToken: "key" }) } };
    const bots = startBotsService(cleanup, { knex, ...parts, integrations, env: live(), approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
    const [card] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "draft", role: "bot", body: { to: "Ana <ana@example.com>", via: "Gmail", from: "pat@example.com", subject: "Lunch", text: "1pm?", status: "pending" } }).returning("*");
    await assert.rejects(bots.settleDraft(bot.id, card.id, { action: "send", text: "1pm Tuesday?" }, as(userId)), /It wasn't sent: Backend Error/u);
    assert.equal((await knex("bot_messages").where({ id: card.id }).first()).body.status, "pending");
    fail = false;
    const sent = await bots.settleDraft(bot.id, card.id, { action: "send", text: "1pm Tuesday?" }, as(userId));
    assert.equal(sent.messages[0].body.status, "sent");
    const raw = Buffer.from(sends.at(-1).raw, "base64url").toString("utf8");
    assert.match(raw, /^To: ana@example\.com\r\n/u);
    assert.equal(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString("utf8"), "1pm Tuesday?");
    await assert.rejects(bots.settleDraft(bot.id, card.id, { action: "send" }, as(userId)), /already been dealt/u);
    assert.equal(sends.length, 2, "one failed try and one send");
  } finally {
    globalThis.fetch = original;
    await knex("plugin_accounts").where({ id: account.id }).del();
  }
});

// A test copy (SIDE_EFFECTS not live, D-69) sends nothing from a connected mailbox: Send logs the
// email by sender, recipients and subject, and the card ends sent, as it would in the live copy.
test("a test copy's Send on an email draft is logged and marked sent, and nothing reaches the mailbox", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "gmail", name: "", status: "connected", label: "pat@example.com" }).returning("*");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  };
  try {
    const integrations = { reachableAccounts: await connectedAccounts(knex, cleanup), connections: { accessToken: async () => ({ accessToken: "key" }) } };
    const bots = startBotsService(cleanup, { knex, ...parts, integrations, env: { ...process.env, SIDE_EFFECTS: "" }, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
    const [card] = await knex("bot_messages").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, kind: "draft", role: "bot", body: { to: "Ana <ana@example.com>", via: "Gmail", from: "pat@example.com", subject: "Lunch", text: "1pm?", status: "pending" } }).returning("*");
    const logged = context.mock.method(console, "info", () => {});
    const sent = await bots.settleDraft(bot.id, card.id, { action: "send", text: "1pm Tuesday?" }, as(userId));
    logged.mock.restore();
    assert.equal(sent.messages[0].body.status, "sent");
    assert.deepEqual(calls, [], "nothing reached Gmail");
    assert.deepEqual(logged.mock.calls.map((call) => call.arguments).filter(([fields]) => fields?.sideEffects), [[
      { sideEffects: "simulate", kind: "email", from: "Gmail: pat@example.com", to: ["ana@example.com"], cc: [] },
      'Test copy: the email "Lunch" from Gmail: pat@example.com to ana@example.com was simulated, not sent (SIDE_EFFECTS is not live).'
    ]]);
  } finally {
    globalThis.fetch = original;
    await knex("plugin_accounts").where({ id: account.id }).del();
  }
});

// A reply draft is filled from the email it answers: From is the mailbox that got it,
// To its reply-to address, and it goes into the same thread; "send it" in words sends the card.
test("a reply draft answers from the receiving mailbox to the reply-to address, in its thread", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "gmail", name: "", status: "connected", label: "pat@example.com" }).returning("*");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body || "{}") });
    if (String(url).includes("/messages/send")) return new Response(JSON.stringify({ id: "s1" }), { status: 200 });
    return new Response(JSON.stringify({
      threadId: "t9",
      payload: { headers: [
        { name: "From", value: "Ms Reed <reed@school.example>" }, { name: "Reply-To", value: "office@school.example" },
        { name: "Subject", value: "Sports day" }, { name: "Message-ID", value: "<abc@school.example>" }
      ], mimeType: "text/plain", body: { data: Buffer.from("See you there").toString("base64url") } }
    }), { status: 200 });
  };
  try {
    const integrations = { reachableAccounts: await connectedAccounts(knex, cleanup), connections: { accessToken: async () => ({ accessToken: "key" }) }, skills: async () => [] };
    const results = [];
    const bots = startBotsService(cleanup, {
      knex, ...parts, integrations, env: live(), approvals: { decide: async () => "allow" },
      reply: async (_bot, history, tools) => {
        if (/send it/u.test(history.at(-1).body.text)) results.push(await tools.sendDraft.execute({}));
        else results.push(await tools.showDraft.execute({ replyTo: { emailId: "m7" }, cc: "kim@example.com", text: "Hi Ms Reed,\n\nThanks, we'll be there.\n\nPat Example" }));
        return { text: "ok", transcript: [] };
      }
    });
    const first = await bots.sendMessage(bot.id, { text: "Draft a reply to the school saying thanks, we'll be there" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: first.messages[0].id }, undefined, as(userId));
    assert.match(results[0].doubt, /came from reed@school\.example but asks for replies to go to office@school\.example/u);
    const card = await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "draft" }).first();
    assert.deepEqual([card.body.from, card.body.to, card.body.subject, card.body.cc], ["pat@example.com", "office@school.example", "Re: Sports day", "kim@example.com"]);
    assert.equal(card.body.inReplyTo.from, "Ms Reed <reed@school.example>");
    const second = await bots.sendMessage(bot.id, { text: "Looks good, send it" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: second.messages[0].id }, undefined, as(userId));
    assert.equal(results[1].status, "sent");
    const send = calls.find((call) => call.url.includes("/messages/send"));
    assert.equal(send.body.threadId, "t9");
    const raw = Buffer.from(send.body.raw, "base64url").toString("utf8");
    assert.match(raw, /^To: office@school\.example\r\nCc: kim@example\.com\r\nIn-Reply-To: <abc@school\.example>\r\n/u);
    assert.equal((await knex("bot_messages").where({ id: card.id }).first()).body.status, "sent");
  } finally {
    globalThis.fetch = original;
    await knex("plugin_accounts").where({ id: account.id }).del();
  }
});

// A task needing an app that isn't connected shows a card to connect it, and an app
// whose connection isn't built yet sends the bot to its website instead.
test("a task for an unconnected app shows a connect card, and one Mercbot can't connect yet a card that asks for it", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const integrations = {
    ...await connectAppsReads(knex, cleanup, [
      { id: "google-drive", name: "Google Drive", logo: "googledrive", color: "#4285F4", icon: "folder", oauth: {} },
      { id: "todoist", name: "Todoist", soon: true }
    ]),
    connections: { accessToken: async () => ({ accessToken: "key" }) },
    skills: async () => [],
    // No files here: send_files is switched off, so "the card below" isn't a claim of attached files.
    toolSwitches: async () => ({ skip: {}, removed: ["send_files"], turnedOff: [] })
  };
  const results = [];
  const prompts = [];
  // A computer, so the check on a claimed screen hand-over is active: "card below" about a connect
  // card isn't one.
  const computer = { status: async () => ({ state: "awake" }), screenshot: async () => null, hold: async () => {} };
  const bots = startBotsService(cleanup, {
    knex, ...parts, integrations, computer, approvals: { decide: async () => "allow" },
    reply: async (_bot, history, tools, _state, prompt) => {
      prompts.push(prompt);
      const asked = history.at(-1).body.text;
      if (asked.includes("Drive")) {
        results.push(await tools.suggestConnect.execute({ app: "google drive", task: "save the list to your Drive" }));
        results.push(await tools.suggestConnect.execute({ app: "Todoist", task: "add buy milk to your list" }));
      } else {
        results.push(await tools.suggestConnect.execute({ app: "Todoist", task: "add buy milk to your list" }));
      }
      return { text: "It isn't connected yet; the card below asks for it.", transcript: [] };
    }
  });
  const sent = await bots.sendMessage(bot.id, { text: "Save the shopping list to my Drive" }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
  assert.equal(results[0].status, "card shown");
  assert.equal(results[1].status, "already shown", "one connect card per reply");
  assert.equal(results[1].note, results[0].note, "asked again, the bot is told the same");
  assert.deepEqual(prompts, [""], "no second pass for a connect card below");
  const card = await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "connect" }).first();
  assert.deepEqual([card.body.app, card.body.button, card.body.plugin.logo, card.body.task], ["Google Drive", "Authorize", "googledrive", "save the list to your Drive"]);

  const again = await bots.sendMessage(bot.id, { text: "Add buy milk to my Todoist list" }, as(userId));
  await bots.replyTo(bot.id, { afterMessageId: again.messages[0].id }, undefined, as(userId));
  assert.equal(results[2].status, "card shown, not connectable yet");
  const soon = await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "connect" }).orderBy("id", "desc").first();
  assert.deepEqual([soon.body.app, soon.body.button, soon.body.soon], ["Todoist", "Ask for it", true]);
});

/**
 * Sets up the images kind of AI with a stand-in key (D-72), as the picture tests need; the function it returns puts
 * both settings back. The tests change process.env itself, which the bots read when they need it.
 */
function setImagesKind() {
  const saved = { AI_IMAGES_PROVIDER: process.env.AI_IMAGES_PROVIDER, AI_IMAGES_API_KEY: process.env.AI_IMAGES_API_KEY };
  Object.assign(process.env, { AI_IMAGES_PROVIDER: "gemini", AI_IMAGES_API_KEY: "test-key" });
  return () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

// Making pictures: two variants become one row under the reply, an edit sends the
// earlier picture along, each is kept in the Pictures folder, and the Library lists them.
test("pictures are made, edited from an earlier one, shown in a row and listed in the Library", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-pictures-"));
  const requests = [];
  const original = globalThis.fetch;
  const restoreImages = setImagesKind();
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), body });
    if (body.contents[0].parts.at(-1).text.includes("Taylor Swift")) {
      return new Response(JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from(`png-${requests.length}`).toString("base64") } }] } }] }), { status: 200 });
  };
  try {
    const files = {
      store: {
        resolve: async (_place, virtualPath) => path.join(dir, virtualPath),
        existingFile: async (_place, virtualPath) => ({ real: path.join(dir, virtualPath) }),
        settle: async () => {},
        list: async () => ({ mine: [], shared: [] })
      },
      apps: { session: () => ({ close() {} }) }
    };
    const { buildTools } = await import("../../packages/bots/src/server/botTools.js");
    const posted = [];
    const fresh = () => buildTools(turnDoubles({ approvals: { decide: async () => "allow" }, computer: null, files, homeId: bot.workspace_id, userId, botId: bot.id, post: async (messages) => posted.push(...messages) }));
    let run = fresh();
    const two = await run.tools.makePicture.execute({ acknowledgement: "I'll draw it now.", prompt: "A birthday cake with balloons, watercolour", title: "Birthday cake", caption: "A cake with balloons", variants: 2 });
    assert.deepEqual(posted.map((message) => message.body), [{ text: "I'll draw it now.", lead: true }]);
    // One call per reply: a second one in the same reply makes nothing.
    assert.equal((await run.tools.makePicture.execute({ acknowledgement: "Again", prompt: "Another cake please", title: "Cake", caption: "A cake" })).status, "already made");
    await run.finish();
    const firstReply = run.after.filter((message) => message.kind === "pictures");
    run = fresh();
    assert.equal(two.paths.length, 2);
    assert.deepEqual(requests[0].body.generationConfig.imageConfig, { aspectRatio: "3:4" });
    const edited = await run.tools.makePicture.execute({ acknowledgement: "On it.", prompt: "Make the cake purple; keep the balloons", title: "Purple cake", caption: "The same cake in purple", from: [two.paths[1]] });
    assert.equal(requests[2].body.contents[0].parts[0].inlineData.data, Buffer.from("png-2").toString("base64"));
    assert.equal(await readFile(path.join(dir, edited.paths[0]), "utf8"), "png-3");
    await run.finish();
    const shown = [...firstReply, ...run.after.filter((message) => message.kind === "pictures")];
    assert.deepEqual(shown.map((message) => message.body.images.length), [2, 1]);
    const refused = await fresh().tools.makePicture.execute({ acknowledgement: "One moment.", prompt: "A portrait of Taylor Swift", title: "Portrait", caption: "A portrait" });
    assert.match(refused.error, /couldn't be made \(IMAGE_SAFETY\)/u);
    const bots = startBotsService(cleanup, { knex, ...parts, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
    await knex("bot_messages").insert(shown.map((message) => ({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, ...message })));
    const library = await bots.library(bot.id, as(userId));
    assert.deepEqual(library.items.filter((item) => item.kind === "picture").map((item) => item.name), ["Purple cake", "Birthday cake", "Birthday cake (2)"]);

    // Images is optional (D-72): without its key the tool is still there, and says plainly that pictures aren't set
    // up, before posting anything or asking any provider.
    process.env.AI_IMAGES_API_KEY = "";
    posted.length = 0;
    const asked = requests.length;
    const off = await fresh().tools.makePicture.execute({ acknowledgement: "I'll draw it now.", prompt: "A cake", title: "Cake", caption: "A cake" });
    assert.match(off.error, /^Pictures aren't set up on this copy of Mercbot\./u);
    assert.deepEqual(posted, []);
    assert.equal(requests.length, asked);
  } finally {
    globalThis.fetch = original;
    restoreImages();
    await rm(dir, { recursive: true, force: true });
  }
});

// A reply that says a picture is there without making one is sent back once.
test("a reply that claims a picture without making one is sent back to make it", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const restoreImages = setImagesKind();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "cG5n" } }] } }] }), { status: 200 });
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-claims-"));
  try {
    const files = { store: { resolve: async (_place, p) => path.join(dir, p), existingFile: async (_place, p) => ({ real: path.join(dir, p) }), settle: async () => {}, list: async () => ({ mine: [], shared: [] }), placeFor: () => ({}) }, apps: { session: () => ({ close() {} }) } };
    const prompts = [];
    const bots = startBotsService(cleanup, {
      knex, ...parts, files, approvals: { decide: async () => "allow" },
      reply: async (_bot, _history, tools, _state, prompt) => {
        prompts.push(prompt);
        if (!prompt) return { text: "Here's the cartoony picture of the cake. (Pictures shown: a cake)", transcript: [] };
        await tools.makePicture.execute({ acknowledgement: "Drawing it now.", prompt: "A cartoony cake", title: "Cake", caption: "A cake" });
        return { text: "Here's the cartoony cake.", transcript: [] };
      }
    });
    const sent = await bots.sendMessage(bot.id, { text: "Make it more cartoony" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /you didn't call make_picture/u);
    const kinds = (await knex("bot_messages").where({ bot_id: bot.id }).where("id", ">", sent.messages[0].id).orderBy("id")).map((row) => `${row.kind}:${row.body.text || ""}`);
    assert.deepEqual(kinds, ["text:Drawing it now.", "text:Here's the cartoony cake.", "pictures:"]);
  } finally {
    globalThis.fetch = original;
    restoreImages();
    await rm(dir, { recursive: true, force: true });
  }
});

// "Want me to make it 45 minutes?" isn't about a picture, so the next reply isn't checked as one,
// and isn't sent back to be redone.
test("a bot's offer to make a meeting longer doesn't make the next reply a picture claim", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const restoreImages = setImagesKind();
  try {
    const files = { store: { placeFor: () => ({}) }, apps: { session: () => ({ close() {} }) } };
    const prompts = [];
    const bots = startBotsService(cleanup, {
      knex, ...parts, files, approvals: { decide: async () => "allow" },
      reply: async (_bot, history, _tools, _state, prompt) => {
        prompts.push(prompt);
        const asked = history.at(-1).body.text;
        return { text: /meeting/u.test(asked) ? "Want me to make it 45 minutes instead?" : "Done, that takes it off your calendar.", transcript: [] };
      }
    });
    for (const text of ["Put a meeting in for Friday", "Take it off again"]) {
      const sent = await bots.sendMessage(bot.id, { text }, as(userId));
      await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    }
    assert.deepEqual(prompts, ["", ""], "no second pass");
  } finally {
    restoreImages();
  }
});

// On a copy without the images kind of AI (D-72), a reply saying pictures aren't available isn't sent back to make
// one, whatever its words: make_picture would only say pictures aren't set up.
test("a copy that can't make pictures doesn't send a reply back for the picture it didn't make", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const restoreImages = setImagesKind();
  process.env.AI_IMAGES_API_KEY = "";
  try {
    const files = { store: { placeFor: () => ({}) }, apps: { session: () => ({ close() {} }) } };
    const prompts = [];
    const bots = startBotsService(cleanup, {
      knex, ...parts, files, approvals: { decide: async () => "allow" },
      reply: async (_bot, _history, _tools, _state, prompt) => {
        prompts.push(prompt);
        return { text: "Picture making isn't available on this copy of Mercbot, sorry.", transcript: [] };
      }
    });
    const sent = await bots.sendMessage(bot.id, { text: "Draw me a cartoony cake" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    assert.deepEqual(prompts, [""], "no second pass");
  } finally {
    restoreImages();
  }
});

// A picture made in the reply isn't checked again, and a refusal that only
// offers an alternative is sent back to draw it.
test("a picture made in the reply isn't questioned, and a refusal draws its alternative", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const restoreImages = setImagesKind();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "cG5n" } }] } }] }), { status: 200 });
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-refusal-"));
  try {
    const files = { store: { resolve: async (_place, p) => path.join(dir, p), existingFile: async (_place, p) => ({ real: path.join(dir, p) }), settle: async () => {}, list: async () => ({ mine: [], shared: [] }), placeFor: () => ({}) }, apps: { session: () => ({ close() {} }) } };
    const prompts = [];
    const bots = startBotsService(cleanup, {
      knex, ...parts, files, approvals: { decide: async () => "allow" },
      reply: async (_bot, history, tools, _state, prompt) => {
        prompts.push(prompt);
        const asked = history.at(-1).body.text;
        if (/watercolour/u.test(asked) || prompt) {
          await tools.makePicture.execute({ acknowledgement: "Drawing it now.", prompt: "A microphone by a cake", title: "Cake", caption: "A cake" });
          return { text: "Here's the watercolour picture.", transcript: [] };
        }
        return { text: "I don't make pictures of real, named people. Want a microphone and guitar instead?", transcript: [] };
      }
    });
    const first = await bots.sendMessage(bot.id, { text: "Turn this into a watercolour picture" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: first.messages[0].id }, undefined, as(userId));
    assert.deepEqual(prompts, [""]);
    const second = await bots.sendMessage(bot.id, { text: "Make a picture of Taylor Swift singing by the cake" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: second.messages[0].id }, undefined, as(userId));
    assert.equal(prompts.length, 3);
    assert.match(prompts[2], /call make_picture now with an original alternative/u);
    assert.equal((await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "pictures" })).length, 2);
  } finally {
    globalThis.fetch = original;
    restoreImages();
    await rm(dir, { recursive: true, force: true });
  }
});

// "Added" is only said once the event was really added: a claim without the tool is sent
// back, and one event goes in one calendar even with two connected.
test("a calendar claim without the tool is sent back, and an event goes in one calendar", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const accounts = await knex("plugin_accounts").insert([
    { user_id: userId, plugin_id: "google-calendar", name: "", status: "connected", label: "pat@example.com" },
    { user_id: userId, plugin_id: "google-calendar", name: "family", status: "connected", label: "kim@example.com" }
  ]).returning("*");
  const posted = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") posted.push(String(url));
    return new Response(JSON.stringify({ summary: "Lunch with Ana", start: { dateTime: "2026-11-03T13:00:00+01:00" }, timeZone: "Europe/Rome" }), { status: 200 });
  };
  try {
    const integrations = {
      ...await connectAppsReads(knex, cleanup, [{ id: "google-calendar", name: "Google Calendar" }]),
      connections: { accessToken: async (_who, accountId) => ({ accessToken: `key-${accountId}` }) },
      skills: async () => []
    };
    const prompts = [];
    const results = [];
    let lastSeen = null;
    let claim = "I've added it to both calendars: Lunch with Ana, Tue 3 Nov at 13:00.";
    const computer = { status: async () => ({ state: "awake" }), screenshot: async () => null, hold: async () => {} };
    const bots = startBotsService(cleanup, {
      knex, ...parts, integrations, computer, approvals: { decide: async () => "allow" },
      reply: async (_bot, history, tools, _state, prompt) => {
        prompts.push(prompt);
        lastSeen = history.at(-1);
        const off = { account: "pat@example.com", eventId: "e1", timezone: "UTC", acknowledgement: "Taking lunch off your calendar." };
        if (claim === "rerun") {
          if (!prompt) await tools.deleteCalendarEvent.execute(off);
          return { text: prompt ? "Lunch is off your calendar." : "Lunch is off your calendar; the screen is yours now.", transcript: [] };
        }
        if (!prompt) return { text: claim, transcript: [] };
        const lunch = { title: "Lunch with Ana", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timezone: "UTC" };
        if (claim.startsWith("Removed")) {
          const window = { from: "2026-11-03T00:00", to: "2026-11-04T00:00", timezone: "UTC" };
          await tools.calendarEvents.execute({ ...window, acknowledgement: "Checking Tuesday first." });
          await tools.calendarEvents.execute({ ...window, acknowledgement: "Checking your calendars for Tuesday." });
          results.push(await tools.deleteCalendarEvent.execute(off), await tools.deleteCalendarEvent.execute(off));
          return { text: "Lunch is off your calendar.", transcript: [] };
        }
        results.push(await tools.addCalendarEvent.execute(lunch));
        results.push(await tools.addCalendarEvent.execute({ ...lunch, account: "pat@example.com" }));
        results.push(await tools.addCalendarEvent.execute({ ...lunch, account: "family" }));
        return { text: "Added to pat@example.com.", transcript: [] };
      }
    });
    const sent = await bots.sendMessage(bot.id, { text: "Put lunch with Ana next Tuesday at 1 in my calendar" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    assert.match(prompts[1], /you didn't call add_calendar_event/u);
    assert.match(results[0].error, /clearly the person's own, so don't guess/u);
    assert.equal(results[1].status, "done");
    assert.equal(results[1].lengthGuessed, undefined);
    assert.match(results[2].error, /already added this event in this reply, to Google Calendar: pat@example\.com/u);
    assert.equal(posted.length, 1);

    // A described calendar that no account matches gets a question first, and nothing is added.
    // Each step first lets the last reply finish its background work: that work answers a message
    // that arrived meanwhile, so it could take up the step's own message.
    await bots.drain(10000);
    const work = await bots.sendMessage(bot.id, { text: "Put a team call on my work calendar for Wednesday at 9" }, as(userId));
    results.length = 0;
    await bots.replyTo(bot.id, { afterMessageId: work.messages[0].id }, undefined, as(userId));
    assert.match(results[0].error, /don't guess/u, "no account given: still asks");
    assert.match(results[1].error, /Nothing was added\. The person asked for their "work" calendar.*ask_with_options/u, "a named account that isn't the work one isn't used");
    assert.equal(posted.length, 1, "nothing more was added");
    assert.match(results[1].error, /only these calendars.*No times or time zones/u, "one card, calendars only");

    // Their pick on that card is the answer: the calendar they picked is used at once.
    await bots.drain(10000);
    const { conversation_id: conversationId } = await knex("bot_messages").where({ id: work.messages[0].id }).first("conversation_id");
    const [card] = await knex("bot_messages").insert({
      workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, role: "bot", kind: "choice",
      body: { purpose: "question", question: "Which calendar?", options: ["Google Calendar: pat@example.com", "Connect another"], multi: false, chosen: null }
    }).returning("*");
    await bots.answerChoice(bot.id, card.id, ["Google Calendar: pat@example.com"], as(userId));
    results.length = 0;
    await bots.replyTo(bot.id, { afterMessageId: Number(card.id) }, undefined, as(userId));
    assert.equal(results[1].status, "done", "the picked calendar is used");
    assert.equal(posted.length, 2);

    // A removal written in the words of Mercbot's own event line, with no tool run, is sent back too.
    await bots.drain(10000);
    claim = "Removed \"Lunch with Ana\" from Google Calendar: pat@example.com.Taken off — Tuesday is clear again.";
    prompts.length = 0;
    const off = await bots.sendMessage(bot.id, { text: "Take the lunch off again please" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: off.messages[0].id }, undefined, as(userId));
    assert.match(prompts[1], /you didn't call add_calendar_event/u);
    const leads = await knex("bot_messages").where({ bot_id: bot.id }).where("id", ">", off.messages[0].id).whereRaw("body->>'lead' = 'true'");
    assert.deepEqual(leads.map((message) => message.body.text), ["Checking Tuesday first.", "Taking lunch off your calendar."], "a status line is said once per reply, and a lookup's once");

    // A pass sent back by a check carries on from what the first pass already did, so it neither
    // redoes nor denies it.
    await bots.drain(10000);
    claim = "rerun";
    prompts.length = 0;
    const rerun = await bots.sendMessage(bot.id, { text: "Take the lunch off again please" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: rerun.messages[0].id }, undefined, as(userId));
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /you didn't call ask_for_help/u);
    assert.match(lastSeen.body.text, /the screen is yours now/u, "the second pass reads the first one's reply");
  } finally {
    globalThis.fetch = original;
    await knex("plugin_accounts").whereIn("id", accounts.map((account) => account.id)).del();
  }
});

// "My calendar" is the account whose address is the person's own: one hour by default,
// a status line first, a link back; an invite the person asked for in so many words needs no card.
test("my calendar is the person's own account, and an explicit invite goes ahead", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  const { email } = await knex("users").where({ id: userId }).first("email");
  const accounts = await knex("plugin_accounts").insert([
    { user_id: userId, plugin_id: "google-calendar", name: "family", status: "connected", label: "kim@example.com" },
    { user_id: userId, plugin_id: "google-calendar", name: "", status: "connected", label: email }
  ]).returning("*");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", auth: options.headers?.authorization, body: JSON.parse(options.body || "{}") });
    if (String(url).includes("/calendarList/primary")) return new Response(JSON.stringify({ timeZone: "Australia/Perth" }), { status: 200 });
    return new Response(JSON.stringify({
      id: "e1", summary: "Lunch with Ana", htmlLink: "https://calendar.google.com/e1",
      start: { dateTime: "2026-11-03T13:00:00+08:00", timeZone: "Australia/Perth" }, end: { dateTime: "2026-11-03T14:00:00+08:00" },
      attendees: options.method === "PATCH" ? [{ email: "ana@example.com", responseStatus: "needsAction" }] : undefined
    }), { status: 200 });
  };
  try {
    const integrations = {
      ...await connectAppsReads(knex, cleanup, [{ id: "google-calendar", name: "Google Calendar", logo: "googlecalendar", color: "#4285F4", icon: "calendar" }]),
      connections: { accessToken: async (_who, accountId) => ({ accessToken: `key-${accountId}` }) },
      skills: async () => []
    };
    let state = "";
    const results = [];
    const bots = startBotsService(cleanup, {
      knex, ...parts, integrations, env: live(),
      approvals: { decide: async (_action, { reversible }) => (reversible ? "allow" : "ask") },
      reply: async (_bot, _history, tools, note) => {
        state = note;
        results.push(await tools.addCalendarEvent.execute({ acknowledgement: "Adding it for Tuesday 3 Nov at 1pm Perth time.", title: "Lunch with Ana", start: "2026-11-03T13:00", timezone: "UTC" }));
        results.push(await tools.changeCalendarEvent.execute({ eventId: "e1", timezone: "UTC", attendees: ["ana@example.com"], personAsked: true }));
        return { text: "Done.", transcript: [] };
      }
    });
    const sent = await bots.sendMessage(bot.id, { text: "Put lunch with Ana next Tuesday at 1 in my calendar, and invite ana@example.com" }, as(userId));
    await bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    assert.match(state, new RegExp(`${email.replace(/[.+]/gu, "\\$&")} \\(the person's own\\)`, "u"));
    const post = calls.find((call) => call.method === "POST");
    assert.equal(post.auth, `Bearer key-${accounts[1].id}`);
    assert.equal(post.body.start.dateTime, "2026-11-03T13:00:00+08:00");
    assert.equal(post.body.end.dateTime, "2026-11-03T14:00:00+08:00");
    assert.equal(results[0].lengthGuessed, "one hour");
    assert.equal(results[0].result.link, "https://calendar.google.com/e1");
    assert.equal(results[1].status, "done", "an invite the person asked for needs no card");
    assert.deepEqual(results[1].result.guests, [{ email: "ana@example.com", answer: "needsAction" }]);
    const rows = await knex("bot_messages").where({ bot_id: bot.id }).where("id", ">", sent.messages[0].id).orderBy("id");
    assert.equal(rows[0].body.text, "Adding it for Tuesday 3 Nov at 1pm Perth time.");
    const added = rows.find((row) => row.kind === "event" && row.body.text === "Added to your calendar: Lunch with Ana");
    assert.equal(added.body.link, "https://calendar.google.com/e1");
    assert.equal(added.body.app.logo, "googlecalendar");
    assert.equal(rows.filter((row) => row.kind === "choice").length, 0);
  } finally {
    globalThis.fetch = original;
    await knex("plugin_accounts").whereIn("id", accounts.map((account) => account.id)).del();
  }
});

// A new bot's "what first?" card is skipped when the person has already written.
test("a new bot's first-task card isn't posted after the person has already written", async (context) => {
  const { knex, parts, as, userId, bot, cleanup } = await setup(context);
  await knex("bot_conversations").where({ id: bot.conversation_id }).update({ onboarding_step: "intro-ask" });
  const bots = startBotsService(cleanup, { knex, ...parts, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "ok", transcript: [] }) });
  await bots.sendMessage(bot.id, { text: "Draw me a cake" }, as(userId));
  const result = await bots.advanceOnboarding(bot.id, "intro-ask", { displayName: "Pat" }, as(userId));
  assert.equal(result.messages.length, 0);
  assert.equal(await knex("bot_messages").where({ bot_id: bot.id, conversation_id: bot.conversation_id, kind: "choice" }).first(), undefined);
  assert.equal((await knex("bot_conversations").where({ id: bot.conversation_id }).first()).onboarding_step, null);
});
