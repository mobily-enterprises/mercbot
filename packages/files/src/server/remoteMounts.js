import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { driveStandIn } from "./driveStorage.js";
import { FilesError } from "./fileStore.js";
import { ownOrigin } from "./ownMachine.js";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A person's own storage (D-26), mounted with rclone as a folder on the server that needs it, so
// the apps, the sandbox and the desktop work on it like on any other folder. Proven on
// 2026-10-25 against WebDAV, which taught three rules:
// - Saves upload one second after the app closes the file. Uploading at once breaks the apps'
//   save (write a temporary file, then rename it).
// - Before a reply is reported done, and before the server stops, Mercbot waits until rclone has
//   uploaded everything (`settle`). A machine that vanishes after that loses nothing; one that
//   vanishes before it can lose the last second of saves.
// - The control socket needs a short path, and a stale one is removed before mounting.
// Each server mounts independently; another server's changes show within about 10 seconds.
// Google Drive (D-80) is mounted the same way with rclone's Drive backend, rooted at the folder Mercbot made there.
// rclone asks this server for each key (`token`) at DRIVE_TOKEN_PATH on its own port: its refresh key is a random
// key of that mount, known only to this process, and the account's own permission stays here. Each key it gets
// lasts at most KEY_SECONDS; the mount reads the home's choice and the account's key again every CHECK_SECONDS, so it
// follows its account and the home's choice within minutes (signed out, signed in again, renewed by another server,
// the home's files kept elsewhere), and a renewed key reaches rclone within a minute.
// rclone only asks for a key once its own has run out, even when Drive turns that key down (access removed in the
// Google account): the mount hears it in rclone's log and asks for a new one at once (`keyRefused`), once per key,
// waiting longer each time a renewal fails for a reason other than Google refusing it, which signs the account out.
// Until a renewal works or the account is signed in again, the mount is `blocked`: its saves can't reach Drive, so
// `settle` doesn't wait for them.
const WRITE_BACK = "1s";
const DIR_CACHE = "10s";
const KEY_SECONDS = 60;
const CHECK_SECONDS = 240;
const RETRY_FIRST_MS = 15000;
const RETRY_MOST_MS = 300000;
export const DRIVE_TOKEN_PATH = "/api/files/drive-token";
// Why a mount's rclone is refused for good: its account needs signing in again or was removed, or it's no longer the
// home's choice. Anything else is "not now".
const REFUSED = Object.freeze(["files_storage_sign_in_again", "integrations_account_not_found", "files_storage_drive_not_chosen"]);
// What rclone logs when Drive turns its key down (Google's API library words its 401s so).
const KEY_TURNED_DOWN = /googleapi: (?:Error 401\b|got HTTP response code 401\b)/u;

// In Mercbot's own namespace (D-68, scripts/namespace.sh) the server is the namespace's root, so
// rclone mounts directly: its FUSE library mounts only through a program named fusermount3, and
// the one it finds first is the hosting script's copy without the set-user-ID bit (.tools/fuse),
// which as the namespace's root makes the mount itself, as JuiceFS does. Mounts come off with plain
// umount. The host's set-user-ID fusermount3 is for a server outside the namespace (development,
// D-49); on Ubuntu its AppArmor profile only allows mounts under home, /tmp, /mnt and /media.
function ownNamespace(env) {
  return env.MERCBOT_NAMESPACE === "own";
}

function unmount(env, dir) {
  return ownNamespace(env) ? run("umount", ["-l", dir]) : run("fusermount3", ["-uz", dir]);
}

function rcloneBinary(env) {
  const tools = path.resolve(env.MERCBOT_TOOLS_DIR || ".tools");
  const unpacked = path.join(tools, "bin", "rclone");
  return existsSync(unpacked) ? unpacked : "rclone";
}

/** The PATH rclone runs with: in Mercbot's own namespace, the hosting script's fusermount3 first. */
function rclonePath(env) {
  return ownNamespace(env) ? `${path.resolve(env.MERCBOT_TOOLS_DIR || ".tools", "fuse")}:${env.PATH}` : env.PATH;
}

/**
 * A Google Drive mount's settings for rclone: its Drive backend, rooted at Mercbot's folder, with no key of its own yet
 * (one long run out), so it asks `tokenUrl` for one at once with the mount's own random key. A test copy's stand-in
 * Drive is reached through its proxy (driveStandIn).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ folderId: string }} settings
 * @param {{ key: string, tokenUrl: string }} mount
 */
function driveEnvironment(env, settings, { key, tokenUrl }, remote = "PERSON") {
  const standIn = driveStandIn(env);
  const config = `RCLONE_CONFIG_${remote}_`;
  return {
    PATH: rclonePath(env),
    [`${config}TYPE`]: "drive",
    [`${config}SCOPE`]: "drive",
    [`${config}ROOT_FOLDER_ID`]: settings.folderId,
    // rclone sends these with each key request; this server's address ignores them.
    [`${config}CLIENT_ID`]: "mercbot",
    [`${config}CLIENT_SECRET`]: "mercbot",
    [`${config}TOKEN_URL`]: tokenUrl,
    [`${config}TOKEN`]: JSON.stringify({ access_token: "", token_type: "Bearer", refresh_token: key, expiry: "2000-01-01T00:00:00Z" }),
    ...(standIn?.proxy ? { HTTPS_PROXY: standIn.proxy } : {})
  };
}

/** rclone trusts a test copy's stand-in Drive (driveStandIn), which has no rate limit to keep to. */
const standInFlags = (env) => (driveStandIn(env)?.ca ? ["--ca-cert", driveStandIn(env).ca, "--drive-pacer-min-sleep", "1ms"] : []);

/** What a Drive mount's rclone is told beyond its remote's settings. */
function driveFlags(env) {
  return ["--poll-interval", "0", ...standInFlags(env)];
}

/**
 * rclone takes its settings from the environment, so no secret is ever written to disk or put
 * in a command line. Passwords go in "obscured", rclone's own encoding, read from stdin.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env The server's, for the tools folder and PATH.
 * @param {object} settings
 */
async function environment(env, settings, remote = "PERSON") {
  const obscure = await new Promise((resolve, reject) => {
    const child = spawn(rcloneBinary(env), ["obscure", "-"], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("rclone couldn't read the password."))));
    child.stdin.end(settings.password || "");
  });
  const config = `RCLONE_CONFIG_${remote}_`;
  return {
    PATH: rclonePath(env),
    [`${config}TYPE`]: "webdav",
    [`${config}URL`]: settings.url,
    [`${config}VENDOR`]: settings.vendor || "other",
    [`${config}USER`]: settings.user || "",
    [`${config}PASS`]: obscure
  };
}

/**
 * Checks storage before it's saved: it must answer, and Mercbot's folder must be creatable there.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {object} settings
 */
export async function checkStorage(env, settings) {
  const rcloneEnv = await environment(env, settings);
  try {
    await run(rcloneBinary(env), [
      "mkdir", "person:Mercbot", "--config", "/dev/null", "--contimeout", "10s", "--timeout", "15s", "--retries", "1"
    ], { env: rcloneEnv, timeout: 30000 });
  } catch (error) {
    const said = String(error.stderr || "").split("\n").find((line) => /ERROR|CRITICAL|Failed/u.test(line)) || "";
    if (/401|403|unauthori[sz]ed|forbidden/iu.test(said)) {
      throw new FilesError(400, "The storage turned down that username and password.", { code: "files_storage_sign_in_refused" });
    }
    throw new FilesError(400, "Mercbot couldn't reach that storage. Check the address.", { code: "files_storage_unreachable" });
  }
}

function request(socketPath, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      path: `/${method}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      timeout: 5000
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("rclone didn't answer.")));
    req.end("{}");
  });
}

async function mounted(dir) {
  const table = await fs.readFile("/proc/self/mounts", "utf8").catch(() => "");
  return table.split("\n").some((line) => line.split(" ")[1] === dir);
}

/** A key request a mount's rclone can't be given a key for: `refused` once its account needs signing in again. */
export class DriveKeyError extends Error {
  constructor(refused) {
    super(refused ? "invalid_grant" : "temporarily_unavailable");
    this.refused = refused;
  }
}

/**
 * Each home's own storage mounted with rclone.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {string} [dependencies.dataDir]
 * @param {(homeId: string, settings: object, why?: { refused?: string }) => Promise<{ accessToken: string, expiresAt: number | null }>} [dependencies.driveKey]
 *   a key for a home's Google Drive while it's the home's choice, renewed at once when given the key Drive turned
 *   down (storageSettings.js)
 * @param {number} [dependencies.keySeconds] how long a key handed to rclone lasts (tests make it short)
 */
export function createRemoteMounts({ env, dataDir = path.resolve(env.MERCBOT_DATA_DIR || ".data"), driveKey, keySeconds = KEY_SECONDS }) {
  // Sockets live in a short private folder of this process.
  const sockets = mkdtempSync(path.join(os.tmpdir(), "mbrc-"));
  const mounts = new Map();
  const starting = new Map();
  // Each Google Drive mount's own key, which its rclone sends to ask for a Drive key, to what that mount knows:
  // { homeId, settings, key (what the home's choice gave, until `until`), handed (the key rclone has now), renewing
  // (a renewal under way), refused (the last key renewed because Drive turned it down), retryAt, backoff, blocked (rclone
  // has no key Drive takes, and gets none before a renewal works or the account is signed in again) }.
  const driveMounts = new Map();
  // Says a home's mount started renewing a key Drive turned down, to a page waiting to say why (`refusal`).
  const renewals = new EventEmitter().setMaxListeners(0);
  let origin = "";

  /** What a Drive mount, or a transfer's Drive (`transfer`), knows of its keys. */
  const driveEntry = (homeId, settings) => ({ homeId: String(homeId), settings, key: null, until: 0, handed: "", renewing: null, refused: "", retryAt: 0, backoff: 0, blocked: false });

  /** This server listens at `address`; its own rclone reaches it there for Drive keys. */
  function listening(address) {
    origin = ownOrigin(address, "http");
  }

  async function start(userId, settings) {
    const dir = path.join(dataDir, "mounts", String(userId));
    const cache = path.join(dataDir, "mount-cache", String(userId));
    const socket = path.join(sockets, `${userId}.sock`);
    const drive = settings.kind === "drive";
    if (drive && !origin) throw new Error("This server isn't listening yet.");
    if (await mounted(dir)) await unmount(env, dir).catch(() => {});
    await fs.rm(socket, { force: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(cache, { recursive: true });
    const driveKeyOf = drive ? randomBytes(32).toString("hex") : null;
    if (drive) driveMounts.set(driveKeyOf, driveEntry(userId, settings));
    const child = spawn(rcloneBinary(env), [
      "mount", drive ? "person:" : "person:Mercbot", dir,
      "--config", "/dev/null",
      "--vfs-cache-mode", "full", "--vfs-write-back", WRITE_BACK, "--dir-cache-time", DIR_CACHE,
      "--cache-dir", cache,
      "--rc", "--rc-addr", `unix://${socket}`, "--rc-no-auth",
      ...(drive ? driveFlags(env) : [])
    ], {
      env: drive ? driveEnvironment(env, settings, { key: driveKeyOf, tokenUrl: `${origin}${DRIVE_TOKEN_PATH}` }) : await environment(env, settings),
      // A Drive mount's log is read for Drive turning its key down, and goes nowhere else.
      stdio: drive ? ["ignore", "ignore", "pipe"] : "ignore"
    });
    child.once("error", () => {});
    if (drive) {
      createInterface({ input: child.stderr }).on("line", (line) => {
        if (KEY_TURNED_DOWN.test(line)) keyRefused(driveMounts.get(driveKeyOf));
      });
    }
    const entry = { dir, socket, child, key: JSON.stringify(settings), driveKey: driveKeyOf };
    child.once("exit", () => {
      if (entry.driveKey) driveMounts.delete(entry.driveKey);
      if (mounts.get(userId) === entry) mounts.delete(userId);
    });
    for (let tries = 0; tries < 100 && child.exitCode === null; tries += 1) {
      if (await mounted(dir)) {
        mounts.set(userId, entry);
        return entry;
      }
      await sleep(150);
    }
    child.kill("SIGKILL");
    throw new Error("Your storage couldn't be opened right now.");
  }

  /** Whether what a Drive mount read is still to be used: read within CHECK_SECONDS, and its key good for a while. */
  const current = (mount) =>
    Boolean(mount.key) && Date.now() < mount.until && (!mount.key.expiresAt || mount.key.expiresAt - Date.now() > (keySeconds + 60) * 1000);

  /**
   * A Drive key for the mount whose rclone sent `mountKey` (its refresh key), as Google's token endpoint answers:
   * `{ access_token, token_type, expires_in }`. Throws DriveKeyError: refused for a key no mount here has, once the
   * account needs signing in again or was removed, or once the home keeps its files elsewhere; otherwise not now.
   * @param {string} mountKey
   */
  async function token(mountKey) {
    const mount = driveMounts.get(String(mountKey || ""));
    if (!mount || !driveKey) throw new DriveKeyError(true);
    if (!current(mount)) {
      try {
        mount.key = await driveKey(mount.homeId, mount.settings);
        mount.until = Date.now() + CHECK_SECONDS * 1000;
        mount.blocked = false;
      } catch (error) {
        mount.key = null;
        const refused = REFUSED.includes(error?.code);
        if (refused) mount.blocked = true;
        throw new DriveKeyError(refused);
      }
    }
    const { accessToken, expiresAt } = mount.key;
    mount.handed = accessToken;
    const left = expiresAt ? Math.floor((expiresAt - Date.now()) / 1000) : keySeconds;
    return { access_token: accessToken, token_type: "Bearer", expires_in: Math.max(1, Math.min(keySeconds, left)) };
  }

  /**
   * Drive turned down the key this mount's rclone has (rclone's log said so): ask for a new one at once, renewed under
   * the account's row lock, so of several servers whose mounts saw it only one asks Google (D-15). Once per key, and
   * after a failure other than Google's refusal, not again for RETRY_FIRST_MS, then twice as long each time, up to
   * RETRY_MOST_MS. A refusal signs the account out (the home then says "Sign in again"), and rclone is refused its next
   * key; a new key reaches rclone when its own runs out, within KEY_SECONDS.
   */
  function keyRefused(mount) {
    const used = mount?.handed;
    if (!used || !driveKey || mount.renewing || mount.refused === used || Date.now() < mount.retryAt) return;
    mount.renewing = driveKey(mount.homeId, mount.settings, { refused: used }).then(
      (key) => Object.assign(mount, {
        key, until: Date.now() + CHECK_SECONDS * 1000, refused: used, backoff: 0, retryAt: 0, blocked: false
      }),
      (error) => {
        mount.blocked = true;
        if (REFUSED.includes(error?.code)) {
          Object.assign(mount, { key: null, refused: used, backoff: 0, retryAt: 0 });
        } else {
          mount.backoff = Math.min(Math.max(mount.backoff * 2, RETRY_FIRST_MS), RETRY_MOST_MS);
          mount.retryAt = Date.now() + mount.backoff;
        }
      }
    ).finally(() => {
      mount.renewing = null;
    });
    renewals.emit(mount.homeId);
  }

  /**
   * Waits, for at most `ms`, until a home's Drive mount here has renewed a key Drive turned down, so a page that just
   * found the home's storage not answering can say "Sign in again" if that renewal was refused. Resolves at once for a
   * home with no Drive mount here.
   * @param {string} homeId
   */
  async function refusal(homeId, ms = 1500) {
    const mount = [...driveMounts.values()].find((each) => each.homeId === String(homeId));
    if (!mount) return;
    // rclone's log line may come a moment after the error it explains; a key already renewed needs no wait.
    if (!mount.renewing && mount.refused !== mount.handed) {
      await once(renewals, String(homeId), { signal: AbortSignal.timeout(ms) }).catch(() => {});
    }
    await mount.renewing;
  }

  /**
   * Runs rclone once for a home's move between storages (fileMoves.js): `args` name the remotes `remotes` sets up by
   * name (a Drive or WebDAV storage's settings; Mercbot's own storage is a local path in `args`). A Drive asks this
   * server for its keys as a mount does, renewed at once when Drive turns one down. rclone's progress (its stats every
   * 2 s) goes to `onStats`; `signal` stops it. Answers its exit code (null when it couldn't run or was stopped), what
   * it printed, and its first errors, which go nowhere else.
   * @param {string} homeId
   * @param {string[]} args
   * @param {Record<string, object>} remotes by rclone's remote name: "src" for `src:`
   * @param {{ onStats?: (stats: object) => void, signal?: AbortSignal }} [how]
   * @returns {Promise<{ code: number | null, stdout: string, errors: string[] }>}
   */
  async function transfer(homeId, args, remotes, { onStats = () => {}, signal } = {}) {
    const keys = [];
    const variables = { PATH: rclonePath(env) };
    try {
      for (const [remote, settings] of Object.entries(remotes)) {
        if (settings.kind !== "drive") {
          Object.assign(variables, await environment(env, settings, remote.toUpperCase()));
          continue;
        }
        if (!origin) throw new Error("This server isn't listening yet.");
        const key = randomBytes(32).toString("hex");
        driveMounts.set(key, driveEntry(homeId, settings));
        keys.push(key);
        Object.assign(variables, driveEnvironment(env, settings, { key, tokenUrl: `${origin}${DRIVE_TOKEN_PATH}` }, remote.toUpperCase()));
      }
      const child = spawn(rcloneBinary(env), [
        ...args, "--config", "/dev/null", "--use-json-log", "--stats", "2s", "--stats-log-level", "NOTICE", ...standInFlags(env)
      ], { env: variables, stdio: ["ignore", "pipe", "pipe"], signal });
      let stdout = "";
      const errors = [];
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      createInterface({ input: child.stderr }).on("line", (line) => {
        if (KEY_TURNED_DOWN.test(line)) for (const key of keys) keyRefused(driveMounts.get(key));
        let entry = null;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        if (entry?.stats) onStats(entry.stats);
        // The first errors, which say what went wrong; those after them follow from it ("context canceled").
        else if (["error", "critical"].includes(entry?.level) && errors.length < 5) errors.push(String(entry.msg).slice(0, 300));
      });
      const code = await new Promise((resolve) => {
        child.once("error", () => resolve(null));
        child.once("close", (exitCode) => resolve(signal?.aborted ? null : exitCode));
      });
      return { code, stdout, errors };
    } finally {
      for (const key of keys) driveMounts.delete(key);
    }
  }

  /** The person's storage as a folder here, mounting it if needed (again if the settings changed). */
  async function folder(userId, settings) {
    const key = String(userId);
    const entry = mounts.get(key);
    if (entry?.key === JSON.stringify(settings) && entry.child.exitCode === null) return entry.dir;
    if (!starting.has(key)) {
      starting.set(key, (async () => {
        if (entry) await stop(key);
        return start(key, settings);
      })().finally(() => starting.delete(key)));
    }
    return (await starting.get(key)).dir;
  }

  /**
   * Waits until every save has reached the person's storage (at most `ms`), or the Drive mount is `blocked`: its saves
   * can't arrive before a renewal works or the account is signed in again, so a reply or a shutdown doesn't wait for them.
   */
  async function settle(userId, ms = 30000) {
    const entry = mounts.get(String(userId));
    if (!entry?.socket) return;
    const deadline = Date.now() + ms;
    const since = Date.now();
    while (Date.now() < deadline && !driveMounts.get(entry.driveKey)?.blocked) {
      const queued = await request(entry.socket, "vfs/queue").then((answer) => answer.queue?.length ?? 0, () => 0);
      // A save closed a moment ago may not be queued yet, so "empty" counts after a short while.
      if (queued === 0 && Date.now() - since > 300) return;
      await sleep(100);
    }
  }

  async function stop(userId) {
    const entry = mounts.get(String(userId));
    if (!entry) return;
    await settle(userId);
    entry.child.kill("SIGTERM");
    await sleep(300);
    await unmount(env, entry.dir).catch(() => {});
    if (entry.driveKey) driveMounts.delete(entry.driveKey);
    mounts.delete(String(userId));
  }

  async function closeAll() {
    await Promise.all([...mounts.keys()].map((userId) => stop(userId).catch(() => {})));
    await fs.rm(sockets, { recursive: true, force: true });
  }

  return Object.freeze({
    listening,
    folder,
    token,
    refusal,
    transfer,
    settle,
    stop,
    closeAll
  });
}
