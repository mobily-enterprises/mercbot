import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The `mercbot` command on a person's own computer (D-81; docs/standalone-plan.md, change 7), run as the person would,
// with stand-ins for systemd, PostgreSQL's tools, npm and the browser that write down how they were called.
const MERCBOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/mercbot");
const KEY = "ab".repeat(32);
const DB_PASSWORD = "stand-in-database-password";

const STAND_INS = {
  systemctl: `echo "systemctl $*" >>"$CALLS"
case "$*" in
  *is-active*) [ -z "\${NEVER_ACTIVE:-}" ] && [ -e "$STATE/active" ] ;;
  *enable*|*restart*) touch "$STATE/active" ;;
  *disable*|*stop*) rm -f "$STATE/active" ;;
esac`,
  pg_dump: `echo "pg_dump $* password:\${PGPASSWORD:+set}" >>"$CALLS"
for arg; do case "$arg" in --file=*) echo "the database at $(cat "$STATE/database")" >"\${arg#--file=}" ;; esac; done`,
  psql: 'echo "psql $*" >>"$CALLS"',
  pg_restore: `echo "pg_restore $* password:\${PGPASSWORD:+set}" >>"$CALLS"
for arg; do last="$arg"; done
cat "$last" >"$STATE/database"`,
  npm: `echo "npm $* in $PWD" >>"$CALLS"
[ "$*" != "run --silent db:migrate" ] || exit "\${MIGRATE_STATUS:-0}"`,
  "xdg-open": 'echo "xdg-open $*" >>"$CALLS"'
};

const ENABLE = "systemctl --user --quiet enable --now mercbot.service";
const IS_ACTIVE = "systemctl --user is-active --quiet mercbot.service";

/**
 * The calls without those of start's wait: until Mercbot answers its health check, start asks systemd every second
 * whether it still runs, so a busy computer, where Mercbot answers later, makes more of them.
 */
const withoutWaiting = (calls) => calls.filter((call, index) => call !== IS_ACTIVE || !calls.slice(0, index).includes(ENABLE));

/** A person's computer with Mercbot 0.1.0 installed, and its health check answering while `healthy` is true. */
async function computer(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), "mercbot-command-"));
  const home = path.join(root, "mercbot");
  const state = path.join(root, "state");
  const shims = path.join(root, "bin");
  for (const dir of [state, shims, path.join(home, "releases", "0.1.0"), path.join(home, "data", "files")]) mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(STAND_INS)) writeFileSync(path.join(shims, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  symlinkSync("releases/0.1.0", path.join(home, "current"));
  writeFileSync(path.join(home, "data", "mercbot.key"), `${KEY}\n`, { mode: 0o600 });
  writeFileSync(path.join(home, "data", "files", "notes.txt"), "a person's file");
  writeFileSync(path.join(state, "database"), "0.1.0's data");

  const server = { healthy: true };
  const health = http.createServer((request, response) => response.writeHead(request.url === "/api/health" && server.healthy ? 200 : 503).end());
  await new Promise((resolve) => health.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    health.close();
    rmSync(root, { recursive: true, force: true });
  });
  const address = `http://127.0.0.1:${health.address().port}`;
  writeFileSync(path.join(home, "mercbot.env"), [
    "# Mercbot's settings",
    `APP_PUBLIC_URL=${address}`,
    "DB_HOST=127.0.0.1",
    "DB_NAME=mercbot",
    "DB_USER=mercbot",
    `DB_PASSWORD="${DB_PASSWORD}"`,
    `MERCBOT_VAULT_KEY=${"cd".repeat(32)}`,
    "SHOWN=$(touch ran) `touch ran`",
    ""
  ].join("\n"), { mode: 0o600 });

  /** Runs `mercbot ...args` as the person, answering its status, output and the stand-ins' calls. */
  const mercbot = (args, env = {}) => new Promise((resolve) => {
    writeFileSync(path.join(state, "calls"), "");
    execFile("bash", [MERCBOT, ...args], {
      cwd: root,
      env: { PATH: `${shims}:${process.env.PATH}`, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), MERCBOT_HOME: home, CALLS: path.join(state, "calls"), STATE: state, ...env }
    }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr, calls: readFileSync(path.join(state, "calls"), "utf8").trim().split("\n").filter(Boolean) }));
  });
  const running = (yes) => (yes ? writeFileSync(path.join(state, "active"), "") : rmSync(path.join(state, "active"), { force: true }));
  return { root, home, state, address, server, mercbot, running };
}

test("start installs the service on this release and waits for Mercbot; status and stop say where it is", async (context) => {
  const { root, home, address, server, mercbot } = await computer(context);
  const started = await mercbot(["start"]);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stdout, `Mercbot is running at ${address}. Open it with: mercbot open\n`);
  assert.deepEqual(withoutWaiting(started.calls), ["systemctl --user daemon-reload", ENABLE]);
  const unit = readFileSync(path.join(root, "config", "systemd", "user", "mercbot.service"), "utf8");
  for (const line of [`WorkingDirectory=${home}/current`, `EnvironmentFile=${home}/mercbot.env`, "ExecStart=/bin/bash scripts/serve.sh", "KillMode=mixed"]) {
    assert.ok(unit.split("\n").includes(line), line);
  }
  // The settings are read, never run.
  assert.equal(existsSync(path.join(root, "ran")), false);

  assert.deepEqual([(await mercbot(["status"])).stdout, (await mercbot(["status"])).status], [`Mercbot 0.1.0 is running at ${address}.\n`, 0]);
  server.healthy = false;
  const starting = await mercbot(["status"]);
  assert.equal(starting.status, 1);
  assert.match(starting.stdout, /^Mercbot is starting, or isn't answering at .+ See why with: journalctl --user -u mercbot\.service -n 50\n$/u);
  const stopped = await mercbot(["stop"]);
  assert.deepEqual([stopped.stdout, stopped.calls], ["Mercbot has stopped. Start it again with: mercbot start\n", ["systemctl --user --quiet disable --now mercbot.service"]]);
  assert.deepEqual([(await mercbot(["status"])).status, (await mercbot(["status"])).stdout], [3, "Mercbot isn't running. Start it with: mercbot start\n"]);

  // A start that dies says where to look.
  const died = await mercbot(["start"], { NEVER_ACTIVE: "1" });
  assert.equal(died.status, 1);
  assert.match(died.stderr, /^Mercbot stopped while starting\. See why with: journalctl/u);
});

test("open takes the browser in with the key, through a page only the person can read; new-key signs everyone out", async (context) => {
  const { home, address, server, mercbot, running } = await computer(context);
  const page = path.join(home, "data", "open.html");
  const opened = await mercbot(["open"]);
  assert.equal(opened.status, 0, opened.stderr);
  assert.equal(opened.stdout, "Mercbot is opening in your browser.\n");
  assert.deepEqual(opened.calls, [`xdg-open ${page}`], "the key is on no command line");
  assert.equal(statSync(page).mode & 0o777, 0o600);
  assert.match(readFileSync(page, "utf8"), new RegExp(`<meta http-equiv="refresh" content="0;url=${address}/open\\?key=${KEY}">`, "u"));

  server.healthy = false;
  assert.match((await mercbot(["open"])).stderr, /^Mercbot isn't running\. Start it with: mercbot start\n$/u);

  running(true);
  server.healthy = true;
  const renewed = await mercbot(["new-key"]);
  assert.equal(renewed.status, 0, renewed.stderr);
  assert.equal(renewed.stdout, "Mercbot has a new key, and every browser is signed out. Open it again with: mercbot open\n");
  assert.ok(renewed.calls.includes("systemctl --user restart mercbot.service"), "Mercbot restarts to read it");
  const key = readFileSync(path.join(home, "data", "mercbot.key"), "utf8");
  assert.match(key, /^[0-9a-f]{64}\n$/u);
  assert.notEqual(key.trim(), KEY);
  assert.equal(statSync(path.join(home, "data", "mercbot.key")).mode & 0o777, 0o600);
  assert.equal(existsSync(page), false, "the old key's page goes");

  writeFileSync(path.join(home, "data", "mercbot.key"), "not a key\n");
  assert.match((await mercbot(["open"])).stderr, /^Mercbot has no key yet/u);
});

test("a backup holds the database, the data and the settings, for the person alone; restore brings them back", async (context) => {
  const { home, state, mercbot, running } = await computer(context);
  const archive = path.join(home, "kept.tar.gz");
  writeFileSync(path.join(home, "data", "open.html"), "the key's page");
  const saved = await mercbot(["backup", archive]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.match(saved.stdout, /It holds the vault key and Mercbot's key: keep it where only you can read it\.\n$/u);
  assert.equal(statSync(archive).mode & 0o777, 0o600);
  assert.equal(saved.calls.length, 1);
  assert.match(saved.calls[0], /^pg_dump --format=custom --no-owner --file=\S+ password:set$/u);
  assert.ok(!saved.calls[0].includes(DB_PASSWORD), "the password goes by the environment");
  const listed = await new Promise((resolve) => execFile("tar", ["-tzf", archive], (_error, stdout) => resolve(stdout.split("\n").filter(Boolean).sort())));
  for (const part of ["version", "mercbot.env", "KEEP-THIS-SAFE.txt", "database.dump", "data/mercbot.key", "data/files/notes.txt"]) {
    assert.ok(listed.includes(part), part);
  }
  assert.ok(!listed.some((name) => name.endsWith("open.html")), "the key's page stays out");

  // Later: other data, other settings, this computer's database password changed.
  writeFileSync(path.join(state, "database"), "later data");
  writeFileSync(path.join(home, "data", "files", "notes.txt"), "changed later");
  writeFileSync(path.join(home, "mercbot.env"), readFileSync(path.join(home, "mercbot.env"), "utf8")
    .replace(`DB_PASSWORD="${DB_PASSWORD}"`, "DB_PASSWORD=this-computer").replace("MERCBOT_VAULT_KEY=", "MERCBOT_VAULT_KEY=changed"));
  running(true);
  const restored = await mercbot(["restore", archive]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(readFileSync(path.join(state, "database"), "utf8"), "the database at 0.1.0's data\n");
  assert.equal(readFileSync(path.join(home, "data", "files", "notes.txt"), "utf8"), "a person's file");
  const settings = readFileSync(path.join(home, "mercbot.env"), "utf8");
  assert.match(settings, new RegExp(`^MERCBOT_VAULT_KEY=${"cd".repeat(32)}$`, "mu"), "the backup's vault key");
  assert.match(settings, /^DB_PASSWORD=this-computer$/mu, "this computer's database settings");
  assert.doesNotMatch(settings, new RegExp(DB_PASSWORD, "u"));
  assert.equal(statSync(path.join(home, "mercbot.env")).mode & 0o777, 0o600);
  const before = restored.stdout.match(/kept as (\S+) and (\S+)\.\n/u);
  assert.equal(readFileSync(path.join(before[1], "files", "notes.txt"), "utf8"), "changed later", "what was there is kept");
  assert.match(readFileSync(before[2], "utf8"), /MERCBOT_VAULT_KEY=changed/u);
  assert.deepEqual(restored.calls.filter((call) => !call.startsWith("systemctl")).map((call) => call.replace(/ \/\S+\/database\.dump /u, " … ")), [
    "psql --quiet --no-psqlrc -v ON_ERROR_STOP=1 -c DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    "pg_restore --no-owner --no-privileges --exit-on-error --dbname=mercbot … password:set",
    `npm run --silent db:migrate in ${path.join(home, "current")}`
  ]);
  assert.ok(restored.calls.includes("systemctl --user --quiet enable --now mercbot.service"), "it was running, so it runs again");

  assert.match((await mercbot(["restore", path.join(home, "mercbot.env")])).stderr, /can't be read as a backup\.\n$/u);
});

/** A release archive of Mercbot `version`, in one folder as releases come. */
function release(root, version) {
  const folder = path.join(root, `build-${version}`, `mercbot-${version}`);
  mkdirSync(path.join(folder, "scripts"), { recursive: true });
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "account-app", version }));
  writeFileSync(path.join(folder, "scripts", "mercbot"), "");
  const archive = path.join(root, `mercbot-${version}.tar.gz`);
  return new Promise((resolve, reject) => execFile("tar", ["-czf", archive, "-C", path.dirname(folder), path.basename(folder)], (error) => (error ? reject(error) : resolve(archive))));
}

test("upgrade prepares the new release beside the old, backs up, migrates and switches; a failed migration changes nothing", async (context) => {
  const { root, home, state, mercbot, running } = await computer(context);
  mkdirSync(path.join(home, "releases", "0.0.9"));
  running(true);
  const failed = await mercbot(["upgrade", await release(root, "0.2.0")], { MIGRATE_STATUS: "1" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Mercbot 0\.2\.0 couldn't migrate the database, so the database is as it was and Mercbot 0\.1\.0 runs on\.\n$/u);
  assert.equal(readlinkSync(path.join(home, "current")), "releases/0.1.0");
  assert.ok(failed.calls.some((call) => call.startsWith("pg_restore")), "the database is put back");
  assert.equal(withoutWaiting(failed.calls).at(-1), ENABLE, "and Mercbot started again");

  writeFileSync(path.join(state, "database"), "0.1.0's data");
  const upgraded = await mercbot(["upgrade", await release(root, "0.2.0")]);
  assert.equal(upgraded.status, 0, upgraded.stderr);
  const next = path.join(home, "releases", "0.2.0");
  assert.deepEqual(withoutWaiting(upgraded.calls).filter((call) => !call.startsWith("systemctl --user daemon-reload")).map((call) => call.replace(/--file=\S+/u, "--file=…")), [
    `npm run --silent deploy:prepare in ${next}`,
    `npm run --silent build in ${next}`,
    IS_ACTIVE,
    "systemctl --user stop mercbot.service",
    "pg_dump --format=custom --no-owner --file=… password:set",
    `npm run --silent db:migrate in ${next}`,
    ENABLE
  ]);
  assert.equal(readlinkSync(path.join(home, "current")), "releases/0.2.0");
  assert.ok(existsSync(path.join(home, "releases", "0.1.0")), "the release before is kept");
  assert.equal(existsSync(path.join(home, "releases", "0.0.9")), false, "older ones go");
  const backup = upgraded.stdout.match(/to go back to it, mercbot restore (\S+)\n/u)[1];
  assert.match(path.basename(backup), /^mercbot-0\.1\.0-\d{8}-\d{6}\.tar\.gz$/u);

  // Going back: the backup from before the upgrade brings back its release too.
  const back = await mercbot(["restore", backup]);
  assert.equal(back.status, 0, back.stderr);
  assert.equal(readlinkSync(path.join(home, "current")), "releases/0.1.0");
  assert.ok(back.calls.includes(`npm run --silent db:migrate in ${path.join(home, "current")}`));

  assert.match((await mercbot(["upgrade", await release(root, "0.1.0")])).stdout, /^Mercbot is already at 0\.1\.0\.\n$/u);
  const older = await mercbot(["upgrade", await release(root, "0.0.8")]);
  assert.equal(older.status, 1);
  assert.match(older.stderr, /is Mercbot 0\.0\.8, older than this copy's 0\.1\.0\. To go back, restore the backup made before the upgrade\.\n$/u);
});

test("the settings are NAME=value lines: anything else stops the command without showing the line", async (context) => {
  const { home, mercbot } = await computer(context);
  writeFileSync(path.join(home, "mercbot.env"), `APP_PUBLIC_URL=http://localhost:3001\nexport ${DB_PASSWORD}\n`);
  const refused = await mercbot(["status"]);
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, `Line 2 of Mercbot's settings (${home}/mercbot.env) isn't NAME=value.\n`);
  assert.equal((await mercbot(["nothing"])).status, 2);
});
