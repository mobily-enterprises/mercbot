import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Mercbot's service worker (src/public/sw.js, D-133), run as the browser runs it, around a stand-in of the worker's
// world: its caches, its windows and the network. What it keeps and never keeps, the offline page, a pushed
// notification and its icon count, opening one at its chat, and what another app shares.

const ORIGIN = "https://mercbot.example.test";
const source = await readFile(new URL("../../src/public/sw.js", import.meta.url), "utf8");

/** The worker in a world of its own: `online` says whether the network answers. */
function startWorker({ online = true, windows = [] } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const shown = [];
  const badges = [];
  const opened = [];
  const fetched = [];
  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    const key = (request) => new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
    return {
      addAll: async (requests) => requests.forEach((request) => entries.set(key(request), new Response(`kept ${key(request)}`))),
      put: async (request, response) => entries.set(key(request), response),
      match: async (request) => entries.get(key(request))?.clone(),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      delete: async (request) => entries.delete(key(request))
    };
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: async () => {},
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
    navigator: { setAppBadge: async (count) => badges.push(count), clearAppBadge: async () => badges.push(0) },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => opened.push(url)
    }
  };
  const context = vm.createContext({
    self,
    caches: { open: async (name) => cacheOf(name), keys: async () => [...stores.keys()], delete: async (name) => stores.delete(name), match: async (request) => {
      for (const name of stores.keys()) {
        const found = await cacheOf(name).match(request);
        if (found) return found;
      }
      return undefined;
    } },
    fetch: async (request) => {
      fetched.push(new URL(typeof request === "string" ? request : request.url, ORIGIN).pathname);
      if (!online) throw new TypeError("Failed to fetch");
      return new Response("from the network", { status: 200 });
    },
    // A worker's relative addresses are its origin's.
    Request: class extends Request {
      constructor(input, init) {
        super(typeof input === "string" ? new URL(input, ORIGIN).href : input, init);
      }
    },
    Response,
    URL,
    Date,
    Math,
    Promise,
    JSON,
    Number,
    String,
    Set,
    console
  });
  vm.runInContext(source, context);
  /** Fires an event at the worker and waits for what it said it's doing (waitUntil, respondWith). */
  async function fire(type, fields) {
    const pending = [];
    let answer;
    const event = { ...fields, waitUntil: (work) => pending.push(work), respondWith: (work) => { answer = work; } };
    listeners.get(type)(event);
    await Promise.all(pending);
    return answer === undefined ? undefined : await answer;
  }
  return { fire, stores, shown, badges, opened, fetched };
}

/** A fetch event for `path`: a page's navigation or another request. */
function fetchEvent(path, { method = "GET", mode = "navigate", body } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { method, ...(body ? { body } : {}) });
  Object.defineProperty(request, "mode", { value: mode });
  return { request };
}

test("installing keeps the offline page, and activating drops caches of older releases", async () => {
  const worker = startWorker();
  await worker.fire("install", {});
  assert.deepEqual([...worker.stores.get("mercbot-offline-v1").keys()].map((url) => new URL(url).pathname), [
    "/offline.html",
    "/offline.js",
    "/app-icons/icon-192.png"
  ]);
  worker.stores.set("mercbot-offline-v0", new Map());
  await worker.fire("activate", {});
  assert.equal(worker.stores.has("mercbot-offline-v0"), false);
  assert.equal(worker.stores.has("mercbot-offline-v1"), true);
});

test("offline, a page shows the offline page; the API, public pages and the Console never do, and nothing private is kept", async () => {
  const worker = startWorker({ online: false });
  await worker.fire("install", {});
  const page = await worker.fire("fetch", fetchEvent("/w/home?chat=3"));
  assert.equal(await page.text(), `kept ${ORIGIN}/offline.html`);
  for (const path of ["/api/w/home/chats", "/a/home/app", "/p/page", "/console"]) {
    assert.equal(await worker.fire("fetch", fetchEvent(path)), undefined, `${path} is the browser's own`);
  }
  assert.equal(await worker.fire("fetch", fetchEvent("/api/session", { mode: "cors" })), undefined, "the API is never answered by the worker");

  const online = startWorker();
  await online.fire("fetch", fetchEvent("/w/home"));
  await online.fire("fetch", fetchEvent("/assets/app-abc123.js", { mode: "cors" }));
  assert.deepEqual([...online.stores.keys()], ["mercbot-assets"], "a page is never kept; a built file is");
  await online.fire("fetch", fetchEvent("/assets/app-abc123.js", { mode: "cors" }));
  assert.deepEqual(online.fetched, ["/w/home", "/assets/app-abc123.js"], "a built file kept is read from the cache");
});

test("a pushed notification shows with its chat's tag, opens there, and sets the icon's count", async () => {
  const worker = startWorker();
  const payload = { title: "Chef in Kitchen", body: "Dinner at 7?", url: "/w/home?chat=3", tag: "chat-3", unread: 2 };
  await worker.fire("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  const shown = JSON.parse(JSON.stringify(worker.shown.map(({ title, body, tag, renotify, badge, data }) => ({ title, body, tag, renotify, badge, data }))));
  assert.deepEqual(shown, [{
    title: "Chef in Kitchen",
    body: "Dinner at 7?",
    tag: "chat-3",
    renotify: true,
    badge: "/app-icons/badge-96.png",
    data: { url: "/w/home?chat=3" }
  }]);
  assert.deepEqual(worker.badges, [2]);
  await worker.fire("push", { data: { json: () => ({ ...payload, unread: 0 }), text: () => "" } });
  assert.deepEqual(worker.badges, [2, 0], "no unread chats clears the count");
  await worker.fire("push", { data: { json: () => { throw new SyntaxError("not JSON"); }, text: () => "Plain words" } });
  assert.deepEqual([worker.shown.at(-1).title, worker.shown.at(-1).body], ["Mercbot", "Plain words"]);
});

test("opening a notification goes to its chat in the window already open, even one that can't be focused, else a new one", async () => {
  const navigated = [];
  const window = {
    url: `${ORIGIN}/w/home`,
    focus: async () => { throw new Error("Not allowed to focus a window."); },
    navigate: async (url) => navigated.push(url)
  };
  const worker = startWorker({ windows: [window] });
  const notification = { data: { url: "/w/home?chat=3" }, close: () => {} };
  await worker.fire("notificationclick", { notification });
  assert.deepEqual(navigated, [`${ORIGIN}/w/home?chat=3`]);

  const closed = startWorker({ windows: [] });
  await closed.fire("notificationclick", { notification });
  assert.deepEqual(closed.opened, [`${ORIGIN}/w/home?chat=3`]);
});

test("what another app shares is kept for the app to read, which opens to choose the chat", async () => {
  const worker = startWorker();
  const form = new FormData();
  form.append("title", "Dinner ideas");
  form.append("url", "https://example.test/recipe");
  form.append("files", new File(["oak, pine"], "woods.txt", { type: "text/plain" }));
  const answer = await worker.fire("fetch", fetchEvent("/share", { method: "POST", body: form }));
  assert.equal(answer.status, 303);
  const key = new URL(answer.headers.get("location"), ORIGIN).searchParams.get("key");
  assert.match(new URL(answer.headers.get("location"), ORIGIN).search, /^\?go=share&key=[a-z0-9]+$/u);
  const shared = worker.stores.get("mercbot-shared");
  const meta = await shared.get(`${ORIGIN}/shared/${key}/meta`).clone().json();
  assert.deepEqual([meta.title, meta.text, meta.url, meta.files], ["Dinner ideas", "", "https://example.test/recipe", [{ name: "woods.txt", type: "text/plain" }]]);
  assert.equal(await shared.get(`${ORIGIN}/shared/${key}/0`).clone().text(), "oak, pine");
});
