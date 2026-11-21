import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createMeter } from "../../packages/account/src/server/meter.js";
import { createComputers, PLACE_HERE } from "../../packages/computer/src/server/computers.js";
import { registerRoutes } from "../../packages/computer/src/server/registerRoutes.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// A chat's computers (D14, D16), through the computer routes as a person's request reaches them: each bot in a chat
// has its own computer there, anyone who can open the chat takes it over and hands it back, each with a line in the
// chat that its people hear of, the bot doesn't act on it meanwhile, and a home member who can't open the chat (a
// private chat they're not in) gets a 404 for all of it. A stand-in replaces the desktop, so this needs no Xvfb or Chrome.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

/** A recorder that records nothing and refuses nothing. */
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

/** Computers that wake, sleep and browse in memory, logging what the bot did on each. */
function fakeDesktops(log) {
  return ({ changed, store }) => {
    const states = new Map();
    const status = (computerId) => ({ state: states.get(String(computerId)) || "asleep", url: "", error: "" });
    const did = (what) => async (computerId) => {
      log.push(`${what} ${computerId}`);
      return { url: "https://example.com", title: "Page", text: "", screenshot: await store(computerId, Buffer.from("jpeg")) };
    };
    return {
      async wake(computerId) {
        states.set(String(computerId), "awake");
        await changed(computerId, status(computerId));
      },
      async sleep(computerId) {
        states.set(String(computerId), "asleep");
        await changed(computerId, status(computerId));
      },
      browse: did("browsed"),
      act: did("acted"),
      startSignIn: did("started a sign-in"),
      screenshot: (computerId) => store(computerId, Buffer.from("jpeg")),
      fill: async (computerId) => {
        log.push(`filled ${computerId}`);
        return { filled: ["username", "password"], url: "https://shop.example.com/login" };
      },
      signInPage: async () => ({ url: "", inChain: false, startedFrom: "" }),
      endSignIn: async () => {},
      hold: () => {},
      screen: () => null,
      status,
      shutdown: async () => {}
    };
  };
}

/**
 * A home with three people and two bots: Family (public: Anna, Ben) with Tripbot and Chef, and Plans (private: Anna,
 * Ben) with Tripbot. Carla is in the home and in neither chat.
 */
async function rossiHome(context) {
  const people = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.equal(people.length, 3, "the test database needs three users");
  const [anna, ben, carla] = people;
  const [row] = await knex("workspaces").insert({ slug: `rossi-${randomBytes(5).toString("hex")}`, name: "Rossi", owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert(people.map((id, index) => ({ workspace_id: homeId, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
  const bots = {};
  for (const name of ["Tripbot", "Chef"]) {
    bots[name] = String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC" }).returning("id"))[0].id);
  }
  const family = await seedChat(knex, { homeId, kind: "public", title: "Family", people: [anna, ben], bots: [bots.Tripbot, bots.Chef] });
  const plans = await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna, ben], bots: [bots.Tripbot] });
  return { homeId, anna, ben, carla, bots, family, plans };
}

/** One server's computers and the computer routes, on the test's records, with what they told people kept. */
async function startComputers(context) {
  const { records, computer: resources, systemContext } = await startChatRecords(knex, context);
  const log = [];
  const told = [];
  const notices = {
    publish: async (topic, key, event) => told.push({ topic, keys: [String(key)], event }),
    publishEach: async (topic, keys, event) => told.push({ topic, keys: keys.map(String), event }),
    subscribe: () => () => {}
  };
  const volume = await mkdtemp(path.join(os.tmpdir(), "mercbot-chat-computers-"));
  context.after(() => rm(volume, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const files = { store, media: { on: false }, shell: { available: () => false } };
  const computers = createComputers({
    resources,
    systemContext,
    directory: records.directory,
    chats: records.chats,
    messages: records.messages,
    env: { ...process.env, MERCBOT_SERVER_ID: `chat-computers-${randomBytes(4).toString("hex")}` },
    notices,
    files,
    meter: createMeter({ recorder: FREE_RECORDER }),
    placement: PLACE_HERE,
    createManager: fakeDesktops(log)
  });
  await computers.register({ address: "127.0.0.1", port: 9 });
  context.after(() => computers.shutdown());
  const routes = new Map();
  const http = { router: { register: (method, route, _options, handler) => routes.set(`${method} ${route}`, handler) } };
  registerRoutes(http, { computer: computers, files, records, streams: new Set(), meter: { pausedMessage: async () => null } });
  return { records, computers, routes, log, told };
}

/** A person's request to a computer route, answered: { status, body }. */
async function ask(routes, method, route, { homeId, userId, botId, chatId, body = {} }) {
  const handler = routes.get(`${method} /api/w/:workspaceSlug/bots/:botId${route}`);
  assert.ok(handler, `the route ${method} ${route} is registered`);
  const reply = {
    statusCode: 200,
    body: undefined,
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(sent) {
      this.body = sent;
      return this;
    },
    header() {
      return this;
    }
  };
  const request = {
    params: { workspaceSlug: `home-${homeId}`, botId: String(botId) },
    query: chatId == null ? {} : { chat: String(chatId) },
    body,
    workspace: { id: homeId },
    user: { id: userId },
    callOptions: async () => memberOptions({ userId, homeId })
  };
  await handler(request, reply);
  return { status: reply.statusCode, body: reply.body };
}

test("anyone who can open a chat takes over a bot's computer there and hands it back, and the bot waits meanwhile", async (context) => {
  const { records, computers, routes, log, told } = await startComputers(context);
  const { homeId, anna, ben, carla, bots, family } = await rossiHome(context);
  const names = await records.chats.names([anna, ben, carla], memberOptions({ userId: anna, homeId }));
  const tripbot = family.chatBotIds.get(bots.Tripbot);
  const chef = family.chatBotIds.get(bots.Chef);
  const as = (userId, botId = bots.Tripbot) => ({ homeId, userId, botId, chatId: family.id });

  // Carla isn't in Family, but it's public, so she can open it, and take over Tripbot's computer there (D16).
  const taken = await ask(routes, "POST", "/computer/take-over", as(carla));
  assert.equal(taken.status, 200);
  assert.equal(taken.body.control.userId, carla);
  assert.equal(taken.body.control.name, names.get(carla));
  assert.deepEqual(taken.body.messages.map((message) => message.body.text), [`${names.get(carla)} took over Tripbot's computer.`]);
  const timeline = await records.messages.timeline(family.id, {}, memberOptions({ userId: anna, homeId }));
  assert.equal(timeline.messages.at(-1).body.text, `${names.get(carla)} took over Tripbot's computer.`, "the line is in the chat");
  // The chat's people and Carla hear of the line and of the control, on any server.
  const heard = (type) => told.filter((notice) => notice.topic === "bots" && notice.event.type === type).at(-1);
  assert.deepEqual(heard("messages").keys.sort(), [anna, ben, carla].sort());
  assert.deepEqual(heard("computer").event, { type: "computer", chatId: family.id, botId: bots.Tripbot, control: taken.body.control });
  const status = await ask(routes, "GET", "/computer", as(anna));
  assert.equal(status.body.state, "awake", "taking over woke it");
  assert.equal(status.body.control.userId, carla, "the computer's status says who has control");

  // While Carla has control, Tripbot doesn't act on its computer there; Chef's computer in the same chat is its own.
  for (const work of [() => computers.browse(tripbot, "https://example.com"), () => computers.act(tripbot, "click"), () => computers.screenshot(tripbot),
    () => computers.fill(tripbot, { site: "Shop" }), () => computers.startSignIn(tripbot, "https://example.com/login")]) {
    await assert.rejects(work(), (error) => error.statusCode === 409 && error.code === "computer_person_in_control" &&
      error.message === `${names.get(carla)} has control of Tripbot's computer. Wait until they hand it back.`);
  }
  await computers.browse(chef, "https://example.com");
  assert.deepEqual(log, [`browsed ${chef}`], "only Chef's computer did anything");
  assert.equal((await computers.status(tripbot)).state, "awake", "its status still answers");

  // Ben takes it from Carla, and the line names her; Anna, not the one with control, hands it back.
  const again = await ask(routes, "POST", "/computer/take-over", as(ben));
  assert.equal(again.body.messages[0].body.text, `${names.get(ben)} took over Tripbot's computer from ${names.get(carla)}.`);
  assert.equal(again.body.control.userId, ben);
  const back = await ask(routes, "POST", "/computer/hand-back", as(anna));
  assert.deepEqual({ status: back.status, control: back.body.control }, { status: 200, control: null });
  assert.equal(back.body.messages[0].body.text, `${names.get(anna)} handed Tripbot's computer back.`);
  assert.equal(heard("computer").event.control, null);
  assert.equal((await ask(routes, "GET", "/computer", as(ben))).body.control, null);
  await computers.browse(tripbot, "https://example.com");
  assert.equal(log.at(-1), `browsed ${tripbot}`, "the bot acts on it again");
  // Handing back what nobody controls changes nothing.
  assert.deepEqual((await ask(routes, "POST", "/computer/hand-back", as(carla))).body, { messages: [], control: null });

  // A password typed in lists the site among the computer's sign-ins; a computer that sleeps is the bot's again.
  await computers.fill(tripbot, { site: "Shop" });
  assert.deepEqual((await computers.status(tripbot)).signIns.map(({ label, kind }) => ({ label, kind })), [{ label: "Shop", kind: "site" }]);
  await ask(routes, "POST", "/computer/take-over", as(carla));
  await computers.sleep(tripbot);
  assert.equal((await computers.status(tripbot)).control, null, "sleep ends a take-over");
});

test("a home member who can't open a private chat gets a 404 for its computers, and so does a bot not in the chat", async (context) => {
  const { records, computers, routes } = await startComputers(context);
  const { homeId, anna, carla, bots, plans, family } = await rossiHome(context);
  const seat = plans.chatBotIds.get(bots.Tripbot);
  const carlaAsks = { homeId, userId: carla, botId: bots.Tripbot, chatId: plans.id };
  for (const [method, route] of [["GET", "/computer"], ["POST", "/computer/wake"], ["POST", "/computer/ticket"], ["POST", "/computer/take-over"],
    ["POST", "/computer/hand-back"], ["POST", "/computer/reset"], ["POST", "/computer/open"]]) {
    const answer = await ask(routes, method, route, carlaAsks);
    assert.deepEqual({ status: answer.status, code: answer.body?.code }, { status: 404, code: "computer_not_found" }, `${method} ${route}`);
  }
  // The same through the capability, and a computer named by another chat's seat is no way in.
  await assert.rejects(computers.takeOver(seat, memberOptions({ userId: carla, homeId })), { statusCode: 404, code: "computer_not_found" });
  const notInChat = await ask(routes, "POST", "/computer/take-over", { homeId, userId: anna, botId: bots.Chef, chatId: plans.id });
  assert.equal(notInChat.status, 404, "Chef isn't in Plans, so it has no computer there");
  const noChat = await ask(routes, "GET", "/computer", { homeId, userId: anna, botId: bots.Tripbot, chatId: null });
  assert.equal(noChat.status, 404, "a computer is a bot's in a chat: without one there's none");
  // Nothing changed in the private chat: no line, no control, and Anna, who's in it, can take it over.
  assert.deepEqual((await records.messages.timeline(plans.id, {}, memberOptions({ userId: anna, homeId }))).messages, []);
  assert.equal((await computers.status(seat)).control, null);
  const annaTakes = await ask(routes, "POST", "/computer/take-over", { homeId, userId: anna, botId: bots.Tripbot, chatId: plans.id });
  assert.equal(annaTakes.status, 200);
  assert.equal(annaTakes.body.control.userId, anna);
  assert.notEqual(family.chatBotIds.get(bots.Tripbot), seat, "the same bot has another computer in another chat (D14)");
  assert.equal((await computers.status(family.chatBotIds.get(bots.Tripbot))).control, null);
});
