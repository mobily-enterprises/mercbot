import fs from "node:fs/promises";
import path from "node:path";

/**
 * A home's Database files (D-130) as the table records write them: each record's file at its fixed place, copied in,
 * and removed once no record holds it. Nothing else writes there (fileStore.js refuses it).
 * @param {object} store the file store's own parts
 * @param {string} store.DB the Database files' path for bots and people ("/files/db")
 * @param {(place: object) => Promise<object>} store.prepare the place's folders, made when missing
 * @param {(homeId: string) => object} store.homePlace
 * @param {(homeId: string) => Promise<void>} store.settleHome sends the home's folder to its storage
 */
export function createRecordFileStore({ DB, prepare, homePlace, settleHome }) {
  /**
   * A record's file, copied from `source` (a real path the caller may read) to its Database files place,
   * `/files/db/tables/<table>/<record>/<field>/<name>` (a name taken there gets a number), and sent to the home's
   * storage. Only the table records' writes call this: Database files take nothing by hand. Answers the file's path,
   * name and size.
   * @param {string | number} homeId
   * @param {{ table: string, record: string, field: string }} at keys and id, each a plain name
   * @param {string} source
   * @param {string} name the file's name as given
   */
  async function writeRecordFile(homeId, at, source, name) {
    const dirs = await prepare(homePlace(homeId));
    const parts = [at.table, at.record, at.field].map(String);
    if (!parts.every((part) => /^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(part))) throw new Error("A record file's table, record and field are plain names.");
    const folder = path.join(dirs.db, "tables", ...parts);
    await fs.mkdir(folder, { recursive: true });
    const clean = path.basename(String(name || "file")).replace(/[\p{Cc}/\\]/gu, "").slice(0, 120) || "file";
    const { name: stem, ext } = path.parse(clean);
    let chosen = clean;
    for (let n = 2; await fs.lstat(path.join(folder, chosen)).then(() => true, () => false); n += 1) chosen = `${stem} (${n})${ext}`;
    const temporary = path.join(folder, `.${chosen}.${process.pid}.part`);
    await fs.copyFile(source, temporary);
    await fs.rename(temporary, path.join(folder, chosen));
    const { size } = await fs.stat(path.join(folder, chosen));
    await settleHome(homeId);
    return { path: `${DB}/tables/${parts.join("/")}/${chosen}`, name: chosen, size };
  }

  /** A record's file gone (it was replaced): its Database files path, never anything outside it. */
  async function removeRecordFile(homeId, virtualPath) {
    const dirs = await prepare(homePlace(homeId));
    const value = path.posix.normalize(String(virtualPath || ""));
    if (!value.startsWith(`${DB}/tables/`)) return;
    const real = path.join(dirs.db, value.slice(DB.length + 1));
    if (!real.startsWith(path.join(dirs.db, "tables") + path.sep)) return;
    await fs.unlink(real).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await settleHome(homeId);
  }

  return Object.freeze({
    writeRecordFile,
    removeRecordFile
  });
}
