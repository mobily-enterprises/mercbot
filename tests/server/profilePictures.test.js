import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { PROFILE_PICTURES, profilePictureDriver } from "../../packages/files/src/server/profilePictures.js";

// People's profile pictures (D-19): on Mercbot's shared volume, never on a server's own disk; one
// still in JSKIT's own storage from before moves over the first time it's read.
const PICTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** JSKIT's storage driver as it was: pictures by unstorage key, in memory. */
function earlierStorage(entries = {}) {
  const kept = new Map(Object.entries(entries));
  return {
    kept,
    getItemRaw: async (key) => kept.get(key) ?? null,
    removeItem: async (key) => {
      kept.delete(key);
    }
  };
}

async function volume(t, { mounted = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-pictures-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  if (mounted) await fs.writeFile(path.join(dir, ".mercbot-files"), "");
  const store = createFileStore({ root: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  return { dir, folder: store.profilePicturesFolder };
}

test("a picture is saved, read and removed on the volume, under the person's own folder", async (t) => {
  const { dir, folder } = await volume(t);
  const earlier = earlierStorage();
  const driver = profilePictureDriver({ folder, earlier });
  const file = path.join(dir, "profile-pictures", "7", "avatar");

  await driver.setItemRaw("7:avatar", PICTURE);
  assert.deepEqual(await fs.readFile(file), PICTURE);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ["avatar"], "no half-written copy is left beside it");
  assert.deepEqual(await driver.getItemRaw("7:avatar"), PICTURE);
  assert.equal(await driver.hasItem("7:avatar"), true);
  assert.deepEqual(await driver.getKeys(), ["7:avatar"]);

  await driver.removeItem("7:avatar");
  assert.equal(existsSync(file), false);
  assert.equal(await driver.getItemRaw("7:avatar"), null, "a person with no picture has none");
  assert.equal(await driver.hasItem("7:avatar"), false);
});

test("a picture JSKIT kept before moves to the volume when it's first read, and only once", async (t) => {
  const { dir, folder } = await volume(t);
  const earlier = earlierStorage({ [`${PROFILE_PICTURES}:7:avatar`]: PICTURE, [`${PROFILE_PICTURES}:8:avatar`]: PICTURE });
  const driver = profilePictureDriver({ folder, earlier });

  assert.deepEqual(await driver.getItemRaw("7:avatar"), PICTURE);
  assert.deepEqual(await fs.readFile(path.join(dir, "profile-pictures", "7", "avatar")), PICTURE);
  assert.equal(earlier.kept.has(`${PROFILE_PICTURES}:7:avatar`), false, "the old copy is gone once it's on the volume");
  assert.deepEqual(await driver.getItemRaw("7:avatar"), PICTURE, "later reads find it on the volume");

  // Removing a picture that never moved removes the old copy too.
  await driver.removeItem("8:avatar");
  assert.equal(earlier.kept.has(`${PROFILE_PICTURES}:8:avatar`), false);
  assert.equal(await driver.getItemRaw("8:avatar"), null);
});

test("a picture saved through another server while an old one moves over stays", async (t) => {
  const { dir, folder } = await volume(t);
  const newer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
  const earlier = earlierStorage({ [`${PROFILE_PICTURES}:7:avatar`]: PICTURE });
  // The person saves a new picture just as this server finds the old one in its own folder.
  const driver = profilePictureDriver({
    folder,
    earlier: {
      ...earlier,
      getItemRaw: async (key) => {
        await driver.setItemRaw("7:avatar", newer);
        return earlier.getItemRaw(key);
      }
    }
  });

  assert.deepEqual(await driver.getItemRaw("7:avatar"), newer);
  const file = path.join(dir, "profile-pictures", "7", "avatar");
  assert.deepEqual(await fs.readFile(file), newer, "the new picture is the one kept");
  assert.deepEqual(await fs.readdir(path.dirname(file)), ["avatar"], "no copy is left beside it");
  assert.equal(earlier.kept.has(`${PROFILE_PICTURES}:7:avatar`), false, "the old copy is gone");
});

test("without the volume no picture is saved or shown, and nothing lands on the server's disk", async (t) => {
  const { dir, folder } = await volume(t, { mounted: false });
  const earlier = earlierStorage({ [`${PROFILE_PICTURES}:7:avatar`]: PICTURE });
  const driver = profilePictureDriver({ folder, earlier });

  await assert.rejects(driver.setItemRaw("9:avatar", PICTURE), { statusCode: 503, code: "files_unavailable" });
  await assert.rejects(driver.getItemRaw("7:avatar"), { statusCode: 503, code: "files_unavailable" });
  assert.deepEqual(await fs.readdir(dir), [], "the unmounted folder stays empty");
  assert.equal(earlier.kept.has(`${PROFILE_PICTURES}:7:avatar`), true, "the old copy waits for the volume");
});

test("only a person's picture is reachable: other names are refused", async (t) => {
  const { folder } = await volume(t);
  const driver = profilePictureDriver({ folder, earlier: earlierStorage() });
  for (const key of ["..:avatar", "7:..", "7/../x", "", "7:av atar"]) {
    await assert.rejects(driver.setItemRaw(key, PICTURE), /isn't a profile picture's name/u, key);
  }
});
