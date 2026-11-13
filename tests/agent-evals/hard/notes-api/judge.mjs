import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(mkdtempSync(path.join(os.tmpdir(), "notes-judge-")), "store.json");
const port = 41000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
function start() {
  const child = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), NOTES_FILE: file }, stdio: "ignore" });
  return child;
}
async function ready() {
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(`${base}/notes`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("server never answered");
}
const call = async (method, url, body, raw) => {
  const response = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

test("judge", async () => {
  let server = start();
  try {
    await ready();
    const a = await call("POST", "/notes", { title: "Groceries", body: "Milk and EGGS", tags: ["home"] });
    assert.equal(a.status, 201);
    assert.deepEqual([a.body.id, a.body.title, a.body.tags], [1, "Groceries", ["home"]]);
    assert.ok(!Number.isNaN(Date.parse(a.body.createdAt)));
    await new Promise((r) => setTimeout(r, 15));
    const b = await call("POST", "/notes", { title: "Work plan", body: "Ship it" });
    assert.deepEqual([b.status, b.body.id, b.body.tags], [201, 2, []]);
    assert.deepEqual((await call("GET", "/notes")).body.map((n) => n.id), [2, 1], "newest first");
    assert.deepEqual((await call("GET", "/notes?tag=home")).body.map((n) => n.id), [1]);
    assert.deepEqual((await call("GET", "/notes?q=eggs")).body.map((n) => n.id), [1]);
    assert.equal((await call("POST", "/notes", { title: "", body: "x" })).status, 400);
    assert.equal((await call("POST", "/notes", { title: "x".repeat(101), body: "x" })).status, 400);
    assert.equal((await call("POST", "/notes", { title: "ok", body: "x", tags: [1] })).status, 400);
    const bad = await call("POST", "/notes", undefined, "{nope");
    assert.equal(bad.status, 400); assert.equal(typeof bad.body.error, "string");
    const patched = await call("PATCH", "/notes/2", { tags: ["work"] });
    assert.deepEqual([patched.status, patched.body.title, patched.body.tags], [200, "Work plan", ["work"]]);
    assert.equal((await call("PATCH", "/notes/2", { title: "" })).status, 400);
    assert.equal((await call("GET", "/notes/9")).status, 404);
    assert.equal((await call("GET", "/nothing")).status, 404);
    assert.equal((await call("DELETE", "/notes/1")).status, 204);
    assert.equal((await call("GET", "/notes/1")).status, 404);
    server.kill(); await new Promise((r) => setTimeout(r, 300));
    assert.ok(existsSync(file), "notes are kept in NOTES_FILE");
    server = start(); await ready();
    assert.deepEqual((await call("GET", "/notes")).body.map((n) => n.id), [2], "survives a restart");
    assert.equal((await call("POST", "/notes", { title: "Again", body: "" })).body.id, 3, "ids never reused");
  } finally {
    server.kill();
  }
});
