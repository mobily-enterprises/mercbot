import assert from "node:assert/strict";
import test from "node:test";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { registerRoutes as registerComputerRoutes } from "../../packages/computer/src/server/registerRoutes.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";

// The bots routes' one guard: a bot or chat in the address is one the person may open in the request's home, read
// through the directory and the chats, or the route answers 404 with a code that says which: bots_bot_not_found for
// :botId, bots_chat_not_found for :chatId. An id that is no id at all is refused the same way, without a read. An
// archived bot (D-108) or chat is read-only: only the routes that say they take one change anything about it.

function routesWith(findBot, service = {}, findChat = (chatId) => ({ id: chatId, archived_at: null })) {
  const routes = new Map();
  const asked = [];
  const askedChats = [];
  const http = { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } };
  const bots = {
    listedBot: async (botId) => ({ id: botId, name: "Found" }),
    ...service,
    chats: { addPerson: async (chatId) => ({ chat: { id: chatId } }), ...service.chats }
  };
  const records = {
    directory: {
      findBot: async (botId, options) => {
        asked.push({ botId, options });
        return findBot(botId);
      }
    },
    chats: {
      find: async (chatId, options) => {
        askedChats.push({ chatId, options });
        return findChat(chatId);
      }
    }
  };
  registerRoutes(http, {
    bots,
    approvals: {},
    notices: {},
    meter: { track: (_meta, work) => work(), pausedMessage: async () => null },
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
  return { call, asked, askedChats };
}

test("a bot the person doesn't see in the home is not found, and says so", async () => {
  const { call, asked } = routesWith(() => null);
  const answer = await call("GET /api/w/:workspaceSlug/bots/:botId", { workspaceSlug: "home-3", botId: "12" });
  assert.equal(answer.status, 404);
  assert.equal(answer.body.code, "bots_bot_not_found");
  assert.equal(asked[0].botId, "12");
  assert.ok(asked[0].options.context, "read in the request's own options");
});

test("a chat the person can't open is not found as a chat, and an id that is no chat id isn't read", async () => {
  const { call, askedChats } = routesWith(() => null, {}, () => null);
  const answer = await call("POST /api/w/:workspaceSlug/chats/:chatId/people", { workspaceSlug: "home-3", chatId: "40" }, { userId: "8" });
  assert.equal(answer.status, 404);
  assert.equal(answer.body.code, "bots_chat_not_found");
  assert.equal(askedChats[0].chatId, "40");
  assert.ok(askedChats[0].options.context, "read in the request's own options");
  for (const chatId of ["0", "abc", "1.5", "-3"]) {
    const refused = await call("GET /api/w/:workspaceSlug/chats/:chatId/messages", { workspaceSlug: "home-3", chatId });
    assert.deepEqual([refused.status, refused.body.code], [404, "bots_chat_not_found"], chatId);
  }
  assert.equal(askedChats.length, 1);
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

/** A service whose every member named records that it ran, and answers so. */
function recording(ran, names) {
  const work = (name) => async () => {
    ran.push(name);
    return { done: name };
  };
  const service = { chat: {}, chats: {}, knowledge: {} };
  for (const name of names) {
    const [part, member] = name.includes(".") ? name.split(".") : [null, name];
    if (part) service[part][member] = work(name);
    else service[member] = work(name);
  }
  return service;
}

test("an archived bot is read-only: its reads answer, and only the routes that take an archived bot change it (D-108)", async () => {
  const ledger = (archivedAt) => ({ id: "12", name: "Ledger", kind: "bot", archivedAt });
  const ran = [];
  const service = recording(ran, ["chat.recordVoiceCall", "chat.startTeaching", "updateBot", "chats.direct", "knowledge.add",
    "archiveBot", "unarchiveBot", "deleteBot", "chats.removeBot", "library", "chat.routinesOf"]);
  const params = { workspaceSlug: "home-3", chatId: "40", botId: "12" };
  const writes = [
    "POST /api/w/:workspaceSlug/chats/:chatId/bots/:botId/voice-call",
    "POST /api/w/:workspaceSlug/chats/:chatId/bots/:botId/teach/start",
    "PATCH /api/w/:workspaceSlug/bots/:botId",
    "POST /api/w/:workspaceSlug/bots/:botId/direct",
    "POST /api/w/:workspaceSlug/bots/:botId/knowledge"
  ];
  const taking = [
    "POST /api/w/:workspaceSlug/bots/:botId/archive",
    "POST /api/w/:workspaceSlug/bots/:botId/unarchive",
    "DELETE /api/w/:workspaceSlug/bots/:botId",
    "DELETE /api/w/:workspaceSlug/chats/:chatId/bots/:botId"
  ];
  const reads = ["GET /api/w/:workspaceSlug/bots/:botId/library", "GET /api/w/:workspaceSlug/bots/:botId/routines"];

  const archived = routesWith(() => ledger("2026-11-21T10:00:00.000Z"), service);
  for (const key of writes) {
    const answer = await archived.call(key, params, { seconds: 30, name: "Notes", text: "Hi" });
    assert.equal(answer.status, 409, key);
    assert.deepEqual(answer.body, { error: "Ledger is archived. Unarchive it to continue.", code: "bots_bot_archived", params: { name: "Ledger" } }, key);
  }
  assert.deepEqual(ran, [], "none of their work ran");
  for (const key of [...taking, ...reads]) assert.equal((await archived.call(key, params, {})).status, 200, key);
  assert.deepEqual(ran, ["archiveBot", "unarchiveBot", "deleteBot", "chats.removeBot", "library", "chat.routinesOf"]);

  // The same writes reach their work while it isn't archived.
  ran.length = 0;
  const active = routesWith(() => ledger(null), service);
  for (const key of writes) assert.equal((await active.call(key, params, { seconds: 30, name: "Notes", text: "Hi" })).status, 200, key);
  assert.equal(ran.length, writes.length);
});

test("an archived chat is read-only: it reads, and only leaving, its place, unarchiving, deleting it and stopping a discussion change anything", async () => {
  const ran = [];
  const service = recording(ran, ["chat.sendMessage", "chat.reply", "chats.addPerson", "chats.change", "chats.archive",
    "chat.discuss", "chat.startDiscussion", "chat.discussMore", "chat.wrapUpDiscussion", "chat.cancelDiscussion",
    "chat.messages", "chats.leave", "chats.changePlace", "chats.markRead", "chats.unarchive", "chats.remove", "chat.stopDiscussion"]);
  const params = { workspaceSlug: "home-3", chatId: "40", messageId: "5" };
  const writes = [
    "POST /api/w/:workspaceSlug/chats/:chatId/messages",
    "POST /api/w/:workspaceSlug/chats/:chatId/reply",
    "POST /api/w/:workspaceSlug/chats/:chatId/people",
    "PATCH /api/w/:workspaceSlug/chats/:chatId",
    "POST /api/w/:workspaceSlug/chats/:chatId/archive",
    "POST /api/w/:workspaceSlug/chats/:chatId/discussions",
    "POST /api/w/:workspaceSlug/chats/:chatId/discussions/:messageId/start",
    "POST /api/w/:workspaceSlug/chats/:chatId/discussions/:messageId/round",
    "POST /api/w/:workspaceSlug/chats/:chatId/discussions/:messageId/wrap",
    "POST /api/w/:workspaceSlug/chats/:chatId/discussions/:messageId/cancel"
  ];
  const taking = [
    "GET /api/w/:workspaceSlug/chats/:chatId/messages",
    "POST /api/w/:workspaceSlug/chats/:chatId/leave",
    "PATCH /api/w/:workspaceSlug/chats/:chatId/place",
    "POST /api/w/:workspaceSlug/chats/:chatId/read",
    "POST /api/w/:workspaceSlug/chats/:chatId/unarchive",
    "DELETE /api/w/:workspaceSlug/chats/:chatId",
    "POST /api/w/:workspaceSlug/chats/:chatId/discussions/:messageId/stop"
  ];
  const archived = routesWith(() => null, service, (chatId) => ({ id: chatId, archived_at: "2026-11-21T10:00:00.000Z" }));
  for (const key of writes) {
    const answer = await archived.call(key, params, { text: "Hi", title: "Plans", userId: "8" });
    assert.deepEqual([answer.status, answer.body?.code], [409, "bots_chat_archived"], key);
  }
  assert.deepEqual(ran, [], "none of their work ran");
  for (const key of taking) assert.equal((await archived.call(key, params, {})).status, 200, key);
  assert.deepEqual(ran, ["chat.messages", "chats.leave", "chats.changePlace", "chats.markRead", "chats.unarchive", "chats.remove", "chat.stopDiscussion"]);

  ran.length = 0;
  const open = routesWith(() => null, service);
  for (const key of writes) assert.equal((await open.call(key, params, { text: "Hi", title: "Plans", userId: "8" })).status, 200, key);
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

test("only the home's owners and admins make a bot the main bot; anyone who may change it renames it", async () => {
  const updates = [];
  const { call } = routesWith((botId) => ({ id: botId, name: "Otto", archivedAt: null }), {
    updateBot: async (botId, patch) => {
      updates.push({ botId, patch });
      return { id: botId, name: "Otto" };
    }
  });
  const route = "PATCH /api/w/:workspaceSlug/bots/:botId";
  const member = await call(route, { workspaceSlug: "home-3", botId: "12" }, { main: true });
  assert.deepEqual([member.status, member.body.code], [403, "bots_main_bot_manage_forbidden"]);
  assert.deepEqual(updates, [], "a member's request changes nothing");
  const renamed = await call(route, { workspaceSlug: "home-3", botId: "12" }, { name: "Otto 2" });
  assert.equal(renamed.status, 200, "a rename goes on to the bot's own rule (botSettings.js)");
  const owner = await call(route, { workspaceSlug: "home-3", botId: "12" }, { main: true }, ["workspace.settings.update"]);
  assert.equal(owner.status, 200);
  assert.deepEqual(updates.map((update) => update.patch), [{ name: "Otto 2" }, { main: true }]);
});
