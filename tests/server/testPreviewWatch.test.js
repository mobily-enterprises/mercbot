import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { watchTestPreview } from "../support/testPreviewWatch.mjs";

// The browser suite's Test Previews (tests/e2e/globalSetup.mjs): one that stops after it started and before the
// teardown stops it (it crashed, or something killed it) says so in the suite's output, with its pid, its exit code or
// signal and its log's end, and its log is kept outside the run's folder, which the teardown removes. One the teardown
// stops says nothing. A stand-in process stands for the Test Preview: it writes its log, says it's up over IPC as
// start-test-app.mjs does, and waits; told "crash", it exits with code 3, as a crashing server exits.
const STAND_IN = "console.log('listening'); console.error('the last thing it said'); process.on('message', (m) => m === 'crash' && process.exit(3)); "
  + "process.send({ origin: 'http://127.0.0.1:1' }); setInterval(() => {}, 1000);";

async function started(t) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-preview-watch-"));
  const keepDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-preview-kept-"));
  t.after(() => Promise.all([runDir, keepDir].map((dir) => rm(dir, { recursive: true, force: true }))));
  const log = path.join(runDir, "server-2.log");
  const output = createWriteStream(log, { flags: "a" });
  await once(output, "open");
  const server = spawn(process.execPath, ["-e", STAND_IN], { stdio: ["ignore", output, output, "ipc"] });
  t.after(() => server.kill("SIGKILL"));
  await once(server, "message");
  return { runDir, keepDir, log, server };
}

test("a Test Preview killed during the run says so with its pid, signal and log's end, and its log outlives the run's folder", async (t) => {
  const { runDir, keepDir, log, server } = await started(t);
  const said = [];
  const kept = path.join(keepDir, "test-preview-2.log");
  const watched = watchTestPreview(server, { name: "Test Preview 2", log, kept, stopping: () => false, report: (text) => said.push(text) });
  process.kill(server.pid, "SIGKILL");
  await watched;
  await rm(runDir, { recursive: true, force: true });
  assert.equal(said.length, 1, "one report");
  assert.match(said[0], new RegExp(`^Test Preview 2 \\(pid ${server.pid}\\) stopped during the run \\(signal SIGKILL\\)`, "u"));
  assert.ok(said[0].includes(`its log is kept at ${kept}`), said[0]);
  assert.ok(said[0].trimEnd().endsWith("the last thing it said"), said[0]);
  assert.match(await readFile(kept, "utf8"), /listening\n[^]*the last thing it said/u, "the whole log, kept");
});

test("a Test Preview that exits on its own during the run says its exit code", async (t) => {
  const { log, keepDir, server } = await started(t);
  const said = [];
  const watched = watchTestPreview(server, {
    name: "Test Preview 0", log, kept: path.join(keepDir, "test-preview-0.log"), stopping: () => false, report: (text) => said.push(text)
  });
  server.send("crash");
  await watched;
  assert.equal(said.length, 1, "one report");
  assert.match(said[0], new RegExp(`^Test Preview 0 \\(pid ${server.pid}\\) stopped during the run \\(exit 3\\)`, "u"));
});

test("a Test Preview the teardown stops says nothing and leaves no log behind", async (t) => {
  const { keepDir, log, server } = await started(t);
  const said = [];
  const kept = path.join(keepDir, "test-preview-1.log");
  const watched = watchTestPreview(server, { name: "Test Preview 1", log, kept, stopping: () => true, report: (text) => said.push(text) });
  process.kill(server.pid, "SIGTERM");
  await watched;
  assert.deepEqual(said, []);
  assert.equal(existsSync(kept), false);
});
