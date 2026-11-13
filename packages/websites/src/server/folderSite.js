import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MARKER_FILE, markerIn } from "./marker.js";
import { WebsiteError } from "./websiteError.js";

/**
 * A website in a folder on this computer that a web server already serves (D-84): a page is the folder <slug>/ in it.
 * A new copy is written beside the old one and swapped in with two renames, so the address never shows half a page,
 * and the old copy comes back if the second rename fails.
 * @param {string} folder an absolute path
 */
export function createFolderSite(folder) {
  const placeOf = (slug) => path.join(folder, slug);
  const beside = (slug, what) => path.join(folder, `.${slug}.mercbot-${what}-${randomBytes(6).toString("hex")}`);

  /** What the folder's own errors mean to the person; never more than its path. */
  function refused(error) {
    if (error instanceof WebsiteError) return error;
    const code = String(error?.code || "");
    if (code === "ENOENT" || code === "ENOTDIR") {
      return new WebsiteError(409, `The folder ${folder} isn't there. Check the website's folder in Settings → Website.`, {
        code: "websites_folder_missing", params: { folder }
      });
    }
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      return new WebsiteError(409, `Mercbot may not write in ${folder}. Let the user Mercbot runs as write there.`, {
        code: "websites_folder_not_writable", params: { folder }
      });
    }
    return new WebsiteError(409, `Writing in ${folder} failed (${code || "an unknown error"}).`, { code: "websites_folder_failed", params: { folder } });
  }

  const guarded = (work) => async (...args) => {
    try {
      return await work(...args);
    } catch (error) {
      throw refused(error);
    }
  };

  /** The folder is there, is a folder, and Mercbot may write in it. */
  async function check() {
    const stat = await fs.stat(folder);
    if (!stat.isDirectory()) throw Object.assign(new Error("not a folder"), { code: "ENOTDIR" });
    await fs.access(folder, fs.constants.W_OK | fs.constants.X_OK);
  }

  /** Whether anything is at <slug>/, and the publication id its marker names (null without one). */
  async function read(slug) {
    const stat = await fs.lstat(placeOf(slug)).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return { exists: false, marker: null };
    if (!stat.isDirectory()) return { exists: true, marker: null };
    const text = await fs.readFile(path.join(placeOf(slug), MARKER_FILE), "utf8").catch(() => null);
    return { exists: true, marker: text === null ? null : markerIn(text) };
  }

  /** Puts exactly `files` at <slug>/, in place of whatever was there. */
  async function put(slug, files) {
    const fresh = beside(slug, "new");
    await fs.mkdir(fresh);
    try {
      for (const file of files) {
        const target = path.join(fresh, file.path);
        if (!target.startsWith(`${fresh}${path.sep}`)) throw new Error(`A page's file is outside its folder: ${file.path}`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.content);
      }
      const old = beside(slug, "old");
      const had = await fs.rename(placeOf(slug), old).then(() => true, (error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      });
      try {
        await fs.rename(fresh, placeOf(slug));
      } catch (error) {
        if (had) await fs.rename(old, placeOf(slug)).catch(() => {});
        throw error;
      }
      if (had) await fs.rm(old, { recursive: true, force: true });
    } catch (error) {
      await fs.rm(fresh, { recursive: true, force: true });
      throw error;
    }
  }

  /** Takes <slug>/ away, if it's there. */
  async function remove(slug) {
    await fs.rm(placeOf(slug), { recursive: true, force: true });
  }

  return Object.freeze({
    check: guarded(check),
    read: guarded(read),
    put: guarded(put),
    remove: guarded(remove)
  });
}
