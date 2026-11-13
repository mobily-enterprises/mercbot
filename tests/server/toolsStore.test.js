import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// D-70: each tool is installed once per version into the tools' store and hard-linked into .tools,
// so a published Mercbot reinstalls only what changed, and an install cut short is never used.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function withPlace(run) {
  const place = mkdtempSync(path.join(os.tmpdir(), "mb-tools-store-"));
  try {
    return run(place);
  } finally {
    rmSync(place, { recursive: true, force: true });
  }
}

// One install run, as scripts/install-tools.sh makes it: the release's .tools, the shared store and
// a demo tool whose installer counts its runs and writes VERSION into bin/demo (and bin/extra,
// unless NO_EXTRA is set), failing halfway when HALFWAY is set.
function install(place, { release = "release-1", version = "1", env = {} } = {}) {
  const script = `
    set -euo pipefail
    TOOLS="$PLACE/${release}/.tools"
    . scripts/tools-store.sh
    install_demo() {
      echo run >> "$PLACE/runs"
      mkdir -p "$1/bin"
      echo "half of ${version}" > "$1/bin/demo"
      if [ -n "\${HALFWAY:-}" ]; then exit 1; fi
      echo "demo ${version}" > "$1/bin/demo"
      if [ -z "\${NO_EXTRA:-}" ]; then echo extra > "$1/bin/extra"; fi
    }
    tools_install demo "${version}" install_demo bin/demo bin/extra`;
  const result = spawnSync("bash", ["-c", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PLACE: place, MERCBOT_TOOLS_STORE: path.join(place, "store"), ...env }
  });
  return { status: result.status, stderr: result.stderr };
}

const runs = (place) => (existsSync(path.join(place, "runs")) ? readFileSync(path.join(place, "runs"), "utf8").split("\n").filter(Boolean).length : 0);
const read = (place, file) => readFileSync(path.join(place, file), "utf8");

test("a tool already in the store is linked into a new release's .tools, not installed or copied again", () => withPlace((place) => {
  assert.equal(install(place).status, 0);
  assert.equal(install(place, { release: "release-2" }).status, 0);
  assert.equal(runs(place), 1, "installed once");
  assert.equal(read(place, "release-2/.tools/bin/demo"), "demo 1\n");
  const linked = statSync(path.join(place, "release-2/.tools/bin/demo"));
  assert.equal(linked.ino, statSync(path.join(place, "store/demo/1/bin/demo")).ino, "a hard link to the store's file");
  assert.equal(linked.nlink, 3, "the store's file and both releases' links");
  assert.ok(!existsSync(path.join(place, "release-2/.tools/.done")), "the marker stays in the store");
}));

test("an install cut short leaves no marker and nothing in .tools, and the next run installs it again", () => withPlace((place) => {
  assert.notEqual(install(place, { env: { HALFWAY: "1" } }).status, 0);
  assert.ok(!existsSync(path.join(place, "store/demo/1/.done")));
  assert.ok(!existsSync(path.join(place, "release-1/.tools/bin/demo")));
  assert.equal(install(place).status, 0);
  assert.equal(runs(place), 2, "installed again, not reused");
  assert.equal(read(place, "release-1/.tools/bin/demo"), "demo 1\n");
}));

test("a new version replaces the old in the store, while a running release keeps its links to the old", () => withPlace((place) => {
  assert.equal(install(place).status, 0);
  assert.equal(install(place, { release: "release-2", version: "2", env: { NO_EXTRA: "1" } }).status, 0);
  assert.ok(!existsSync(path.join(place, "store/demo/1")), "the old version is gone from the store");
  assert.equal(read(place, "release-2/.tools/bin/demo"), "demo 2\n");
  assert.ok(!existsSync(path.join(place, "release-2/.tools/bin/extra")), "what the new install doesn't make isn't linked");
  assert.equal(read(place, "release-1/.tools/bin/demo"), "demo 1\n", "the older release still has its tool");
  // A checkout installs into the same .tools again: it follows the new version.
  assert.equal(install(place, { version: "2", env: { NO_EXTRA: "1" } }).status, 0);
  assert.equal(runs(place), 2);
  assert.equal(read(place, "release-1/.tools/bin/demo"), "demo 2\n");
  assert.ok(!existsSync(path.join(place, "release-1/.tools/bin/extra")));
}));

test("a published Mercbot's Prepare keeps the store in its home's cache, which outlives releases", () => {
  const prepare = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts["deploy:prepare"];
  assert.equal(prepare, 'npm ci --include=dev && MERCBOT_TOOLS_STORE="${MERCBOT_TOOLS_STORE:-$HOME/.cache/mercbot-tools}" npm run tools:install');
  const lines = (file) => readFileSync(path.join(ROOT, file), "utf8").split("\n");
  for (const file of ["scripts/install-tools.sh", "scripts/build-toolbox.sh"]) {
    assert.ok(lines(file).includes('. "$ROOT/scripts/tools-store.sh"'), file);
  }
  assert.ok(lines("scripts/tools-store.sh").includes('STORE="${MERCBOT_TOOLS_STORE:-$TOOLS/store}"'));
});

// The toolbox's stamp (scripts/build-toolbox.sh) says which package list a store's toolbox was built from. en_US.UTF-8
// orders that list differently from C, so a stamp sorted in the locale made a toolbox built from a terminal look stale
// to a Prepare without a locale, which built the same toolbox again (25 to 40 minutes).
test("the toolbox's stamp is the same in every locale", (t) => {
  const installed = spawnSync("locale", ["-a"], { encoding: "utf8" }).stdout || "";
  if (!/^en_US\.utf-?8$/imu.test(installed)) return t.skip("en_US.UTF-8 isn't installed here, so there's no other order to compare");
  const lines = readFileSync(path.join(ROOT, "scripts/build-toolbox.sh"), "utf8").split("\n");
  const computed = lines.slice(lines.findIndex((line) => line.startsWith("BASE_RELEASE=")), lines.findIndex((line) => line.startsWith("STAMP=")) + 1);
  const stamp = (locale) => spawnSync("bash", ["-c", `${computed.join("\n")}\nprintf '%s' "$STAMP"`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, LANG: locale, LC_ALL: locale }
  }).stdout;
  assert.match(stamp("C"), /^ubuntu-base-\S+ r\d+ [0-9a-f]{16}$/u);
  assert.equal(stamp("en_US.UTF-8"), stamp("C"));
});
