import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { createCdpBridge } from "../../packages/computer/src/server/cdpBridge.js";

// D-68: a browser's remote control is a Unix socket, reached through the server's own port.

/** A stand-in for Chrome's remote control on a Unix socket: /json/version and an echoing WebSocket. */
async function fakeBrowser(socketPath) {
  const upgrades = [];
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer((request, response) => {
    if (request.url !== "/json/version") return response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc" }));
  });
  server.on("upgrade", (request, socket, head) => {
    upgrades.push(request.url);
    wss.handleUpgrade(request, socket, head, (ws) => ws.on("message", (data) => ws.send(`echo ${data}`)));
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  return {
    upgrades,
    close: () => new Promise((resolve) => {
      for (const client of wss.clients) client.terminate();
      server.close(resolve);
    })
  };
}

/** Opens `url` as a WebSocket: "open" when it connects, else the refusal's status. */
function open(url, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => resolve({ ws, status: 101 }));
    ws.once("unexpected-response", (request, response) => {
      resolve({ status: response.statusCode });
      request.destroy();
    });
    ws.once("error", () => resolve({ status: 0 }));
  });
}

async function setup(context) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-cdp-"));
  const socketPath = path.join(dir, "cdp.sock");
  const browser = await fakeBrowser(socketPath);
  const server = http.createServer((request, response) => response.writeHead(404).end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bridge = createCdpBridge();
  bridge.listening(server.address());
  const detach = bridge.attach(server);
  context.after(async () => {
    detach();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { bridge, browser, server, socketPath };
}

test("a browser's route passes its WebSocket through the server's own port to the Unix socket", async (context) => {
  const { bridge, browser, server, socketPath } = await setup(context);
  const route = bridge.route(socketPath);
  const url = await route.browserUrl();
  const port = server.address().port;
  const match = url.match(new RegExp(`^ws://127\\.0\\.0\\.1:${port}/api/computer-cdp/([0-9a-f]{64})/devtools/browser/abc$`, "u"));
  assert.ok(match, url);

  const { ws, status } = await open(url);
  assert.equal(status, 101);
  const answer = new Promise((resolve) => ws.once("message", (data) => resolve(String(data))));
  ws.send("hello");
  assert.equal(await answer, "echo hello");
  assert.deepEqual(browser.upgrades, ["/devtools/browser/abc"], "the browser sees only its own path, never the key");
  ws.close();
});

test("each browser gets its own fresh key, and a closed route stops working", async (context) => {
  const { bridge, socketPath } = await setup(context);
  const first = bridge.route(socketPath);
  const second = bridge.route(socketPath);
  const keyOf = (url) => url.match(/computer-cdp\/([0-9a-f]{64})\//u)[1];
  const firstUrl = await first.browserUrl();
  assert.notEqual(keyOf(firstUrl), keyOf(await second.browserUrl()));
  first.close();
  assert.equal((await open(firstUrl)).status, 403);
  const still = await open(await second.browserUrl());
  assert.equal(still.status, 101);
  still.ws.close();
});

test("an unknown key, another path or any proxy header is refused", async (context) => {
  const { bridge, server, socketPath } = await setup(context);
  const url = await bridge.route(socketPath).browserUrl();
  const base = `ws://127.0.0.1:${server.address().port}/api/computer-cdp/`;
  assert.equal((await open(`${base}${"0".repeat(64)}/devtools/browser/abc`)).status, 403, "unknown key");
  assert.equal((await open(`${base}short/devtools/browser/abc`)).status, 403, "malformed key");
  assert.equal((await open(url.replace("/devtools/browser/abc", "/json/version"))).status, 403, "not /devtools/");
  for (const header of ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "via"]) {
    assert.equal((await open(url, { [header]: "1.2.3.4" })).status, 403, header);
  }
});

test("a connection from another machine is refused", async (context) => {
  const { bridge, socketPath } = await setup(context);
  const url = new URL(await bridge.route(socketPath).browserUrl());
  const server = new EventEmitter();
  const detach = bridge.attach(server);
  context.after(detach);
  const answers = [];
  const socket = { remoteAddress: "203.0.113.5", localAddress: "10.0.0.2", end: (text) => answers.push(text) };
  server.emit("upgrade", { url: url.pathname, headers: {}, method: "GET", httpVersion: "1.1", rawHeaders: [] }, socket, Buffer.alloc(0));
  assert.deepEqual(answers, ["HTTP/1.1 403 Forbidden\r\n\r\n"]);
});

test("other upgrades are left alone, and a route has no address before the server listens", async () => {
  const bridge = createCdpBridge();
  await assert.rejects(bridge.route("/nowhere.sock").browserUrl(), /isn't listening yet/u);
  const server = new EventEmitter();
  const detach = bridge.attach(server);
  const socket = { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1", end: () => assert.fail("not ours") };
  server.emit("upgrade", { url: "/api/computer-vnc?ticket=x", headers: {} }, socket, Buffer.alloc(0));
  detach();
  assert.equal(server.listenerCount("upgrade"), 0);
});

test("listening on every interface reaches the server through 127.0.0.1", async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-cdp-"));
  const socketPath = path.join(dir, "cdp.sock");
  const browser = await fakeBrowser(socketPath);
  context.after(async () => {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  });
  const bridge = createCdpBridge();
  bridge.listening({ address: "::", port: 3000 });
  assert.match(await bridge.route(socketPath).browserUrl(), /^ws:\/\/127\.0\.0\.1:3000\/api\/computer-cdp\//u);
  bridge.listening({ address: "::1", port: 3000 });
  assert.match(await bridge.route(socketPath).browserUrl(), /^ws:\/\/\[::1\]:3000\//u);
});
