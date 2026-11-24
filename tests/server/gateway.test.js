import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __testables, sandboxGateway, sizeText, startGateway } from "../../packages/files/src/server/gateway.js";

const { blocked } = __testables;

// Bots' gateway (D-49, D-126): their computers' apps, their commands and their coding runs reach only public addresses
// through it.
test("private, internal and this machine's addresses are blocked; public ones aren't", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:10.1.2.3", "::ffff:127.0.0.1"]) {
    assert.equal(blocked(address), true, address);
  }
  for (const address of ["104.20.23.154", "8.8.8.8", "2606:4700::6812:179a", "::ffff:104.20.23.154"]) assert.equal(blocked(address), false, address);
});

test("the gateway refuses internal targets and mail ports before connecting", async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-gateway-"));
  let gateway = null;
  context.after(async () => {
    await gateway?.close();
    await rm(dir, { recursive: true, force: true });
  });
  gateway = await startGateway({ socketPath: path.join(dir, "gateway.sock") });
  const ask = (request) => new Promise((resolve) => {
    const socket = net.connect(path.join(dir, "gateway.sock"));
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("close", () => resolve(answer));
    socket.write(request);
  });
  assert.match(await ask("CONNECT 127.0.0.1:5432 HTTP/1.1\r\nHost: 127.0.0.1:5432\r\n\r\n"), /^HTTP\/1\.1 403[^]*not a public address/u);
  assert.match(await ask("GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n"), /^HTTP\/1\.1 403/u);
  assert.match(await ask("CONNECT localhost:443 HTTP/1.1\r\n\r\n"), /^HTTP\/1\.1 403/u);
  assert.match(await ask("CONNECT smtp.example.com:25 HTTP/1.1\r\n\r\n"), /^HTTP\/1\.1 403[^]*port 25/u);
  assert.match(await ask("GET /relative HTTP/1.1\r\n\r\n"), /^HTTP\/1\.1 400/u);
  assert.ok(gateway.stats.refused >= 4);
});

/** Sends `request` to a gateway's socket and resolves to all it answers. */
const askAt = (socketPath, request) => new Promise((resolve) => {
  const socket = net.connect(socketPath);
  let answer = "";
  socket.on("data", (chunk) => (answer += chunk));
  socket.on("close", () => resolve(answer));
  socket.on("error", (error) => resolve(`error ${error.code}`));
  socket.write(request);
});

test("a stand-in answers for its own public name and port only, and never for a mail port", async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-gateway-"));
  const standIn = net.createServer((socket) => socket.end("the stand-in\n"));
  await new Promise((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  const { port } = standIn.address();
  const socketPath = path.join(dir, "gateway.sock");
  // Put away before the gateway starts: one that doesn't start must not leave the stand-in listening, which keeps the
  // file from ever ending.
  let gateway = null;
  context.after(async () => {
    await gateway?.close();
    await new Promise((resolve) => standIn.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  gateway = await startGateway({
    socketPath,
    standIns: new Map([["web.example.test:443", { address: "127.0.0.1", port }], ["mail.example.test:587", { address: "127.0.0.1", port }]])
  });
  assert.equal(await askAt(socketPath, "CONNECT web.example.test:443 HTTP/1.1\r\n\r\n"), "HTTP/1.1 200 Connection Established\r\n\r\nthe stand-in\n");
  assert.match(await askAt(socketPath, "CONNECT mail.example.test:587 HTTP/1.1\r\n\r\n"), /^HTTP\/1\.1 403[^]*port 587/u);
  assert.match(await askAt(socketPath, `CONNECT 127.0.0.1:${port} HTTP/1.1\r\n\r\n`), /^HTTP\/1\.1 403[^]*not a public address/u, "its own address is still refused");
});

test("a plain http request reaches its host by its path alone, and only that request goes there", async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-gateway-"));
  const heads = [];
  const standIn = net.createServer((socket) => socket.once("data", (chunk) => {
    heads.push(chunk.toString("latin1"));
    socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
  }));
  await new Promise((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  const socketPath = path.join(dir, "gateway.sock");
  let gateway = null;
  context.after(async () => {
    await gateway?.close();
    await new Promise((resolve) => standIn.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  gateway = await startGateway({ socketPath, standIns: new Map([["web.example.test:80", { address: "127.0.0.1", port: standIn.address().port }]]) });
  const answer = await askAt(socketPath, "GET http://web.example.test/page?x=1 HTTP/1.1\r\nHost: web.example.test\r\nConnection: keep-alive\r\nProxy-Connection: keep-alive\r\n\r\n");
  assert.match(answer, /^HTTP\/1\.1 200 OK[^]*ok$/u);
  assert.equal(heads[0], "GET /page?x=1 HTTP/1.1\r\nHost: web.example.test\r\nConnection: close\r\n\r\n");
});

test("a sandbox's gateway starts in a folder whose path is longer than a socket's may be, and leaves nothing there", async (context) => {
  // As a sandbox's folder is under Production's TMPDIR, /var/lib/mercbot-online-work/tmp: well past 107 bytes.
  const root = await mkdtemp(path.join(os.tmpdir(), "mb-gateway-long-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "a".repeat(60), "b".repeat(60), "gateway");
  assert.ok(path.join(dir, "gateway.sock").length > 107);
  const gateway = await sandboxGateway(dir);
  // Reached as a sandbox reaches it, through its folder rather than by the whole path.
  const folder = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    assert.match(await askAt(`/proc/self/fd/${folder.fd}/gateway.sock`, "CONNECT 10.0.0.1:80 HTTP/1.1\r\n\r\n"), /^HTTP\/1\.1 403[^]*not a public address/u);
    assert.deepEqual((await readdir(dir)).sort(), ["forward.py", "gateway.sock"]);
    await gateway.close();
    assert.deepEqual(await readdir(dir), ["forward.py"], "the socket goes with the gateway");
  } finally {
    await folder.close();
  }
});

/** A stand-in that sends `bytes` to whoever connects, then ends. */
async function sender(context, bytes) {
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.end(Buffer.alloc(bytes, 7));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

/** A stand-in that reads all it's sent: `received()` is how much. */
async function reader(context) {
  let got = 0;
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.on("data", (chunk) => (got += chunk.length));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, received: () => got };
}

/** A gateway in a folder of the test's own, with these stand-ins and options. */
async function gatewayWith(context, standIns, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-gateway-"));
  const socketPath = path.join(dir, "gateway.sock");
  let gateway = null;
  context.after(async () => {
    await gateway?.close();
    await rm(dir, { recursive: true, force: true });
  });
  gateway = await startGateway({ socketPath, standIns: new Map(standIns), ...options });
  return { gateway, socketPath };
}

/** CONNECTs to `target` through the gateway and reads to the end: { head, bytes } (bytes after the gateway's answer). */
const tunnelRead = (socketPath, target) => new Promise((resolve) => {
  const socket = net.connect(socketPath);
  let answer = Buffer.alloc(0);
  socket.on("data", (chunk) => (answer = Buffer.concat([answer, chunk])));
  socket.on("error", () => {});
  socket.on("close", () => {
    const end = answer.indexOf("\r\n\r\n");
    resolve({ head: answer.subarray(0, end).toString("latin1"), bytes: answer.length - end - 4, text: answer.toString("latin1") });
  });
  socket.write(`CONNECT ${target} HTTP/1.1\r\n\r\n`);
});

/** CONNECTs to `target` and sends `bytes` through, as fast as the tunnel takes them: resolves once it closes. */
const tunnelSend = (socketPath, target, bytes) => new Promise((resolve) => {
  const socket = net.connect(socketPath);
  let answered = false;
  socket.on("data", (chunk) => {
    if (answered || !chunk.toString("latin1").startsWith("HTTP/1.1 200")) return;
    answered = true;
    const piece = Buffer.alloc(64 * 1024, 1);
    let left = bytes;
    const more = () => {
      while (left > 0) {
        left -= piece.length;
        if (!socket.write(piece)) return socket.once("drain", more);
      }
      socket.end();
    };
    more();
  });
  socket.on("error", () => {});
  socket.on("close", resolve);
  socket.write(`CONNECT ${target} HTTP/1.1\r\n\r\n`);
});

const MB = 1024 ** 2;
const ROOMY = { commandIn: 64 * MB, commandOut: 64 * MB };

test("a command's connections end once it has received the most one command may, the next is refused, and the bot is told", async (context) => {
  const port = await sender(context, 3 * MB);
  const { gateway, socketPath } = await gatewayWith(context, [["files.example.test:443", { address: "127.0.0.1", port }]], {
    limits: { ...ROOMY, commandIn: MB }
  });
  const first = await tunnelRead(socketPath, "files.example.test:443");
  assert.match(first.head, /^HTTP\/1\.1 200/u);
  assert.ok(first.bytes < 3 * MB, `it was cut short (${first.bytes} bytes)`);
  assert.ok(first.bytes <= MB + 64 * 1024, `about the command's limit (${first.bytes} bytes)`);
  const said = "Mercbot's gateway ended this command's internet connections: it received 1 MB, the most one command may receive.";
  const next = await tunnelRead(socketPath, "files.example.test:443");
  assert.equal(next.text, `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(said)}\r\n\r\n${said}`);
  assert.deepEqual(gateway.notes(), [said], "said once, however often it refused");
  // The next command (a computer's session runs one after another) starts with nothing received.
  gateway.begin();
  assert.deepEqual(gateway.notes(), []);
  assert.match((await tunnelRead(socketPath, "files.example.test:443")).head, /^HTTP\/1\.1 200/u);
});

test("a command's connections end once it has sent the most one command may", async (context) => {
  const far = await reader(context);
  const { gateway, socketPath } = await gatewayWith(context, [["upload.example.test:443", { address: "127.0.0.1", port: far.port }]], {
    limits: { ...ROOMY, commandOut: MB }
  });
  await tunnelSend(socketPath, "upload.example.test:443", 4 * MB);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(far.received() < 2 * MB, `it was cut short (${far.received()} bytes reached the far end)`);
  assert.deepEqual(gateway.notes(), ["Mercbot's gateway ended this command's internet connections: it sent 1 MB, the most one command may send."]);
});

test("a meter's refusal reaches the program as its status and words, and the bot as a note, with the gateway's own refusals", async (context) => {
  const port = await sender(context, 10);
  const slowDown = "Mercbot's gateway refused a connection: slow down. This bot opened 120 new internet connections this minute, the most a bot may; try again in 9 s.";
  let allowed = 1;
  const meter = {
    connection: async () => (allowed-- > 0 ? null : { status: "429 Too Many Requests", key: "minute", message: slowDown }),
    add: () => null,
    close: async () => {}
  };
  const { gateway, socketPath } = await gatewayWith(context, [["web.example.test:443", { address: "127.0.0.1", port }]], { limits: ROOMY, meter });
  assert.match((await tunnelRead(socketPath, "web.example.test:443")).head, /^HTTP\/1\.1 200/u);
  const refused = await tunnelRead(socketPath, "web.example.test:443");
  assert.match(refused.text, /^HTTP\/1\.1 429 Too Many Requests\r\n[^]*\r\n\r\nMercbot's gateway refused a connection: slow down\./u);
  await tunnelRead(socketPath, "web.example.test:443");
  await tunnelRead(socketPath, "10.0.0.1:80");
  await tunnelRead(socketPath, "web.example.test:25");
  assert.deepEqual(gateway.notes(), [
    slowDown,
    "Mercbot's gateway doesn't connect to 10.0.0.1: it's not a public address.",
    "Mercbot's gateway doesn't connect to port 25."
  ]);
});

test("a meter that says the home's day is spent ends every connection the gateway has open", async (context) => {
  const port = await sender(context, 2 * MB);
  const spent = "Mercbot's gateway ended this command's internet connections: this home's commands have used 1 MB of internet today.";
  let counted = 0;
  const meter = { connection: async () => null, add: (received) => ((counted += received) > MB ? spent : null), close: async () => {} };
  const { gateway, socketPath } = await gatewayWith(context, [["files.example.test:443", { address: "127.0.0.1", port }]], { limits: ROOMY, meter });
  const read = await tunnelRead(socketPath, "files.example.test:443");
  assert.ok(read.bytes < 2 * MB, `it was cut short (${read.bytes} bytes)`);
  assert.deepEqual(gateway.notes(), [spent]);
});

test("amounts of data read as people read them", () => {
  assert.equal(sizeText(2 * 1024 ** 3), "2 GB");
  assert.equal(sizeText(20 * 1024 ** 3), "20 GB");
  assert.equal(sizeText(1.5 * 1024 ** 3), "1.5 GB");
  assert.equal(sizeText(200 * MB), "200 MB");
  assert.equal(sizeText(12 * 1024), "12 KB");
  assert.equal(sizeText(5), "5 bytes");
});
