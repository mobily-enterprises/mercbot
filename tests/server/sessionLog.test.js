import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { __testables } from "../../packages/files/src/server/shell.js";

// A bot's command in a computer's session (shell.js IN_SESSION) is copied into the session's log, which the Terminal's
// top pane shows, under its heading and followed by its "(exit N)" line. The copy is written by a process of its own,
// which can finish after the command has; here it's slowed (a head that waits a second before reading), so an exit line
// written without waiting for the copy comes before the output (shell.integration.js's session log, desktop, 25 Nov).
// The session's script as the sandbox runs it, on the host's bash, with its log in the test's own folder in place of
// the sandbox's /tmp/bot.log.
const { IN_SESSION } = __testables;
const LOG = "/tmp/bot.log";

/** `script` run as a session runs a bot's command headed "test": its exit code, its output and the log it leaves. */
async function inSession(root, name, script) {
  const log = path.join(root, `${name}.log`);
  const child = spawn("bash", ["-c", IN_SESSION.replaceAll(LOG, log), "command", "test", "5", script], {
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  // Once every process holding its pipes has ended, the log's copy included.
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, output, log: stripVTControlCharacters(await readFile(log, "utf8")) };
}

test("a session's log shows a command's output before its exit line, however late the log's copy is written", async (context) => {
  assert.ok(IN_SESSION.includes(LOG), "the session's script writes its log at /tmp/bot.log");
  const root = await mkdtemp(path.join(os.tmpdir(), "mb-session-log-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const head = execFileSync("bash", ["-c", "command -v head"], { encoding: "utf8" }).trim();
  await mkdir(path.join(root, "bin"));
  await writeFile(path.join(root, "bin", "head"), `#!/bin/sh\nsleep 1\nexec ${head} "$@"\n`);
  await chmod(path.join(root, "bin", "head"), 0o755);

  const [done, failed] = await Promise.all([
    inSession(root, "done", "echo first-run"),
    inSession(root, "failed", "echo half; exit 3")
  ]);
  assert.deepEqual(done, { code: 0, output: "first-run\n", log: "\n$ test\nfirst-run\n(exit 0)\n" });
  assert.deepEqual(failed, { code: 3, output: "half\n", log: "\n$ test\nhalf\n(exit 3)\n" }, "the command's own exit code, in the log and returned");
});
