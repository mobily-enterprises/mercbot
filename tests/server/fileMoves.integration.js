import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeDrive } from "../support/fakeDrive.mjs";
import { filesEnv, filesHandles, startFilesServer } from "../support/filesServer.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seal, unseal } from "../../packages/account/src/server/vaultCrypto.js";

// Moving a home's files when it chooses other storage (D-80, fileMoves.js): every file is copied with rclone and the
// new place made an exact copy, checked, then switched to in one write; meanwhile the files are read-only. The old copy
// goes to the Drive's bin, or is deleted on Mercbot's own storage. A move a server dies in is carried on by another; a
// cancelled or failed one leaves the home where it was. Against the disposable test database, the stand-in Drive
// (tests/support/fakeDrive.mjs, which rclone reaches through its proxy) and the toolbox's rclone; no FUSE mount.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const RCLONE = path.resolve(".tools/bin/rclone");
const SKIP = existsSync(RCLONE) ? false : "the toolbox's rclone isn't installed (npm run tools:install)";
const VAULT = randomBytes(32).toString("base64");
const VAULT_KEY = Buffer.from(VAULT, "base64");
const FOLDER = "application/vnd.google-apps.folder";
// The moves' waits, short: no settling, a beat and a sweep every 200 ms, a lease of 3 s.
const FAST = Object.freeze({ settleMs: 0, beatMs: 200, sweepMs: 200, leaseSeconds: 3 });

/** `files` as both trees list them: each file's text, and each folder (ending in "/") with null. */
function withFolders(files) {
  const tree = {};
  for (const [name, text] of Object.entries(files)) {
    const parts = name.split("/").filter(Boolean);
    for (let depth = 1; depth < parts.length; depth += 1) tree[`${parts.slice(0, depth).join("/")}/`] = null;
    tree[name] = text;
  }
  return tree;
}

const bytesOf = (files) => Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text ?? ""), 0);
const countOf = (files) => Object.values(files).filter((text) => text !== null).length;
/** `count` files in ten folders of the home's shared folder. */
const spread = (count) => Object.fromEntries(Array.from({ length: count }, (_, n) => [`shared/folder-${n % 10}/file-${n}.txt`, `File number ${n}`]));

async function writeTree(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const at = path.join(dir, name);
    if (text === null) await fs.mkdir(at, { recursive: true });
    else await fs.mkdir(path.dirname(at), { recursive: true }).then(() => fs.writeFile(at, text));
  }
}

/** A folder on disk as withFolders lists it. */
async function treeOf(dir) {
  const tree = {};
  const walk = async (at, prefix) => {
    for (const entry of await fs.readdir(at, { withFileTypes: true })) {
      const named = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        tree[`${named}/`] = null;
        await walk(path.join(at, entry.name), `${named}/`);
      } else {
        tree[named] = await fs.readFile(path.join(at, entry.name), "utf8");
      }
    }
  };
  await walk(dir, "");
  return tree;
}

/** Waits for a background move to get somewhere, for at most `ms`. */
async function until(check, why, ms = 60000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Waited ${ms / 1000} s: ${why}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function setup(context) {
  const knex = await connectTestDatabase();
  const drive = await startFakeDrive();
  const filesDir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-moves-"));
  const env = await filesEnv({ vault: VAULT, drive, filesDir });
  const [pat, kim] = (await knex("users").orderBy("id").limit(2)).map((user) => String(user.id));
  const [home] = await knex("workspaces").insert({ slug: `moves-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, name: "Moving test", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: kim, role_sid: "admin", status: "active" }
  ]);
  const handles = await filesHandles(knex, context);
  const servers = [];
  const added = [];
  context.after(async () => {
    for (const server of servers) await server.close();
    await knex("file_storage").where({ workspace_id: homeId }).del();
    await knex("plugin_accounts").whereIn("id", added).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex.destroy();
    await drive.close();
    await fs.rm(filesDir, { recursive: true, force: true });
  });

  /** One more server, sharing the database, the stand-in Drive and Mercbot's volume. */
  async function serve(timing = FAST) {
    const server = await startFilesServer({ handles, env, timing });
    servers.push(server);
    return server;
  }
  /** A Google Drive account signed in with the stand-in's keys; `fields` may make it the home's. */
  async function account(userId, label, fields = {}) {
    const { access, refresh, expiresAt } = drive.issue();
    const [row] = await knex("plugin_accounts").insert({
      user_id: userId,
      plugin_id: "google-drive",
      name: `drive-${randomBytes(4).toString("hex")}`,
      label,
      status: "connected",
      connected_at: new Date(),
      tokens: seal({ access, refresh, expiresAt, scope: "https://www.googleapis.com/auth/drive" }, VAULT_KEY),
      ...fields
    }).returning("*");
    added.push(row.id);
    return { id: String(row.id) };
  }
  const as = (userId, permissions = ["workspace.settings.update"]) =>
    requestContextOptions({ user: { id: userId }, workspace: { id: homeId, name: "Moving test" }, permissions });
  const row = () => knex("file_storage").where({ workspace_id: homeId }).first();
  const stored = async () => {
    const found = await row();
    return { kind: found.kind, settings: unseal(found.settings, VAULT_KEY) };
  };
  /** Waits until the home's move is `status`. */
  const moved = (status) => until(async () => (await row())?.move_status === status, `the move is ${status}`);
  // The home's folder on Mercbot's own storage.
  const own = path.join(filesDir, "homes", homeId);
  const uploads = () => drive.requests.filter((call) => call.startsWith("POST /upload/")).length;
  return { knex, drive, env, pat, kim, homeId, serve, account, as, row, stored, moved, own, uploads };
}

test("every switch copies all the home's files and makes the new place an exact copy of them; the old copy goes", { skip: SKIP }, async (context) => {
  const { knex, drive, pat, kim, homeId, serve, account, as, stored, moved, own } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const homeDrive = await account(kim, "family@example.com", { workspace_id: homeId });
  // Mercbot's folder in the home's Drive from before, which it remembers: a file that's no longer the home's, and one
  // of the same size and time as the home's own but other text, which a copy going by size and time would skip.
  const old = drive.add({ name: "Mercbot – Moving test", mimeType: FOLDER, parents: ["root"] });
  const oldShared = drive.add({ name: "shared", mimeType: FOLDER, parents: [old.id] });
  const when = new Date("2026-11-01T10:00:00Z");
  drive.add({ name: "notes.txt", parents: [oldShared.id], data: "Shoppinz", modifiedTime: when.toISOString() });
  drive.add({ name: "stale.txt", parents: [oldShared.id], data: "From before" });
  await knex("file_storage").insert({ workspace_id: homeId, kind: "mercbot", settings: seal({ driveFolders: { [homeDrive.id]: old.id } }, VAULT_KEY) });
  const files = {
    "shared/notes.txt": "Shopping",
    "shared/Invoices/march.pdf": "%PDF-1.7 march",
    "shared/Empty/": null,
    "bots/7/everyone/report.md": "# Report",
    "bots/7/people/9/diary.txt": "Dear diary"
  };
  await writeTree(own, files);
  await fs.utimes(path.join(own, "shared/notes.txt"), when, when);

  // Mercbot's storage → the home's Drive. When the move starts the files are read-only: read, not written.
  const server = await serve();
  const seen = [];
  let release = null;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  server.moves.whenStarting(async (id) => {
    const place = server.store.homePlace(id);
    seen.push(await server.store.prepare(place).then(() => "written", (error) => error.code));
    seen.push(await server.store.prepare(place, { reading: true }).then(() => "read", (error) => error.code));
    await held;
  });
  const started = await server.storage.choose(homeId, { kind: "drive", accountId: homeDrive.id }, as(pat));
  assert.deepEqual([started.kind, started.move.status, started.move.from.label, started.move.to.label], ["mercbot", "running", "Mercbot", "Google Drive (family@example.com)"]);
  await assert.rejects(server.storage.choose(homeId, { kind: "mercbot" }, as(kim)), { code: "files_storage_move_going" }, "one move at a time");
  await until(() => seen.length === 2, "the move started");
  assert.deepEqual(seen, ["files_storage_moving", "read"]);
  release();
  await moved("done");
  const first = await stored();
  assert.deepEqual([first.kind, first.settings.accountId, first.settings.folderId], ["drive", homeDrive.id, old.id], "Mercbot's folder there, as remembered");
  assert.deepEqual(drive.tree(old.id), withFolders(files), "exactly the home's files, the same-size file overwritten");
  assert.deepEqual(drive.tree(old.id, { bin: true }), { "shared/stale.txt": "From before" }, "what was there before went to the Drive's bin");
  assert.equal(existsSync(own), false, "Mercbot's own copy was deleted");
  const done = (await server.storage.describe(as(pat))).move;
  assert.deepEqual([done.status, done.files, done.bytes, done.filesDone, done.bytesDone], ["done", countOf(files), bytesOf(files), countOf(files), bytesOf(files)]);

  // The home's Drive → Pat's own, with a file the bots made in the Drive meanwhile. The home's Drive folder goes to
  // its bin, with everything in it, never deleted.
  drive.add({ name: "new.txt", parents: [oldShared.id], data: "Made in Drive" });
  const now = { ...files, "shared/new.txt": "Made in Drive" };
  await server.storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  await moved("done");
  const second = await stored();
  assert.deepEqual([second.kind, second.settings.accountId, second.settings.driveFolders[homeDrive.id]], ["drive", patDrive.id, old.id]);
  assert.deepEqual(drive.tree(second.settings.folderId), withFolders(now));
  assert.equal(drive.files.get(old.id).trashed, true);
  assert.deepEqual(drive.tree(old.id), {});
  assert.deepEqual(drive.tree(old.id, { bin: true }), { ...withFolders(now), "shared/stale.txt": "From before" });

  // Pat's Drive → Mercbot's storage, where something was left: the home's folder there is made the exact copy.
  await writeTree(own, { "shared/leftover.txt": "Not the home's any more" });
  await server.storage.choose(homeId, { kind: "mercbot" }, as(pat));
  await moved("done");
  assert.equal((await stored()).kind, "mercbot");
  assert.deepEqual(await treeOf(own), withFolders(now));
  assert.equal(drive.files.get(second.settings.folderId).trashed, true, "Pat's Drive folder went to their bin");
  assert.equal(await server.storage.folder(homeId), null, "and the files can be written again");
});

test("a home of 1,000 files moves with Drive calls that follow the files, and nothing else per file", { skip: SKIP }, async (context) => {
  // Per file, rclone's Drive upload looks the file up by name (to update one already there) and uploads it.
  const { drive, pat, homeId, serve, account, as, stored, moved, own } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const server = await serve();
  /** Moves `count` files from Mercbot's storage to Pat's Drive: the Drive calls made, uploads, lookups and the rest. */
  async function move(count) {
    await fs.rm(own, { recursive: true, force: true });
    await writeTree(own, spread(count));
    const before = drive.requests.length;
    await server.storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
    await moved("done");
    const calls = drive.requests.slice(before);
    assert.deepEqual(drive.tree((await stored()).settings.folderId), withFolders(spread(count)));
    const uploads = calls.filter((call) => call.startsWith("POST /upload/")).length;
    const lookups = calls.filter((call) => call === "GET /drive/v3/files?name").length;
    // The other calls by kind, files' and folders' ids left out, to tell which grew.
    const kinds = {};
    for (const call of calls) {
      const kind = call.replace(/\/files\/[^/?]+/u, "/files/:id");
      kinds[kind] = (kinds[kind] || 0) + 1;
    }
    return { uploads, lookups, others: calls.length - uploads - lookups, kinds };
  }
  const small = await move(100);
  // And back, all 100 files from the Drive to Mercbot's storage.
  await server.storage.choose(homeId, { kind: "mercbot" }, as(pat));
  await moved("done");
  assert.deepEqual(await treeOf(own), withFolders(spread(100)));
  const large = await move(1000);
  assert.deepEqual([small.uploads, large.uploads], [100, 1000], "each file is sent once");
  // One lookup per file, and one per folder made.
  assert.ok(small.lookups <= 100 + 20 && large.lookups <= 1000 + 20, `${large.lookups} lookups for 1,000 files, ${small.lookups} for 100`);
  // The rest (listing the ten folders, making them, the checks) is the same for ten times the files.
  assert.ok(large.others <= small.others + 10, `${large.others} other Drive calls for 1,000 files, ${small.others} for 100: ${JSON.stringify(large.kinds)} against ${JSON.stringify(small.kinds)}`);
});

test("a server killed in the middle of a move: another server carries it on, and the copy is exact", { skip: SKIP }, async (context) => {
  const { drive, env, pat, homeId, serve, account, row, stored, moved, own, uploads } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const files = spread(200);
  await writeTree(own, files);
  drive.state.uploadDelay = 20;
  // The other server, in a process of its own, starts the move; it and its rclone are killed while it copies.
  const timing = { ...FAST, leaseSeconds: 2 };
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const other = spawn(process.execPath, [
    path.resolve("tests/support/moveServer.mjs"),
    JSON.stringify({ env, homeId, userId: pat, choice: { kind: "drive", accountId: patDrive.id }, timing })
  ], { detached: true, stdio: ["ignore", "ignore", "inherit"], env: childEnv });
  const exited = new Promise((resolve) => other.once("exit", resolve));
  context.after(() => {
    if (other.exitCode === null && other.signalCode === null) process.kill(-other.pid, "SIGKILL");
  });
  await until(() => uploads() >= 40, "the other server is copying");
  const { move: before } = await row();
  process.kill(-other.pid, "SIGKILL");
  await exited;
  drive.state.uploadDelay = 0;
  const killed = await row();
  assert.deepEqual([killed.kind, killed.move_status], ["mercbot", "running"], "the home stays where it was meanwhile");

  // This server's sweep takes the move once the other's lease runs out, and carries it on to the end.
  const server = await serve(timing);
  server.moves.startSweeping();
  await moved("done");
  const after = await row();
  assert.equal(after.move.id, before.id, "the same move, carried on");
  const { settings } = await stored();
  assert.equal(settings.accountId, patDrive.id);
  assert.deepEqual(drive.tree(settings.folderId), withFolders(files), "every file once, none twice");
  const names = [...drive.files.values()].filter((file) => !file.trashed).map((file) => `${file.parents[0]}/${file.name}`);
  assert.equal(new Set(names).size, names.length, "no file was made twice");
  assert.equal(existsSync(own), false);
});

test("a cancelled or failed move leaves the home where it was, and its copy goes to the Drive's bin", { skip: SKIP }, async (context) => {
  const { drive, pat, homeId, serve, account, as, stored, moved, own, uploads } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const server = await serve();
  const files = spread(40);
  await writeTree(own, files);
  const copies = () => [...drive.files.values()].filter((file) => file.name === "Mercbot – Moving test");

  // Cancelled while it copies.
  drive.state.uploadDelay = 100;
  await server.storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  await until(() => uploads() >= 4, "the copy is under way");
  await server.storage.cancelMove(homeId, as(pat));
  await moved("cancelled");
  drive.state.uploadDelay = 0;
  assert.equal((await stored()).kind, "mercbot");
  assert.deepEqual(await treeOf(own), withFolders(files), "the home's files as they were");
  assert.equal(await server.storage.folder(homeId), null, "and writable again");
  assert.deepEqual(copies().map((copy) => copy.trashed), [true], "the copy went to the Drive's bin");
  await assert.rejects(server.storage.cancelMove(homeId, as(pat)), { code: "files_storage_move_none" });
  assert.equal((await server.storage.describe(as(pat))).move.status, "cancelled");

  // Failed: the Drive is full. It says why, and the home stays.
  drive.state.quota = [...drive.files.values()].reduce((sum, file) => sum + (file.data?.length || 0), 0) + 30;
  await server.storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  await moved("failed");
  const failed = (await server.storage.describe(as(pat))).move;
  assert.deepEqual([failed.error, failed.sourceUnreadable], ["There isn't enough space in the new place for this home's files.", false]);
  assert.equal((await stored()).kind, "mercbot");
  assert.deepEqual(await treeOf(own), withFolders(files));
  assert.deepEqual(copies().map((copy) => copy.trashed), [true, true]);
});

test("a command started before the move is waited for, and a copy that differs is copied again", { skip: SKIP }, async (context) => {
  const { knex, drive, pat, homeId, serve, account, as, row, stored, moved, own } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const server = await serve();
  const files = spread(20);
  await writeTree(own, files);
  const [bot] = await knex("bots").insert({ user_id: pat, workspace_id: homeId, name: "Tess", color: "#1E86FC" }).returning("id");
  const command = await server.runs.begin(homeId, { botId: bot.id ?? bot, conversationId: null, userId: pat, why: "Making a report", script: "make-report", server: "elsewhere" });

  await server.storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  await until(async () => (await row()).move?.stage === "commands", "the move waits for the command", 30000);
  // The command still writes, then ends: the move copies what changed again.
  await writeTree(own, { "shared/report.txt": "The report" });
  await server.runs.finish(command, { status: "done", exitCode: 0, output: "", changed: [] });
  await moved("done");
  assert.deepEqual(drive.tree((await stored()).settings.folderId), withFolders({ ...files, "shared/report.txt": "The report" }));
});

test("whose own Google Drive holds the home's files: the person's account while the files move in and once they're there", { skip: SKIP }, async (context) => {
  const { pat, kim, homeId, serve, account, as, moved } = await setup(context);
  const kimDrive = await account(kim, "kim@example.com");
  const homeDrive = await account(pat, "family@example.com", { workspace_id: homeId });
  const server = await serve();
  const held = (userId) => server.storage.heldInTheirDrive(homeId, userId);

  // On Mercbot's own storage the files are nobody's.
  assert.equal(await held(kim), null);
  // While the files move into Kim's Drive, and once they're there, they're Kim's; never Pat's.
  let release = null;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  server.moves.whenStarting(() => waiting);
  await server.storage.choose(homeId, { kind: "drive", accountId: kimDrive.id }, as(kim));
  assert.deepEqual(await held(kim), { account: "kim@example.com", moving: true, into: true });
  assert.equal(await held(pat), null);
  release();
  await moved("done");
  assert.deepEqual(await held(kim), { account: "kim@example.com", moving: false, into: false });
  assert.equal(await held(pat), null);

  // In the home's own Drive account, which Pat added, the files are nobody's.
  await server.storage.choose(homeId, { kind: "drive", accountId: homeDrive.id }, as(pat));
  await moved("done");
  assert.equal(await held(pat), null);
  assert.equal(await held(kim), null);
});
