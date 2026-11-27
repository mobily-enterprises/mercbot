import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { WebSocketServer } from "ws";
import { attachVncBridge } from "../../packages/computer/src/server/vncBridge.js";

// Node takes the HTTP server's own error listener off a socket before it hands the socket to an upgrade's listeners.
// A page that gives up on a live screen while the bridge still checks its ticket resets that socket: it ends that
// socket alone, never the server, and leaves nothing open behind it.

/** `promise`'s value, or `otherwise` once `ms` have passed without one. */
function within(promise, ms, otherwise) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, otherwise);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const closed = (socket) => within(new Promise((resolve) => socket.once("close", () => resolve("closed"))), 2000, "still open");

async function listen(server, context) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

/** A server with the bridge, whose ticket check waits for the test's answer; and the sockets it accepted. */
async function bridged(context) {
  let answer;
  let asked;
  const checking = new Promise((resolve) => (asked = resolve));
  const computers = {
    findScreen: () => new Promise((resolve) => {
      answer = resolve;
      asked();
    })
  };
  const server = http.createServer((request, response) => response.writeHead(404).end());
  const sockets = [];
  server.on("connection", (socket) => sockets.push(socket));
  const stop = attachVncBridge(server, computers);
  context.after(stop);
  const port = await listen(server, context);
  return { port, checking, answer: (target) => answer(target), sockets };
}

/** A page opening its live screen: the WebSocket's opening request, raw, on a socket it can reset. */
function openScreen(port) {
  const page = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
  page.on("error", () => {});
  page.write([
    "GET /api/computer-vnc?ticket=t1 HTTP/1.1",
    `host: 127.0.0.1:${port}`,
    "connection: Upgrade",
    "upgrade: websocket",
    "sec-websocket-version: 13",
    "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==",
    "sec-websocket-protocol: binary",
    "",
    ""
  ].join("\r\n"));
  return page;
}

test("a page that gives up while its ticket is checked ends its own socket, never the server", async (context) => {
  const { port, checking, answer, sockets } = await bridged(context);
  const page = openScreen(port);
  await checking;
  // Node's test runner fails the test on the unhandled error a reset with no listener raises.
  page.resetAndDestroy();
  assert.equal(await closed(sockets[0]), "closed");
  let opened = 0;
  answer({ socketPath: "/nowhere.sock", opened: () => opened++, closed() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 0, "no screen is opened for a page that's gone");
});

test("a page that gives up while another server's screen opens leaves that server's socket closed too", async (context) => {
  // The other server holds its WebSocket's opening until the page has gone.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let reached;
  const reaching = new Promise((resolve) => (reached = resolve));
  let otherClosed;
  const ended = within(new Promise((resolve) => (otherClosed = resolve)), 4000, "still open");
  const sockets = new WebSocketServer({ noServer: true });
  const connections = [];
  const other = http.createServer((request, response) => response.writeHead(404).end());
  other.on("upgrade", async (request, socket, head) => {
    reached();
    await held;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      connections.push(ws);
      ws.once("close", () => otherClosed("closed"));
    });
  });
  context.after(() => {
    for (const ws of connections) ws.terminate();
    sockets.close();
  });
  const otherPort = await listen(other, context);

  const { port, checking, answer, sockets: accepted } = await bridged(context);
  const page = openScreen(port);
  await checking;
  answer({ remote: `http://127.0.0.1:${otherPort}`, headers: {}, gone: async () => {} });
  await reaching;
  page.resetAndDestroy();
  assert.equal(await closed(accepted[0]), "closed");
  release();
  assert.equal(await ended, "closed", "the other server's socket for the page that's gone is closed");
  assert.equal(connections.length, 1);
});
