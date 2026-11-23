import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { registerRoutes as registerAppsRoutes } from "../../packages/apps/src/server/registerRoutes.js";
import { registerRoutes as registerBotsRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { registerRoutes as registerComputerRoutes } from "../../packages/computer/src/server/registerRoutes.js";

// The live streams (bots' events, apps' table changes, a computer's state) stop with their page: they unsubscribe,
// leave the server's streams and clear their keep-alive, whether the page goes while the stream runs or while the
// request was still being checked. One that missed its page's close kept writing to it every 20 seconds for the life
// of the server, and kept a development server from stopping.

const STREAMS = [
  {
    route: "GET /api/w/:workspaceSlug/bot-events",
    register: (http, deps) => registerBotsRoutes(http, { bots: {}, approvals: {}, meter: {}, records: {}, ...deps })
  },
  {
    route: "GET /api/w/:workspaceSlug/apps-events",
    register: (http, deps) => registerAppsRoutes(http, { appsRuntime: {}, ...deps })
  },
  {
    route: "GET /api/w/:workspaceSlug/bots/:botId/computer/stream",
    register: (http, { notices, streams }) => registerComputerRoutes(http, {
      computer: { subscribe: (computerId, send) => notices.subscribe("computer", computerId, send) },
      files: {},
      records: {
        directory: {
          findBot: async (botId) => ({ id: botId }),
          chatBotOf: async (botId, chatId) => ({ id: "9", botId, chatId }),
          computerOf: async (chatBotId) => ({ chatBotId, chatId: "4", chatKind: "public", botId: "5", botName: "Bot", workspaceId: "3" })
        },
        chats: {}
      },
      streams,
      meter: {}
    }),
    // The bot's computer in a chat (D14).
    query: { chat: "4" }
  }
];

/** A request's close, listened for as the routes do: `once` would also listen for errors, and so see the abort as one. */
const closeOf = (raw) => new Promise((resolve) => raw.once("close", resolve));

/** The request a route is handed, for a page of person 7 in home 3. */
const requestOf = (raw, query = {}) => ({
  raw,
  params: { workspaceSlug: "home-3", botId: "5" },
  query,
  user: { id: "7" },
  workspace: { id: "3", slug: "home-3" },
  membership: { roleSid: "member" },
  permissions: [],
  callOptions: async () => ({})
});

/** The reply a route is handed: a stream hijacks it and writes to its raw response. */
function replyOf(res) {
  const reply = {
    raw: res,
    hijack() {},
    code() {
      return reply;
    },
    send() {
      return reply;
    }
  };
  return reply;
}

/** The route's handler on a real server, with what it subscribed to and the keep-alives it left. */
async function streamOn(t, { route, register, query = {} }) {
  const handlers = new Map();
  const streams = new Set();
  const subscriptions = [];
  const notices = {
    subscribe(kind, id) {
      const subscription = { kind, id, ended: false };
      subscriptions.push(subscription);
      return () => {
        subscription.ended = true;
      };
    },
    onMissed: () => () => {}
  };
  register({ router: { register: (method, path, _options, handler) => handlers.set(`${method} ${path}`, handler) } }, { notices, streams });
  const handler = handlers.get(route);
  assert.ok(handler, `${route} is a route`);

  const keepAlives = new Set();
  t.mock.method(globalThis, "setInterval", (_work, ms) => {
    const timer = { ms };
    keepAlives.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearInterval", (timer) => keepAlives.delete(timer));

  let arrived;
  const arrivals = new Promise((resolve) => {
    arrived = resolve;
  });
  const server = http.createServer((raw, res) => arrived({ raw, res }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const client = http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/w/home-3/bots/5/computer/stream?chat=4" });
  client.on("error", () => {});

  const { raw, res } = await arrivals;
  return { answer: () => handler(requestOf(raw, query), replyOf(res)), client, raw, streams, subscriptions, keepAlives };
}

for (const stream of STREAMS) {
  test(`${stream.route} stops when its page goes while it runs`, async (t) => {
    const { answer, client, raw, streams, subscriptions, keepAlives } = await streamOn(t, stream);
    await answer();
    assert.equal(streams.size, 1);
    assert.equal(keepAlives.size, 1);
    assert.deepEqual(subscriptions.map(({ ended }) => ended), [false]);

    const closed = closeOf(raw);
    client.destroy();
    await closed;
    assert.equal(streams.size, 0);
    assert.equal(keepAlives.size, 0);
    assert.deepEqual(subscriptions.map(({ ended }) => ended), [true]);
  });

  test(`${stream.route} stops at once when its page went while the request was checked`, async (t) => {
    const { answer, client, raw, streams, subscriptions, keepAlives } = await streamOn(t, stream);
    const closed = closeOf(raw);
    client.destroy();
    await closed;

    await answer();
    assert.equal(streams.size, 0);
    assert.equal(keepAlives.size, 0);
    assert.deepEqual(subscriptions.map(({ ended }) => ended), [true]);
  });
}

// Notices the server may have missed (its listening connection was replaced, notices.js) end every page's stream open
// then, so each page connects again and catches up (useChatEvents.js); a stream opened after stays until the next time.
test("GET /api/w/:workspaceSlug/bot-events ends the streams open when notices may have been missed", async (t) => {
  const handlers = new Map();
  const streams = new Set();
  const missedListeners = [];
  const notices = {
    subscribe: () => () => {},
    onMissed(listener) {
      missedListeners.push(listener);
      return () => {};
    }
  };
  registerBotsRoutes(
    { router: { register: (method, path, _options, handler) => handlers.set(`${method} ${path}`, handler) } },
    { bots: {}, approvals: {}, meter: {}, records: {}, notices, streams }
  );
  const handler = handlers.get("GET /api/w/:workspaceSlug/bot-events");
  const server = http.createServer((raw, res) => handler(requestOf(raw), replyOf(res)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const missed = () => {
    for (const listener of missedListeners) listener();
  };
  /** A page's stream, as the page sees it: whether the server has ended it. */
  const open = async () => {
    const client = http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/w/home-3/bot-events" });
    client.on("error", () => {});
    const [response] = await once(client, "response");
    const page = { ended: false, end: once(response, "end") };
    response.on("end", () => {
      page.ended = true;
    });
    response.resume();
    return page;
  };

  const first = await open();
  assert.equal(missedListeners.length, 1, "the route hears when notices may have been missed");
  missed();
  await first.end;

  const second = await open();
  const third = await open();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual([second.ended, third.ended], [false, false], "a stream opened after stays open");
  assert.equal(missedListeners.length, 1, "heard once, however many streams open");

  missed();
  await Promise.all([second.end, third.end]);
});
