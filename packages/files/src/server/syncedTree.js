import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// A folder on this server kept as a working copy of remote storage (D-91): the files bucket, or a home's own WebDAV or
// Google Drive storage through rclone. Everything that works on files (the routes, the bots' sandboxes, the office
// apps, the desktop) keeps working on real folders here; what's in them comes from the remote (`pull`) and goes back
// to it (`push`). The remote is the truth that every server shares (D-15, D-19):
// - `pull(prefix)` brings a folder up to date before it's read: what changed or appeared remotely is fetched, what went
//   remotely goes here. A change made here that isn't pushed yet is kept, and wins when it's pushed.
// - `push(prefix)` sends what changed here since it was last pulled or pushed: new and changed files, new folders, and
//   files and folders removed here.
// What this server last saw of each path (`known`: its size and change time here, and the remote's version of it)
// tells a change made here from one made elsewhere. Pulls of a folder within PULL_FRESH_MS of the last are skipped,
// unless `fresh`, and a pull asked for while one runs waits for it. Pulls and pushes in one scope (a path's first two
// parts: a home, a computer, a conversation's runs) run one at a time. Links aren't kept remotely: a link a bot made
// stays on the server that made it. Each file is fetched into this tree's own temporary folder, then moved into place,
// so nothing reads a half-fetched file.
export const PULL_FRESH_MS = 1000;
const TRANSFERS = 8;
const TEMPORARY = ".mbsync";

/**
 * @typedef {{ path: string, dir?: boolean, size?: number, version?: string, modified?: number }} RemoteEntry
 * @typedef {object} Remote
 * @property {(prefix: string) => Promise<RemoteEntry[]>} list everything under a folder (its own entry included, if
 *   the remote keeps folders), every level
 * @property {(remotePath: string, file: string) => Promise<string | null>} download fetches a file, answering its
 *   version, or null when it's gone
 * @property {(file: string, remotePath: string) => Promise<string>} upload sends a file, answering its new version
 * @property {(remotePath: string) => Promise<void>} remove removes a file (one already gone is fine)
 * @property {(remotePath: string) => Promise<void>} makeDir
 * @property {(remotePath: string) => Promise<void>} removeDir removes an empty folder (one already gone is fine)
 */

/** Runs `work` on each item, at most `limit` at once; answers the first error after all have run. */
async function eachAtMost(items, limit, work) {
  const errors = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item).catch((error) => errors.push(error));
    }
  }));
  if (errors.length) throw errors[0];
}

const inside = (rel, prefix) => prefix === "" || rel === prefix || rel.startsWith(`${prefix}/`);
const depth = (rel) => rel.split("/").length;
/** A remote path that stays inside the tree: no empty, "." or ".." parts, nothing absolute. */
const safe = (rel) => Boolean(rel) && rel.split("/").every((part) => part && part !== "." && part !== "..");

/**
 * @param {object} options
 * @param {string} options.root the folder here
 * @param {Remote} options.remote
 * @param {() => number} [options.now]
 * @param {boolean} [options.oneScope] the whole tree is one scope (a home's own storage)
 * @param {string} [options.temporary] where files are fetched to before they're moved into place, on the tree's own
 *   disk: by default `.mbsync` in the tree, which nothing in it lists
 */
export function createSyncedTree({ root, remote, now = Date.now, oneScope = false, temporary = path.join(root, TEMPORARY) }) {
  const known = new Map();
  const scopes = new Map();
  const pulls = new Map();
  const scopeOf = (rel) => (oneScope ? "" : rel.split("/").slice(0, 2).join("/"));
  const local = (rel) => path.join(root, ...rel.split("/").filter(Boolean));

  /** Runs `work` once nothing else runs in `rel`'s scope. */
  function exclusive(rel, work) {
    const scope = scopeOf(rel);
    const before = scopes.get(scope) ?? Promise.resolve();
    const run = before.then(work, work);
    const settled = run.catch(() => {});
    scopes.set(scope, settled);
    settled.then(() => {
      if (scopes.get(scope) === settled) scopes.delete(scope);
    });
    return run;
  }

  const changedHere = (entry, stat) => !entry || entry.dir || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs;

  async function fetchInto(entry, file) {
    await fs.mkdir(temporary, { recursive: true });
    const temp = path.join(temporary, randomBytes(8).toString("hex"));
    try {
      const version = await remote.download(entry.path, temp);
      if (version === null) return null;
      if (entry.modified) await fs.utimes(temp, new Date(entry.modified), new Date(entry.modified));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.rename(temp, file);
      return version || entry.version;
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  async function pullNow(prefix, shallow) {
    // Shallow: only what's straight in the folder (a computer's saved browser, not its screenshots).
    const level = (rel) => !shallow || !rel.slice(prefix ? prefix.length + 1 : 0).includes("/");
    const entries = (await remote.list(prefix)).filter((entry) => safe(entry.path) && inside(entry.path, prefix) && level(entry.path));
    const seen = new Set(entries.map((entry) => entry.path));
    for (const entry of entries.filter((each) => each.dir)) {
      await fs.mkdir(local(entry.path), { recursive: true });
      if (!known.has(entry.path)) known.set(entry.path, { dir: true });
    }
    await eachAtMost(entries.filter((each) => !each.dir), TRANSFERS, async (entry) => {
      const before = known.get(entry.path);
      if (before && !before.dir && before.version === entry.version) return;
      const file = local(entry.path);
      const stat = await fs.lstat(file).catch(() => null);
      // A folder or a link where the remote has a file, or a change made here not pushed yet: this server's wins.
      if (stat && (!stat.isFile() || changedHere(before, stat))) return;
      const version = await fetchInto(entry, file);
      if (version === null) return;
      const after = await fs.stat(file);
      known.set(entry.path, { size: after.size, mtimeMs: after.mtimeMs, version });
    });
    // What this server saw that the remote no longer has went elsewhere: it goes here too, deepest first, unless it was
    // changed here since (then it's sent again).
    const gone = [...known.keys()].filter((rel) => inside(rel, prefix) && level(rel) && !seen.has(rel)).sort((a, b) => depth(b) - depth(a));
    for (const rel of gone) {
      const entry = known.get(rel);
      known.delete(rel);
      const stat = await fs.lstat(local(rel)).catch(() => null);
      if (!stat) continue;
      if (entry.dir) await fs.rmdir(local(rel)).catch(() => {});
      else if (stat.isFile() && !changedHere(entry, stat)) await fs.rm(local(rel), { force: true });
    }
  }

  /**
   * Brings the folder `prefix` (a path inside the tree, such as "homes/4/shared") up to date with the remote.
   * @param {string} prefix
   * @param {{ fresh?: boolean, shallow?: boolean }} [how] `fresh`: pull even if it was pulled a moment ago; `shallow`:
   *   only the files straight in the folder
   */
  function pull(prefix, { fresh = false, shallow = false } = {}) {
    // A pull's key is its depth, then its folder (forget reads the folder back from it).
    const key = `${shallow ? "1" : "0"}${prefix}`;
    const state = pulls.get(key) ?? { at: -Infinity, running: null, queued: null };
    pulls.set(key, state);
    if (state.running) {
      if (!fresh) return state.running;
      state.queued ??= state.running.catch(() => {}).then(() => {
        state.queued = null;
        return start();
      });
      return state.queued;
    }
    if (!fresh && now() - state.at < PULL_FRESH_MS) return Promise.resolve();
    return start();

    function start() {
      const startedAt = now();
      state.running = exclusive(prefix, () => pullNow(prefix, shallow)).then(() => {
        state.at = startedAt;
      }).finally(() => {
        state.running = null;
      });
      return state.running;
    }
  }

  /** Every folder and file under the tree path `rel` here, as tree paths, links and the temporary folder left out. */
  async function walk(rel, found) {
    const entries = await fs.readdir(local(rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!rel && path.join(root, entry.name) === temporary) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        found.dirs.push(child);
        await walk(child, found);
      } else if (entry.isFile()) {
        found.files.push(child);
      }
    }
    return found;
  }

  async function pushNow(prefix) {
    const top = await fs.lstat(local(prefix)).catch(() => null);
    const found = top?.isDirectory()
      ? await walk(prefix, { dirs: prefix ? [prefix] : [], files: [] })
      : { dirs: [], files: top?.isFile() ? [prefix] : [] };
    const here = new Set([...found.dirs, ...found.files]);
    for (const rel of found.dirs) {
      const entry = known.get(rel);
      if (entry?.dir) continue;
      if (entry) await remote.remove(rel);
      await remote.makeDir(rel);
      known.set(rel, { dir: true });
    }
    await eachAtMost(found.files, TRANSFERS, async (rel) => {
      const stat = await fs.lstat(local(rel)).catch(() => null);
      if (!stat?.isFile()) return;
      const entry = known.get(rel);
      if (!changedHere(entry, stat)) return;
      if (entry?.dir) await remote.removeDir(rel);
      const version = await remote.upload(local(rel), rel);
      // What was sent is what was looked at before it was read: a change made while it went is sent next time.
      known.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs, version });
    });
    const gone = [...known.keys()].filter((rel) => inside(rel, prefix) && !here.has(rel)).sort((a, b) => depth(b) - depth(a));
    for (const rel of gone) {
      const entry = known.get(rel);
      if (entry.dir) await remote.removeDir(rel);
      else await remote.remove(rel);
      known.delete(rel);
    }
  }

  /** Sends what changed here in the folder `prefix` to the remote. */
  function push(prefix) {
    return exclusive(prefix, () => pushNow(prefix));
  }

  /**
   * Pushes every scope that holds anything here or held something this server saw (so what was removed here goes
   * remotely too): each folder or file one level inside a top folder, such as "homes/4" or "usage-archive/daily".
   * Answers the failures, one per scope.
   */
  async function pushAll() {
    const found = new Set([...known.keys()].filter((rel) => rel.includes("/")).map(scopeOf));
    for (const top of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!top.isDirectory() || top.name.startsWith(".")) continue;
      for (const entry of await fs.readdir(local(top.name), { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory() || entry.isFile()) found.add(`${top.name}/${entry.name}`);
      }
    }
    const failures = [];
    for (const scope of found) await push(scope).catch((error) => failures.push({ scope, error }));
    return failures;
  }

  /**
   * Removes the folder `prefix` and everything in it, remotely and here, whatever this server has seen of it: what
   * a conversation, a computer or a home's storage leaves behind.
   */
  function removeTree(prefix) {
    return exclusive(prefix, async () => {
      const entries = (await remote.list(prefix)).filter((entry) => safe(entry.path) && inside(entry.path, prefix));
      await eachAtMost(entries.filter((entry) => !entry.dir), TRANSFERS, (entry) => remote.remove(entry.path));
      const dirs = entries.filter((each) => each.dir).sort((a, b) => depth(b.path) - depth(a.path));
      for (const entry of dirs) await remote.removeDir(entry.path);
      for (const rel of [...known.keys()]) if (inside(rel, prefix)) known.delete(rel);
      await fs.rm(local(prefix), { recursive: true, force: true });
    });
  }

  /** The names of the folders and files straight under `prefix` remotely, such as every computer's in "computers". */
  async function children(prefix) {
    const names = new Set();
    for (const entry of await remote.list(prefix)) {
      if (!safe(entry.path) || !entry.path.startsWith(`${prefix}/`)) continue;
      names.add(entry.path.slice(prefix.length + 1).split("/")[0]);
    }
    return [...names];
  }

  /**
   * One file here, fetched alone when this server doesn't have it yet (a screenshot another server took), or null when
   * the remote hasn't it either.
   */
  function fetch(rel) {
    if (!safe(rel)) return Promise.resolve(null);
    return exclusive(rel, async () => {
      const file = local(rel);
      if ((await fs.lstat(file).catch(() => null))?.isFile()) return file;
      const version = await fetchInto({ path: rel }, file);
      if (version === null) return null;
      const stat = await fs.stat(file);
      known.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs, version });
      return file;
    });
  }

  /** What the remote holds under the folder `prefix`, every level: `{ path, dir, size, modified }`. */
  async function entries(prefix) {
    return (await remote.list(prefix)).filter((entry) => safe(entry.path) && inside(entry.path, prefix) && entry.path !== prefix);
  }

  /** Removes one file, remotely and here. */
  function removeFile(rel) {
    return exclusive(rel, async () => {
      await remote.remove(rel);
      known.delete(rel);
      await fs.rm(local(rel), { force: true });
    });
  }

  /** Forgets what this server saw under `prefix`, without touching the remote: its copy here goes too. */
  function forget(prefix) {
    return exclusive(prefix, async () => {
      for (const rel of [...known.keys()]) if (inside(rel, prefix)) known.delete(rel);
      for (const rel of [...pulls.keys()]) if (inside(rel.slice(1), prefix)) pulls.delete(rel);
      await fs.rm(local(prefix), { recursive: true, force: true });
    });
  }

  return Object.freeze({
    root,
    pull,
    push,
    pushAll,
    fetch,
    removeTree,
    removeFile,
    entries,
    children,
    forget,
    path: local
  });
}
