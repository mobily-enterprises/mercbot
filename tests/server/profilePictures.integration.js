import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../server.js";
import { PICTURE, browser } from "../support/browser.mjs";

// Profile pictures on the real server (D-19): JSKIT's avatar routes save and read them on Mercbot's
// shared files volume, a picture JSKIT kept in its own folder before moves over when it's next
// shown, and a server without its volume saves none. The server reads its database as it starts,
// so this file runs in the database suite, on its own copy of the test template.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it with npm run test:database.");

test("profile pictures are saved and shown from the files volume, and old ones move there", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-pictures-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const files = path.join(dir, "files");
  const jskitStorage = path.join(dir, "storage");
  await fs.mkdir(files);
  await fs.writeFile(path.join(files, ".mercbot-files"), "");
  const app = await createServer({
    runtimeEnv: {
      ...process.env,
      AUTH_LOCAL_SESSION_SECRET: "profile-pictures-test-only-secret",
      AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
      DB_CLIENT: "pg",
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      PORT: "3001",
      SERVER_SURFACE: "all",
      MERCBOT_FILES_DIR: files,
      JSKIT_STORAGE_FS_BASE_PATH: jskitStorage
    }
  });
  t.after(() => app.close());

  const request = browser(app);
  assert.equal((await request("GET", "/api/session")).status, 200);
  const signedUp = await request("POST", "/api/register", { json: { email: `pictures-${randomUUID()}@example.test`, password: "Pictures-test-password-2026!" } });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));

  const uploaded = await request("POST", "/api/settings/profile/avatar", { upload: ["avatar", "me.png", "image/png", PICTURE] });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  const [person] = await fs.readdir(path.join(files, "profile-pictures"));
  const onVolume = path.join(files, "profile-pictures", person, "avatar");
  assert.deepEqual(await fs.readFile(onVolume), PICTURE, "the picture is on the volume");
  const inJskit = path.join(jskitStorage, "users", "avatars", person, "avatar");
  assert.equal(existsSync(inJskit), false, "JSKIT's own folder on the server's disk doesn't hold it");

  const shown = await request("GET", "/api/settings/profile/avatar");
  assert.equal(shown.status, 200);
  assert.deepEqual(Buffer.from(shown.body), PICTURE);

  // A picture saved before the move is still in JSKIT's folder: shown from there once, then from the volume.
  await fs.mkdir(path.dirname(inJskit), { recursive: true });
  await fs.rename(onVolume, inJskit);
  const before = await request("GET", "/api/settings/profile/avatar");
  assert.equal(before.status, 200);
  assert.deepEqual(Buffer.from(before.body), PICTURE);
  assert.deepEqual(await fs.readFile(onVolume), PICTURE, "it moved to the volume");
  assert.equal(existsSync(inJskit), false, "and left the server's disk");

  // Without its volume the server neither saves nor shows a picture, and writes nothing to its disk.
  await fs.rm(path.join(files, ".mercbot-files"));
  const refused = await request("POST", "/api/settings/profile/avatar", { upload: ["avatar", "me.png", "image/png", PICTURE] });
  assert.equal(refused.status, 503, JSON.stringify(refused.body));
  assert.equal((await request("GET", "/api/settings/profile/avatar")).status, 503);
  assert.equal(existsSync(inJskit), false);
  await fs.writeFile(path.join(files, ".mercbot-files"), "");

  const removed = await request("DELETE", "/api/settings/profile/avatar");
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(existsSync(onVolume), false, "removing the picture removes it from the volume");
});
