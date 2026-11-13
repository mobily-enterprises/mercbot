import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { seal, unseal, vaultKey } from "@local/account/vault-crypto";
import { FilesError } from "./fileStore.js";

// Moving a home's files when it chooses other storage (D-80, the owner, 2026-11-12: "it should be an OVERWRITE. That
// is, ALL data is moved across EACH TIME"): every file is copied to the new place, which becomes an exact copy of the
// old one (rclone sync), checked, and only then does the home switch, in one write. Meanwhile the files are read-only
// (storageSettings.folder). A move lives on the home's file_storage row, so there's one at a time; a server claims it
// under that row's lock and holds it by a lease it renews (D-15), so when its server stops another one carries on. The
// old copy then goes: a person's Google Drive folder to that Drive's bin, Mercbot's own copy deleted; a WebDAV copy
// stays. A move that fails or is cancelled leaves the home on its old storage, unchanged.
const LEASE_SECONDS = 60;
const BEAT_MS = 10000;
const SWEEP_MS = 30000;
// Saves still on their way through other servers' mounts of a Drive or WebDAV storage when the move starts: rclone's
// 1-second upload delay and 10-second listings. Mercbot's own storage is written at once.
const SETTLE_MS = 15000;
const CHECK_ROUNDS = 3;
// A command started before the move may still write; one runs at most 30 minutes (shell.js).
const COMMANDS_MS = 31 * 60 * 1000;
/** A move that hasn't ended: running, or switched and putting the old copy away. */
export const GOING = Object.freeze(["running", "switched"]);
const FIELDS = Object.freeze(["kind", "settings", "move", "moveStatus"]);

/** The search entries file_storage's owns entry adds: moves in one of some states; moves whose server's lease ran out. */
export const FILE_STORAGE_FILTERS = Object.freeze({
  moveStatuses: { type: "array", actualField: "moveStatus", filterOperator: "in" },
  moveLeaseExpired: {
    type: "boolean",
    applyFilter(query, _value, { column }) {
      query.whereRaw("?? < now()", [column("moveLeaseUntil")]);
    }
  }
});

/** Why a move stopped short, in words for the person; `sourceUnreadable` when it was reading the files where they are. */
class MoveError extends Error {
  constructor(message, { sourceUnreadable = false } = {}) {
    super(message);
    this.sourceUnreadable = sourceUnreadable;
  }
}
const LOST = "lost";
const CANCELLED = "cancelled";

/** The refusal of another move, or of another choice, while one is going. */
export function alreadyMoving() {
  return new FilesError(409, "This home's files are being moved. Wait until that's done, or cancel it.", { code: "files_storage_move_going" });
}

/** Where a home's files are, as Settings → Files names it. */
export function placeOf(settings) {
  if (settings?.kind === "drive") return { kind: "drive", label: `Google Drive (${settings.label})` };
  if (settings?.kind === "webdav") return { kind: "webdav", label: `${new URL(settings.url).host} (WebDAV)` };
  return { kind: "mercbot", label: "Mercbot" };
}

/**
 * @param {object} dependencies
 * @param {object} dependencies.fileStorage the file_storage handle
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {import("./types.js").RemoteMounts} dependencies.mounts
 * @param {import("./types.js").DriveStorage} dependencies.drive
 * @param {import("./types.js").ShellRuns} dependencies.runs
 * @param {{ settleMs?: number, beatMs?: number, sweepMs?: number, leaseSeconds?: number }} [dependencies.timing] tests shorten them
 */
export function createFileMoves({ fileStorage, systemContext, env, store, mounts, drive, runs, timing = {} }) {
  const { settleMs = SETTLE_MS, beatMs = BEAT_MS, sweepMs = SWEEP_MS, leaseSeconds = LEASE_SECONDS } = timing;
  const inHome = (homeId) => ({ context: systemContext("move a home's files to the storage it chose, claiming and finishing that move").forWorkspace(String(homeId)) });
  const everyHome = () => ({ context: systemContext("find the moves of homes' files whose server stopped, in every home") });
  const lease = () => fileStorage.raw("now() + make_interval(secs => ?)", [Number(leaseSeconds)]);
  // The moves this server runs, by home, and what's told when one starts (bots' computers go to sleep).
  const going = new Map();
  const starting = [];
  let sweeper = null;

  function vault() {
    const key = vaultKey(env);
    if (!key) throw new FilesError(503, "This home's storage can't be opened: this server has no vault key.", { code: "files_storage_vault_key_missing" });
    return key;
  }

  /**
   * Starts moving the home's files to `target` (its kind and settings, ready to save, as storageSettings.choose made
   * them): the home's row says so under its lock, so its files are read-only from then on, unless a move is going
   * already. The move itself runs in the background, on this server unless another takes it first.
   * @param {string} homeId
   * @param {{ kind: string } & Record<string, any>} target
   * @param {object} options the request's
   */
  async function start(homeId, target, options) {
    const key = vault();
    await fileStorage.withTransaction({ ...inHome(homeId), retry: false }, async (txOptions) => {
      // A home on Mercbot's storage may have no row yet; the move needs one, saying Mercbot's storage.
      await fileStorage.createMany([{ kind: "mercbot", settings: seal({}, key) }], {
        ...txOptions, onConflict: { keys: ["workspaceId"], action: "ignore" }, returning: "none"
      });
      const [row] = await fileStorage.lockWhere({ workspaceId: String(homeId) }, { ...txOptions, fields: FIELDS });
      if (GOING.includes(row.moveStatus)) throw alreadyMoving();
      const move = {
        id: randomUUID(),
        stage: "waiting",
        from: placeOf({ kind: row.kind, ...unseal(row.settings, key) }),
        to: placeOf(target),
        target: seal(target, key),
        startedAt: new Date().toISOString(),
        startedBy: String(resolveAuditActorId(options.context) ?? "") || null,
        files: null,
        bytes: null,
        filesDone: 0,
        bytesDone: 0
      };
      await fileStorage.patchWhere({ workspaceId: String(homeId) }, {
        move, moveStatus: "running", moveClaim: null, moveLeaseUntil: fileStorage.raw("now()"), moveCancel: false
      }, { ...txOptions, returning: "none" });
    });
    kick(homeId);
  }

  /** An owner or admin cancels the home's move; the server running it stops at its next beat. */
  async function cancel(homeId, options) {
    const changed = await fileStorage.patchWhere({ workspaceId: String(homeId), moveStatus: "running" }, { moveCancel: true }, {
      ...passedOn(options), returning: "count"
    });
    if (!changed) throw new FilesError(409, "This home's files aren't being moved.", { code: "files_storage_move_none" });
  }

  /** Takes the home's move when no server holds it (its lease ran out), under the home's row lock. */
  async function claim(homeId) {
    const token = `${os.hostname()}:${process.pid}:${randomUUID()}`;
    return fileStorage.withTransaction({ ...inHome(homeId), retry: false }, async (txOptions) => {
      const [row] = await fileStorage.lockWhere(
        { workspaceId: String(homeId), moveStatuses: [...GOING], moveLeaseExpired: true },
        { ...txOptions, fields: FIELDS }
      );
      if (!row) return null;
      await fileStorage.patchWhere({ workspaceId: String(homeId) }, { moveClaim: token, moveLeaseUntil: lease() }, { ...txOptions, returning: "none" });
      return { homeId: String(homeId), token, kind: row.kind, settings: row.settings, status: row.moveStatus, move: row.move };
    });
  }

  /** Runs the home's move here if it's free to take, in the background. */
  function kick(homeId) {
    if (going.has(String(homeId))) return;
    claim(homeId)
      .then((job) => job && run(job))
      .catch((error) => console.warn("Taking a move of a home's files failed; the next sweep tries again.", error?.message));
  }

  /**
   * The move's beat: renews its lease and saves its progress, while this server still holds it. Throws LOST when
   * another server took it, CANCELLED once an owner or admin cancelled it.
   */
  async function beat(job) {
    const [row] = await fileStorage.patchWhere(
      { workspaceId: job.homeId, moveClaim: job.token },
      { moveLeaseUntil: lease(), move: job.move },
      { ...inHome(job.homeId), returning: "records" }
    );
    if (!row) throw new Error(LOST);
    if (row.moveCancel && job.status === "running") throw new Error(CANCELLED);
  }

  async function run(job) {
    const stop = new AbortController();
    going.set(job.homeId, stop);
    const beating = setInterval(() => beat(job).catch((error) => stop.abort(error)), beatMs);
    try {
      if (job.status === "running") await copyAndSwitch(job, stop.signal);
      await cleanUp(job);
    } catch (error) {
      await end(job, stop.signal.reason || error).catch((ended) => console.warn("Ending a move of a home's files failed.", ended?.message));
    } finally {
      clearInterval(beating);
      going.delete(job.homeId);
    }
  }

  /** rclone's name for one end of the move, and the remote it needs: Mercbot's own storage is a local folder. */
  async function endOf(homeId, settings, name) {
    if (settings.kind === "drive") return { path: `${name}:`, remotes: { [name]: settings } };
    if (settings.kind === "webdav") return { path: `${name}:Mercbot`, remotes: { [name]: settings } };
    const folder = await store.ownFolder(homeId);
    await fs.mkdir(folder, { recursive: true });
    return { path: folder, remotes: {} };
  }

  /** The number of files and their bytes at one end. */
  async function size(job, at, { source = false, signal }) {
    const { code, stdout } = await mounts.transfer(job.homeId, ["size", "--json", at.path], at.remotes, { signal });
    signal.throwIfAborted();
    if (code !== 0) {
      throw new MoveError(source ? "Mercbot couldn't read the files where they are now." : "Mercbot couldn't reach the new place.", { sourceUnreadable: source });
    }
    const { count, bytes } = JSON.parse(stdout);
    return { count: Number(count) || 0, bytes: Number(bytes) || 0 };
  }

  /**
   * Makes the new place an exact copy of the old: every file copied (`everything`, the first time) or only those that
   * differ by size or checksum (after a check found a difference, or when another server carries on), and what else is
   * there removed (to Drive's bin, in a Drive).
   */
  async function sync(job, from, to, { everything, signal }) {
    const move = job.move;
    const { code, errors } = await mounts.transfer(job.homeId, [
      "sync", from.path, to.path, "--create-empty-src-dirs", everything ? "--ignore-times" : "--checksum",
      "--transfers", "4", "--checkers", "8", "--retries", "3",
      // A full Google Drive stops the copy at once, rather than after every file was turned down three times.
      "--drive-stop-on-upload-limit"
    ], { ...from.remotes, ...to.remotes }, {
      signal,
      onStats: (stats) => {
        move.filesDone = Math.min(move.files ?? Infinity, (Number(stats.transfers) || 0) + (Number(stats.checks) || 0));
        move.bytesDone = Math.min(move.bytes ?? Infinity, Number(stats.bytes) || 0);
      }
    });
    signal.throwIfAborted();
    if (code !== 0) {
      console.warn("Copying a home's files to the storage it chose failed.", errors.join(" | "));
      if (errors.some((error) => /quota|storage.*full|insufficient storage|507/iu.test(error))) {
        throw new MoveError("There isn't enough space in the new place for this home's files.");
      }
      throw new MoveError("Mercbot couldn't copy every file to the new place.");
    }
  }

  /** Whether both ends hold the same files: their count and bytes, then each file's size and checksum where both have one. */
  async function same(job, from, to, signal) {
    const [had, has] = await Promise.all([size(job, from, { source: true, signal }), size(job, to, { signal })]);
    if (had.count !== has.count || had.bytes !== has.bytes) return false;
    const { code } = await mounts.transfer(job.homeId, ["check", from.path, to.path], { ...from.remotes, ...to.remotes }, { signal });
    signal.throwIfAborted();
    return code === 0;
  }

  /**
   * Waits for the home's commands that started before the move, which may still write (Settings → Files says so);
   * true when there were some.
   */
  async function commandsDone(job, signal) {
    const deadline = Date.now() + COMMANDS_MS;
    let waited = false;
    while (Date.now() < deadline && (await runs.runningBefore(job.homeId, job.move.startedAt))) {
      if (!waited) {
        job.move.stage = "commands";
        await beat(job);
      }
      waited = true;
      await delay(beatMs, null, { signal });
    }
    return waited;
  }

  async function copyAndSwitch(job, signal) {
    const key = vault();
    const move = job.move;
    const source = { kind: job.kind, ...unseal(job.settings, key) };
    const target = unseal(move.target, key);
    if (move.stage === "waiting") {
      for (const listener of starting) await listener(job.homeId).catch((error) => console.warn("Telling a home's files are moving failed.", error?.message));
      if (source.kind !== "mercbot") await delay(settleMs, null, { signal });
    }
    if (source.kind === "drive") {
      await drive.ready(job.homeId, source).catch((error) => Promise.reject(new MoveError(`Mercbot couldn't read the files where they are now: ${error.message}`, { sourceUnreadable: true })));
      // Mercbot's folder put in the bin is taken out first, or its files read as gone; the move bins it again after.
      await drive.trash(job.homeId, source, false);
    }
    const [from, to] = await Promise.all([endOf(job.homeId, source, "src"), endOf(job.homeId, target, "dst")]);
    move.stage = "counting";
    await beat(job);
    const counted = await size(job, from, { source: true, signal });
    Object.assign(move, { files: counted.count, bytes: counted.bytes });
    const first = !move.copied;
    move.stage = "copying";
    await beat(job);
    await sync(job, from, to, { everything: first, signal });
    move.copied = true;
    // What a command still writing changed is copied again, before any check.
    const waited = await commandsDone(job, signal);
    move.stage = "checking";
    await beat(job);
    for (let round = 1; ; round += 1) {
      if (!(waited && round === 1) && (await same(job, from, to, signal))) break;
      if (round >= CHECK_ROUNDS) throw new MoveError(`The copy didn't match this home's files after ${CHECK_ROUNDS} tries.`);
      await sync(job, from, to, { everything: false, signal });
    }
    await switchOver(job, source, target);
  }

  /** The switch, in one write under the home's row lock, while this server still holds the move and nobody cancelled it. */
  async function switchOver(job, source, target) {
    const key = vault();
    await fileStorage.withTransaction({ ...inHome(job.homeId), retry: false }, async (txOptions) => {
      const [row] = await fileStorage.lockWhere({ workspaceId: job.homeId, moveClaim: job.token }, { ...txOptions, fields: ["moveCancel"] });
      if (!row) throw new Error(LOST);
      if (row.moveCancel) throw new Error(CANCELLED);
      const { kind, ...settings } = target;
      job.move = { ...job.move, stage: "cleaning", filesDone: job.move.files, bytesDone: job.move.bytes, source: seal(source, key) };
      await fileStorage.patchWhere({ workspaceId: job.homeId }, {
        kind, settings: seal(settings, key), move: job.move, moveStatus: "switched", moveLeaseUntil: lease()
      }, { ...txOptions, returning: "none" });
    });
    job.status = "switched";
  }

  /**
   * After the switch the old copy goes: a person's Google Drive folder to that Drive's bin (Google keeps it 30 days),
   * Mercbot's own copy deleted, a WebDAV copy kept. A step that fails is told in the log and the move still ends.
   */
  async function cleanUp(job) {
    const key = vault();
    const source = unseal(job.move.source, key);
    if (source.kind === "drive") {
      await drive.trash(job.homeId, source, true).catch((error) => console.warn("Putting a home's old Google Drive folder in the bin failed.", error?.message));
    } else if (source.kind === "mercbot") {
      const [row] = await fileStorage.queryAll({ filters: { workspaceId: job.homeId }, fields: ["kind"] }, inHome(job.homeId));
      // Never the folder the home uses now.
      if (row && row.kind !== "mercbot") await fs.rm(await store.ownFolder(job.homeId), { recursive: true, force: true });
    }
    await mounts.stop(job.homeId).catch(() => {});
    const { target: _target, source: _source, ...kept } = job.move;
    await fileStorage.patchWhere({ workspaceId: job.homeId, moveClaim: job.token }, {
      move: { ...kept, stage: "done", finishedAt: new Date().toISOString() }, moveStatus: "done", moveClaim: null, moveLeaseUntil: null
    }, { ...inHome(job.homeId), returning: "none" });
  }

  /**
   * A move stopped before the switch: cancelled, or failed with its reason, the home still on its old storage. The copy
   * it started goes: to the bin in a Google Drive, deleted in Mercbot's own storage; one in WebDAV storage stays there,
   * where the next move overwrites it. Nothing, when another server holds the move now.
   */
  async function end(job, error) {
    if (error?.message === LOST || job.status !== "running") {
      if (job.status === "switched") console.warn("Cleaning up after a move of a home's files failed; another server carries on.", error?.message);
      return;
    }
    const cancelled = error?.message === CANCELLED;
    if (!cancelled && !(error instanceof MoveError)) console.warn("A move of a home's files failed.", error?.message);
    const { target, source: _source, ...kept } = job.move;
    const ended = await fileStorage.patchWhere({ workspaceId: job.homeId, moveClaim: job.token, moveStatus: "running" }, {
      move: {
        ...kept,
        stage: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : error instanceof MoveError ? error.message : "Mercbot couldn't move this home's files.",
        sourceUnreadable: Boolean(error?.sourceUnreadable),
        finishedAt: new Date().toISOString()
      },
      moveStatus: cancelled ? "cancelled" : "failed",
      moveClaim: null,
      moveLeaseUntil: null
    }, { ...inHome(job.homeId), returning: "count" });
    if (!ended) return;
    const place = unseal(target, vault());
    if (place.kind === "drive") {
      await drive.trash(job.homeId, place, true).catch((binned) => console.warn("Putting a stopped move's copy in Google Drive's bin failed.", binned?.message));
    } else if (place.kind === "mercbot") {
      const [row] = await fileStorage.queryAll({ filters: { workspaceId: job.homeId }, fields: ["kind"] }, inHome(job.homeId));
      if (row && row.kind !== "mercbot") await fs.rm(await store.ownFolder(job.homeId), { recursive: true, force: true });
    }
  }

  /** Every server, every SWEEP_MS: moves whose server stopped (lease run out) are carried on here. */
  async function sweep() {
    const found = await fileStorage.queryAll({ filters: { moveStatuses: [...GOING], moveLeaseExpired: true }, fields: ["workspaceId"] }, everyHome());
    for (const row of found) kick(row.workspaceId);
  }

  function startSweeping() {
    sweeper ??= setInterval(() => sweep().catch((error) => console.warn("Sweeping moves of homes' files failed.", error?.message)), sweepMs);
    sweeper.unref();
  }

  /** Stops this server's moves where they are; another server carries them on once their lease runs out. */
  function stopAll() {
    clearInterval(sweeper);
    sweeper = null;
    for (const stop of going.values()) stop.abort(new Error(LOST));
  }

  /** `listener(homeId)` runs here when a move of that home's files starts (D-80): what may still write stops. */
  function whenStarting(listener) {
    starting.push(listener);
  }

  return Object.freeze({
    start,
    cancel,
    sweep,
    startSweeping,
    stopAll,
    whenStarting
  });
}
