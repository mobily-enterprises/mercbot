import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { xvfbArgs } from "../../packages/computer/src/server/computerManager.js";
import { program } from "../../packages/computer/src/server/desktop.js";

// Every window Mercbot opens on a bot's computer is an xterm (computers.js xtermCommand): the dock's Terminal, a coding
// run's progress and a coding tool's sign-in. Mercbot runs as the root of a user and mount namespace of its own
// (scripts/namespace.sh, D-68), where xterm, as root, gave its program root's groups (initgroups) before starting it,
// which a user namespace refuses: the program never started and the window closed at once. This starts xterm as
// Mercbot does there, with a real Xvfb, xterm and unshare, the xterm the desktop finds (on PATH, or the tools' own),
// and checks that the program in the window starts, as the host's own user.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const XVFB = process.env.MERCBOT_XVFB || program(process.env, "Xvfb");
const XTERM = program(process.env, "xterm");
const namespaces = spawnSync("unshare", ["--user", "--map-root-user", "--mount", "true"]).status === 0;
const missing = !XVFB ? "Xvfb isn't installed" : !XTERM ? "xterm isn't installed" : !namespaces ? "this host refuses user namespaces" : "";

// Run inside the namespace: xterm as computers.js starts it there, its program writing who it runs as, then what
// happened, as JSON. MERCBOT_NAMESPACE and MERCBOT_UNSHARE are what scripts/namespace.sh exports.
const IN_NAMESPACE = `
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
const [computers, marker, display] = process.argv.slice(1);
const { __testables } = await import(computers);
const argv = __testables.xtermCommand(process.env, "Terminal", ["sh", "-c", 'id -u > "$0"; exec sleep 60', marker], Number(display));
const xterm = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "ignore", "pipe"] });
let said = "";
xterm.stderr.on("data", (chunk) => (said += chunk));
let exit = null;
xterm.on("exit", (code, signal) => (exit = signal || code));
for (let waited = 0; waited < 15000 && exit === null && !existsSync(marker); waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => setTimeout(resolve, 300));
xterm.kill("SIGKILL");
console.log(JSON.stringify({ uid: existsSync(marker) ? readFileSync(marker, "utf8").trim() : null, exit, said: said.trim() }));
`;

test("a window on a bot's computer starts its program where Mercbot runs in its own namespace, as the host's own user", { skip: missing || false }, async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-xterm-window-"));
  let display = 600 + Math.floor(Math.random() * 300);
  while (existsSync(`/tmp/.X11-unix/X${display}`) || existsSync(`/tmp/.X${display}-lock`)) display += 1;
  const xvfb = spawn(XVFB, xvfbArgs(display), { stdio: "ignore" });
  const ended = new Promise((resolve) => xvfb.once("exit", resolve));
  context.after(async () => {
    // Asked to end, Xvfb removes its socket and lock file; killed, it leaves them in /tmp.
    xvfb.kill("SIGTERM");
    const stop = setTimeout(() => xvfb.kill("SIGKILL"), 5000);
    await ended;
    clearTimeout(stop);
    await rm(dir, { recursive: true, force: true });
  });
  for (let waited = 0; waited < 10000 && !existsSync(`/tmp/.X11-unix/X${display}`); waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(existsSync(`/tmp/.X11-unix/X${display}`), `Xvfb :${display} started`);

  const marker = path.join(dir, "started");
  const env = { ...process.env, MERCBOT_NAMESPACE: "own", MERCBOT_UNSHARE: "unshare" };
  const ran = spawnSync("unshare", ["--user", "--map-root-user", "--mount", "--", process.execPath, "--input-type=module", "-e", IN_NAMESPACE,
    path.join(ROOT, "packages/computer/src/server/computers.js"), marker, String(display)], { cwd: ROOT, env, encoding: "utf8", timeout: 30000 });
  assert.equal(ran.status, 0, ran.stderr);
  const { uid, exit, said } = JSON.parse(ran.stdout.trim().split("\n").at(-1));
  assert.equal(uid, String(process.getuid()), `the program in the window started as the host's own user (xterm ended: ${exit}, said: ${said || "nothing"})`);
  assert.equal(exit, null, "the window stayed open while its program ran");
});
