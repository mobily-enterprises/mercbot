import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { FilesError } from "./fileStore.js";

// The file store's copies (fileStore.js transfer, Copy to… and Move to…, D-120): a file or a whole folder copied one
// directory entry at a time, never read into memory whole, and a free name for what arrives.

/** Copies a file to `to`, never over one already there. */
export const copyFileOnce = (from, to) => fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);

/**
 * A free name for `name` in the real folder `dir`: the name itself, else "<stem> (2)<ext>", "(3)" and on, as uploads
 * name theirs.
 */
export async function freeName(dir, name) {
  const { name: stem, ext } = path.parse(name);
  let free = name;
  for (let count = 2; await fs.lstat(path.join(dir, free)).then(() => true, () => false); count += 1) free = `${stem} (${count})${ext}`;
  return free;
}

/**
 * Copies a folder's files and sub-folders into `to` (made here), one directory entry at a time, so a large folder is
 * never read into memory whole. Links are left out: one could lead outside the place. `each` hears every file copied,
 * by its path inside the folder ("a/b.txt").
 */
export async function copyTree(from, to, each, inner = "") {
  await fs.mkdir(to);
  for await (const entry of await fs.opendir(from)) {
    const at = inner ? `${inner}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await copyTree(path.join(from, entry.name), path.join(to, entry.name), each, at);
    else if (entry.isFile()) await copyFileOnce(path.join(from, entry.name), path.join(to, entry.name)).then(() => each(at));
  }
}

/** Every file under a folder, by its path inside it, one directory entry at a time; links left out. */
export async function eachFile(dir, each, inner = "") {
  for await (const entry of await fs.opendir(dir)) {
    const at = inner ? `${inner}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await eachFile(path.join(dir, entry.name), each, at);
    else if (entry.isFile()) await each(at);
  }
}

/**
 * The store's transfer (fileStore.js), on its own place reads and writes: `prepare`, `existingEntry`, `existingFolder`
 * and `makeFolder`.
 * @param {{ prepare: Function, existingEntry: Function, existingFolder: Function, makeFolder: Function }} store
 */
export function placeTransfer({ prepare, existingEntry, existingFolder, makeFolder }) {
  /**
   * Copies or moves (`move`) a file or a whole folder from one place to a folder of another (or the same) place, both of
   * the same home: Copy to… and Move to… (fileTransfer.js). The source must be there (404); a folder that isn't is made; a name
   * taken there gets " (2)", " (3)" before its extension. Moving into the folder it's already in, or a folder into
   * itself or one of its own folders, is refused (409 files_transfer_same); so is copying a folder into itself. Both
   * places write, so it's refused while the home's files are moved to other storage (D-80). `each` hears every file
   * the destination got, by its path inside what was copied or moved ("" for a single file), with the destination's
   * own path. Answers the destination's path and whether it's a folder.
   * @param {{ from: { place: object, path: string }, to: { place: object, folder: string }, move?: boolean, each?: (inner: string, landed: string) => Promise<void> }} transfer
   */
  return async function transfer({ from, to, move = false, each = async () => {} }) {
    await prepare(to.place);
    if (move) await prepare(from.place);
    const source = await existingEntry(from.place, from.path, { folder: true, reading: !move });
    const folder = path.posix.normalize(String(to.folder || "").trim()).replace(/(?<=.)\/+$/u, "");
    // A folder that isn't there yet is made, as New folder makes one: "Add from files…" copies into Uploads.
    const target = await existingFolder(to.place, folder).catch(async (error) => {
      if (error?.code !== "files_file_gone") throw error;
      await makeFolder(to.place, folder);
      return existingFolder(to.place, folder);
    });
    if (!(await fs.lstat(target.real)).isDirectory()) throw new FilesError(400, "That's a file, not a folder.", { code: "files_not_folder" });
    const same = () => new FilesError(409, "That's where it already is.", { code: "files_transfer_same" });
    if (move && path.dirname(source.real) === target.real) throw same();
    if (source.stat.isDirectory() && (target.real + path.sep).startsWith(source.real + path.sep)) throw same();
    const name = await freeName(target.real, path.posix.basename(path.posix.normalize(String(from.path))));
    const real = path.join(target.real, name);
    const landed = `${target.virtualPath}/${name}`;
    const heard = (inner) => each(inner, landed);
    const isFolder = source.stat.isDirectory();
    if (move) {
      try {
        await fs.rename(source.real, real);
      } catch (error) {
        // Folders on different disks (a home's own storage mounted beside Mercbot's) are copied, then removed.
        if (error?.code !== "EXDEV") throw error;
        if (isFolder) await copyTree(source.real, real, async () => {});
        else await copyFileOnce(source.real, real);
        await fs.rm(source.real, { recursive: true, force: true });
      }
      if (isFolder) await eachFile(real, heard);
      else await heard("");
    } else if (isFolder) {
      await copyTree(source.real, real, heard);
    } else {
      await copyFileOnce(source.real, real);
      await heard("");
    }
    return { path: landed, folder: isFolder };
  };
}
