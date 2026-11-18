import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.match(stderr, /The hosting scripts there are: scripts\/hosting\/local\.sh scripts\/hosting\/store\.sh scripts\/hosting\/vibe64\.sh \(/u, script);
  }
});

test("the install and the toolbox build check the host and take their host steps from the same script", () => {
  const lines = (file) => readFileSync(path.join(ROOT, file), "utf8").split("\n");
  // The install's check is the same but on a store host, which is checked when Mercbot starts there (D-92).
  for (const [file, check] of [["scripts/install-tools.sh", "--check-install"], ["scripts/build-toolbox.sh", "--check"]]) {
    assert.ok(lines(file).includes(`bash "$ROOT/scripts/namespace.sh" ${check}`), file);
    assert.ok(lines(file).includes('. "$ROOT/${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"'), file);
  }
  assert.ok(lines("scripts/namespace.sh").includes('hosting="${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"'), "namespace.sh's default");
});

// D-91: bots' files are in an S3 bucket Mercbot reaches itself, and people's storage through rclone's remote control,
// so no host is asked for FUSE: no hosting script opens /dev/fuse, the install brings neither JuiceFS nor a
// fusermount3, the start mounts nothing, and rclone is started as a remote control, never a mount.
test("nothing needs FUSE: no host is asked for /dev/fuse, and nothing is mounted", () => {
  const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
  for (const file of ["scripts/hosting/vibe64.sh", "scripts/hosting/local.sh", "scripts/hosting/store.sh", "scripts/hosting/lib/ubuntu.sh"]) {
    assert.doesNotMatch(read(file), /\/dev\/fuse|fusermount|host_fuse_tools/u, file);
  }
  assert.doesNotMatch(read("scripts/install-tools.sh"), /juicefs|fuse/iu);
  assert.doesNotMatch(read("scripts/serve.sh"), /mount-files|umount|juicefs/u);
  const mounts = read("packages/files/src/server/remoteMounts.js");
  assert.match(mounts, /spawn\(rcloneBinary\(env\), \[\n\s+"rcd",/u);
  assert.doesNotMatch(mounts, /"mount"|fusermount|umount/u);
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

test("on a host whose programs come from a store, the store, the toolbox's folder and gVisor are checked first, and the toolbox and desktop programs are never made there", () => {
  const unset = bash(". scripts/hosting/store.sh; host_check", { MERCBOT_TOOLBOX_STORE: "", MERCBOT_TOOLBOX_DIR: "" });
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /^On this host Mercbot's bots' toolbox comes from the store: MERCBOT_TOOLBOX_STORE names the store and MERCBOT_TOOLBOX_DIR the folder the toolbox is made in\. See README → Hosting requirements\.\nMERCBOT_TOOLBOX_STORE= MERCBOT_TOOLBOX_DIR=\n$/u);
  const store = mkdtempSync(path.join(os.tmpdir(), "mercbot-store-"));
  try {
    const noRunsc = bash(`. scripts/hosting/store.sh; PATH=${store}; host_check`, { MERCBOT_TOOLBOX_STORE: store, MERCBOT_TOOLBOX_DIR: path.join(store, "box"), MERCBOT_RUNSC: "" });
    assert.equal(noRunsc.status, 1);
    assert.match(noRunsc.stderr, /^This host has no gVisor \(runsc\), which Mercbot's bots' sandboxes need\. See README → Hosting requirements\.\nrunsc: not found/u);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
  for (const step of ["host_toolbox_packages", "host_desktop_tools"]) {
    const refused = bash(`. scripts/hosting/store.sh; ${step} a b`);
    assert.equal(refused.status, 1, step);
    assert.match(refused.stderr, /^On this host Mercbot's bots' toolbox and their desktops' programs come from its store, so they're never built or installed here\./u, step);
  }
  // The install's downloads unpack as on Ubuntu (rclone's release is a Debian package), and only a store host says
  // its toolbox comes from the store.
  assert.equal(bash(". scripts/hosting/store.sh; declare -f host_unpack_deb | grep -q 'dpkg-deb -x'").status, 0);
  assert.equal(bash(". scripts/hosting/store.sh; host_store_toolbox").status, 0);
  for (const hosting of ["vibe64", "local"]) assert.equal(bash(`. scripts/hosting/${hosting}.sh; host_store_toolbox`).status, 1, hosting);
});

// D-92: the install for a store host, run where its release is built, brings only the downloads its servers use, never
// the toolbox or the desktops' programs, which the store gives them at every start; an Ubuntu host's install is
// unchanged. It runs the real install-tools.sh, namespace.sh and hosting scripts in a copy of scripts/ whose tools'
// store and toolbox build are stand-ins that record what they are asked to install.
test("on a host whose programs come from a store, the install brings only the downloads: no toolbox and no desktop programs", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mercbot-store-install-"));
  const shims = shimFolder({ unshare: "exit 0", Xvfb: "exit 0", x11vnc: "exit 0", openbox: "exit 0" });
  try {
    mkdirSync(path.join(root, "scripts/hosting/lib"), { recursive: true });
    mkdirSync(path.join(root, "scripts/coding-tools"), { recursive: true });
    for (const file of ["scripts/install-tools.sh", "scripts/namespace.sh", "scripts/hosting/store.sh", "scripts/hosting/vibe64.sh",
      "scripts/hosting/local.sh", "scripts/hosting/lib/ubuntu.sh", "scripts/coding-tools/package.json", "scripts/coding-tools/package-lock.json"]) {
      writeFileSync(path.join(root, file), readFileSync(path.join(ROOT, file)));
    }
    writeFileSync(path.join(root, "scripts/tools-store.sh"), 'STORE="$MERCBOT_TOOLS_STORE"\ntools_install() { echo "$1" >> "$INSTALLED"; }\n');
    writeFileSync(path.join(root, "scripts/build-toolbox.sh"), 'echo toolbox >> "$INSTALLED"\n');
    const install = (hosting) => {
      const installed = path.join(root, `installed-${hosting}`);
      // What an earlier install left in the checkout: a toolbox and desktop programs.
      mkdirSync(path.join(root, ".tools/toolbox/rootfs/etc"), { recursive: true });
      mkdirSync(path.join(root, ".tools/desktop/usr/bin"), { recursive: true });
      const result = spawnSync("bash", ["scripts/install-tools.sh"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env, PATH: `${shims}:${process.env.PATH}`, HOSTING_SCRIPT: `scripts/hosting/${hosting}.sh`, INSTALLED: installed,
          MERCBOT_TOOLS_STORE: path.join(root, "store"), MERCBOT_TOOLBOX_STORE: "", MERCBOT_TOOLBOX_DIR: "", MERCBOT_NAMESPACE: ""
        }
      });
      return {
        status: result.status,
        stderr: result.stderr,
        installed: existsSync(installed) ? readFileSync(installed, "utf8").split("\n").filter(Boolean) : [],
        left: ["toolbox", "desktop"].filter((folder) => existsSync(path.join(root, ".tools", folder)))
      };
    };
    const downloads = ["rclone", "piper", "wordcraft", "gridcraft", "deckcraft", "pdfcraft", "coding", "gvisor"];
    // A store host's build: it has none of the store's settings, which only its servers get.
    const store = install("store");
    assert.equal(store.status, 0, store.stderr);
    assert.deepEqual(store.installed, downloads);
    assert.deepEqual(store.left, [], "no .tools/toolbox or .tools/desktop on a store host");
    const vibe64 = install("vibe64");
    assert.equal(vibe64.status, 0, vibe64.stderr);
    assert.deepEqual(vibe64.installed, [...downloads.slice(0, 7), "desktop", "gvisor", "toolbox"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
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

test("where the computer allows namespaces, Mercbot uses its own unshare and the tools' gVisor", () => {
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
