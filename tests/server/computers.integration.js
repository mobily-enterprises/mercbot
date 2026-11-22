import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { seedChat } from "../support/chatFixtures.mjs";
import { startChatRecords } from "../support/botRecords.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createNotices } from "../../packages/notices/src/server/notices.js";
import { createMeter, refusalOf, refuseWork } from "../../packages/account/src/server/meter.js";
import { createComputerRecords } from "../../packages/computer/src/server/computerRecords.js";
import { createComputers, PLACE_HERE } from "../../packages/computer/src/server/computers.js";
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { separateHome, testBot } from "./testHome.js";

// A copy that checks no pictures (Mercbot's own): nothing is queued.
const NO_CHECKS = createMediaChecks({ guard: createMediaGuard(null), mediaChecks: null, systemContext: null, store: null });

// A recorder that records nothing and refuses nothing, as tests/support/botDoubles.mjs's FREE_RECORDER: the computers
// need no bots service, so this file doesn't import that one.
const FREE_RECORDER = Object.freeze({
  open: async () => ({ id: "0" }),
  finish: async () => true,
  release: async () => true,
  startComputerDay: async () => null,
  countComputerDay: async () => true,
  computerDay: async () => true,
  startComputation: async () => ({ id: "0" }),
  renewComputation: async () => true,
  finishComputation: async () => true
});

// Bot computers shared by several servers (D-15), against the disposable test database.
// A stand-in replaces the real desktop, so this needs no Xvfb or Chrome.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/**
 * Desktops that stand in for the real computer manager, saying what they do in `log`. `profile` is the browser profile
 * an awake computer has, where a coding tool's sign-in is kept (codingRuns.js).
 */
function fakeDesktops(log, name, profile = null) {
  return ({ changed, store }) => {
    const states = new Map();
    const status = (computerId) => ({ state: states.get(computerId) || "asleep", url: "", error: "" });
    return {
      async wake(computerId) {
        log.push(`${name} woke ${computerId}`);
        states.set(computerId, "awake");
        await changed(computerId, status(computerId));
        return { computerId, profile };
      },
      async sleep(computerId) {
        if (states.get(computerId) === "awake") log.push(`${name} slept ${computerId}`);
        states.set(computerId, "asleep");
        await changed(computerId, status(computerId));
      },
      async browse(computerId, url) {
        log.push(`${name} browsed ${url}`);
        return { url, title: "Page", text: "", screenshot: await store(computerId, Buffer.from("jpeg")) };
      },
      act: async () => ({ success: true }),
      // As the real fill answers: which fields were typed, never their values, on the page in front.
      async fill(computerId, { url = "https://www.login.example.org/sign-in", ...values }) {
        log.push(`${name} filled ${computerId}`);
        return { filled: ["username", "password"].filter((field) => values[field]), url };
      },
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
      hold: (computerId, held) => {
        log.push(`${name} ${held ? "held" : "let go of"} ${computerId}`);
      },
      async open(computerId, virtualPath) {
        log.push(`${name} opened ${virtualPath}`);
        return { opened: virtualPath };
      },
      screen: (computerId) => (states.get(computerId) === "awake" ? { socketPath: "/tmp/x11vnc.sock", opened() {}, closed() {} } : null),
      status,
      shutdown: async () => {}
    };
  };
}

/** Waits for `done` to hold, failing the test after five seconds without it. */
async function until(done, what) {
  for (const deadline = Date.now() + 5000; !(await done());) {
    if (Date.now() > deadline) assert.fail(`${what} didn't happen within five seconds.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Waits until `notices` hears what's published: its LISTEN connection opens a moment after it's made. */
async function listening(notices) {
  let heard = false;
  const stop = notices.subscribe("computers-test", "ready", () => {
    heard = true;
  });
  await until(async () => {
    await notices.publish("computers-test", "ready", {});
    return heard;
  }, "Hearing notices");
  stop();
}

/** A person of the test's own, named `name`. */
async function person(knex, name) {
  const sid = `${name.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await knex("users")
    .insert({ auth_provider: "test", auth_provider_user_sid: sid, email: `${sid}@example.com`, username: sid.replace(/-/gu, ""), display_name: name })
    .returning("id");
  return String(row.id);
}

/**
 * The computers' tables owned as ComputerFeature owns them, beside the bots' records whose chat rule their row policies
 * read (startChatRecords), and what createComputers reads from those records: a computer's bot in its chat
 * (records.directory), the chat's people and their names (records.chats), and where its lines go (records.messages).
 */
async function computerParts(knex, context) {
  const { records, computer: resources, systemContext } = await startChatRecords(knex, context);
  return { resources, systemContext, directory: records.directory, chats: records.chats, messages: records.messages };
}

async function startServer(knex, context, name, log, store, { placement = PLACE_HERE, events = undefined, media = NO_CHECKS, profile = null } = {}) {
  const notices = createNotices({ knex });
  const parts = await computerParts(knex, context);
  const computers = createComputers({
    ...parts, env: process.env, notices, files: { store, media }, meter: createMeter({ recorder: FREE_RECORDER }),
    createManager: fakeDesktops(log, name, profile), placement, events
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
    notices,
    // Call options for work done on no one's behalf, as the bots' own calls are made.
    system: (reason) => ({ context: parts.systemContext(reason) }),
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

/** The files store on a volume of the test's own, removed when it ends. */
async function volumeFor(context) {
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  context.after(() => rm(volume, { recursive: true, force: true }));
  return { volume, store: createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} }) };
}

test("two servers share one bot computer through the database", async (context) => {
  const knex = await connectTestDatabase();
  const log = [];
  // The servers share one files volume, as they do in production.
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // A copy that checks pictures (D-90) checks only the screenshots a reply shows, queued once its turn is over
  // (botTools.js), so a computer queues none as it keeps them.
  const queued = [];
  const media = {
    on: true,
    screenshotLater: async (screenshot) => {
      queued.push(screenshot);
    }
  };
  const a = await startServer(knex, context, "integration-A", log, store, { media });
  const b = await startServer(knex, context, "integration-B", log, store, { media });
  const user = await knex("users").insert({ username: `computers-${Date.now()}` }).returning("id").catch(() => null);
  const userId = user?.[0]?.id ?? (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Shared" });
  const other = await testBot(knex, userId, { name: "Other" });
  // A computer is a bot's in a chat (D14): its id is that bot's chat_bots id.
  const computerId = bot.chat_bot_id;
  context.after(async () => {
    await a.stop().catch(() => {});
    await b.stop().catch(() => {});
    await knex("bots").whereIn("id", [bot.id, other.id]).del();
    await knex("mercbot_servers").whereIn("id", ["integration-A", "integration-B"]).del();
    await knex.destroy();
    await rm(volume, { recursive: true, force: true });
  });

  // Both servers ask at once: the computer runs on one of them, and both see it awake.
  const woken = await Promise.all([a.computers.wake(computerId), b.computers.wake(computerId)]);
  assert.deepEqual(woken.map((status) => status.state), ["awake", "awake"]);
  const owner = (await knex("bot_computers").where({ chat_bot_id: computerId }).first()).server_id;
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
  assert.equal(await there.computers.screenshotData(other.chat_bot_id, page.screenshot), null, "another computer can't read it");
  assert.deepEqual(queued, [], "a screenshot is kept without being queued for a check: a reply that shows it queues it");

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
  assert.equal(await knex("bot_computers").where({ chat_bot_id: nowhere }).first(), undefined);
  assert.ok(!log.some((line) => line.endsWith(nowhere)));

  // A ticket, kept for the computer's chat_bots id in its home, sends the screen to the owner, which uses it up once.
  const ticket = await there.computers.issueTicket(computerId);
  const kept = await knex("computer_tickets").where({ ticket }).first("chat_bot_id", "workspace_id");
  assert.deepEqual([String(kept.chat_bot_id), String(kept.workspace_id)], [computerId, String(bot.workspace_id)]);
  assert.equal((await there.computers.findScreen(ticket)).remote, here.url);
  assert.equal((await here.computers.findScreen(ticket)).socketPath, "/tmp/x11vnc.sock");
  assert.equal(await here.computers.findScreen(ticket), null);
  // A computer whose bot is in no chat has no screen to give a ticket for.
  await assert.rejects(there.computers.issueTicket(nowhere), /This computer's chat is gone\./u);

  // Only servers holding the shared secret may pass work on.
  const refused = await fetch(here.url, { method: "POST", headers: { "x-mercbot-internal": "wrong" }, body: JSON.stringify({ operation: "sleep", computerId }) });
  assert.equal(refused.status, 403);

  // When the owner crashes, the next call finds it unreachable and takes the computer over at once.
  await here.crash();
  const status = await there.computers.wake(computerId);
  assert.equal(status.state, "awake");
  const taken = (await knex("bot_computers").where({ chat_bot_id: computerId }).first()).server_id;
  assert.notEqual(taken, owner);
  assert.ok(log.some((line) => line === `${taken} woke ${computerId}`));

  // A move of the home's files starting puts the home's awake computers to sleep, wherever they run (D-80).
  await here.computers.sleepHome(String(bot.workspace_id));
  assert.equal((await knex("bot_computers").where({ chat_bot_id: computerId }).first()).state, "asleep");
  assert.equal((await there.computers.wake(computerId)).state, "awake");

  // A cleanly stopped server leaves its computers asleep for everyone.
  await there.stop();
  assert.equal((await here.computers.status(computerId)).state, "asleep");

  // A computer's files go with its bot's seat in its chat: the sweep removes the folders of seats that are gone, and
  // keeps those of seats that live.
  const otherFolder = path.join(volume, "computers", other.chat_bot_id);
  await mkdir(path.join(otherFolder, "screenshots"), { recursive: true });
  await writeFile(path.join(otherFolder, "screenshots", "kept.jpg"), "jpeg");
  await knex("conversations").where({ id: bot.conversation_id }).del();
  await here.computers.sweepFiles();
  assert.equal(existsSync(path.join(volume, "computers", computerId)), false);
  assert.ok(existsSync(path.join(otherFolder, "screenshots", "kept.jpg")), "a live seat's computer keeps its folder");
});

// A deleted chat's computers (D14) go to sleep wherever they run, and its folders go: its own, its computers' and its
// bots' command outputs. Their rows went with the chat, so the server that hears of it asks every server, and the one
// running each computer puts it to sleep.
test("a deleted chat's computers go to sleep on whichever server runs them, and its folders go", async (context) => {
  const knex = await connectTestDatabase();
  const log = [];
  const { volume, store } = await volumeFor(context);
  const a = await startServer(knex, context, "removed-A", log, store);
  const b = await startServer(knex, context, "removed-B", log, store);
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Gone" });
  const kept = await testBot(knex, userId, { name: "Kept" });
  const computerId = bot.chat_bot_id;
  context.after(async () => {
    for (const server of [a, b]) await server.stop().catch(() => {});
    await knex("bots").whereIn("id", [bot.id, kept.id]).del();
    await knex("mercbot_servers").whereIn("id", ["removed-A", "removed-B"]).del();
    await knex.destroy();
  });
  await listening(a.notices);

  // Both computers run on A, which woke them (PLACE_HERE), each with a screenshot in its folder.
  for (const id of [computerId, kept.chat_bot_id]) {
    await a.computers.wake(id);
    await a.computers.browse(id, "example.com");
  }
  const chatFolder = path.join(volume, "homes", String(bot.workspace_id), "chats", bot.conversation_id);
  const runsFolder = path.join(volume, "runs", computerId);
  for (const folder of [chatFolder, runsFolder]) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "notes.txt"), "kept until the chat goes");
  }

  // The chat is deleted, its rows with it, and B hears of it.
  await knex("conversations").where({ id: bot.conversation_id }).del();
  await b.computers.chatRemoved({ homeId: String(bot.workspace_id), chatId: bot.conversation_id, chatBotIds: [computerId] });
  await until(() => log.includes(`removed-A slept ${computerId}`), "A putting the deleted chat's computer to sleep");
  assert.ok(!log.some((line) => line.startsWith("removed-B slept")), "B runs none of them");
  for (const folder of [path.join(volume, "computers", computerId), runsFolder, chatFolder]) assert.equal(existsSync(folder), false, folder);

  // Another chat's computer goes on as it was.
  assert.ok(!log.includes(`removed-A slept ${kept.chat_bot_id}`));
  assert.equal((await a.computers.status(kept.chat_bot_id)).state, "awake");
  assert.ok(existsSync(path.join(volume, "computers", kept.chat_bot_id, "screenshots")));
});

// Taking over a chat's computer (D16): anyone who can open the chat takes it over, from the bot or from another person,
// and anyone who can hands it back. Each is a line in the chat its people hear of, on any server. While a person has
// control the bot's own work on the computer waits, naming them; what isn't the bot acting goes on. A computer that
// goes to sleep is the bot's again.
test("a person who takes over a chat's computer holds its bot off until it's handed back, or the computer sleeps", async (context) => {
  const knex = await connectTestDatabase();
  const log = [];
  const { store } = await volumeFor(context);
  const server = await startServer(knex, context, "control-A", log, store);
  const sam = await person(knex, "Sam");
  const priya = await person(knex, "Priya");
  const homeId = await separateHome(knex, sam, [priya]);
  const [bot] = await knex("bots").insert({ made_by: sam, workspace_id: homeId, name: "Tripbot", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id);
  const chat = await seedChat(knex, { homeId, title: "Lisbon", people: [sam, priya], bots: [botId] });
  const computerId = chat.chatBotIds.get(botId);
  context.after(async () => {
    await server.stop().catch(() => {});
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").whereIn("id", [sam, priya]).del();
    await knex("mercbot_servers").where({ id: "control-A" }).del();
    await knex.destroy();
  });
  const as = (userId) => requestContextOptions({ user: { id: userId }, workspace: { id: homeId, slug: `home-${homeId}` }, membership: { roleSid: "member" } });
  const computers = server.computers;
  const heard = [];
  server.notices.subscribe("bots", priya, (event) => heard.push(event));
  await listening(server.notices);
  // The lines in the chat, as records.messages wrote them.
  const lines = () => knex("messages").where({ conversation_id: chat.id }).orderBy("id").select("role", "kind", "author_user_id", "body");
  const texts = async () => (await lines()).map((line) => line.body.text);
  const controlled = async () => knex("bot_computers").where({ chat_bot_id: computerId }).first("controlled_by", "controlled_at");

  // Nobody has control at first, and nothing is signed in.
  assert.deepEqual(await computers.status(computerId), { state: "asleep", url: "", error: "", control: null, signIns: [] });

  // Taking over is a person's, of a computer that's there.
  await assert.rejects(computers.takeOver(computerId, server.system("a call with no person")), TypeError);
  await assert.rejects(computers.takeOver(String(Number(computerId) + 1_000_000), as(sam)), (error) => error.statusCode === 404 && error.code === "computer_not_found");
  assert.deepEqual(await lines(), []);

  // Sam takes over: the computer wakes for him, a line in the chat says so, and the chat's people hear of both.
  const taken = await computers.takeOver(computerId, as(sam));
  assert.deepEqual([taken.control.userId, taken.control.name], [sam, "Sam"]);
  assert.ok(!Number.isNaN(Date.parse(taken.control.since)));
  assert.deepEqual(taken.messages.map((message) => message.body.text), ["Sam took over Tripbot's computer."]);
  assert.deepEqual(
    (await lines()).map(({ role, kind, author_user_id: author, body }) => [role, kind, author, body.icon, body.computer]),
    [["system", "event", null, "computer", { chatBotId: computerId, botId, control: sam }]],
    "Mercbot's own line, no one's unread"
  );
  const status = await computers.status(computerId);
  assert.deepEqual(
    [status.state, status.control.userId, status.control.name, Date.parse(status.control.since)],
    ["awake", sam, "Sam", Date.parse(taken.control.since)]
  );
  assert.equal(String((await controlled()).controlled_by), sam, "every server sees who has control");
  await until(() => heard.some((event) => event.type === "messages" && event.chatId === chat.id), "Priya hearing of the line");
  await until(() => heard.some((event) => event.type === "computer" && event.botId === botId && event.control?.userId === sam), "Priya hearing who has control");
  // Taking it again changes nothing.
  assert.deepEqual((await computers.takeOver(computerId, as(sam))).messages, []);
  assert.equal((await lines()).length, 1);

  // While Sam has control, each thing the bot would do on the computer waits, naming him, and none reaches it.
  const heldOff = (error) => error.statusCode === 409 && error.code === "computer_person_in_control"
    && error.message === "Sam has control of Tripbot's computer. Wait until they hand it back.";
  const reached = log.length;
  for (const [what, work] of [
    ["browse", () => computers.browse(computerId, "example.com")],
    ["act", () => computers.act(computerId, "Click Sign in")],
    ["fill", () => computers.fill(computerId, { site: "mail.example.com", username: "sam", password: "secret" })],
    ["screenshot", () => computers.screenshot(computerId)],
    ["startSignIn", () => computers.startSignIn(computerId, "https://example.com/sign-in")],
    ["a coding tool's sign-in", () => computers.code(computerId, { action: "signIn", tool: "codex" })],
    ["a coding run", () => computers.code(computerId, { action: "start", tool: "codex", folder: "/files/chat/website", brief: "Fix the menu." })]
  ]) await assert.rejects(work(), heldOff, what);
  assert.deepEqual(log.slice(reached), []);
  // What isn't the bot acting goes on: its state, holding it, opening a file for the person, a coding tool's status.
  assert.equal((await computers.status(computerId)).state, "awake");
  await computers.hold(computerId, true);
  assert.ok(log.includes(`control-A held ${computerId}`));
  assert.deepEqual(await computers.open(computerId, "/files/chat/notes.docx"), { opened: "/files/chat/notes.docx" });
  assert.ok(Array.isArray((await computers.code(computerId, { action: "status" })).tools));

  // Priya takes it from Sam, then hands it back to the bot, which acts on it again.
  const fromSam = await computers.takeOver(computerId, as(priya));
  assert.deepEqual([fromSam.control.userId, fromSam.control.name], [priya, "Priya"]);
  const back = await computers.handBack(computerId, as(priya));
  assert.deepEqual([back.messages.map((message) => message.body.text), back.control], [["Priya handed Tripbot's computer back."], null]);
  assert.deepEqual((await texts()).slice(1), ["Priya took over Tripbot's computer from Sam.", "Priya handed Tripbot's computer back."]);
  assert.equal((await lines()).at(-1).body.computer.control, null);
  assert.equal((await computers.status(computerId)).control, null);
  assert.deepEqual(await controlled(), { controlled_by: null, controlled_at: null });
  await until(() => heard.some((event) => event.type === "computer" && event.control === null), "Priya hearing the bot has it back");
  // With nobody in control, handing it back posts nothing.
  assert.deepEqual(await computers.handBack(computerId, as(sam)), { messages: [], control: null });
  assert.equal((await lines()).length, 3);
  await computers.browse(computerId, "example.com");
  assert.ok(log.includes("control-A browsed example.com"));

  // A computer that goes to sleep is the bot's again, without a line.
  await computers.takeOver(computerId, as(sam));
  await computers.sleep(computerId);
  assert.deepEqual(await computers.status(computerId), { state: "asleep", url: "", error: "", control: null, signIns: [] });
  assert.deepEqual(await controlled(), { controlled_by: null, controlled_at: null });
  assert.deepEqual((await texts()).slice(3), ["Sam took over Tripbot's computer."]);
  assert.equal((await computers.browse(computerId, "example.org")).url, "example.org");
});

// What's signed in on a computer (D14, D16), as its panel lists it, newest first: a site a fill typed a password on,
// a coding tool signed in there, and Sedna (D-93). It's kept with the saved browser, so every server reads it.
test("what signs in on a computer is listed with it, newest first: a site a password was typed on, a coding tool, Sedna", async (context) => {
  const knex = await connectTestDatabase();
  const log = [];
  const { store } = await volumeFor(context);
  const profile = await mkdtemp(path.join(os.tmpdir(), "mb-profile-"));
  context.after(() => rm(profile, { recursive: true, force: true }));
  const server = await startServer(knex, context, "signins-A", log, store, { profile });
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Signer" });
  const computerId = bot.chat_bot_id;
  context.after(async () => {
    await server.stop().catch(() => {});
    await knex("bots").where({ id: bot.id }).del();
    await knex("mercbot_servers").where({ id: "signins-A" }).del();
    await knex.destroy();
  });
  const computers = server.computers;
  const listed = async () => (await computers.status(computerId)).signIns.map(({ label, kind }) => [label, kind]);

  // A fill that typed no password signed in to nothing.
  await computers.fill(computerId, { site: "mail.example.com", username: "sam" });
  assert.deepEqual(await listed(), []);
  // One that typed a password signed in to the site it named, else to the page's host.
  await computers.fill(computerId, { site: "mail.example.com", username: "sam", password: "secret" });
  await computers.fill(computerId, { url: "https://www.login.example.org/sign-in", password: "secret" });
  assert.deepEqual(await listed(), [["login.example.org", "site"], ["mail.example.com", "site"]]);
  // Signing in to a site again lists it once, as the newest.
  await computers.fill(computerId, { site: "mail.example.com", password: "secret" });
  assert.deepEqual(await listed(), [["mail.example.com", "site"], ["login.example.org", "site"]]);

  // A coding tool signed in on the computer, as its own sign-in leaves it in the browser profile, is listed once.
  await computers.code(computerId, { action: "status" });
  assert.equal((await listed()).length, 2, "a tool not signed in isn't listed");
  await mkdir(path.join(profile, ".coding", ".claude"), { recursive: true });
  await writeFile(path.join(profile, ".coding", ".claude", ".credentials.json"), "{}");
  await computers.code(computerId, { action: "status" });
  await computers.code(computerId, { action: "status" });
  // Sedna's is noted by the bots (D-93).
  await computers.noteSignIn(computerId, { label: "Sedna", kind: "sedna" });
  const expected = [["Sedna", "sedna"], ["Claude Code", "coding"], ["mail.example.com", "site"], ["login.example.org", "site"]];
  assert.deepEqual(await listed(), expected);
  const { signIns } = await computers.status(computerId);
  assert.ok(signIns.every((one) => !Number.isNaN(Date.parse(one.since))));
  const saved = (await knex("bot_browser_state").where({ chat_bot_id: computerId }).first("sign_ins")).sign_ins;
  assert.deepEqual(saved.map(({ label, kind }) => [label, kind]), expected, "kept with the saved browser");

  // A sign-in has a label and a kind of the three.
  await assert.rejects(computers.noteSignIn(computerId, { label: "My bank", kind: "bank" }), TypeError);
  await assert.rejects(computers.noteSignIn(computerId, { label: "  ", kind: "site" }), TypeError);
  // The newest thirty are kept.
  for (let index = 1; index <= 30; index += 1) await computers.noteSignIn(computerId, { label: `site-${index}.example.com`, kind: "site" });
  const many = await listed();
  assert.equal(many.length, 30);
  assert.deepEqual([many[0], many.at(-1)], [["site-30.example.com", "site"], ["site-1.example.com", "site"]]);
});

// Refused, a coding run doesn't start (D-73, D-77): it needs its computer awake, and a computer's day is opened
// before the computer starts, so it stays asleep saying why and the coding tool is never reached. The real computer
// manager here: the refusal comes before any display or browser, and putting the computer away again, its coding run
// first (computerManager's teardown), keeps the refusal as the reason.
test("refused, a coding run doesn't start: its computer can't open its day", async (context) => {
  const knex = await connectTestDatabase();
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  const notices = createNotices({ knex });
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
    shell: { available: () => false, detach: async () => {} },
    media: NO_CHECKS
  };
  const computers = createComputers({
    ...(await computerParts(knex, context)), env: { ...process.env, MERCBOT_SERVER_ID: "integration-refused" }, notices, files, meter: createMeter({ recorder }), placement: PLACE_HERE
  });
  await computers.register({ address: "127.0.0.1", port: 9 });
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Coder" });
  const computerId = bot.chat_bot_id;
  context.after(async () => {
    await computers.shutdown();
    await notices.close();
    await knex("bots").where({ id: bot.id }).del();
    await knex("mercbot_servers").where({ id: "integration-refused" }).del();
    await knex.destroy();
    await rm(volume, { recursive: true, force: true });
  });

  const start = { action: "start", tool: "claude-code", folder: "/files/chat/website", brief: "Fix the menu on small screens." };
  await assert.rejects(computers.code(computerId, start), (error) => refusalOf(error)?.message === PAUSED);
  assert.deepEqual(opened, [computerId], "the computer's day was asked for, once");
  // Its state is recorded as it changes, without the wake waiting for the write: the row the claim made reads asleep
  // already, so this waits for the refusal's reason, written after waking.
  const recorded = () => knex("bot_computers").where({ chat_bot_id: computerId }).first("state", "error");
  for (const deadline = Date.now() + 5000; (await recorded())?.error !== PAUSED && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(await recorded(), { state: "asleep", error: PAUSED }, "it stays asleep, saying why");
});

// A computer's states land in the order they change, though the manager doesn't wait for a write: here the first,
// creating the row, is slowest, so the second creates it first and the first, losing that race, would retry and
// land last, leaving the asleep computer recorded as waking.
test("a computer's states are recorded in the order they change, even when the first write is slowest", async (context) => {
  const knex = await connectTestDatabase();
  const { resources, systemContext } = await computerParts(knex, context);
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Ordered" });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  let lookups = 0;
  const records = createComputerRecords({
    resources,
    system: () => ({ context: systemContext("record the test bot's computer") }),
    homeOf: async () => {
      lookups += 1;
      if (lookups === 1) await new Promise((resolve) => setTimeout(resolve, 300));
      return String(bot.workspace_id);
    }
  });
  const computerId = bot.chat_bot_id;
  await Promise.all([
    records.recordState(computerId, "integration-ordered", { state: "waking", url: "", error: "" }),
    records.recordState(computerId, "integration-ordered", { state: "asleep", url: "", error: "This home's work is paused." })
  ]);
  assert.deepEqual(
    await knex("bot_computers").where({ chat_bot_id: computerId }).first("state", "error"),
    { state: "asleep", error: "This home's work is paused." }
  );
});

// A copy built on Mercbot that says where computers run (D-85): a server it never chooses passes every computer to the
// servers it does, the least busy first; their calls are signed with its secret, a gone one's computer is placed again,
// and with nowhere to put it a computer says so, and who listens hears it (D-88). The servers it knows say who is
// alive and holds what.
test("a copy that says where computers run passes them to the servers it chooses", async (context) => {
  const knex = await connectTestDatabase();
  const log = [];
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-volume-"));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const hosts = new Set(["placement-A", "placement-B"]);
  let open = true;
  const placement = {
    secret: "placement-secret-for-the-integration-test",
    async choose(_computerId, servers) {
      const candidates = (await servers.live()).filter((server) => open && hosts.has(server.id)).sort((x, y) => x.awake - y.awake || x.id.localeCompare(y.id));
      return candidates[0]?.id ?? null;
    }
  };
  const events = [];
  const listener = { record: async (event) => events.push(event) };
  const web = await startServer(knex, context, "placement-web", log, store, { placement, events: listener });
  const a = await startServer(knex, context, "placement-A", log, store, { placement });
  const b = await startServer(knex, context, "placement-B", log, store, { placement });
  const userId = (await knex("users").first())?.id ?? (await knex("users").insert({ username: `placement-${Date.now()}` }).returning("id"))[0].id;
  const first = await testBot(knex, userId, { name: "Placed" });
  const second = await testBot(knex, userId, { name: "Placed too" });
  context.after(async () => {
    for (const server of [web, a, b]) await server.stop().catch(() => {});
    await knex("bots").whereIn("id", [first.id, second.id]).del();
    await knex("mercbot_servers").whereIn("id", ["placement-web", "placement-A", "placement-B"]).del();
    await knex.destroy();
    await rm(volume, { recursive: true, force: true });
  });
  const holder = async (bot) => (await knex("bot_computers").where({ chat_bot_id: bot.chat_bot_id }).first())?.server_id;

  // The first computer goes to the least busy server chosen, the second to the other; the asking server runs neither.
  assert.equal((await web.computers.wake(first.chat_bot_id)).state, "awake");
  assert.equal(await holder(first), "placement-A");
  assert.equal((await web.computers.wake(second.chat_bot_id)).state, "awake");
  assert.equal(await holder(second), "placement-B");
  assert.ok(!log.some((line) => line.startsWith("placement-web ")));
  const known = new Map((await web.computers.servers()).map((server) => [server.id, server]));
  assert.deepEqual(
    ["placement-web", "placement-A", "placement-B"].map((id) => ({ id, alive: known.get(id)?.alive, awake: known.get(id)?.awake, url: known.get(id)?.url })),
    [{ id: "placement-web", alive: true, awake: 0, url: web.url }, { id: "placement-A", alive: true, awake: 1, url: a.url }, { id: "placement-B", alive: true, awake: 1, url: b.url }]
  );
  assert.ok(Date.now() - Date.parse(known.get("placement-A").seenAt) < 45_000);
  await web.computers.browse(first.chat_bot_id, "example.com");
  assert.ok(log.includes("placement-A browsed example.com"));

  // Calls between servers are signed with the placement's secret, not the database's; so is a relayed screen.
  const signed = (secret) => fetch(a.url, {
    method: "POST",
    headers: { "x-mercbot-internal": secret },
    body: JSON.stringify({ operation: "screenshot", computerId: first.chat_bot_id })
  });
  assert.equal((await signed(placement.secret)).status, 200);
  const kept = (await knex("mercbot_settings").where({ name: "internal_secret" }).first())?.value;
  assert.equal((await signed(kept || "missing")).status, 403);
  assert.equal((await signed("")).status, 403);
  const screen = await web.computers.findScreen(await web.computers.issueTicket(first.chat_bot_id));
  assert.deepEqual({ remote: screen.remote, headers: screen.headers }, { remote: a.url, headers: { "x-mercbot-internal": placement.secret } });

  // A server that crashed is found gone at the next call, and its computer is placed again, on the other one.
  await a.crash();
  assert.equal((await web.computers.browse(first.chat_bot_id, "example.org")).url, "example.org");
  assert.equal(await holder(first), "placement-B");
  assert.ok(log.includes("placement-B browsed example.org"));

  // With no server to put a computer on, waking it says so, and nothing runs it.
  await web.computers.sleep(first.chat_bot_id);
  await b.crash();
  open = false;
  await assert.rejects(web.computers.wake(first.chat_bot_id), (error) => error.statusCode === 503 && error.code === "computer_none_free");
  assert.ok(!log.some((line) => line.startsWith("placement-web ")));
  await new Promise(setImmediate);
  assert.deepEqual(events, [{ kind: "refused", computerId: first.chat_bot_id, serverId: "placement-web", code: "computer_none_free" }]);
});
