import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { driveStandIn } from "../../packages/files/src/server/driveStorage.js";
import { answerDriveToken, registerDriveTokenRoute } from "../../packages/files/src/server/driveTokenRoute.js";
import { createRemoteMounts } from "../../packages/files/src/server/remoteMounts.js";
import { startFakeDrive } from "../support/fakeDrive.mjs";

// A home's files kept in Google Drive (D-80), mounted for real: rclone's Drive backend against the stand-in Drive
// (tests/support/fakeDrive.mjs, reached through its proxy and test authority), asking this server's own route for each
// key. Listing, upload (small, and big in resumable chunks), download, rename and delete reach the Drive folder; while
// the account needs signing in again rclone is refused a key and keeps the save, which arrives once it's signed in. A
// key Drive turns down before it runs out (access removed in Google) is renewed at once, once, from rclone's log; until
// a renewal works or the account is signed in again, settling the home's saves doesn't wait for them.
// Needs the toolbox's rclone (npm run tools:install), FUSE this user may mount with, and openssl.
const RCLONE = path.resolve(".tools/bin/rclone");
const has = (command) => spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;

/** Whether this user may mount with FUSE here (a host may refuse it): rclone mounts an empty folder for a moment. */
function fuseAllowed() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mercbot-fuse-"));
  try {
    for (const name of ["from", "to"]) mkdirSync(path.join(dir, name));
    const args = ["mount", path.join(dir, "from"), path.join(dir, "to"), "--config", "/dev/null", "--daemon", "--daemon-wait", "5s"];
    const mounted = spawnSync(RCLONE, args, { timeout: 15000 });
    if (mounted.status !== 0) return false;
    spawnSync("fusermount3", ["-uz", path.join(dir, "to")]);
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ready = existsSync(RCLONE) && existsSync("/dev/fuse") && has("fusermount3") && has("openssl") && fuseAllowed();
const FOLDER = "application/vnd.google-apps.folder";

/** A Drive call on the stand-in's own address, with a key it handed out. */
async function driveCall(drive, route, init = {}) {
  const response = await fetch(`${drive.url}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${drive.issue().access}`, ...init.headers }
  });
  return response.json();
}

/** Mercbot's folder in the stand-in Drive, as driveStorage.js makes it, and the settings a home keeps for it. */
async function mercbotFolder(drive) {
  const folder = await driveCall(drive, "/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mercbot – Test home", mimeType: FOLDER })
  });
  return { folder, settings: { kind: "drive", accountId: "41", userId: "7", label: "pat@example.com", folderId: folder.id, folderName: folder.name } };
}

/**
 * The stand-in Drive, this server's key route and the mounts, all closed after the test. `driveKey(drive, homeId,
 * settings, why)` stands for storageSettings.driveKey; `answers` are the key route's status codes, one per key rclone
 * asked for.
 */
async function mountedDrive(context, driveKey, { keySeconds } = {}) {
  const drive = await startFakeDrive();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-drive-mount-"));
  const server = Fastify();
  const answers = [];
  server.addHook("onResponse", async (request, reply) => {
    if (request.url.startsWith("/api/files/drive-token")) answers.push(reply.statusCode);
  });
  const mounts = createRemoteMounts({
    env: { ...process.env, MERCBOT_TEST_GOOGLE_DRIVE_URL: drive.url, MERCBOT_TEST_GOOGLE_DRIVE_PROXY: drive.proxy, MERCBOT_TEST_GOOGLE_DRIVE_CA: drive.caFile },
    dataDir,
    driveKey: (...args) => driveKey(drive, ...args),
    keySeconds
  });
  await registerDriveTokenRoute(server, mounts);
  await server.listen({ host: "127.0.0.1", port: 0 });
  context.after(async () => {
    await mounts.closeAll();
    await server.close();
    await drive.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  mounts.listening(server.server.address());
  return { drive, server, mounts, answers };
}

const signInAgain = () => Object.assign(new Error("Sign in again."), { code: "files_storage_sign_in_again" });
const asKey = ({ access, expiresAt }) => ({ accessToken: access, expiresAt });

/** Waits until `check` holds, for at most `ms`. */
async function until(check, ms, why) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, why);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test("the token route answers only this machine's own key requests, as a token endpoint does", async () => {
  const mounts = { token: async (key) => ({ access_token: `for-${key}`, token_type: "Bearer", expires_in: 300 }) };
  const form = { grant_type: "refresh_token", refresh_token: "mount-key" };
  const ask = (request) => answerDriveToken(mounts, { socket: { remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" }, headers: {}, form, ...request });
  assert.deepEqual(await ask({}), { status: 200, body: { access_token: "for-mount-key", token_type: "Bearer", expires_in: 300 } });
  assert.equal((await ask({ socket: { remoteAddress: "10.1.2.3", localAddress: "10.1.2.3" } })).status, 200, "the server's own address");
  assert.deepEqual(await ask({ socket: { remoteAddress: "203.0.113.5", localAddress: "10.1.2.3" } }), { status: 403, body: { error: "access_denied" } });
  assert.equal((await ask({ headers: { "x-forwarded-for": "203.0.113.5" } })).status, 403, "came through the proxy");
  assert.equal((await ask({ headers: { forwarded: "for=203.0.113.5" } })).status, 403, "came through the proxy");
  assert.deepEqual(await ask({ form: { grant_type: "authorization_code", code: "x" } }), { status: 400, body: { error: "unsupported_grant_type" } });
});

// The app's own hooks finish a reply later (@fastify/cookie's onSend), and a route that sends without returning the
// reply is answered a second time: in a Test Preview each key rclone asked for logged a 500 and "Reply was already sent".
test("the token route answers each key request once, with the app's later-finishing hooks", async (context) => {
  const logged = [];
  const server = Fastify({ logger: { level: "warn", stream: { write: (line) => void logged.push(JSON.parse(line).msg) } } });
  context.after(() => server.server.listening && server.close());
  server.addHook("onSend", async (_request, _reply, payload) => {
    await new Promise((resolve) => setImmediate(resolve));
    return payload;
  });
  await registerDriveTokenRoute(server, { token: async (key) => ({ access_token: `for-${key}`, token_type: "Bearer", expires_in: 300 }) });
  // Over a real connection, as rclone asks: Fastify sends a second time only to a request with a socket.
  const origin = await server.listen({ host: "127.0.0.1", port: 0 });
  const answer = await fetch(`${origin}/api/files/drive-token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=mount-key"
  });
  assert.deepEqual([answer.status, await answer.json()], [200, { access_token: "for-mount-key", token_type: "Bearer", expires_in: 300 }]);
  await server.close();
  assert.deepEqual(logged, []);
});

test("the stand-in Drive, its proxy and its test authority are never used in production", () => {
  const standIn = { MERCBOT_TEST_GOOGLE_DRIVE_URL: "http://127.0.0.1:9", MERCBOT_TEST_GOOGLE_DRIVE_PROXY: "http://127.0.0.1:8", MERCBOT_TEST_GOOGLE_DRIVE_CA: "/tmp/ca.pem" };
  assert.deepEqual(driveStandIn(standIn), { url: "http://127.0.0.1:9", proxy: "http://127.0.0.1:8", ca: "/tmp/ca.pem" });
  assert.equal(driveStandIn({ ...standIn, NODE_ENV: "production" }), null);
  assert.equal(driveStandIn({}), null);
});

const SKIP = ready ? false : "rclone (npm run tools:install), FUSE or openssl isn't installed, or this host refuses FUSE mounts";

test("a Google Drive folder is mounted: listed, saved to, read, renamed and deleted, and a refused key loses nothing", { skip: SKIP }, async (context) => {
  // The account's key, as driveStorage.js gives it: a short one, so rclone asks for each call; refused while the
  // account needs signing in again.
  let signedOut = false;
  const asked = [];
  const { drive, server, mounts, answers } = await mountedDrive(context, async (standIn, homeId, settings) => {
    asked.push([homeId, settings.accountId]);
    if (signedOut) throw signInAgain();
    return asKey(standIn.issue(2));
  });

  // An unknown mount's key is refused, through the real route and its form parser.
  const unknown = await server.inject({
    method: "POST",
    url: "/api/files/drive-token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "grant_type=refresh_token&refresh_token=nobody"
  });
  assert.deepEqual([unknown.statusCode, unknown.json(), unknown.headers["cache-control"]], [400, { error: "invalid_grant" }, "no-store"]);
  answers.length = 0;

  // Mercbot's folder in the person's Drive, with a file the person put there themselves.
  const { folder, settings } = await mercbotFolder(drive);
  const boundary = "mercbot-test";
  await driveCall(drive, "/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body: [
      `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify({ name: "from-pat.txt", parents: [folder.id] }),
      `--${boundary}`, "Content-Type: text/plain", "", "Pat wrote this in Drive.", `--${boundary}--`, ""
    ].join("\r\n")
  });

  const dir = await mounts.folder("3", settings);
  assert.ok(existsSync(dir));
  assert.deepEqual(asked[0], ["3", "41"], "the mount asks for the home's account's key");

  // Listing and download: what the person put there.
  assert.deepEqual(await fs.readdir(dir), ["from-pat.txt"]);
  assert.equal(await fs.readFile(path.join(dir, "from-pat.txt"), "utf8"), "Pat wrote this in Drive.");

  // Upload: a small file in one request, a big one (over rclone's 8 MB chunk) in resumable chunks, in a folder.
  const big = Buffer.alloc(9 * 1024 * 1024, 7);
  await fs.writeFile(path.join(dir, "notes.txt"), "Saved by a bot.");
  await fs.mkdir(path.join(dir, "Reports"));
  await fs.writeFile(path.join(dir, "Reports", "big.bin"), big);
  await mounts.settle("3");
  assert.deepEqual(drive.childrenOf(folder.id), ["Reports", "from-pat.txt", "notes.txt"]);
  assert.equal(drive.named("notes.txt").data.toString("utf8"), "Saved by a bot.");
  assert.equal(drive.named("big.bin").parents[0], drive.named("Reports").id);
  assert.ok(drive.named("big.bin").data.equals(big), "the big file arrives whole");
  assert.ok(drive.requests.some((request) => request.endsWith("?uploadType=resumable")), "in resumable chunks");
  assert.deepEqual(new Set(answers), new Set([200]), "every key request was answered");

  // Rename, then delete: Drive keeps a deleted file in its bin.
  await fs.rename(path.join(dir, "notes.txt"), path.join(dir, "renamed.txt"));
  await mounts.settle("3");
  assert.equal(drive.named("notes.txt"), null);
  assert.equal(drive.named("renamed.txt").data.toString("utf8"), "Saved by a bot.");
  await fs.unlink(path.join(dir, "renamed.txt"));
  await until(() => drive.named("renamed.txt") === null, 5000, "the deleted file leaves the folder");
  assert.deepEqual(drive.childrenOf(folder.id), ["Reports", "from-pat.txt"]);

  // Signed out: rclone is refused a key, and the save waits on this server instead of being lost.
  signedOut = true;
  await fs.writeFile(path.join(dir, "while-signed-out.txt"), "Kept until signed in again.");
  await until(() => answers.includes(400), 10000, "rclone asked for a key and was refused");
  assert.equal(drive.named("while-signed-out.txt"), null);

  // Signed in again: the save arrives.
  signedOut = false;
  await until(() => drive.named("while-signed-out.txt") !== null, 25000, "the waiting save arrives once signed in again");
  assert.equal(drive.named("while-signed-out.txt").data.toString("utf8"), "Kept until signed in again.");
});

test("a key Drive turns down before it runs out is renewed at once, once; a refused renewal signs the mount out at once", { skip: SKIP }, async (context) => {
  // The account's hour-long key, as storageSettings.driveKey gives it, renewed when told which key Drive turned down.
  // Once `withdrawn` (access removed in Google), Google refuses that renewal, and the account is signed out.
  let key = null;
  let withdrawn = false;
  let signedOut = false;
  const renewals = [];
  const { drive, mounts, answers } = await mountedDrive(context, async (standIn, _homeId, _settings, why = {}) => {
    if (why.refused) {
      renewals.push(why.refused);
      if (withdrawn) {
        signedOut = true;
        throw signInAgain();
      }
      if (why.refused === key.accessToken) key = asKey(standIn.issue());
    }
    if (signedOut) throw signInAgain();
    key ||= asKey(standIn.issue());
    return key;
  }, { keySeconds: 2 });
  const { settings } = await mercbotFolder(drive);
  const dir = await mounts.folder("3", settings);
  await fs.writeFile(path.join(dir, "first.txt"), "Saved with the first key.");
  await mounts.settle("3");
  assert.ok(drive.named("first.txt"));
  const first = key.accessToken;

  // Drive turns down the key, which hasn't run out: rclone's log says so, and the mount asks for a new key at once,
  // once however often rclone is turned down; the save arrives with the new key.
  drive.expire(first);
  await fs.writeFile(path.join(dir, "second.txt"), "Saved once the key was renewed.");
  await until(() => renewals.length > 0, 10000, "the mount asked to renew the key Drive turned down");
  assert.equal(renewals[0], first);
  await until(() => drive.named("second.txt") !== null, 25000, "the save arrives with the new key");
  assert.deepEqual(renewals, [first], "renewed once");

  // Access removed: the new key is turned down too and Google refuses to renew it. The mount is refused its next key
  // at once (the home says "Sign in again"), and asks no more renewals; the saves wait on this server. rclone asks for
  // a waiting save's key only when it tries that save again, 2, 4 then 8 s later, so three saves give three refusals
  // in one try.
  withdrawn = true;
  const before = answers.length;
  drive.expire(key.accessToken);
  for (const name of ["third.txt", "fourth.txt", "fifth.txt"]) await fs.writeFile(path.join(dir, name), "Kept until signed in again.");
  await until(() => renewals.length === 2, 10000, "the mount asked to renew the second key");
  await mounts.refusal("3");
  await until(() => answers.slice(before).includes(400), 10000, "rclone is refused its next key");
  await until(() => answers.slice(before).filter((status) => status === 400).length >= 3, 15000, "rclone kept asking");
  assert.equal(renewals.length, 2, "no renewal once Google refused");
  assert.equal(drive.named("third.txt"), null);

  // Nothing arrives before the account is signed in again, so a reply or a shutdown doesn't wait for it.
  const settling = Date.now();
  await mounts.settle("3");
  assert.ok(Date.now() - settling < 5000, "settling doesn't wait for saves that can't arrive");
});

test("a renewal that fails for another reason isn't tried again at once", { skip: SKIP }, async (context) => {
  let key = null;
  const renewals = [];
  const { drive, mounts, answers } = await mountedDrive(context, async (standIn, _homeId, _settings, why = {}) => {
    if (why.refused) {
      renewals.push(why.refused);
      throw new Error("Google didn't answer.");
    }
    key ||= asKey(standIn.issue());
    return key;
  }, { keySeconds: 2 });
  const { settings } = await mercbotFolder(drive);
  const dir = await mounts.folder("3", settings);
  await fs.writeFile(path.join(dir, "first.txt"), "Saved.");
  await mounts.settle("3");

  // Google doesn't answer the renewal: rclone, turned down again and again, waits for the next try. rclone tries a
  // waiting save again 2, 4 then 8 s later, so four saves turn it down four times in one try.
  drive.expire(key.accessToken);
  for (const name of ["second.txt", "third.txt", "fourth.txt", "fifth.txt"]) await fs.writeFile(path.join(dir, name), "Waits.");
  await until(() => renewals.length === 1, 10000, "the mount asked to renew the key Drive turned down");
  const asked = answers.length;
  await until(() => answers.length > asked + 3, 15000, "rclone kept trying");
  assert.equal(renewals.length, 1, "not again before the wait is over");

  // Nothing arrives before a renewal works, so a reply or a shutdown doesn't wait for it.
  const settling = Date.now();
  await mounts.settle("3");
  assert.ok(Date.now() - settling < 5000, "settling doesn't wait for saves that can't arrive");
});
