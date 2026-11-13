import assert from "node:assert/strict";
import test from "node:test";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
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
    const request = { params, body, user: { id: "7" }, workspace: { id: "3", slug: "home-3" }, membership: { roleSid: "member" }, permissions };
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
