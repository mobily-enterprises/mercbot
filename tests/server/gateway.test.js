import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __testables, startGateway } from "../../packages/computer/src/server/gateway.js";

const { blocked } = __testables;

// The computer's gateway (D-47): its apps reach only public addresses through it.
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
