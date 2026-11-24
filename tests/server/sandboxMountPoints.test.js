import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { folderMount, runSandboxed, sandboxPlace, sandboxSpec } from "../../packages/files/src/server/gvisor.js";

// A sandbox given a folder at one of the sandboxes' mount points (gvisor.js TOOLBOX_MOUNT_POINTS) its toolbox lacks.
// gVisor makes a missing point in the toolbox itself, which works only where the user running runsc may write there:
// in a toolbox the server owns while MERCBOT_SANDBOX_USER runs runsc, or one root made for a host's servers to share,
// it starts nothing ("cannot create sandbox"). The stand-in runsc here refuses a missing point as gVisor does there,
// so what's checked is the server's part: it makes the point before runsc runs, and where it can't, it refuses the
// sandbox in words that name the fix, without starting runsc.

const LIMITS = { processes: 64, openFiles: 256, fileSize: 1 << 20, processMemory: 0, scratch: "16m" };

/** A toolbox with no mount points, a folder to give the sandbox, and a stand-in runsc that notes each run. */
async function world(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mb-mount-points-"));
  context.after(async () => {
    await chmod(path.join(root, "toolbox"), 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const toolbox = path.join(root, "toolbox");
  await mkdir(path.join(toolbox, "etc"), { recursive: true });
  await writeFile(path.join(toolbox, "etc", "mercbot-toolbox"), "stand-in\n");
  const folder = path.join(root, "db");
  await mkdir(folder);
  const runs = path.join(root, "runs.log");
  const runsc = path.join(root, "runsc");
  // `run --bundle DIR ID`: refuses, as gVisor does, when a folder's mount point isn't in the toolbox; anything else
  // (delete, kill, events) does nothing.
  await writeFile(runsc, `#!/usr/bin/env bash
bundle=""; run=no
while [ $# -gt 0 ]; do case "$1" in run) run=yes ;; --bundle) bundle=$2; shift ;; esac; shift; done
[ "$run" = yes ] || exit 0
echo run >> ${JSON.stringify(runs)}
node -e '
const spec = JSON.parse(require("fs").readFileSync(process.argv[1] + "/config.json", "utf8"));
const lacks = spec.mounts.filter((mount) => mount.type === "bind" && !require("fs").existsSync(spec.root.path + mount.destination));
if (lacks.length) { console.error("running container: creating container: cannot create sandbox: EOF"); process.exit(128); }
console.log("started");
' "$bundle"
`);
  await chmod(runsc, 0o755);
  const env = { MERCBOT_RUNSC: runsc, MERCBOT_TOOLBOX_DIR: toolbox, MERCBOT_TOOLS_DIR: root };
  return { toolbox, folder, runs, env };
}

/** Runs a sandbox given `folder` at /files/db, read-only, to its end: { exitCode, output }. */
async function runWithDb({ env, folder }) {
  const mounts = [folderMount(folder, "/files/db", { readonly: true })];
  const spec = sandboxSpec({ runtimeEnv: env, args: ["/bin/true"], cwd: "/", env: [], limits: LIMITS, mounts, rootReadOnly: true });
  let output = "";
  const onOutput = (text) => {
    output += text;
  };
  const { done } = await runSandboxed({ env, place: sandboxPlace("points"), spec, maxSeconds: 30, memory: 1 << 30, onOutput });
  const { exitCode } = await done;
  return { exitCode, output };
}

test("a sandbox given a folder at a mount point its toolbox lacks starts: the server makes the point before runsc runs", async (
  context
) => {
  const place = await world(context);
  const { exitCode, output } = await runWithDb(place);
  assert.equal(exitCode, 0, output);
  assert.match(output, /started/u);
  assert.ok((await stat(path.join(place.toolbox, "files", "db"))).isDirectory(), "the point is in the toolbox now");
});

const NO_UNWRITABLE = process.getuid?.() === 0
  ? "root may write in any folder, so no toolbox here is one this process can't write"
  : false;
test("where the server can't make the point (a toolbox it may not write in), the sandbox is refused naming the fix, and runsc never runs", {
  skip: NO_UNWRITABLE
}, async (context) => {
  const place = await world(context);
  await chmod(place.toolbox, 0o555);
  await assert.rejects(runWithDb(place), (error) => {
    assert.match(error.message, /lacks \/files\/db/u);
    assert.ok(error.message.includes(`node scripts/toolbox-mount-points.mjs ${place.toolbox}`), error.message);
    return true;
  });
  assert.equal(await stat(place.runs).then(() => true, () => false), false, "runsc never ran");
});
