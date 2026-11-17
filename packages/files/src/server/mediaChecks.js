import fs from "node:fs/promises";
import path from "node:path";
import { SNIFF_BYTES, sniffMedia } from "@local/account/media-check";

// A copy built on Mercbot may check every picture and video before it's kept or sent (`mercbot.media-check`, D-90).
// Most are checked on their way in (an upload, a picture a bot makes, a profile picture). A bot's computer takes
// screenshots by the dozen, and a bot's turn may save many files, so those are checked afterwards instead, within
// minutes: each waits in media_checks, where every server takes a batch in turn (D-15), and stays visible meanwhile. A
// blocked one is removed; one that can't be checked now stays waiting, and is tried again later, further each time,
// so none is ever left unchecked. Without a checker nothing is queued, and nothing here runs.

const SWEEP_MS = 20000;
// The most rows one server takes in one sweep, and checks a few at a time.
const BATCH = 25;
const AT_ONCE = 3;
// How long a taken row is this server's: a server that stops while checking leaves it to another after this.
const LEASE_SECONDS = 300;
// A check that couldn't be made is tried again after a minute, then twice as long each time, up to half an hour.
const FIRST_RETRY_SECONDS = 60;
const LAST_RETRY_SECONDS = 30 * 60;
// A screenshot is queued just before it's written, so it's taken no sooner than this after.
const SCREENSHOT_WAIT_SECONDS = 30;
// A file is checked whole, in memory; a picture or video bigger than this can't be, so it isn't kept.
const CHECK_LIMIT = 100 * 1024 * 1024;
const SCREENSHOT_NAME = /^\d+-[0-9a-f]{16}\.jpg$/u;
const FIELDS = Object.freeze(["id", "workspaceId", "origin", "place", "path", "botId", "userId", "conversationId", "attempts"]);
const GONE = new Set(["files_file_gone", "files_path_outside"]);

/** The search entries media_checks' owns entry adds: rows that may be taken now, on the database's clock. */
export const MEDIA_CHECK_FILTERS = Object.freeze({
  due: {
    type: "boolean",
    applyFilter(query, due, { column }) {
      if (due) query.whereRaw("?? <= now()", [column("checkAfter")]);
    }
  }
});

/** How many seconds a row waits before its `attempts`-th try again. */
export function retryAfter(attempts) {
  return Math.min(LAST_RETRY_SECONDS, FIRST_RETRY_SECONDS * 2 ** Math.max(0, attempts - 1));
}

/** A file's first bytes, which say what it is. */
async function headOf(file) {
  const handle = await fs.open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const missing = (error) => error?.code === "ENOENT" || GONE.has(error?.code);

/** What `work` answers, or null when its file isn't there. */
const unlessGone = (work) => work.catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});

/**
 * The files feature's media checks (`files.media`): a copy's checker (`check`, `checkText`, from @local/account's
 * guard, which never throws) and the queue of what's checked afterwards.
 * @param {object} dependencies
 * @param {import("./types.js").MediaGuard} dependencies.guard the copy's checker, or none (createMediaGuard(null))
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.mediaChecks the media_checks handle
 * @param {(reason: string) => object} dependencies.systemContext the files feature's system scope
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {{ sweepMs?: number, batch?: number, leaseSeconds?: number, screenshotWaitSeconds?: number }} [dependencies.timing]
 *   tests shorten them
 */
export function createMediaChecks({ guard, mediaChecks, systemContext, store, timing = {} }) {
  const { sweepMs = SWEEP_MS, batch = BATCH, leaseSeconds = LEASE_SECONDS, screenshotWaitSeconds = SCREENSHOT_WAIT_SECONDS } = timing;
  const everyHome = () => ({ context: systemContext("check the pictures and videos waiting for a copy's check, in every home") });
  const inHome = (homeId) => ({ context: systemContext("queue a home's pictures and videos for a copy's check").forWorkspace(String(homeId)) });
  const secondsFromNow = (seconds) => mediaChecks.raw("now() + make_interval(secs => ?)", [Number(seconds)]);
  let sweeper = null;
  let sweeping = null;

  async function queue(homeId, rows) {
    if (!guard.on || !homeId || !rows.length) return;
    await mediaChecks.createMany(rows, { ...inHome(homeId), returning: "none" });
  }

  /**
   * A screenshot about to be kept in a computer's folder (its name, computers.js storeScreenshot), queued before it's
   * written, so none is ever there unqueued, and taken about `screenshotWaitSeconds` later (by this server's clock: a new
   * row's time can't be the database's), once it is. A computer's key is its conversation's id.
   * @param {{ computerId: string, name: string, workspaceId: string | null, userId?: string | null, botId?: string | null }} screenshot
   */
  function screenshotLater({ computerId, name, workspaceId, userId = null, botId = null }) {
    return queue(workspaceId, [{
      origin: "screenshot",
      path: name,
      conversationId: String(computerId),
      userId,
      botId,
      checkAfter: new Date(Date.now() + screenshotWaitSeconds * 1000).toISOString()
    }]);
  }

  /** Whether a saved file may be a picture or video: it is by its first bytes, or they can't be read now. */
  async function mayBeMedia(place, virtualPath) {
    try {
      const file = await store.existingFile(place, virtualPath);
      return Boolean(sniffMedia(await headOf(file.real)));
    } catch (error) {
      return !missing(error);
    }
  }

  /**
   * The files a bot's turn saved, by their paths in its place (fileStore.js): the pictures and videos among them are
   * queued.
   * @param {{ place: object, paths: Iterable<string>, workspaceId: string, userId?: string | null, botId?: string | null,
   *   conversationId?: string | null }} saved
   */
  async function filesLater({ place, paths, workspaceId, userId = null, botId = null, conversationId = null }) {
    if (!guard.on) return;
    const rows = [];
    for (const virtualPath of new Set(paths)) {
      if (await mayBeMedia(place, virtualPath)) rows.push({ origin: "saved_file", place, path: virtualPath, userId, botId, conversationId });
    }
    await queue(workspaceId, rows);
  }

  /** Takes up to `batch` rows whose time has come, for this server, for `leaseSeconds`. */
  function claim() {
    return mediaChecks.withTransaction(everyHome(), async (txOptions) => {
      const rows = await mediaChecks.claim({ filters: { due: true }, sort: ["checkAfter", "id"], take: batch }, { ...txOptions, fields: [...FIELDS] });
      if (rows.length) {
        await mediaChecks.patchWhere({ id: rows.map((row) => String(row.id)) }, { checkAfter: secondsFromNow(leaseSeconds) }, {
          ...txOptions,
          returning: "none"
        });
      }
      return rows;
    });
  }

  /** A row's file: where it is and how it's removed, or null when it's gone. It throws when it can't be told now. */
  async function fileOf(row) {
    if (row.origin === "screenshot") {
      if (!SCREENSHOT_NAME.test(row.path)) return null;
      // Without the volume a screenshot is neither there nor gone: it waits.
      if (!(await store.available())) throw new Error("the files volume isn't available on this server");
      const conversation = Number(row.conversationId);
      // Taken on another server, it's fetched from the files bucket first (D-91).
      const real = (await store.computerFile(conversation, `screenshots/${row.path}`)) ?? path.join(store.computersRoot, String(conversation), "screenshots", row.path);
      async function remove() {
        await fs.rm(real, { force: true });
        await store.settleComputer(conversation);
      }
      return { real, remove };
    }
    const found = await store.existingFile(row.place, row.path).catch((error) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!found) return null;
    // Removing writes, so it waits while the home's files are being moved (D-80).
    async function remove() {
      await fs.rm((await store.existingFile(row.place, row.path, { writing: true })).real, { force: true });
      await store.settle(row.workspaceId);
    }
    return { real: found.real, remove };
  }

  /** A row whose check can't be made now waits again, further each time. It answers false: the row isn't done. */
  async function again(row) {
    const attempts = Number(row.attempts || 0) + 1;
    await mediaChecks.patchWhere({ id: String(row.id) }, { attempts, checkAfter: secondsFromNow(retryAfter(attempts)) }, {
      ...everyHome(),
      returning: "none"
    });
    return false;
  }

  const where = (row) => `${row.origin === "screenshot" ? "screenshot" : "file"} ${row.path} (home ${row.workspaceId})`;

  /** One row: checked, or its file gone, answering true; or, when it can't be checked now, waiting again (false). */
  async function checkRow(row) {
    const file = await fileOf(row);
    const size = file ? await unlessGone(fs.stat(file.real).then((stat) => stat.size)) : null;
    if (size === null) return true;
    if (size > CHECK_LIMIT) {
      const head = await unlessGone(headOf(file.real));
      if (head && sniffMedia(head)) {
        await file.remove();
        console.warn(`A ${where(row)} was removed: at ${Math.round(size / 1048576)} MB it's too big to check.`);
      }
      return true;
    }
    const bytes = await unlessGone(fs.readFile(file.real));
    if (!bytes || !sniffMedia(bytes)) return true;
    const answer = await guard.check({
      bytes,
      origin: row.origin,
      workspaceId: row.workspaceId,
      userId: row.userId,
      botId: row.botId,
      conversationId: row.conversationId,
      path: row.path,
      ip: null
    });
    if (answer.verdict === "unavailable") return again(row);
    if (answer.verdict === "block") {
      await file.remove();
      console.info(`A ${where(row)} was removed: its check blocked it${answer.ref ? ` (${answer.ref})` : ""}.`);
    }
    return true;
  }

  /**
   * One sweep: a batch of the rows whose time has come, AT_ONCE at a time; then the rows done go, in one statement.
   * Answers how many it took.
   */
  async function sweep() {
    if (!guard.on) return 0;
    const rows = await claim();
    const done = [];
    for (let start = 0; start < rows.length; start += AT_ONCE) {
      const group = rows.slice(start, start + AT_ONCE);
      const finished = await Promise.all(group.map((row) => checkRow(row).catch((error) => {
        console.warn(`Checking a ${where(row)} failed; it's tried again later: ${String(error?.message || error).split("\n")[0]}`);
        return again(row).catch(() => false);
      })));
      for (const [index, row] of group.entries()) {
        if (finished[index]) done.push(String(row.id));
      }
    }
    if (done.length) await mediaChecks.deleteWhere({ id: done }, { ...everyHome(), returning: "none" });
    return rows.length;
  }

  /** Every server sweeps, every `sweepMs`, one sweep at a time; without a checker, never. */
  function startSweeping() {
    if (!guard.on) return;
    sweeper ??= setInterval(() => {
      sweeping ??= sweep()
        .catch((error) => console.warn("Sweeping the media checks failed; the next sweep tries again.", error?.message))
        .finally(() => {
          sweeping = null;
        });
    }, sweepMs);
    sweeper.unref();
  }

  /** Stops sweeping here; rows this server took go to another once their lease runs out. */
  function stop() {
    clearInterval(sweeper);
    sweeper = null;
  }

  return Object.freeze({
    on: guard.on,
    check: guard.check,
    checkText: guard.checkText,
    screenshotLater,
    filesLater,
    sweep,
    startSweeping,
    stop
  });
}
