import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The toolbox build runs its install in gVisor (scripts/toolbox-run.sh, D-47) with a stand-in for runsc here. On a
// published Mercbot, Prepare's output is a socket, and gVisor shuts down an inherited socket when its sandbox ends: the
// build's next line died of SIGPIPE (status 141). A test run's output is a socket too (a Node child's stdio is a
// socket pair), so the stand-in does to it what gVisor does.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// runsc's stand-in. `delete` stops what `run` left behind; `run` acts as the variables say: REFUSED fails before
// the sandbox starts; otherwise the install marks its start, prints a line and exits with INSTALL_STATUS (0), with
// an error line first when that isn't 0, after shutting down the socket it was given as output (SHUTS_OUTPUT) and
// leaving a process running that holds that output (OUTLIVES).
const RUNSC = `#!/usr/bin/env bash
if [ "$1" != "--rootless" ]; then
  [ -f "$PLACE/left.pid" ] && kill "$(cat "$PLACE/left.pid")" 2>/dev/null
  echo delete >> "$PLACE/calls"
  exit 0
fi
echo run >> "$PLACE/calls"
if [ -n "\${REFUSED:-}" ]; then echo "creating the sandbox: operation not permitted" >&2; exit 128; fi
: > "$PLACE/rootfs/install.started"
echo "Installing the toolbox's packages"
if [ "\${INSTALL_STATUS:-0}" != 0 ]; then echo "dpkg: error processing package tmux" >&2; fi
if [ -n "\${OUTLIVES:-}" ]; then sleep 30 & echo $! > "$PLACE/left.pid"; fi
if [ -n "\${SHUTS_OUTPUT:-}" ] && [ -S /proc/self/fd/1 ]; then
  "$NODE" -e 'new (require("node:net").Socket)({ fd: 1, readable: false }).end()'
fi
exit "\${INSTALL_STATUS:-0}"
`;

function withPlace(run) {
  const place = mkdtempSync(path.join(os.tmpdir(), "mb-toolbox-run-"));
  mkdirSync(path.join(place, "rootfs"));
  mkdirSync(path.join(place, "bundle"));
  writeFileSync(path.join(place, "runsc"), RUNSC);
  chmodSync(path.join(place, "runsc"), 0o755);
  return Promise.resolve(run(place)).finally(() => {
    const left = path.join(place, "left.pid");
    if (existsSync(left)) {
      try {
        process.kill(Number(readFileSync(left, "utf8")));
      } catch {
        // Already stopped, as it should be.
      }
    }
    rmSync(place, { recursive: true, force: true });
  });
}

// The build's step as build-toolbox.sh takes it, then the build's next line. Resolves when the build's process
// ends (or at 15 s, when it's stopped), with how long it took; `closedOutput` closes the build's output first.
function build(place, env = {}, { closedOutput = false } = {}) {
  const script = `set -euo pipefail
. scripts/toolbox-run.sh
toolbox_run "$PLACE/runsc" "$PLACE/state" "$PLACE/bundle" "$PLACE/rootfs"
echo "Toolbox built"`;
  const started = performance.now();
  const child = spawn("bash", ["-c", script], { cwd: ROOT, env: { ...process.env, PLACE: place, NODE: process.execPath, ...env } });
  let stdout = "";
  let stderr = "";
  if (closedOutput) child.stdout.destroy();
  else child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const bound = setTimeout(() => child.kill("SIGKILL"), 15_000);
  return new Promise((resolve) => child.on("exit", (status, signal) => {
    clearTimeout(bound);
    resolve({ status, signal, stdout, stderr, seconds: (performance.now() - started) / 1000 });
  }));
}

const calls = (place) => readFileSync(path.join(place, "calls"), "utf8").trim().split("\n");

/** Whether process `pid` is gone within 2 s (a stopped one lasts until its parent collects it). */
async function gone(pid) {
  for (let tries = 0; tries < 40; tries += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test("a sandbox that shuts down its output as it ends leaves the build's own output working", () => withPlace(async (place) => {
  const result = await build(place, { SHUTS_OUTPUT: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Installing the toolbox's packages\nToolbox built\n", "the install's output, then the build's next line");
  assert.deepEqual(calls(place), ["run", "delete"]);
  assert.equal(existsSync(path.join(place, "rootfs/install.started")), false, "the marker goes with the install");
}));

test("a sandbox process that outlives runsc run neither holds the build up nor stays running", () => withPlace(async (place) => {
  const result = await build(place, { OUTLIVES: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.seconds < 10, `the build went on at once (${result.seconds.toFixed(1)} s), not after the process's 30 s`);
  assert.match(result.stdout, /Toolbox built\n$/u);
  const left = Number(readFileSync(path.join(place, "left.pid"), "utf8"));
  assert.ok(await gone(left), "runsc delete stopped what the sandbox left running");
}));

test("a host that won't start the sandbox is told apart from an install that fails inside it", () => withPlace(async (place) => {
  const refused = await build(place, { REFUSED: "1" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^This host doesn't let Mercbot create its own sandboxes, which its bots' computers need\. See README → Hosting requirements\.\ncreating the sandbox: operation not permitted\n$/u);
  assert.doesNotMatch(refused.stdout, /Toolbox built/u);

  const failed = await build(place, { INSTALL_STATUS: "3" });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "Installing the toolbox's packages\n", "the install's output is shown");
  assert.equal(failed.stderr, "dpkg: error processing package tmux\nThe toolbox's install failed inside its sandbox (status 3); its output is above.\n", "the end of its errors, then what failed");
}));

test("the build's own output closing stops it with that write's status, never as a host that refuses sandboxes", () => withPlace(async (place) => {
  const result = await build(place, {}, { closedOutput: true });
  assert.equal(result.status, 141, "SIGPIPE's status, as the shell reports a command it stopped");
  assert.equal(result.stderr, "");
}));
