import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

// Where bots' files live (D-20, D-21, D-36, D-47). Files belong to a home, in three folders:
//   <root>/homes/<homeId>/shared/                          /files/shared: the whole home
//   <root>/homes/<homeId>/bots/<botId>/everyone/           /files/bot: everyone using the bot
//   <root>/homes/<homeId>/bots/<botId>/people/<userId>/    /files/mine: one person with the bot
// A bot names them by those paths, the same ones it sees in its sandboxes, so nothing it writes or
// reads ever names a real path on the server. Every call takes a place: { homeId, botId, userId }
// for a person with a bot; { homeId, botId, everyone: true } where nothing personal may be reached
// (a shared bot, whose old /files/mine paths still lead to its bot folder); or
// { homeId, home: true } for the home's own folder alone.
export const MINE = "/files/mine";
export const BOT = "/files/bot";
export const SHARED = "/files/shared";
const MARKER = ".mercbot-files";
const LIST_LIMIT = 300;
// A folder's walk stops after this many entries, so one that holds something huge (an unpacked
// archive, a node_modules) doesn't make every listing, which runs on each bot turn and after each
// command, stat all of it; such a folder is listed as `partial`.
const WALK_LIMIT = 5000;
// A folder's files are looked at this many at a time: one after another, a turn's listing of
// thousands of files on the shared volume waited for each in turn.
const STAT_BATCH = 32;

export class FilesError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "FilesError";
  }
}

/**
 * The bots' and homes' files on this server (see the file header).
 * @param {object} dependencies
 * @param {string} [dependencies.root] The shared volume (MERCBOT_FILES_DIR), when there is one.
 * @param {string} dependencies.fallback The folder used without one: `<MERCBOT_DATA_DIR>/files` (filesFolder).
 * @param {(homeId: number | string, how: { reading: boolean }) => Promise<string | null>} dependencies.ownStorage The
 *   folder of the home's own storage when it connected one (D-26), or null for Mercbot's; while the home's files are
 *   being moved (D-80) it refuses all but `reading`.
 * @param {(homeId: number | string) => Promise<void>} dependencies.settle Waits until saves there have arrived.
 * @param {(homeId: number | string) => Promise<void>} dependencies.explain Throws why the home's own storage
 *   didn't answer, when that's known (a Google Drive to sign in again, D-80).
 */
export function createFileStore({ root, fallback, ownStorage, settle, explain }) {
  const configured = Boolean(root);
  const base = path.resolve(root || fallback);

  /**
   * A configured folder is a shared volume (JuiceFS on servers, D-20) and must be mounted; its
   * marker proves it, so a server whose mount is missing never writes files onto its own disk
   * (D-19). Without one, a single machine keeps them in its data folder's files/.
   */
  async function available() {
    if (!configured) {
      await fs.mkdir(base, { recursive: true });
      return true;
    }
    return fs.access(path.join(base, MARKER)).then(() => true, () => false);
  }

  /**
   * The real folders of a place: `mine` is the person's own (for a place without a person, the
   * bot folder, so the /files/mine every sandbox has still leads somewhere), `personal` says
   * whether it really is theirs, and `bot` is null for the home's own place. Only `reading` gets
   * them while the home's files are being moved to other storage (D-80): every other call is
   * refused then, so whatever writes is refused unless it says it only reads.
   */
  async function folders({ homeId, botId, userId, everyone = false, home: homeOnly = false }, { reading = false } = {}) {
    if (!homeId || !(homeOnly || (botId && (userId || everyone)))) {
      throw new Error("A file place needs a home, and a bot with a person or everyone.");
    }
    const own = await ownStorage(homeId, { reading });
    if (!own && !(await available())) {
      throw new FilesError(503, "Files aren't available on this server right now.", { code: "files_unavailable" });
    }
    const home = own || path.join(base, "homes", String(homeId));
    const shared = path.join(home, "shared");
    if (homeOnly) return { mine: null, bot: null, shared, personal: false };
    const bot = path.join(home, "bots", String(botId));
    const everyoneFolder = path.join(bot, "everyone");
    return everyone
      ? { mine: everyoneFolder, bot: everyoneFolder, shared, personal: false }
      : { mine: path.join(bot, "people", String(userId)), bot: everyoneFolder, shared, personal: true };
  }

  const rootsOf = (dirs) => [[MINE, dirs.mine], [BOT, dirs.bot], [SHARED, dirs.shared]].filter(([, dir]) => dir);

  /**
   * The place's folders, made when missing (empty folders, which a move of the home's files needn't carry); `reading`
   * gets them while the files are being moved (see folders).
   */
  async function prepare(place, { reading = false } = {}) {
    const dirs = await folders(place, { reading });
    try {
      for (const [, dir] of rootsOf(dirs)) await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // A home's own storage that doesn't answer (rclone's I/O error, a mount that went away) says so, rather than
      // failing as an unknown error: WebDAV storage offline, or a Google Drive that turned its key down, which is then
      // renewed at once, so it says "Sign in again" if Google refused that (D-80).
      if (error?.code !== "EIO" && error?.code !== "ENOTCONN") throw error;
      await explain(place.homeId);
      throw new FilesError(503, "This home's storage isn't answering right now. Try again in a few minutes.", { code: "files_storage_not_answering" });
    }
    return dirs;
  }

  /**
   * The home's folder on Mercbot's own storage, whatever the home keeps its files in now: what a move to or from
   * Mercbot's storage copies (D-80, fileMoves.js). Refused while the shared volume isn't mounted, so a move never copies
   * an empty folder over a person's files, nor fills a server's own disk.
   */
  async function ownFolder(homeId) {
    if (!(await available())) throw new FilesError(503, "Files aren't available on this server right now.", { code: "files_unavailable" });
    return path.join(base, "homes", String(homeId));
  }

  // A conversation's whole command outputs (D-48), on Mercbot's own shared volume, outside every
  // person's folders: the sandbox sees them read-only at /runs. `runsRoot` is where they all are.
  const runsRoot = path.join(base, "runs");
  async function runsFolder(conversationId) {
    if (!await available()) throw new FilesError(503, "Files aren't available on this server right now.", { code: "files_unavailable" });
    const dir = path.join(runsRoot, String(conversationId));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  // A bot computer's own files (D-50): its screenshots and its saved browser, also on Mercbot's
  // own shared volume and outside every person's folders, never in the database or on a server's
  // own disk. `computersRoot` is where they all are.
  const computersRoot = path.join(base, "computers");
  async function computerFolder(conversationId) {
    if (!await available()) throw new FilesError(503, "Files aren't available on this server right now.", { code: "files_unavailable" });
    const dir = path.join(computersRoot, String(conversationId));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  // People's profile pictures (D-19, profilePictures.js), on Mercbot's own shared volume as well,
  // outside every person's folders, never on a server's own disk.
  async function profilePicturesFolder() {
    if (!await available()) throw new FilesError(503, "Files aren't available on this server right now.", { code: "files_unavailable" });
    const dir = path.join(base, "profile-pictures");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** "/files/mine/a/b.docx" → the real path, or null outside the place's folders; for writing unless `reading`. */
  async function resolve(place, virtualPath, { reading = false } = {}) {
    const value = path.posix.normalize(String(virtualPath || "").trim());
    const dirs = await folders(place, { reading });
    for (const [prefix, dir] of rootsOf(dirs)) {
      if (!value.startsWith(`${prefix}/`)) continue;
      const real = path.join(dir, value.slice(prefix.length + 1));
      if (real.startsWith(dir + path.sep)) return real;
    }
    return null;
  }

  /**
   * An existing regular file the bot may reach. The app sandbox lets a bot make links, so the
   * link-free real path is checked too: a link can never lead a download anywhere else.
   */
  async function existingEntry(place, virtualPath, { folder = false, reading = false } = {}) {
    const real = await resolve(place, virtualPath, { reading });
    if (!real) throw new FilesError(400, "That's not one of the bot's files.", { code: "files_path_outside" });
    const stat = await fs.lstat(real).catch(() => null);
    if (!(stat?.isFile() || (folder && stat?.isDirectory()))) {
      throw new FilesError(404, "That file isn't there any more.", { code: "files_file_gone" });
    }
    const dirs = await folders(place, { reading });
    const canonical = await fs.realpath(real);
    const allowed = await Promise.all(rootsOf(dirs).map(([, dir]) => fs.realpath(dir).catch(() => dir)));
    if (!allowed.some((dir) => canonical.startsWith(dir + path.sep))) {
      throw new FilesError(400, "That's not one of the bot's files.", { code: "files_path_outside" });
    }
    return { real: canonical, stat };
  }
  /** An existing file to read, or to change in place with `writing` (refused while the home's files are moved). */
  const existingFile = (place, virtualPath, { writing = false } = {}) => existingEntry(place, virtualPath, { reading: !writing });

  /**
   * An existing folder the bot may reach, one of its folders ("/files/mine") or a folder in one,
   * by its link-free real path and the path the bot gives it: what a coding run's own sandbox is
   * given (D-77), so a link can't lead it anywhere else.
   */
  async function existingFolder(place, virtualPath) {
    const value = path.posix.normalize(String(virtualPath || "").trim()).replace(/(.)\/$/u, "$1");
    const root = rootsOf(await folders(place)).find(([prefix]) => prefix === value);
    if (!root) return { real: (await existingEntry(place, value, { folder: true })).real, virtualPath: value };
    const real = await fs.realpath(root[1]).catch(() => null);
    if (!real || !(await fs.lstat(real)).isDirectory()) {
      throw new FilesError(404, "That folder isn't there any more.", { code: "files_file_gone" });
    }
    return { real, virtualPath: value };
  }

  /** The place's folders a listing names: mine only when it's the person's own. */
  const sectionsOf = (dirs) => [
    ...(dirs.personal ? [["mine", dirs.mine, MINE]] : []),
    ...(dirs.bot ? [["bot", dirs.bot, BOT]] : []),
    ["shared", dirs.shared, SHARED]
  ];
  const byNewest = (a, b) => b.modified.localeCompare(a.modified);
  const visible = (entries) => entries.filter((entry) => !entry.name.startsWith("."));

  /** The files among a folder's entries as { path, size, modified }, STAT_BATCH looked at at a time. */
  async function filesIn(dir, prefix, entries) {
    const files = [];
    for (let start = 0; start < entries.length; start += STAT_BATCH) {
      const batch = await Promise.all(entries.slice(start, start + STAT_BATCH).map(async (entry) => {
        const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
        return stat && { path: `${prefix}/${entry.name}`, size: stat.size, modified: stat.mtime.toISOString() };
      }));
      files.push(...batch.filter(Boolean));
    }
    return files;
  }

  /** A folder's files, then its sub-folders' in turn, until WALK_LIMIT files are found. */
  async function walk(dir, prefix, found) {
    const entries = visible(await fs.readdir(dir, { withFileTypes: true }).catch(() => []));
    const files = entries.filter((entry) => entry.isFile());
    const room = WALK_LIMIT - found.entries.length;
    found.entries.push(...(await filesIn(dir, prefix, files.slice(0, room))));
    if (files.length > room) found.partial = true;
    for (const entry of entries.filter((each) => each.isDirectory())) {
      if (found.entries.length >= WALK_LIMIT) {
        found.partial = true;
        return found;
      }
      await walk(path.join(dir, entry.name), `${prefix}/${entry.name}`, found);
    }
    return found;
  }

  /**
   * The files in the place's folders and all their sub-folders, each folder's newest 300: { mine
   * (only when it's the person's own), bot, shared, left, partial }. `left` counts, for each folder
   * with more, the older files left out. A folder named in `partial` has more than 5,000 files; its
   * walk stopped there, so its 300 are the newest of the first 5,000 found. The bots' turns and
   * tools read this; the file browser reads one folder at a time (listFolder).
   */
  async function list(place) {
    const dirs = await prepare(place, { reading: true });
    const listing = {};
    const left = {};
    const partial = [];
    const sections = sectionsOf(dirs);
    const walked = await Promise.all(sections.map(([, dir, prefix]) => walk(dir, prefix, { entries: [], partial: false })));
    sections.forEach(([key], index) => {
      const all = walked[index].entries.sort(byNewest);
      listing[key] = all.slice(0, LIST_LIMIT);
      if (all.length > LIST_LIMIT) left[key] = all.length - LIST_LIMIT;
      if (walked[index].partial) partial.push(key);
    });
    return { ...listing, left, partial };
  }

  /**
   * The real folder at a folder path of the place ("/files/bot" or "/files/bot/Invoices"), null
   * when it isn't there (any more), or an error outside the place's folders or for a file.
   */
  async function folderAt(place, at) {
    const root = rootsOf(await prepare(place, { reading: true })).find(([prefix]) => prefix === at);
    if (root) return root[1];
    const found = await existingEntry(place, at, { folder: true, reading: true }).catch((error) => {
      if (error?.code === "files_file_gone") return null;
      throw error;
    });
    if (found && !found.stat.isDirectory()) throw new FilesError(400, "That's a file, not a folder.", { code: "files_not_folder" });
    return found?.real ?? null;
  }

  /**
   * What's directly in one of the place's folders, for the file browser: { path, entries, left,
   * partial }. `entries` are its sub-folders ({ path, folder: true }, by name), then its newest
   * 300 files ({ path, size, modified }); `left` counts its older files left out. Only its first
   * 5,000 entries are read, and `partial` then says it has more. A folder that isn't there (any
   * more) is empty.
   */
  async function listFolder(place, virtualFolder) {
    const at = path.posix.normalize(String(virtualFolder || "").trim()).replace(/(?<=.)\/+$/u, "");
    const dir = await folderAt(place, at);
    const entries = dir ? visible(await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) : [];
    const read = entries.slice(0, WALK_LIMIT);
    const folders = read
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ path: `${at}/${entry.name}`, folder: true }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const files = (await filesIn(dir, at, read.filter((entry) => entry.isFile()))).sort(byNewest);
    return {
      path: at,
      entries: [...folders, ...files.slice(0, LIST_LIMIT)],
      left: Math.max(0, files.length - LIST_LIMIT),
      partial: entries.length > WALK_LIMIT
    };
  }

  /**
   * Every sub-folder of the place's folders, for Move to…: { mine (only when it's the person's
   * own), bot, shared }, each a list of folder paths in name order. Only folders are read, at most
   * 5,000 in each of the place's folders.
   */
  async function folderTree(place) {
    const dirs = await prepare(place, { reading: true });
    const tree = {};
    for (const [key, dir, prefix] of sectionsOf(dirs)) {
      const found = [];
      const descend = async (real, at) => {
        for (const entry of visible(await fs.readdir(real, { withFileTypes: true }).catch(() => []))) {
          if (found.length >= WALK_LIMIT) return;
          if (!entry.isDirectory()) continue;
          found.push(`${at}/${entry.name}`);
          await descend(path.join(real, entry.name), `${at}/${entry.name}`);
        }
      };
      await descend(dir, prefix);
      tree[key] = found.sort((a, b) => a.localeCompare(b));
    }
    return tree;
  }

  /**
   * Moving between the folders is how a file becomes private, the bot's or the home's (D-21,
   * D-47); moving within one renames. Folders move too, never a folder into itself.
   */
  async function move(place, from, to) {
    await prepare(place);
    const source = await existingEntry(place, from, { folder: true });
    const target = await resolve(place, to);
    if (!target) {
      throw new FilesError(400, "Files can only go in /files/mine, /files/bot or /files/shared.", {
        code: "files_file_destination_invalid"
      });
    }
    if (
      await fs.lstat(target).then(
        () => true,
        () => false
      )
    ) {
      throw new FilesError(409, "There's already a file there.", { code: "files_destination_taken" });
    }
    if (source.stat.isDirectory() && (target + path.sep).startsWith(source.real + path.sep)) {
      throw new FilesError(400, "A folder can't go inside itself.", { code: "files_folder_into_itself" });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source.real, target);
  }

  /** Deletes a file, or an empty folder (never one of the three folders themselves). */
  async function remove(place, virtualPath) {
    const entry = await existingEntry(place, virtualPath, { folder: true });
    if (!entry.stat.isDirectory()) return fs.unlink(entry.real);
    if ((await fs.readdir(entry.real)).length) throw new FilesError(409, "That folder isn't empty.", { code: "files_folder_not_empty" });
    await fs.rmdir(entry.real);
  }

  async function makeFolder(place, virtualPath) {
    await prepare(place);
    const target = await resolve(place, virtualPath);
    if (!target) {
      throw new FilesError(400, "Folders can only go in /files/mine, /files/bot or /files/shared.", {
        code: "files_folder_destination_invalid"
      });
    }
    const stat = await fs.lstat(target).catch(() => null);
    if (stat && !stat.isDirectory()) throw new FilesError(409, "There's already a file there.", { code: "files_destination_taken" });
    await fs.mkdir(target, { recursive: true });
  }

  /** Where a bot's files are for a person: a shared bot's are everyone's in its home (D-36). */
  function placeFor(bot, userId) {
    return bot.sharing === "shared"
      ? { homeId: bot.workspace_id, botId: bot.id, everyone: true }
      : { homeId: bot.workspace_id, botId: bot.id, userId };
  }

  /** The home's own folder alone, for the home's Files page. */
  const homePlace = (homeId) => ({ homeId, home: true });

  return Object.freeze({
    available,
    ownFolder,
    prepare,
    resolve,
    existingFile,
    existingFolder,
    list,
    listFolder,
    folderTree,
    move,
    remove,
    makeFolder,
    settle,
    placeFor,
    homePlace,
    runsFolder,
    runsRoot,
    computerFolder,
    computersRoot,
    profilePicturesFolder
  });
}
