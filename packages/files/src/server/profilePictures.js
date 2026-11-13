import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// People's profile pictures (D-19). JSKIT's users package keeps them in its runtime storage
// (unstorage) under users/avatars/<user>/avatar, which on its own is a folder on the server's disk
// (data/storage). The files feature mounts this driver there, so they live on Mercbot's own shared
// volume instead, in <files>/profile-pictures/<user>/avatar: every server shows the same picture,
// and a Publish, which starts from a fresh folder, keeps them. Without the volume none is saved or
// shown; nothing falls back to a server's disk. A picture saved before the move, still in JSKIT's own
// folder on the server that took it, moves over the first time it's read there.
export const PROFILE_PICTURES = "users:avatars";

/**
 * @param {object} dependencies
 * @param {() => Promise<string>} dependencies.folder The pictures' folder on the volume; it refuses
 *   (files_unavailable) when the volume isn't there.
 * @param {{ getItemRaw: (key: string) => Promise<unknown>, removeItem: (key: string) => Promise<void> }} dependencies.earlier
 *   The storage's own driver, where pictures were kept before.
 */
export function profilePictureDriver({ folder, earlier }) {
  // JSKIT names a picture <user>:avatar; anything else, such as "..", is refused.
  async function fileOf(key) {
    const parts = String(key).split(":");
    if (parts.some((part) => !/^[\w-]+$/u.test(part))) throw new Error(`"${key}" isn't a profile picture's name.`);
    return path.join(await folder(), ...parts);
  }

  async function read(file) {
    try {
      return await fs.readFile(file);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  // Written whole under a passing name, then put in place, so no server ever reads half a picture.
  // A picture moving over from before (`replace: false`) is only linked in where there's none yet: one
  // saved meanwhile, through any server, is newer and stays.
  async function write(file, data, { replace = true } = {}) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const passing = `${file}.${randomUUID()}.part`;
    await fs.writeFile(passing, data);
    if (replace) return fs.rename(passing, file);
    try {
      await fs.link(passing, file);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    } finally {
      await fs.rm(passing, { force: true });
    }
  }

  async function getItemRaw(key) {
    const file = await fileOf(key);
    const kept = await read(file);
    if (kept) return kept;
    const before = await earlier.getItemRaw(`${PROFILE_PICTURES}:${key}`);
    if (before === null || before === undefined) return null;
    await write(file, Buffer.from(before), { replace: false });
    await earlier.removeItem(`${PROFILE_PICTURES}:${key}`);
    return read(file);
  }

  async function setItemRaw(key, value) {
    await write(await fileOf(key), Buffer.from(value));
  }

  async function removeItem(key) {
    await fs.rm(await fileOf(key), { force: true });
    await earlier.removeItem(`${PROFILE_PICTURES}:${key}`);
  }

  // The rest of unstorage's driver contract, which JSKIT doesn't use for pictures.
  async function getKeys() {
    const root = await folder();
    const people = await fs.readdir(root).catch(() => []);
    return people.map((person) => `${person}:avatar`);
  }

  return Object.freeze({
    name: "mercbot-profile-pictures",
    hasItem: async (key) => (await getItemRaw(key)) !== null,
    getItem: getItemRaw,
    getItemRaw,
    // eslint-disable-next-line jskit/no-slot-setter -- unstorage's driver interface names its writes; not a slot
    setItem: setItemRaw,
    // eslint-disable-next-line jskit/no-slot-setter -- unstorage's driver interface names its writes; not a slot
    setItemRaw,
    removeItem,
    getKeys
  });
}
