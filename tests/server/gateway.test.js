import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __testables, sandboxGateway, startGateway } from "../../packages/files/src/server/gateway.js";

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
  const gateway = await startGateway({ socketPath: path.join(dir, "gateway.sock") });
  context.after(async () => {
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
  });
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
  const gateway = await startGateway({
    socketPath,
    standIns: new Map([["web.example.test:443", { address: "127.0.0.1", port }], ["mail.example.test:587", { address: "127.0.0.1", port }]])
  });
  context.after(async () => {
    await gateway.close();
    await new Promise((resolve) => standIn.close(resolve));
    await rm(dir, { recursive: true, force: true });
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
  const gateway = await startGateway({ socketPath, standIns: new Map([["web.example.test:80", { address: "127.0.0.1", port: standIn.address().port }]]) });
  context.after(async () => {
    await gateway.close();
    await new Promise((resolve) => standIn.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
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
