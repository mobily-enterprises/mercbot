import assert from "node:assert/strict";
import test from "node:test";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { registerRoutes as registerComputerRoutes } from "../../packages/computer/src/server/registerRoutes.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";

// The bots routes' one guard: a bot or group in the address is one the
// person sees in the request's home, read through the directory, or the route answers 404 with a code that says
// which: bots_bot_not_found for :botId, bots_group_not_found for :groupId. An id that is no bot id at all is refused
// the same way, without a read.

function routesWith(findBot, service = {}) {
  const routes = new Map();
  const asked = [];
  const http = { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } };
  const bots = {
    listedBot: async (botId) => ({ id: botId, name: "Found" }),
    addPerson: async (groupId) => ({ bot: { id: groupId } }),
    ...service
  };
  const records = {
    directory: {
      findBot: async (botId, options) => {
        asked.push({ botId, options });
        return findBot(botId);
      }
    }
  };
  registerRoutes(http, {
    bots,
    approvals: {},
    notices: {},
    meter: { track: (_meta, work) => work() },
    records,
    streams: new Set()
  });
  async function call(key, params, body = {}, permissions = []) {
    const handler = routes.get(key);
    assert.ok(handler, `${key} is a route`);
    const method = key.split(" ")[0];
    const answer = {};
    const reply = {
      code(status) {
        answer.status = status;
        return reply;
      },
      send(sent) {
        answer.body = sent;
        return reply;
      }
    };
    const request = { method, params, body, user: { id: "7" }, workspace: { id: "3", slug: "home-3" }, membership: { roleSid: "member" }, permissions };
    request.callOptions = async () => requestContextOptions(request);
    await handler(request, reply);
    return answer;
  }
  return { call, asked };
}

test("a bot the person doesn't see in the home is not found, and says so", async () => {
  const { call, asked } = routesWith(() => null);
  const answer = await call("GET /api/w/:workspaceSlug/bots/:botId", { workspaceSlug: "home-3", botId: "12" });
  assert.equal(answer.status, 404);
  assert.equal(answer.body.code, "bots_bot_not_found");
  assert.equal(asked[0].botId, "12");
  assert.ok(asked[0].options.context, "read in the request's own options");
});

test("a group the person isn't in is not found as a group", async () => {
  const { call } = routesWith(() => null);
  const answer = await call("POST /api/w/:workspaceSlug/groups/:groupId/people", { workspaceSlug: "home-3", groupId: "40" }, { userId: "8" });
  assert.equal(answer.status, 404);
  assert.equal(answer.body.code, "bots_group_not_found");
});

test("an id that is no bot id is refused without a read", async () => {
  const { call, asked } = routesWith(() => ({ id: "1", name: "Never" }));
  for (const botId of ["0", "abc", "1.5", "1; select 1", "99999999999999999999", "-3"]) {
    const answer = await call("GET /api/w/:workspaceSlug/bots/:botId", { workspaceSlug: "home-3", botId });
    assert.equal(answer.status, 404, botId);
    assert.equal(answer.body.code, "bots_bot_not_found", botId);
  }
  assert.equal(asked.length, 0);
});

test("a bot the person sees reaches the route's work", async () => {
  const { call } = routesWith((botId) => ({ id: botId, name: "Found" }));
  const answer = await call("GET /api/w/:workspaceSlug/bots/:botId", { workspaceSlug: "home-3", botId: "12" });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { bot: { id: "12", name: "Found" } });
});

test("an archived bot is read-only: its reads answer, and only the routes that take an archived bot change it (D-108)", async () => {
  const ledger = (archivedAt) => ({ id: "12", name: "Ledger", kind: "bot", archivedAt });
  const ran = [];
  const work = (name) => async () => {
    ran.push(name);
    return { done: name };
  };
  const service = Object.fromEntries(["sendMessage", "replyTo", "react", "advanceOnboarding", "archiveBot", "unarchiveBot", "updateBot",
    "deleteBot", "removeMember", "messages", "library"].map((name) => [name, work(name)]));
  service.knowledge = { add: work("knowledge.add") };
  const params = { workspaceSlug: "home-3", botId: "12" };
  const writes = [
    "POST /api/w/:workspaceSlug/bots/:botId/messages",
    "POST /api/w/:workspaceSlug/bots/:botId/reply",
    "PUT /api/w/:workspaceSlug/bots/:botId/messages/:messageId/reaction",
    "POST /api/w/:workspaceSlug/bots/:botId/onboarding/advance",
    "POST /api/w/:workspaceSlug/bots/:botId/knowledge"
  ];
  const taking = [
    "POST /api/w/:workspaceSlug/bots/:botId/archive",
    "POST /api/w/:workspaceSlug/bots/:botId/unarchive",
    "PATCH /api/w/:workspaceSlug/bots/:botId",
    "DELETE /api/w/:workspaceSlug/bots/:botId",
    "DELETE /api/w/:workspaceSlug/groups/:groupId/members/:botId"
  ];
  const reads = ["GET /api/w/:workspaceSlug/bots/:botId/messages", "GET /api/w/:workspaceSlug/bots/:botId/library"];

  const archived = routesWith(() => ledger("2026-11-21T10:00:00.000Z"), service);
  for (const key of writes) {
    const answer = await archived.call(key, { ...params, messageId: "5" }, { text: "Hi", emoji: "👍" });
    assert.equal(answer.status, 409, key);
    assert.deepEqual(answer.body, { error: "Ledger is archived. Unarchive it to continue.", code: "bots_bot_archived", params: { name: "Ledger" } }, key);
  }
  assert.deepEqual(ran, [], "none of their work ran");
  for (const key of [...taking, ...reads]) {
    const answer = await archived.call(key, { ...params, groupId: "40" }, {});
    assert.equal(answer.status, 200, key);
  }
  assert.deepEqual(ran, ["archiveBot", "unarchiveBot", "updateBot", "deleteBot", "removeMember", "messages", "library"]);

  // The same writes reach their work while it isn't archived.
  ran.length = 0;
  const active = routesWith(() => ledger(null), service);
  for (const key of writes) assert.equal((await active.call(key, { ...params, messageId: "5" }, { text: "Hi", emoji: "👍" })).status, 200, key);
  assert.equal(ran.length, writes.length);
});

test("an archived bot's computer doesn't wake or open a file (D-108), while another bot's does", async () => {
  const routes = new Map();
  const woken = [];
  const bot = { id: "12", name: "Ledger", kind: "bot", archivedAt: "2026-11-21T10:00:00.000Z" };
  registerComputerRoutes({ router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } }, {
    computer: {
      status: async () => ({ state: "asleep" }),
      wake: async (computerId) => { woken.push(computerId); },
      open: async () => ({})
    },
    files: { store: { placeFor: () => ({}), existingFile: async () => ({}) } },
    // The bot in its chat (?chat=40), its computer the chat_bots row 30.
    records: {
      directory: {
        findBot: async () => bot,
        chatBotOf: async () => ({ id: "30", botId: "12", chatId: "40" }),
        computerOf: async (chatBotId) => ({ chatBotId, chatId: "40", chatKind: "public", botId: "12", botName: "Ledger", workspaceId: "3" })
      },
      chats: {}
    },
    streams: new Set(),
    meter: { pausedMessage: async () => null }
  });
  async function call(key, body = {}) {
    const answer = {};
    const reply = {
      code(status) {
        answer.status = status;
        return reply;
      },
      send(sent) {
        answer.body = sent;
        answer.status ??= 200;
        return reply;
      }
    };
    const request = { params: { workspaceSlug: "home-3", botId: "12" }, query: { chat: "40" }, body, user: { id: "7" }, workspace: { id: "3" } };
    request.callOptions = async () => requestContextOptions(request);
    await routes.get(key)(request, reply);
    return answer;
  }
  for (const key of ["POST /api/w/:workspaceSlug/bots/:botId/computer/wake", "POST /api/w/:workspaceSlug/bots/:botId/computer/open"]) {
    const answer = await call(key, { path: "/files/chat/notes.docx" });
    assert.equal(answer.status, 409, key);
    assert.deepEqual(answer.body, { error: "Ledger is archived. Unarchive it to use its computer.", code: "bots_bot_archived", params: { name: "Ledger" } });
  }
  assert.deepEqual(woken, [], "nothing woke");
  bot.archivedAt = null;
  assert.equal((await call("POST /api/w/:workspaceSlug/bots/:botId/computer/wake")).status, 200);
  assert.deepEqual(woken, ["30"]);
});
