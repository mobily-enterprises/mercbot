import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { placeTransfer } from "./fileCopies.js";
import { createRecordFileStore } from "./recordFileStore.js";

// Where bots' files live (D-20, D-21, D-47, D-112). Files belong to a home, in three kinds of folder:
//   <root>/homes/<homeId>/chats/<chatId>/    /files/chat: one chat's, for whoever can open it (R6)
//   <root>/homes/<homeId>/bots/<botId>/everyone/   /files/bot: one bot's, for everyone in the home (Knowledge, pages)
//   <root>/homes/<homeId>/shared/            /files/shared: the whole home's
// A bot names them by those paths, the same ones it sees in its sandboxes, so nothing it writes or reads ever names a
// real path on the server. Every call takes a place:
//   { homeId, chatId, chatKind, botId? }: a chat's files, with its bot's when a bot works there (placeFor);
//   { homeId, botId }: a bot's own folder and the home's (botPlace);
//   { homeId, home: true }: the home's own folder alone (homePlace).
// What a bot makes in a chat belongs to that chat (D13): in a private chat, whose people are fewer than the home's,
// /files/bot and /files/shared only read, in the store and in every sandbox, unless the place is widened (`widened`):
// a person's own action, or the card a person taps, never the bot alone.
export const CHAT = "/files/chat";
export const BOT = "/files/bot";
export const SHARED = "/files/shared";
/**
 * The home's Database files (D-130): the files and pictures records hold, at `tables/<table>/<record>/<field>/<name>`.
 * Everyone reads and copies them; nobody moves, renames, deletes or writes them by hand, so a record's link never
 * breaks: only the table records' own writes put files here (writeRecordFile, removeRecordFile).
 */
export const DB = "/files/db";
// A widened place: only `widened` sets it, so nothing a bot sends (and nothing stored as JSON) can be one.
const WIDE = Symbol("mercbot.files.widened");
const MARKER = ".mercbot-files";
const LIST_LIMIT = 300;
// A folder's walk stops after this many entries, so one that holds something huge (an unpacked
// archive, a node_modules) doesn't make every listing, which runs on each bot turn and after each
// command, stat all of it; such a folder is listed as `partial`.
const WALK_LIMIT = 5000;
// A folder's files are looked at this many at a time: one after another, a turn's listing of
// thousands of files on the shared volume waited for each in turn.
const STAT_BATCH = 32;
// The folders at the volume's top that Mercbot keeps there: homes' files, command outputs, computers' files, profile
// pictures and the usage archive (account retention.js). A private folder (privateFolder) is never one of them.
const STORE_FOLDERS = new Set(["homes", "runs", "computers", "profile-pictures", "usage-archive"]);
const PRIVATE_NAME = /^[a-z][a-z0-9-]{2,40}$/u;

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
 * The refusal for writing in a folder the place may only read: a private chat's bot and home folders (D13), which more
 * people can open than its own.
 */
const onlyReads = (prefix) => (prefix === DB ? dbProtected() : new FilesError(
  403,
  `This is a private chat, so its bots only read ${prefix}: what they make stays in ${CHAT}. ` +
    "Putting it where more people can open it is for a person to do.",
  { code: "files_wider_needs_card", params: { folder: prefix } }
));

/** The refusal for changing Database files by hand. */
const dbProtected = () => new FilesError(
  403,
  "Database files belong to their table's records: copy one out instead of moving it.",
  { code: "files_db_protected" }
);

/** The folders a place has, in words: "/files/chat, /files/bot or /files/shared". */
function placeFolders(place) {
  const named = [...(place.chatId != null ? [CHAT] : []), ...(place.botId != null && !place.home ? [BOT] : []), SHARED];
  return named.length > 1 ? `${named.slice(0, -1).join(", ")} or ${named.at(-1)}` : named[0];
}

/**
 * The bots' and homes' files on this server (see the file header).
 * @param {object} dependencies
 * @param {string} [dependencies.root] A folder the host shares between servers (MERCBOT_FILES_DIR), when there is one.
 * @param {string} dependencies.fallback The folder used without one: `<MERCBOT_DATA_DIR>/files` (filesFolder).
 * @param {{ kind: string, root: string, available?: () => Promise<boolean>, tree?: object | null }} [dependencies.volume]
 *   The files bucket (filesVolume.js, D-91): with one, `root` and `fallback` give way to its working copy here.
 * @param {(homeId: number | string, how: { reading: boolean }) => Promise<string | { dir: string, tree: object } | null>}
 *   dependencies.ownStorage The folder of the home's own storage when it connected one (D-26), with the synced tree
 *   that keeps it (remoteMounts.js), or null for Mercbot's; while the home's files are being moved (D-80) it refuses
 *   all but `reading`.
 * @param {(homeId: number | string) => Promise<void>} dependencies.settle Waits until saves there have arrived.
 * @param {(homeId: number | string) => Promise<void>} dependencies.explain Throws why the home's own storage
 *   didn't answer, when that's known (a Google Drive to sign in again, D-80).
 */
export function createFileStore({ root, fallback, volume = null, ownStorage, settle, explain }) {
  const bucket = volume?.kind === "bucket" ? volume : null;
  const configured = Boolean(root) && !bucket;
  const base = path.resolve(bucket ? bucket.root : root || fallback);
  const unavailable = () => new FilesError(503, "Files aren't available on this server right now.", { code: "files_unavailable" });
  /** A folder of Mercbot's own, as a path inside the bucket's tree ("homes/4/shared"). */
  const inBucket = (dir) => path.relative(base, dir).split(path.sep).join("/");

  /**
   * The files bucket (D-91) is available once its key opened. Without a bucket, a configured folder
   * (MERCBOT_FILES_DIR) is one the host shares between servers and must be mounted; its marker
   * proves it, so a server whose mount is missing never writes files onto its own disk (D-19).
   * Without either, a single machine keeps them in its data folder's files/.
   */
  async function available() {
    if (bucket) return bucket.available();
    if (!configured) {
      await fs.mkdir(base, { recursive: true });
      return true;
    }
    return fs.access(path.join(base, MARKER)).then(() => true, () => false);
  }

  /**
   * The real folders of a place: `chat`, `bot` and `shared`, each null when the place has none, and `readOnly`, the
   * ones the place may only read (a private chat's bot and home folders, unless widened, D13). Only `reading` gets them
   * while the home's files are being moved to other storage (D-80): every other call is refused then, so whatever writes
   * is refused unless it says it only reads.
   */
  async function folders(place, { reading = false, fresh = false } = {}) {
    const { homeId, chatId = null, botId = null, home: homeOnly = false } = place ?? {};
    const named = (id) => id != null && /^\d+$/u.test(String(id));
    const malformed = (id) => id != null && !named(id);
    if (!named(homeId) || (!homeOnly && !named(chatId) && !named(botId)) || malformed(chatId) || malformed(botId)) {
      throw new Error("A file place needs a home, and a chat, a bot or the home's own folder.");
    }
    const given = await ownStorage(homeId, { reading });
    const own = typeof given === "string" ? { dir: given, tree: null } : given;
    if (!own && !(await available())) throw unavailable();
    const home = own?.dir || path.join(base, "homes", String(homeId));
    const dirs = {
      chat: !homeOnly && chatId != null ? path.join(home, "chats", String(chatId)) : null,
      bot: !homeOnly && botId != null ? path.join(home, "bots", String(botId), "everyone") : null,
      shared: path.join(home, "shared"),
      db: path.join(home, "db"),
      // Database files are only read, wherever they're reached from (DB).
      readOnly: narrow(place) ? ["bot", "shared", "db"] : ["db"]
    };
    await pullFolders(dirs, own, homeId, { fresh });
    return dirs;
  }

  /**
   * Whether a place's bot may only read /files/bot and /files/shared: a chat's that isn't public (a private chat, or one
   * whose kind wasn't given), unless it's widened (D13).
   */
  const narrow = (place) => place.chatId != null && place.chatKind !== "public" && !place[WIDE];

  /**
   * Brings the place's folders here up to date from where they're kept (D-91): the home's own storage, through its
   * synced tree, or the files bucket. A home's own storage that doesn't answer says why when that's known, as below.
   */
  async function pullFolders(dirs, own, homeId, { fresh }) {
    const tree = own ? own.tree : bucket?.tree;
    if (!tree) return;
    const relative = (dir) => (own ? path.relative(own.dir, dir).split(path.sep).join("/") : inBucket(dir));
    try {
      await Promise.all([...new Set(rootsOf(dirs).map(([, dir]) => relative(dir)))].map((rel) => tree.pull(rel, { fresh })));
    } catch (error) {
      if (!own) {
        console.warn(`Reading files from the files bucket failed: ${error?.message}`);
        throw unavailable();
      }
      await explain(homeId);
      throw new FilesError(503, "This home's storage isn't answering right now. Try again in a few minutes.", { code: "files_storage_not_answering" });
    }
  }

  /** Sends what changed in the bucket's folder `rel` here; a failure is said and tried again by the volume's own push. */
  async function pushFolder(rel) {
    if (!bucket?.tree) return;
    await bucket.tree.push(rel).catch((error) => console.warn(`Sending ${rel} to the files bucket failed; it's sent again in a moment: ${error?.message}`));
  }

  /**
   * A folder of Mercbot's own in the bucket's tree, pulled here first (`fresh`: even if it was a moment ago; `shallow`:
   * only the files straight in it).
   */
  async function bucketFolder(rel, { fresh = false, shallow = false } = {}) {
    if (!await available()) throw unavailable();
    if (bucket?.tree) {
      await bucket.tree.pull(rel, { fresh, shallow }).catch((error) => {
        console.warn(`Reading ${rel} from the files bucket failed: ${error?.message}`);
        throw unavailable();
      });
    }
    const dir = path.join(base, ...rel.split("/"));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  const rootsOf = (dirs) => [[CHAT, dirs.chat, "chat"], [BOT, dirs.bot, "bot"], [SHARED, dirs.shared, "shared"], [DB, dirs.db, "db"]]
    .filter(([, dir]) => dir);

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
    return bucketFolder(`homes/${homeId}`, { fresh: true });
  }

  /** Deletes the home's folder on Mercbot's own storage, wherever it's kept: a move's old or cancelled copy (D-80). */
  async function removeOwnFolder(homeId) {
    if (!(await available())) throw unavailable();
    if (bucket?.tree) return bucket.tree.removeTree(`homes/${homeId}`);
    await fs.rm(path.join(base, "homes", String(homeId)), { recursive: true, force: true });
  }

  // A bot's whole command outputs in a chat (D-48), by its chat_bots id, on Mercbot's own shared volume, outside every
  // chat's folders: the sandbox sees them read-only at /runs. `runsRoot` is where they all are.
  const runsRoot = path.join(base, "runs");
  const runsFolder = (chatBotId, how) => bucketFolder(`runs/${chatBotId}`, how);
  /** Sends a bot's command outputs in a chat written here to the bucket. */
  const settleRuns = (chatBotId) => pushFolder(`runs/${chatBotId}`);

  // A bot's computer in a chat, by its chat_bots id (D-50, D14): its screenshots and its saved browser, also on
  // Mercbot's own shared volume and outside every chat's folders, never in the database or on a server's own disk.
  // `computersRoot` is where they all are.
  const computersRoot = path.join(base, "computers");
  // Only its own files are pulled: its screenshots are fetched one at a time (computerFile).
  const computerFolder = (chatBotId, how) => bucketFolder(`computers/${chatBotId}`, { ...how, shallow: true });

  /** A file in a computer's folder (`name`, such as "screenshots/<file>"), by its path here, or null when there's none. */
  async function computerFile(chatBotId, name) {
    if (!await available()) throw unavailable();
    const rel = `computers/${chatBotId}/${name}`;
    if (bucket?.tree) {
      return bucket.tree.fetch(rel).catch((error) => {
        console.warn(`Reading ${rel} from the files bucket failed: ${error?.message}`);
        throw unavailable();
      });
    }
    const file = path.join(base, ...rel.split("/"));
    return (await fs.lstat(file).catch(() => null))?.isFile() ? file : null;
  }
  /** Sends a computer's files written here (its screenshots, its saved browser) to the bucket. */
  const settleComputer = (chatBotId) => pushFolder(`computers/${chatBotId}`);

  /** The chat_bots ids that have a computer folder, wherever they're kept. */
  async function computerIds() {
    if (!await available()) return [];
    if (bucket?.tree) return bucket.tree.children("computers");
    return fs.readdir(computersRoot).catch(() => []);
  }

  /** Removes a computer's folder, wherever it's kept. */
  async function removeComputerFolder(chatBotId) {
    if (!/^\d+$/u.test(String(chatBotId))) throw new Error("Removing a computer's folder needs its chat_bots id.");
    if (bucket?.tree) return bucket.tree.removeTree(`computers/${chatBotId}`);
    await fs.rm(path.join(computersRoot, String(chatBotId)), { recursive: true, force: true });
  }

  /** Removes a bot's command outputs in a chat, wherever they're kept: the chat was deleted. */
  async function removeRunsFolder(chatBotId) {
    if (!/^\d+$/u.test(String(chatBotId))) throw new Error("Removing a bot's command outputs in a chat needs its chat_bots id.");
    if (bucket?.tree) return bucket.tree.removeTree(`runs/${chatBotId}`);
    await fs.rm(path.join(runsRoot, String(chatBotId)), { recursive: true, force: true });
  }

  /**
   * Removes a deleted chat's folder (/files/chat), wherever the home keeps its files: Mercbot's own storage or the
   * home's (D-26), whose synced tree then sends the removal on.
   */
  async function removeChatFolder(homeId, chatId) {
    if (!/^\d+$/u.test(String(homeId)) || !/^\d+$/u.test(String(chatId))) throw new Error("A chat's folder needs its home and chat.");
    const given = await ownStorage(homeId, { reading: false });
    const own = typeof given === "string" ? { dir: given, tree: null } : given;
    if (!own && !(await available())) throw unavailable();
    const home = own?.dir || path.join(base, "homes", String(homeId));
    const dir = path.join(home, "chats", String(chatId));
    if (!own && bucket?.tree) return bucket.tree.removeTree(inBucket(dir));
    await fs.rm(dir, { recursive: true, force: true });
    if (own) await settle(homeId);
  }

  /**
   * The command outputs kept, wherever they are: `{ chatBotId, name, modified }` (`modified` in ms), and how to
   * remove one (D-48's week).
   */
  async function runOutputs() {
    if (bucket?.tree) {
      if (!await available()) return [];
      return (await bucket.tree.entries("runs")).filter((entry) => !entry.dir && entry.path.split("/").length === 3)
        .map((entry) => ({ chatBotId: entry.path.split("/")[1], name: entry.path.split("/")[2], modified: entry.modified }));
    }
    const found = [];
    for (const chatBotId of await fs.readdir(runsRoot).catch(() => [])) {
      for (const name of await fs.readdir(path.join(runsRoot, chatBotId)).catch(() => [])) {
        const stat = await fs.stat(path.join(runsRoot, chatBotId, name)).catch(() => null);
        if (stat?.isFile()) found.push({ chatBotId, name, modified: stat.mtimeMs });
      }
    }
    return found;
  }
  async function removeRunOutput(chatBotId, name) {
    if (bucket?.tree) return bucket.tree.removeFile(`runs/${chatBotId}/${name}`);
    await fs.rm(path.join(runsRoot, String(chatBotId), String(name)), { force: true });
    await fs.rmdir(path.join(runsRoot, String(chatBotId))).catch(() => {});
  }

  // People's profile pictures (D-19, profilePictures.js), on Mercbot's own shared volume as well,
  // outside every person's folders, never on a server's own disk.
  // With the bucket, `userId` names the person whose folder is pulled first.
  async function profilePicturesFolder(userId) {
    if (userId === undefined) return bucketFolder("profile-pictures");
    await bucketFolder(`profile-pictures/${userId}`);
    return path.join(base, "profile-pictures");
  }
  /** Sends a person's profile picture written or removed here to the bucket. */
  const settleProfilePicture = (userId) => pushFolder(`profile-pictures/${userId}`);

  /**
   * A folder of a copy built on Mercbot's own, by its name, beside the store's folders on the shared volume (or in the
   * data folder's files, without one; D-90): outside every person's, home's and computer's folders, so no route serves it
   * and no bot's sandbox mounts it, and made for this server's user alone (mode 700). A name the store already uses, or
   * one that isn't a short lowercase word with hyphens, is refused; so is every name while the volume isn't mounted
   * (files_unavailable).
   * @param {string} name
   */
  async function privateFolder(name) {
    if (!PRIVATE_NAME.test(String(name)) || STORE_FOLDERS.has(name)) {
      throw new Error(`"${name}" can't be a private folder's name: use 3 to 41 lowercase letters, digits and hyphens, not one of ${[...STORE_FOLDERS].join(", ")}.`);
    }
    const dir = await bucketFolder(name);
    await fs.chmod(dir, 0o700);
    return dir;
  }

  /**
   * "/files/chat/a/b.docx" → the real path, or null outside the place's folders; for writing unless `reading`, which in a
   * folder the place only reads is refused (files_wider_needs_card).
   */
  async function resolve(place, virtualPath, { reading = false } = {}) {
    const value = path.posix.normalize(String(virtualPath || "").trim());
    const dirs = await folders(place, { reading });
    for (const [prefix, dir, name] of rootsOf(dirs)) {
      if (!value.startsWith(`${prefix}/`)) continue;
      const real = path.join(dir, value.slice(prefix.length + 1));
      if (!real.startsWith(dir + path.sep)) return null;
      if (!reading && dirs.readOnly.includes(name)) throw onlyReads(prefix);
      return real;
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
    const found = (stat) => stat?.isFile() || (folder && stat?.isDirectory());
    let stat = await fs.lstat(real).catch(() => null);
    // Kept elsewhere (D-91), it may have come since this server last looked: looked for once more, just pulled.
    if (!found(stat) && (bucket || (await ownStorage(place.homeId, { reading: true }))?.tree)) {
      await folders(place, { reading, fresh: true });
      stat = await fs.lstat(real).catch(() => null);
    }
    if (!found(stat)) {
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
   * An existing folder the bot may reach and change, one of its folders ("/files/chat") or a folder in one, by its
   * link-free real path and the path the bot gives it: what a coding run's own sandbox is given (D-77), so a link can't
   * lead it anywhere else. A folder the place only reads is refused (D13).
   */
  async function existingFolder(place, virtualPath) {
    const value = path.posix.normalize(String(virtualPath || "").trim()).replace(/(.)\/$/u, "$1");
    const dirs = await folders(place);
    const root = rootsOf(dirs).find(([prefix]) => prefix === value);
    if (!root) return { real: (await existingEntry(place, value, { folder: true })).real, virtualPath: value };
    if (dirs.readOnly.includes(root[2])) throw onlyReads(root[0]);
    const real = await fs.realpath(root[1]).catch(() => null);
    if (!real || !(await fs.lstat(real)).isDirectory()) {
      throw new FilesError(404, "That folder isn't there any more.", { code: "files_file_gone" });
    }
    return { real, virtualPath: value };
  }

  /** The place's folders a listing names, by key: chat, bot and shared, each when the place has it. */
  const sectionsOf = (dirs) => rootsOf(dirs).map(([prefix, dir, key]) => [key, dir, prefix]);
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
   * The files in the place's folders and all their sub-folders, each folder's newest 300: { chat, bot
   * and shared (each when the place has it), left, partial }. `left` counts, for each folder
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
   * Every file in the place's folders and their sub-folders, hidden ones too, changed at or after `since` (a time in
   * ms), by its path. Unlike `list` it has no limit, so it costs what the place holds: only a copy that checks pictures
   * and videos asks it, once a command ends, for every file the command may have written (D-90).
   */
  async function changedSince(place, since) {
    const changed = [];
    async function walkAll(dir, prefix) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const files = await filesIn(dir, prefix, entries.filter((entry) => entry.isFile()));
      changed.push(...files.filter((file) => Date.parse(file.modified) >= since).map((file) => file.path));
      for (const entry of entries.filter((each) => each.isDirectory())) await walkAll(path.join(dir, entry.name), `${prefix}/${entry.name}`);
    }
    for (const [, dir, prefix] of sectionsOf(await prepare(place, { reading: true }))) await walkAll(dir, prefix);
    return changed;
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
   * Every sub-folder of the place's folders, for Move to…: { chat, bot and shared, each when the
   * place has it }, each a list of folder paths in name order. Only folders are read, at most
   * 5,000 in each of the place's folders.
   */
  async function folderTree(place) {
    const dirs = await prepare(place, { reading: true });
    const tree = {};
    for (const [key, dir, prefix] of sectionsOf(dirs)) {
      // Database files take nothing moved in (DB): never a destination.
      if (key === "db") continue;
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
   * Moving between the folders is how a file becomes the chat's, the bot's or the home's (D-21, D-47, D13); moving
   * within one renames. Folders move too, never a folder into itself. A folder the place only reads takes nothing and
   * gives nothing up.
   */
  async function move(place, from, to) {
    await prepare(place);
    const source = await existingEntry(place, from, { folder: true });
    const target = await resolve(place, to);
    if (!target) {
      throw new FilesError(400, `Files can only go in ${placeFolders(place)}.`, {
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

  /** Deletes a file, or an empty folder (never one of the place's folders themselves). */
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
      throw new FilesError(400, `Folders can only go in ${placeFolders(place)}.`, {
        code: "files_folder_destination_invalid"
      });
    }
    const stat = await fs.lstat(target).catch(() => null);
    if (stat && !stat.isDirectory()) throw new FilesError(409, "There's already a file there.", { code: "files_destination_taken" });
    await fs.mkdir(target, { recursive: true });
  }

  // Copy to… and Move to… between places (fileCopies.js, D-120).
  const transfer = placeTransfer({ prepare, existingEntry, existingFolder, makeFolder });

  /**
   * Waits until what changed in the home's files here has reached where they're kept: the files bucket (D-91) and the
   * home's own storage (`settle`, D-26).
   */
  /** Sends what changed in a private folder (privateFolder) here to the bucket. */
  function settlePrivate(name) {
    return pushFolder(name);
  }

  async function settleHome(homeId) {
    await pushFolder(`homes/${homeId}`);
    await settle(homeId);
  }

  /**
   * A chat's files (R6): its folder at /files/chat, with its bot's at /files/bot when `botId` is given, and the home's
   * at /files/shared. `chatKind` is the chat's: in a private chat, or when it isn't given, the bot only reads
   * /files/bot and /files/shared (D13).
   * @param {{ homeId: string | number, chatId: string | number, chatKind?: "public" | "private", botId?: string | number | null }} chat
   */
  function placeFor({ homeId, chatId, chatKind = null, botId = null }) {
    return Object.freeze({
      homeId: String(homeId),
      chatId: String(chatId),
      chatKind: chatKind === "public" ? "public" : "private",
      botId: botId == null ? null : String(botId)
    });
  }

  /** A bot's own folder (/files/bot) and the home's (/files/shared): its Knowledge files and pages, everyone's in the home. */
  const botPlace = ({ homeId, botId }) => Object.freeze({ homeId: String(homeId), botId: String(botId) });

  /** The home's own folder alone, for the home's Files page. */
  const homePlace = (homeId) => Object.freeze({ homeId: String(homeId), home: true });

  /**
   * The same place, whose bot may write in /files/bot and /files/shared even in a private chat: for what a person does
   * themselves (the file routes), or a card a person tapped (D13). Server code only: the mark can't be sent or stored.
   */
  const widened = (place) => Object.freeze({ ...place, [WIDE]: true });

  const recordFiles = createRecordFileStore({ DB, prepare, homePlace, settleHome });
  return Object.freeze({
    available,
    ownFolder,
    removeOwnFolder,
    prepare,
    resolve,
    existingFile,
    existingFolder,
    list,
    changedSince,
    listFolder,
    folderTree,
    move,
    transfer,
    remove,
    makeFolder,
    settle: settleHome,
    placeFor,
    botPlace,
    homePlace,
    widened,
    removeChatFolder,
    runsFolder,
    removeRunsFolder,
    runsRoot,
    settleRuns,
    runOutputs,
    removeRunOutput,
    computerFolder,
    computerFile,
    computersRoot,
    settleComputer,
    computerIds,
    removeComputerFolder,
    profilePicturesFolder,
    settleProfilePicture,
    privateFolder,
    settlePrivate,
    writeRecordFile: recordFiles.writeRecordFile,
    removeRecordFile: recordFiles.removeRecordFile
  });
}
