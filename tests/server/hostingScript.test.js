import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// D-68: what depends on the host lives in one hosting script, named by HOSTING_SCRIPT, and a host
// that lacks something stops Mercbot with one plain sentence instead of switching anything off.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function bash(script, env = {}) {
  const result = spawnSync("bash", ["-c", script], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

test("a HOSTING_SCRIPT that names no file stops the install and the start, naming the variable, the path and the scripts there are", () => {
  for (const script of ["bash scripts/namespace.sh --check", "bash scripts/namespace.sh true", "bash scripts/install-tools.sh", "bash scripts/build-toolbox.sh"]) {
    const { status, stderr } = bash(script, { HOSTING_SCRIPT: "scripts/hosting/nowhere.sh", MERCBOT_NAMESPACE: "" });
    assert.equal(status, 1, script);
    assert.match(stderr, /^HOSTING_SCRIPT is scripts\/hosting\/nowhere\.sh, which doesn't exist in Mercbot's folder\. /u, script);
    assert.match(stderr, /The hosting scripts there are: scripts\/hosting\/local\.sh scripts\/hosting\/vibe64\.sh \(/u, script);
  }
});

test("the install and the toolbox build check the host and take their host steps from the same script", () => {
  const lines = (file) => readFileSync(path.join(ROOT, file), "utf8").split("\n");
  for (const file of ["scripts/install-tools.sh", "scripts/build-toolbox.sh"]) {
    assert.ok(lines(file).includes('bash "$ROOT/scripts/namespace.sh" --check'), file);
    assert.ok(lines(file).includes('. "$ROOT/${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"'), file);
  }
  assert.ok(lines("scripts/namespace.sh").includes('hosting="${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"'), "namespace.sh's default");
});

test("in Mercbot's namespace rclone mounts through the hosting script's fusermount3, never the host's set-user-ID one", () => {
  const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
  assert.ok(read("scripts/install-tools.sh").split("\n").includes('  host_fuse_tools "$1" "$DOWNLOADS"'));
  assert.match(read("scripts/hosting/lib/ubuntu.sh"), /install -m 0755 .+ "\$TOOLS\/fuse\/fusermount3"/u);
  const mounts = read("packages/files/src/server/remoteMounts.js");
  assert.match(mounts, /ownNamespace\(env\) \? `\$\{path\.resolve\(env\.MERCBOT_TOOLS_DIR \|\| "\.tools", "fuse"\)\}:\$\{env\.PATH\}`/u);
  assert.match(mounts, /ownNamespace\(env\) \? run\("umount", \["-l", dir\]\)/u);
});

test("nothing the install does the host's way is left outside the hosting script", () => {
  const install = readFileSync(path.join(ROOT, "scripts/install-tools.sh"), "utf8");
  assert.doesNotMatch(install, /apt-get|dpkg/u);
});

test("a host that lacks something stops with one plain sentence pointing at the README, then the error", () => {
  const { status, stderr } = bash(". scripts/hosting/vibe64.sh; host_refuse 'This host lacks a thing Mercbot needs.' 'thing: not found'");
  assert.equal(status, 1);
  assert.equal(stderr, "This host lacks a thing Mercbot needs. See README → Hosting requirements.\nthing: not found\n");
});

test("a host without Xvfb, x11vnc or openbox is refused by name, never started without them", () => {
  const { status, stderr } = bash(". scripts/hosting/vibe64.sh; PATH=/nonexistent; host_display_programs");
  assert.equal(status, 1);
  assert.match(stderr, /^This host has no Xvfb, x11vnc or openbox, which Mercbot's bots' computers need\. See README → Hosting requirements\.\nXvfb: not found; x11vnc: not found; openbox: not found/u);
  // openbox alone missing is refused too: bots' windows would have no frames to move or close.
  const shims = shimFolder({ Xvfb: "exit 0", x11vnc: "exit 0" });
  try {
    for (const hosting of ["vibe64", "local"]) {
      const missing = bash(`. scripts/hosting/${hosting}.sh; PATH=${shims}; host_display_programs`);
      assert.equal(missing.status, 1, hosting);
      assert.match(missing.stderr, new RegExp(`x11vnc: ${shims}/x11vnc; openbox: not found`, "u"), hosting);
    }
  } finally {
    rmSync(shims, { recursive: true, force: true });
  }
});

// A folder of stand-in programs, each a bash script with the body given, for PATH.
function shimFolder(programs) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mercbot-hosting-"));
  for (const [name, body] of Object.entries(programs)) {
    writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  }
  return dir;
}

// A person's own computer (docs/standalone-plan.md, change 2): every refusal says which command fixes it.
test("on a person's computer each missing piece is refused with the command that fixes it", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mercbot-local-"));
  const trusted = path.join(dir, "trusted");
  const tools = path.join(dir, "tools");
  mkdirSync(trusted);
  mkdirSync(path.join(tools, "bin"), { recursive: true });
  const run = (script, programs, env = {}) => {
    const shims = shimFolder(programs);
    try {
      return bash(`. scripts/hosting/local.sh; PATH=${shims}:$PATH; ${script}`, { MERCBOT_TRUSTED_DIR: trusted, MERCBOT_TOOLS_DIR: tools, ...env });
    } finally {
      rmSync(shims, { recursive: true, force: true });
    }
  };
  const rootStep = /Run Mercbot's installer again and agree to its root step\. See README → Hosting requirements\.\n/u;
  try {
    let refused = run("host_check", { uname: 'echo aarch64' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^Mercbot runs on x86_64 computers only for now, .+\nuname -m: aarch64\n$/u);

    // Ubuntu's AppArmor refusing the system's unshare, before the root step.
    refused = run("host_check", { unshare: 'echo "unshare: write failed /proc/self/uid_map: Operation not permitted" >&2; exit 1' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^This computer doesn't let Mercbot make its own sandboxes, which its bots' computers need\. /u);
    assert.match(refused.stderr, rootStep);
    assert.match(refused.stderr, /Operation not permitted\n$/u);

    // A copy someone other than root could have put there is never used.
    writeFileSync(path.join(trusted, "unshare"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    refused = run("host_check", { unshare: "exit 0" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^This computer's copy of unshare for Mercbot isn't root's own, so Mercbot won't trust it\. /u);
    assert.match(refused.stderr, rootStep);
    rmSync(path.join(trusted, "unshare"));

    // gVisor updated with the tools, while the root step's copy is the old one.
    writeFileSync(path.join(trusted, "runsc"), "old gVisor", { mode: 0o755 });
    writeFileSync(path.join(tools, "bin", "runsc"), "new gVisor", { mode: 0o755 });
    refused = run("host_check", { unshare: "exit 0" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^Mercbot's gVisor was updated, and this computer's trusted copy is still the old one\. /u);
    assert.match(refused.stderr, rootStep);
    writeFileSync(path.join(tools, "bin", "runsc"), "old gVisor", { mode: 0o755 });
    refused = run("host_check", { unshare: "exit 0" });
    assert.match(refused.stderr, /^This computer's copy of runsc for Mercbot isn't root's own/u);
    rmSync(path.join(trusted, "runsc"));

    refused = run("host_display_programs", { Xvfb: "exit 0" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^This computer lacks Xvfb, x11vnc or openbox, which Mercbot's bots' computers need\. Install them with: sudo apt-get install xvfb x11vnc openbox See README/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("where the computer allows namespaces, Mercbot uses its own unshare and the tools' gVisor", (t) => {
  if (bash("{ exec 3<>/dev/fuse; } 2>/dev/null").status !== 0) {
    t.skip("this machine has no /dev/fuse to open, so host_check stops before it answers; the desktop and office test hosts have one");
    return;
  }
  const trusted = mkdtempSync(path.join(os.tmpdir(), "mercbot-trusted-"));
  const shims = shimFolder({ unshare: "exit 0" });
  try {
    const { status, stdout } = spawnSync("bash", ["-c", `. scripts/hosting/local.sh; PATH=${shims}:$PATH; host_check; echo "$MERCBOT_UNSHARE|\${MERCBOT_RUNSC-none}"`], {
      cwd: ROOT, env: { ...process.env, MERCBOT_TRUSTED_DIR: trusted, MERCBOT_RUNSC: "" }, encoding: "utf8"
    });
    assert.equal(status, 0);
    assert.equal(stdout, `${shims}/unshare|\n`);
  } finally {
    rmSync(trusted, { recursive: true, force: true });
    rmSync(shims, { recursive: true, force: true });
  }
  assert.ok(readFileSync(path.join(ROOT, "scripts/namespace.sh"), "utf8").includes('exec "$MERCBOT_UNSHARE" --user --map-root-user --mount -- "$@"'));
});

test("bots' computers and the speed script start their display the same way, without shared memory", async () => {
  const { xvfbArgs } = await import("../../packages/computer/src/server/computerManager.js");
  assert.deepEqual(xvfbArgs(93), [":93", "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-extension", "MIT-SHM"]);
  const script = readFileSync(path.join(ROOT, "scripts/measure-browser-speed.mjs"), "utf8");
  assert.ok(script.includes('spawn(process.env.MERCBOT_XVFB || "Xvfb", xvfbArgs(display), { stdio: "ignore" })'));
});
