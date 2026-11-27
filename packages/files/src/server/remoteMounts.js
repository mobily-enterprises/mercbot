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
import { dataFolder } from "@local/account/data-folder";
import { driveStandIn } from "./driveStorage.js";
import { FilesError } from "./fileStore.js";
import { toolsDir } from "./gvisor.js";
import { createSyncedTree } from "./syncedTree.js";
import { ownOrigin } from "./ownMachine.js";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A home's own storage (D-26): WebDAV, or a Google Drive folder (D-80), reached through rclone's remote control
// (`rclone rcd`, one per home on each server that needs it) with no mount and no FUSE (D-91). The home's folders are a
// working copy here (syncedTree.js), so the apps, the sandbox and the desktop work on them like on any other folder:
// pulled from the storage before they're read, pushed after a write, a reply or a command (`settle`) and every
// PUSH_EVERY_MS, and pushed whole before the server stops. Proven on 2026-10-25 against WebDAV, through a mount, which
// taught two rules kept here:
// - Before a reply is reported done, and before the server stops, Mercbot waits until what was saved has reached the
//   storage (`settle`). A machine that vanishes after that loses nothing.
// - The control socket needs a short path, and a stale one is removed before starting.
// Each server works on its own copy; another server's changes show at the next pull, within about a second.
// rclone asks this server for each Drive key (`token`) at DRIVE_TOKEN_PATH on its own port: its refresh key is a random
// key of that home's rclone, known only to this process, and the account's own permission stays here. Each key it gets
// lasts at most KEY_SECONDS; the home's rclone reads the home's choice and the account's key again every
// CHECK_SECONDS, so it follows its account and the home's choice within minutes (signed out, signed in again, renewed
// by another server, the home's files kept elsewhere), and a renewed key reaches rclone within a minute.
// rclone only asks for a key once its own has run out, even when Drive turns that key down (access removed in the
// Google account): Mercbot hears it in what rclone answers or logs and asks for a new one at once (`keyRefused`), once
// per key, waiting longer each time a renewal fails for a reason other than Google refusing it, which signs the account
// out. Until a renewal works or the account is signed in again, the home's rclone is `blocked`: its saves can't reach
// Drive, so `settle` doesn't wait for them; they stay here and go with a later push.
const PUSH_EVERY_MS = 2000;
const SETTLE_MS = 30000;
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

function rcloneBinary(env) {
  const unpacked = path.join(toolsDir(env), "bin", "rclone");
  return existsSync(unpacked) ? unpacked : "rclone";
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
    PATH: env.PATH,
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
    PATH: env.PATH,
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

/** An error rclone's remote control answered: its own sentence, such as "object not found". */
class RcloneError extends Error {}

/** One call to a home's rclone over its control socket; rclone's own failures throw RcloneError with its sentence. */
function request(socketPath, method, body = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      path: `/${method}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      timeout
    }, (response) => {
      let text = "";
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        let answer;
        try {
          answer = JSON.parse(text || "{}");
        } catch (error) {
          reject(error);
          return;
        }
        if (response.statusCode === 200) resolve(answer);
        else reject(new RcloneError(String(answer?.error || `rclone answered ${response.statusCode}`)));
      });
    });
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("rclone didn't answer.")));
    req.end(JSON.stringify(body));
  });
}

const NOT_FOUND = /not found|doesn't exist|does not exist|no such/iu;
const versionOf = (item) => `${item.Size}:${item.ModTime}`;

/**
 * A home's storage, through its rclone's remote control, as a synced tree's remote: `fsName` is the folder Mercbot
 * keeps there ("person:Mercbot" in WebDAV, "person:" in Drive, rooted at Mercbot's folder); a file is copied between it
 * and this server's folder by rclone itself. `refused` hears each of rclone's answers that says Drive turned its key
 * down.
 */
function rcloneRemote(socket, fsName, refused) {
  const at = (rel) => (rel ? `${fsName}${fsName.endsWith(":") ? "" : "/"}${rel}` : fsName);
  const call = (method, body) => request(socket, method, body).catch((error) => {
    if (KEY_TURNED_DOWN.test(String(error?.message))) refused();
    throw error;
  });
  return {
    async list(prefix) {
      let answer;
      try {
        answer = await call("operations/list", { fs: at(prefix), remote: "", opt: { recurse: true } });
      } catch (error) {
        if (error instanceof RcloneError && NOT_FOUND.test(error.message)) return [];
        throw error;
      }
      const under = (rel) => (prefix ? `${prefix}/${rel}` : rel);
      return [
        ...(prefix ? [{ path: prefix, dir: true }] : []),
        ...(answer.list || []).map((item) => item.IsDir
          ? { path: under(item.Path), dir: true }
          : { path: under(item.Path), size: item.Size, version: versionOf(item), modified: Date.parse(item.ModTime) })
      ];
    },
    async download(rel, file) {
      try {
        await call("operations/copyfile", { srcFs: fsName, srcRemote: rel, dstFs: path.dirname(file), dstRemote: path.basename(file) });
      } catch (error) {
        if (error instanceof RcloneError && NOT_FOUND.test(error.message)) return null;
        throw error;
      }
      return "";
    },
    async upload(file, rel) {
      await call("operations/copyfile", { srcFs: path.dirname(file), srcRemote: path.basename(file), dstFs: fsName, dstRemote: rel });
      const { item } = await call("operations/stat", { fs: fsName, remote: rel });
      return item ? versionOf(item) : "";
    },
    async remove(rel) {
      await call("operations/deletefile", { fs: fsName, remote: rel }).catch((error) => {
        if (!(error instanceof RcloneError && NOT_FOUND.test(error.message))) throw error;
      });
    },
    makeDir: (rel) => call("operations/mkdir", { fs: fsName, remote: rel }).then(() => {}),
    async removeDir(rel) {
      // A folder something else filled meanwhile stays.
      await call("operations/rmdir", { fs: fsName, remote: rel }).catch((error) => {
        if (!(error instanceof RcloneError)) throw error;
      });
    }
  };
}

/** A key request a mount's rclone can't be given a key for: `refused` once its account needs signing in again. */
export class DriveKeyError extends Error {
  constructor(refused) {
    super(refused ? "invalid_grant" : "temporarily_unavailable");
    this.refused = refused;
  }
}

/**
 * Each home's own storage, kept here as a working copy through its rclone.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {string} [dependencies.dataDir]
 * @param {(homeId: string, settings: object, why?: { refused?: string }) => Promise<{ accessToken: string, expiresAt: number | null }>} [dependencies.driveKey]
 *   a key for a home's Google Drive while it's the home's choice, renewed at once when given the key Drive turned
 *   down (storageSettings.js)
 * @param {number} [dependencies.keySeconds] how long a key handed to rclone lasts (tests make it short)
 */
export function createRemoteMounts({ env, dataDir = dataFolder(env), driveKey, keySeconds = KEY_SECONDS }) {
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

  /**
   * Starts the home's rclone (remote control only, no mount) and its synced tree: a fresh working copy here, filled as
   * its folders are pulled.
   */
  async function start(userId, settings) {
    const dir = path.join(dataDir, "mounts", String(userId));
    const socket = path.join(sockets, `${userId}.sock`);
    const drive = settings.kind === "drive";
    if (drive && !origin) throw new Error("This server isn't listening yet.");
    await fs.rm(socket, { force: true });
    // What a copy here held before was pushed when it stopped, or is from a server that stopped without it.
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(`${dir}.mbsync`, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const driveKeyOf = drive ? randomBytes(32).toString("hex") : null;
    if (drive) driveMounts.set(driveKeyOf, driveEntry(userId, settings));
    const child = spawn(rcloneBinary(env), [
      "rcd", "--config", "/dev/null",
      "--rc-addr", `unix://${socket}`, "--rc-no-auth",
      ...(drive ? standInFlags(env) : [])
    ], {
      env: drive ? driveEnvironment(env, settings, { key: driveKeyOf, tokenUrl: `${origin}${DRIVE_TOKEN_PATH}` }) : await environment(env, settings),
      // A Drive's log is read for Drive turning its key down, and goes nowhere else.
      stdio: drive ? ["ignore", "ignore", "pipe"] : "ignore"
    });
    child.once("error", () => {});
    const refused = () => drive && keyRefused(driveMounts.get(driveKeyOf));
    if (drive) {
      createInterface({ input: child.stderr }).on("line", (line) => {
        if (KEY_TURNED_DOWN.test(line)) refused();
      });
    }
    // Fetched files wait beside the home's folder, never in it, where the home would see them.
    const tree = createSyncedTree({
      root: dir, remote: rcloneRemote(socket, drive ? "person:" : "person:Mercbot", refused), oneScope: true, temporary: `${dir}.mbsync`
    });
    const entry = { dir, socket, child, tree, key: JSON.stringify(settings), driveKey: driveKeyOf, pushing: null, timer: null };
    child.once("exit", () => {
      clearInterval(entry.timer);
      if (entry.driveKey) driveMounts.delete(entry.driveKey);
      if (mounts.get(userId) === entry) mounts.delete(userId);
    });
    for (let tries = 0; tries < 100 && child.exitCode === null; tries += 1) {
      if (await request(socket, "rc/noop", {}, 2000).then(() => true, () => false)) {
        if (!drive) await request(socket, "operations/mkdir", { fs: "person:Mercbot", remote: "" }).catch(() => {});
        // Saves made by the apps, the desktop and commands go every PUSH_EVERY_MS, as the mount's did a second after.
        entry.timer = setInterval(() => {
          entry.pushing ??= tree.push("").catch(() => {}).finally(() => (entry.pushing = null));
        }, PUSH_EVERY_MS);
        entry.timer.unref();
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
    const variables = { PATH: env.PATH };
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

  /**
   * The home's storage as a folder here, with the synced tree that keeps it (`{ dir, tree }`), starting its rclone if
   * needed (again if the settings changed).
   */
  async function folder(userId, settings) {
    const key = String(userId);
    const entry = mounts.get(key);
    if (entry?.key === JSON.stringify(settings) && entry.child.exitCode === null) return { dir: entry.dir, tree: entry.tree };
    if (!starting.has(key)) {
      starting.set(key, (async () => {
        if (entry) await stop(key);
        return start(key, settings);
      })().finally(() => starting.delete(key)));
    }
    const started = await starting.get(key);
    return { dir: started.dir, tree: started.tree };
  }

  /**
   * Waits until what changed in the home's folder here has reached its storage (at most `ms`), unless its Drive is
   * `blocked`: its saves can't arrive before a renewal works or the account is signed in again, so a reply or a shutdown
   * doesn't wait for them; they stay here, and the next push sends them.
   */
  async function settle(userId, ms = SETTLE_MS) {
    const entry = mounts.get(String(userId));
    if (!entry) return;
    const blocked = () => Boolean(driveMounts.get(entry.driveKey)?.blocked);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !blocked()) {
      await entry.pushing;
      // The wait ends with the push: a timer left running would hold a stopping server up to SETTLE_MS.
      let late = null;
      const pushed = await Promise.race([
        entry.tree.push("").then(() => true, () => false),
        new Promise((resolve) => (late = setTimeout(resolve, Math.max(0, deadline - Date.now()), false)))
      ]).finally(() => clearTimeout(late));
      if (pushed) return;
      await sleep(500);
    }
  }

  async function stop(userId) {
    const entry = mounts.get(String(userId));
    if (!entry) return;
    clearInterval(entry.timer);
    await settle(userId);
    entry.child.kill("SIGTERM");
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
