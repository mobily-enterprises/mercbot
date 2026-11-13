import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createNotices } from "../../packages/notices/src/server/notices.js";
import { createMeter, refusalOf, refuseWork } from "../../packages/account/src/server/meter.js";
import { FREE_RECORDER } from "../support/botDoubles.mjs";
import { COMPUTER_OWNS } from "../../packages/computer/src/server/ComputerFeature.js";
import { createComputers } from "../../packages/computer/src/server/computers.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { testBot } from "./testHome.js";

// Bot computers shared by several servers (D-15), against the disposable test database.
// A stand-in replaces the real desktop, so this needs no Xvfb or Chrome.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

function fakeDesktops(log, name) {
  return ({ changed, store }) => {
    const states = new Map();
    const status = (computerId) => ({ state: states.get(computerId) || "asleep", url: "", error: "" });
    return {
      async wake(computerId) {
        log.push(`${name} woke ${computerId}`);
        states.set(computerId, "awake");
        await changed(computerId, status(computerId));
      },
      async sleep(computerId) {
        states.set(computerId, "asleep");
        await changed(computerId, status(computerId));
      },
      async browse(computerId, url) {
        log.push(`${name} browsed ${url}`);
        return { url, title: "Page", text: "", screenshot: await store(computerId, Buffer.from("jpeg")) };
      },
      act: async () => ({ success: true }),
      async startSignIn(computerId, url) {
        log.push(`${name} started a sign-in at ${url}`);
        return { url, title: "Sign in", text: "", screenshot: await store(computerId, Buffer.from("jpeg")) };
      },
      async signInPage(computerId) {
        log.push(`${name} read the page in front of ${computerId}`);
        return { url: "https://login.example.com/code", inChain: true, startedFrom: "https://example.com/sign-in" };
      },
      async endSignIn(computerId) {
        log.push(`${name} ended the sign-in on ${computerId}`);
      },
      screenshot: (computerId) => store(computerId, Buffer.from("jpeg")),
      hold: () => {},
      screen: (computerId) => (states.get(computerId) === "awake" ? { socketPath: "/tmp/x11vnc.sock", opened() {}, closed() {} } : null),
      status,
      shutdown: async () => {}
    };
  };
}

// mercbot.bots.records' directory as the computers read it (records/directory.js): a computer's conversation, and
// which conversations still exist, from the test's own rows.
function conversationsOf(knex) {
  return {
    async computerOf(conversationId) {
      const row = await knex("bot_conversations").join("bots", "bots.id", "bot_conversations.bot_id").where("bot_conversations.id", conversationId)
        .first("bot_conversations.id", "bot_conversations.bot_id", "bot_conversations.user_id", "bot_conversations.group_id", "bot_conversations.workspace_id", "bots.name", "bots.kind", "bots.sharing");
      return row
        ? {
            conversationId: String(row.id), botId: String(row.bot_id), botName: row.name, botKind: row.kind, botSharing: row.sharing,
            userId: row.user_id == null ? null : String(row.user_id), groupId: row.group_id == null ? null : String(row.group_id), workspaceId: String(row.workspace_id)
          }
        : null;
    },
    async liveConversationIds(ids) {
      return new Set((await knex("bot_conversations").whereIn("id", ids).pluck("id")).map(String));
    }
  };
}

async function startServer(knex, context, name, log, store) {
  const notices = createNotices({ knex });
  const { resources, systemContext } = (await ownedHandles(knex, context, { "mercbot.computer": COMPUTER_OWNS })).features["mercbot.computer"];
  const computers = createComputers({
    resources, systemContext, directory: conversationsOf(knex), env: process.env, notices, files: { store },
    meter: createMeter({ recorder: FREE_RECORDER }), createManager: fakeDesktops(log, name)
  });
  const httpServer = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    try {
      const result = await computers.answer(request.headers, JSON.parse(raw));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result: result ?? null }));
    } catch (error) {
      response.writeHead(error.statusCode || 500, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  process.env.MERCBOT_SERVER_ID = name;
  await computers.register(httpServer.address());
  delete process.env.MERCBOT_SERVER_ID;
  return {
    computers,
    url: `http://127.0.0.1:${httpServer.address().port}`,
    // A crash: nothing answers any more, but the server's row is still fresh.
    crash: () => new Promise((resolve) => {
      httpServer.closeAllConnections();
      httpServer.close(resolve);
    }),
    async stop() {
      await computers.shutdown();
      httpServer.close();
      await notices.close();
    }
  };
}

test("two servers share one bot computer through the database", async (context) => {
  const knex = await connectTestDatabase();
  const log = [];
  // The servers share one files volume, as they do in production.
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const a = await startServer(knex, context, "integration-A", log, store);
  const b = await startServer(knex, context, "integration-B", log, store);
  const user = await knex("users").insert({ username: `computers-${Date.now()}` }).returning("id").catch(() => null);
  const userId = user?.[0]?.id ?? (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Shared" });
  // A computer is a conversation's (D-36).
  const computerId = String(bot.conversation_id);
  context.after(async () => {
    await a.stop().catch(() => {});
    await b.stop().catch(() => {});
    await knex("bots").where({ id: bot.id }).del();
    await knex("mercbot_servers").whereIn("id", ["integration-A", "integration-B"]).del();
    await knex.destroy();
    await rm(volume, { recursive: true, force: true });
  });

  // Both servers ask at once: the computer runs on one of them, and both see it awake.
  const woken = await Promise.all([a.computers.wake(computerId), b.computers.wake(computerId)]);
  assert.deepEqual(woken.map((status) => status.state), ["awake", "awake"]);
  const owner = (await knex("bot_computers").where({ conversation_id: bot.conversation_id }).first()).server_id;
  const wakers = new Set(log.filter((line) => line.endsWith(`woke ${computerId}`)).map((line) => line.split(" ")[0]));
  assert.deepEqual([...wakers], [owner]);
  const [here, there] = owner === "integration-A" ? [a, b] : [b, a];

  // The other server's work runs on the owner, and its screenshot is readable anywhere.
  const page = await there.computers.browse(computerId, "example.com");
  assert.ok(log.includes(`${owner} browsed example.com`));
  assert.ok(await there.computers.screenshotData(computerId, page.screenshot));
  // Screenshots are files on the shared volume, never in the database (D-50).
  assert.ok(existsSync(path.join(volume, "computers", computerId, "screenshots", page.screenshot)));
  assert.equal(await knex.schema.hasTable("bot_screenshots"), false);
  assert.equal(await there.computers.screenshotData(computerId, `../${page.screenshot}`), null);
  assert.equal(await there.computers.screenshotData(String(Number(computerId) + 1), page.screenshot), null, "another conversation can't read it");

  // A sign-in's chain lives with the browser (D-77): starting one, reading the page in front and ending it run on the owner.
  await there.computers.startSignIn(computerId, "https://example.com/sign-in");
  assert.deepEqual(await there.computers.signInPage(computerId), { url: "https://login.example.com/code", inChain: true, startedFrom: "https://example.com/sign-in" });
  await there.computers.endSignIn(computerId);
  assert.ok(["started a sign-in at https://example.com/sign-in", `read the page in front of ${computerId}`, `ended the sign-in on ${computerId}`]
    .every((line) => log.includes(`${owner} ${line}`)));
  // A computer awake nowhere has no page in front: it is neither woken nor taken for the server that asked.
  const nowhere = String(Number(computerId) + 1_000_000);
  assert.deepEqual(await there.computers.signInPage(nowhere), { url: "", inChain: false, startedFrom: "" });
  await there.computers.endSignIn(nowhere);
  assert.equal(await knex("bot_computers").where({ conversation_id: nowhere }).first(), undefined);
  assert.ok(!log.some((line) => line.endsWith(nowhere)));

  // A ticket sends the screen to the owner, which uses it up once.
  const ticket = await there.computers.issueTicket(computerId);
  assert.equal((await there.computers.findScreen(ticket)).remote, here.url);
  assert.equal((await here.computers.findScreen(ticket)).socketPath, "/tmp/x11vnc.sock");
  assert.equal(await here.computers.findScreen(ticket), null);

  // Only servers holding the shared secret may pass work on.
  const refused = await fetch(here.url, { method: "POST", headers: { "x-mercbot-internal": "wrong" }, body: JSON.stringify({ operation: "sleep", computerId }) });
  assert.equal(refused.status, 403);

  // When the owner crashes, the next call finds it unreachable and takes the computer over at once.
  await here.crash();
  const status = await there.computers.wake(computerId);
  assert.equal(status.state, "awake");
  const taken = (await knex("bot_computers").where({ conversation_id: bot.conversation_id }).first()).server_id;
  assert.notEqual(taken, owner);
  assert.ok(log.some((line) => line === `${taken} woke ${computerId}`));

  // A move of the home's files starting puts the home's awake computers to sleep, wherever they run (D-80).
  await here.computers.sleepHome(String(bot.workspace_id));
  assert.equal((await knex("bot_computers").where({ conversation_id: bot.conversation_id }).first()).state, "asleep");
  assert.equal((await there.computers.wake(computerId)).state, "awake");

  // A cleanly stopped server leaves its computers asleep for everyone.
  await there.stop();
  assert.equal((await here.computers.status(computerId)).state, "asleep");

  // The conversation's files go with it.
  await knex("bots").where({ id: bot.id }).del();
  await here.computers.sweepFiles();
  assert.equal(existsSync(path.join(volume, "computers", computerId)), false);
});

// Refused, a coding run doesn't start (D-73, D-77): it needs its computer awake, and a computer's day is opened
// before the computer starts, so it stays asleep saying why and the coding tool is never reached. The real computer
// manager here: the refusal comes before any display or browser, and putting the computer away again, its coding run
// first (computerManager's teardown), keeps the refusal as the reason.
test("refused, a coding run doesn't start: its computer can't open its day", async (context) => {
  const knex = await connectTestDatabase();
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  const notices = createNotices({ knex });
  const { resources, systemContext } = (await ownedHandles(knex, context, { "mercbot.computer": COMPUTER_OWNS })).features["mercbot.computer"];
  const opened = [];
  const PAUSED = "This home's work is paused.";
  const recorder = {
    ...FREE_RECORDER,
    startComputerDay: async (computer) => {
      opened.push(computer.computerId);
      throw refuseWork(PAUSED, { code: "work_paused" });
    }
  };
  const files = {
    store: createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} }),
    shell: { available: () => false, detach: async () => {} }
  };
  const computers = createComputers({
    resources, systemContext, directory: conversationsOf(knex), env: { ...process.env, MERCBOT_SERVER_ID: "integration-refused" }, notices, files,
    meter: createMeter({ recorder })
  });
  await computers.register({ address: "127.0.0.1", port: 9 });
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Coder" });
  const computerId = String(bot.conversation_id);
  context.after(async () => {
    await computers.shutdown();
    await notices.close();
    await knex("bots").where({ id: bot.id }).del();
    await knex("mercbot_servers").where({ id: "integration-refused" }).del();
    await knex.destroy();
    await rm(volume, { recursive: true, force: true });
  });

  const start = { action: "start", tool: "claude-code", folder: "/files/mine/site", brief: "Fix the menu on small screens." };
  await assert.rejects(computers.code(computerId, start), (error) => refusalOf(error)?.message === PAUSED);
  assert.deepEqual(opened, [computerId], "the computer's day was asked for, once");
  // Its state is recorded as it changes, without the wake waiting for the write.
  const recorded = () => knex("bot_computers").where({ conversation_id: bot.conversation_id }).first("state", "error");
  for (const deadline = Date.now() + 5000; (await recorded())?.state !== "asleep" && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(await recorded(), { state: "asleep", error: PAUSED }, "it stays asleep, saying why");
});
