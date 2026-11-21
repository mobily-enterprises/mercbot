import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createServerWith } from "../../server.js";
import { PICTURE, browser } from "../support/browser.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// A copy built on Mercbot that checks every picture and video before it's kept or sent (`mercbot.media-check`, D-90),
// on the real server: an upload, to a chat's files, a bot's or the home's, a photo the Vault reads and a new profile
// picture are each checked before anything is kept or sent on. Blocked, the route answers 422 media_blocked; not
// checkable now (the checker failed), 503 media_check_unavailable; and nothing is kept. The copy's checker is a
// provider of the capability here. The server reads its database as it starts, so this file runs in the database
// suite.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it with npm run test:database.");

const BLOCKED = Object.freeze({ error: "This file can't be used.", code: "media_blocked" });
const UNAVAILABLE = Object.freeze({ error: "This file can't be checked right now. Try again in a few minutes.", code: "media_check_unavailable" });
const refusal = (response) => ({ error: response.body.error, code: response.body.code });
// A place as the checker got it, its ids as text whichever way the server holds them: the place is opaque to it.
const placeText = (place) => (place ? JSON.parse(JSON.stringify(place), (key, value) => (typeof value === "number" ? String(value) : value)) : place);

test("uploads, Vault photos and profile pictures are checked before anything is kept", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-media-routes-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const volume = path.join(dir, "files");
  await fs.mkdir(volume);
  await fs.writeFile(path.join(volume, ".mercbot-files"), "");

  // The copy's checker: its next verdict (or a failure, which counts as unavailable), and what it was asked.
  let answer = { verdict: "allow" };
  const asked = [];
  const copy = {
    async check(item) {
      asked.push(item);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    checkText: async () => answer
  };
  const MediaCheckProvider = defineProvider({ id: "test.media-check", provides: { mediaCheck: "mercbot.media-check" }, setup: () => ({ mediaCheck: copy }) });
  const app = await createServerWith({
    runtimeEnv: {
      ...process.env,
      AUTH_LOCAL_SESSION_SECRET: "media-routes-test-only-secret",
      AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
      DB_CLIENT: "pg",
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      APP_ENV: "test",
      PORT: "3001",
      SERVER_SURFACE: "all",
      MERCBOT_FILES_DIR: volume,
      JSKIT_STORAGE_FS_BASE_PATH: path.join(dir, "storage"),
      MERCBOT_VAULT_KEY: randomBytes(32).toString("base64"),
      AI_IMAGES_PROVIDER: "gemini",
      AI_IMAGES_API_KEY: "test-key"
    },
    providers: [MediaCheckProvider]
  });
  t.after(() => app.close());
  const knex = await connectTestDatabase();
  // The bot and the chat this test makes go before the connection closes.
  const made = { bots: [], homes: [] };
  t.after(async () => {
    await knex("conversations").whereIn("workspace_id", made.homes).del();
    await knex("bots").whereIn("id", made.bots).del();
    await knex.destroy();
  });

  const request = browser(app);
  assert.equal((await request("GET", "/api/session")).status, 200);
  const email = `media-${randomUUID()}@example.test`;
  const signedUp = await request("POST", "/api/register", { json: { email, password: "Media-test-password-2026!" } });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));
  const home = await knex("workspaces").join("users", "users.id", "workspaces.owner_user_id")
    .where({ "users.email": email, "workspaces.is_personal": true })
    .first("workspaces.id", "workspaces.slug", "users.id as userId");
  const [bot] = await knex("bots").insert({ made_by: home.userId, workspace_id: home.id, name: "Checked", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const homeId = String(home.id);
  const userId = String(home.userId);
  made.bots.push(botId);
  made.homes.push(homeId);
  // The person's private chat with the bot, where the chat's own uploads go.
  const chat = await seedChat(knex, { homeId, kind: "private", people: [userId], bots: [botId] });

  // Gemini, which reads a Vault photo, is a stand-in: a photo that reaches it is one the check allowed.
  const read = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return realFetch(url, options);
    read.push(url);
    const text = JSON.stringify({ fullName: "Ada Lovelace" });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  t.mock.method(console, "warn", () => {});
  const failing = new Error("the checker is down");

  await t.test("an upload to a chat's files, a bot's or the home's, is checked before it's written", async () => {
    const chatUpload = `/api/w/${home.slug}/files/upload?chat=${chat.id}&bot=${botId}`;
    const uploads = path.join(volume, "homes", homeId, "chats", chat.id);
    const kept = async () => (await fs.readdir(uploads, { recursive: true }).catch(() => [])).filter((name) => name.endsWith(".png"));

    answer = { verdict: "block" };
    const blocked = await request("POST", chatUpload, { upload: ["file", "cat.png", "image/png", PICTURE] });
    assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
    assert.deepEqual(refusal(blocked), BLOCKED);
    assert.deepEqual(await kept(), [], "nothing is kept");
    assert.deepEqual(
      [asked[0].origin, asked[0].mime, asked[0].workspaceId, asked[0].userId, asked[0].botId, asked[0].conversationId, asked[0].path],
      ["upload", "image/png", homeId, userId, botId, chat.id, "/files/chat/Uploads/cat.png"]
    );
    assert.deepEqual(asked[0].bytes, PICTURE);
    assert.ok(asked[0].ip, "with the address it came from");
    assert.deepEqual(placeText(asked[0].place), { homeId, chatId: chat.id, chatKind: "private", botId }, "and the place it would be kept in");

    answer = failing;
    const held = await request("POST", chatUpload, { upload: ["file", "cat.png", "image/png", PICTURE] });
    assert.equal(held.status, 503, JSON.stringify(held.body));
    assert.deepEqual(refusal(held), UNAVAILABLE);
    assert.deepEqual(await kept(), []);

    answer = { verdict: "block", notice: "Pictures like this can't be kept here." };
    assert.deepEqual(refusal(await request("POST", chatUpload, { upload: ["file", "cat.png", "image/png", PICTURE] })),
      { error: "Pictures like this can't be kept here.", code: "media_blocked" });

    answer = { verdict: "allow" };
    const allowed = await request("POST", chatUpload, { upload: ["file", "cat.png", "image/png", PICTURE] });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(allowed.body.path, "/files/chat/Uploads/cat.png");
    const [only, ...others] = await kept();
    assert.ok(only.endsWith(path.join("Uploads", "cat.png")) && !others.length, "kept once allowed");

    // A file that isn't a picture or video, whatever its name says, is never sent to the checker.
    const before = asked.length;
    answer = { verdict: "block" };
    const notes = await request("POST", chatUpload, { upload: ["file", "notes.png", "image/png", Buffer.from("Tuesday's minutes")] });
    assert.equal(notes.status, 200, JSON.stringify(notes.body));
    assert.equal(asked.length, before);

    // The bot's own files (its Knowledge files, everyone's in the home).
    const botUpload = `/api/w/${home.slug}/files/upload?bot=${botId}`;
    answer = { verdict: "block" };
    assert.deepEqual(refusal(await request("POST", botUpload, { upload: ["file", "kb.png", "image/png", PICTURE] })), BLOCKED);
    assert.deepEqual([asked.at(-1).path, asked.at(-1).botId, asked.at(-1).conversationId, placeText(asked.at(-1).place)],
      ["/files/bot/Uploads/kb.png", botId, null, { homeId, botId }]);
    assert.equal(existsSync(path.join(volume, "homes", homeId, "bots", botId, "everyone", "Uploads", "kb.png")), false);
    answer = { verdict: "allow" };
    assert.equal((await request("POST", botUpload, { upload: ["file", "kb.png", "image/png", PICTURE] })).status, 200);
    assert.ok(existsSync(path.join(volume, "homes", homeId, "bots", botId, "everyone", "Uploads", "kb.png")));

    // The home's own files.
    const homeUpload = `/api/w/${home.slug}/files/upload`;
    answer = { verdict: "block" };
    const shared = await request("POST", homeUpload, { upload: ["file", "team.png", "image/png", PICTURE] });
    assert.equal(shared.status, 422, JSON.stringify(shared.body));
    assert.deepEqual(refusal(shared), BLOCKED);
    assert.deepEqual([asked.at(-1).path, asked.at(-1).botId, placeText(asked.at(-1).place)], ["/files/shared/Uploads/team.png", null, { homeId, home: true }]);
    assert.equal(existsSync(path.join(volume, "homes", homeId, "shared", "Uploads", "team.png")), false);
    answer = failing;
    assert.deepEqual(refusal(await request("POST", homeUpload, { upload: ["file", "team.png", "image/png", PICTURE] })), UNAVAILABLE);
    answer = { verdict: "allow" };
    assert.equal((await request("POST", homeUpload, { upload: ["file", "team.png", "image/png", PICTURE] })).status, 200);
    assert.ok(existsSync(path.join(volume, "homes", homeId, "shared", "Uploads", "team.png")));
  });

  await t.test("a photo the Vault reads is checked before the images AI sees it", async () => {
    const readPhoto = `/api/w/${home.slug}/vault/read-photo`;
    answer = { verdict: "block" };
    const blocked = await request("POST", readPhoto, { upload: ["photo", "card.png", "image/png", PICTURE] });
    assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
    assert.deepEqual(refusal(blocked), BLOCKED);
    assert.deepEqual([asked.at(-1).origin, asked.at(-1).workspaceId, asked.at(-1).userId, asked.at(-1).path, asked.at(-1).place], ["vault_photo", homeId, userId, null, null]);
    answer = failing;
    const held = await request("POST", readPhoto, { upload: ["photo", "card.png", "image/png", PICTURE] });
    assert.equal(held.status, 503, JSON.stringify(held.body));
    assert.deepEqual(refusal(held), UNAVAILABLE);
    assert.equal(read.length, 0, "the images AI saw neither");
    answer = { verdict: "allow" };
    const allowed = await request("POST", readPhoto, { upload: ["photo", "card.png", "image/png", PICTURE] });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(read.length, 1);
  });

  await t.test("a new profile picture is checked before it's kept", async () => {
    const picture = path.join(volume, "profile-pictures", userId, "avatar");
    answer = { verdict: "block" };
    const blocked = await request("POST", "/api/settings/profile/avatar", { upload: ["avatar", "me.png", "image/png", PICTURE] });
    assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
    assert.match(JSON.stringify(blocked.body), /This file can't be used\./u);
    assert.match(JSON.stringify(blocked.body), /media_blocked/u);
    assert.equal(existsSync(picture), false);
    assert.deepEqual([asked.at(-1).origin, asked.at(-1).userId, asked.at(-1).place], ["profile_picture", userId, null]);
    answer = failing;
    const held = await request("POST", "/api/settings/profile/avatar", { upload: ["avatar", "me.png", "image/png", PICTURE] });
    assert.equal(held.status, 503, JSON.stringify(held.body));
    assert.match(JSON.stringify(held.body), /media_check_unavailable/u);
    assert.equal(existsSync(picture), false);
    answer = { verdict: "allow" };
    assert.equal((await request("POST", "/api/settings/profile/avatar", { upload: ["avatar", "me.png", "image/png", PICTURE] })).status, 200);
    assert.ok(existsSync(picture));
  });
});
