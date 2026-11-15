// scripts/mount-files.sh on servers that start together against one new database (D-20): the volume is formatted
// once, while the others wait for it, and a format that fails stops the start, naming the log that holds why. JuiceFS
// is a stand-in (in a copy of the script's folder, as .tools/bin/juicefs) whose format takes a moment and refuses a
// second format while one is under way, as a real second format of a new volume fails; psql and openssl are the
// host's, against the file's own test database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const STAND_IN = `#!/bin/sh
case "$1" in
  status) [ -e "$STAND_IN_STATE/formatted" ] ;;
  format)
    [ -z "$STAND_IN_FAIL" ] || { echo "the bucket refused the volume" >&2; exit 1; }
    mkdir "$STAND_IN_STATE/formatting" 2>/dev/null || { echo "a format is already under way" >&2; exit 1; }
    echo format >> "$STAND_IN_STATE/formats"
    sleep 0.3
    touch "$STAND_IN_STATE/formatted" ;;
  mount) exit 0 ;;
esac
`;

/** A copy of the script with the stand-in JuiceFS beside it, and its state folder. */
function scriptCopy(context) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "mercbot-mount-files-"));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(path.join(folder, "scripts"));
  mkdirSync(path.join(folder, ".tools/bin"), { recursive: true });
  mkdirSync(path.join(folder, "state"));
  copyFileSync(path.join(ROOT, "scripts/mount-files.sh"), path.join(folder, "scripts/mount-files.sh"));
  writeFileSync(path.join(folder, ".tools/bin/juicefs"), STAND_IN);
  chmodSync(path.join(folder, ".tools/bin/juicefs"), 0o755);
  return folder;
}

/** Runs the copy as server `name` would, to its end. */
function server(folder, name, env = {}) {
  const child = spawn("bash", [path.join(folder, "scripts/mount-files.sh")], {
    env: {
      ...process.env,
      MERCBOT_FILES_DIR: path.join(folder, name, "files"),
      MERCBOT_FILES_CACHE: path.join(folder, name, "cache"),
      MERCBOT_FILES_PASSPHRASE: "test-only-passphrase",
      STAND_IN_STATE: path.join(folder, "state"),
      ...env
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr })));
}

test("servers that start together against a new database format the files volume once, and all mount it", async (context) => {
  const folder = scriptCopy(context);
  const started = await Promise.all(["web", "computers", "another"].map((name) => server(folder, name)));
  for (const run of started) assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readFileSync(path.join(folder, "state/formats"), "utf8").trim().split("\n"), ["format"]);
  assert.equal(started.filter((run) => run.stdout.includes("Files volume created")).length, 1);
  for (const name of ["web", "computers", "another"]) assert.ok(existsSync(path.join(folder, name, "files/.mercbot-files")), name);
});

test("a format that fails stops the start, naming the log that says why", async (context) => {
  const folder = scriptCopy(context);
  const run = await server(folder, "web", { STAND_IN_FAIL: "1" });
  assert.notEqual(run.status, 0);
  const log = path.join(folder, "web/mount.log");
  assert.ok(run.stderr.includes(`Making the files volume failed; see ${path.join(folder, "web/cache")}/../mount.log`), run.stderr);
  assert.match(readFileSync(log, "utf8"), /the bucket refused the volume/u);
  assert.equal(existsSync(path.join(folder, "web/files/.mercbot-files")), false);
});
