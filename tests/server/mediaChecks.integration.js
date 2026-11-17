import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { PICTURE } from "../support/browser.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// What a copy that checks pictures and videos checks afterwards (D-90): a bot's computer's screenshots and the files
// bots save wait in media_checks, every server takes a batch of the due ones in turn (D-15), a blocked file is removed,
// and one that can't be checked now waits, longer each time. Without a checker nothing is queued.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(4), Buffer.from("isommp41", "latin1"), Buffer.alloc(600)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF", "latin1"), Buffer.alloc(600)]);

test("screenshots and the pictures and videos bots save are checked afterwards, a batch at a time, through the database", async (context) => {
  const knex = await connectTestDatabase();
  const [userId] = (await knex("users").orderBy("id").limit(1).pluck("id")).map(String);
  assert.ok(userId, "the test database needs a user");
  const [made] = await knex("workspaces")
    .insert({ slug: `media-${randomBytes(5).toString("hex")}`, name: "Media", owner_user_id: userId, is_personal: false })
    .returning("id");
  const home = String(made.id ?? made);
  const volume = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-media-checks-"));
  await fs.writeFile(path.join(volume, ".mercbot-files"), "");
  context.after(async () => {
    await knex("media_checks").where({ workspace_id: home }).del();
    await knex("workspaces").where({ id: home }).del();
    await knex.destroy();
    await fs.rm(volume, { recursive: true, force: true });
  });
  const { resources, systemContext } = (await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS })).features["mercbot.files"];
  const store = createFileStore({ root: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const place = { homeId: home, botId: "41", userId };
  await store.prepare(place);
  const save = async (name, data) => {
    const real = await store.resolve(place, `/files/mine/${name}`);
    await fs.mkdir(path.dirname(real), { recursive: true });
    await fs.writeFile(real, data);
    return real;
  };
  const turn = (paths) => ({ place, paths: paths.map((name) => `/files/mine/${name}`), workspaceId: home, userId, botId: "41", conversationId: "5" });
  const rows = () => knex("media_checks").where({ workspace_id: home }).orderBy("id")
    .select("*", knex.raw("round(extract(epoch from check_after - now()))::int as wait"));
  const due = () => knex("media_checks").where({ workspace_id: home }).update({ check_after: knex.raw("now() - interval '1 second'") });

  // The copy's checker: each file's verdict by its path (allowed by default), or a failure; `pause` holds a check.
  let verdicts = {};
  let pause = null;
  const asked = [];
  const copy = {
    async check(item) {
      asked.push(item);
      if (pause) await pause(item);
      const answer = verdicts[item.path] ?? { verdict: "allow" };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    checkText: async () => ({ verdict: "allow" })
  };
  const server = (timing = {}) => createMediaChecks({ guard: createMediaGuard(copy), mediaChecks: resources.mediaChecks, systemContext, store, timing });
  const checks = server();
  const cat = await save("cat.png", PICTURE);
  const dog = await save("dog.mp4", MP4);
  await save("notes.txt", "Tuesday's minutes");

  await context.test("without a checker nothing is queued, and a sweep reads nothing", async () => {
    const none = createMediaChecks({ guard: createMediaGuard(null), mediaChecks: resources.mediaChecks, systemContext, store });
    const statements = await statementsDuring(knex, async () => {
      await none.filesLater(turn(["cat.png", "dog.mp4"]));
      await none.screenshotLater({ computerId: "77", name: `77-${"a".repeat(16)}.jpg`, workspaceId: home });
      assert.equal(await none.sweep(), 0);
      none.startSweeping();
      none.stop();
    }, /media_checks/u);
    assert.deepEqual(statements, []);
    assert.equal(none.on, false);
  });

  await context.test("a turn's saved pictures and videos are queued, in one statement, with whose they are; other files aren't", async () => {
    const statements = await statementsDuring(knex, () => checks.filesLater(turn(["cat.png", "notes.txt", "dog.mp4", "gone.png", "cat.png"])), /media_checks/u);
    assert.equal(statements.length, 1);
    const queued = await rows();
    assert.deepEqual(queued.map((row) => [row.origin, row.path, String(row.bot_id), String(row.user_id), String(row.conversation_id), row.attempts]), [
      ["saved_file", "/files/mine/cat.png", "41", userId, "5", 0],
      ["saved_file", "/files/mine/dog.mp4", "41", userId, "5", 0]
    ]);
    assert.deepEqual(queued[0].place, place);
    assert.ok(queued.every((row) => row.wait <= 0), "each may be taken at once");
  });

  let twoRowSweep = null;
  await context.test("a sweep checks what's due: a blocked file is removed, an allowed one kept, and both rows go", async (t) => {
    verdicts = { "/files/mine/cat.png": { verdict: "block", ref: "check-1" } };
    const said = t.mock.method(console, "info", () => {});
    twoRowSweep = await statementsDuring(knex, async () => assert.equal(await checks.sweep(), 2), /media_checks/u);
    assert.equal(existsSync(cat), false, "the blocked picture is gone");
    assert.deepEqual(await fs.readFile(dog), MP4, "the allowed video stays");
    assert.deepEqual(await rows(), []);
    assert.deepEqual(asked.map((item) => [item.origin, item.path, item.mime, item.workspaceId, item.userId, item.botId, item.conversationId, item.ip]), [
      ["saved_file", "/files/mine/cat.png", "image/png", home, userId, "41", "5", null],
      ["saved_file", "/files/mine/dog.mp4", "video/mp4", home, userId, "41", "5", null]
    ]);
    assert.deepEqual(asked[0].bytes, PICTURE);
    assert.match(said.mock.calls[0].arguments[0], /^A file \/files\/mine\/cat\.png \(home \d+\) was removed: its check blocked it \(check-1\)\.$/u);
  });

  await context.test("a sweep's statements follow its batch, not its rows", async () => {
    const names = Array.from({ length: 8 }, (_, at) => `many-${at}.png`);
    for (const name of names) await save(name, PICTURE);
    await checks.filesLater(turn(names));
    const eight = await statementsDuring(knex, async () => assert.equal(await checks.sweep(), 8), /media_checks/u);
    assert.equal(eight.length, twoRowSweep.length, `two rows took ${twoRowSweep.length} statements, eight took ${eight.length}`);
    assert.deepEqual(await rows(), []);
  });

  await context.test("a file that can't be checked now stays, and waits longer each time it can't", async (t) => {
    t.mock.method(console, "warn", () => {});
    const fox = await save("fox.png", PICTURE);
    await checks.filesLater(turn(["fox.png"]));
    verdicts = { "/files/mine/fox.png": { verdict: "unavailable" } };
    assert.equal(await checks.sweep(), 1);
    let [waiting] = await rows();
    assert.deepEqual([waiting.attempts, waiting.wait], [1, 60]);
    assert.equal(await checks.sweep(), 0, "not before its time");
    await due();
    verdicts = { "/files/mine/fox.png": new Error("the checker is down") };
    assert.equal(await checks.sweep(), 1);
    [waiting] = await rows();
    assert.deepEqual([waiting.attempts, waiting.wait], [2, 120]);
    assert.ok(existsSync(fox), "it stays while it waits");
    await due();
    verdicts = {};
    assert.equal(await checks.sweep(), 1);
    assert.deepEqual(await rows(), []);
    assert.ok(existsSync(fox));
  });

  await context.test("a screenshot is queued before it's written, checked once it's due, and removed when blocked", async () => {
    const name = "77-0123456789abcdef.jpg";
    await checks.screenshotLater({ computerId: "77", name, workspaceId: home, userId, botId: "41" });
    const [queued] = await rows();
    assert.deepEqual([queued.origin, queued.path, String(queued.conversation_id), queued.place, queued.wait], ["screenshot", name, "77", null, 30]);
    assert.equal(await checks.sweep(), 0, "a screenshot waits until it's written");
    const shot = path.join(volume, "computers", "77", "screenshots", name);
    await fs.mkdir(path.dirname(shot), { recursive: true });
    await fs.writeFile(shot, JPEG);
    await due();
    verdicts = { [name]: { verdict: "block" } };
    assert.equal(await checks.sweep(), 1);
    assert.equal(existsSync(shot), false);
    assert.equal(asked.at(-1).mime, "image/jpeg");
    assert.deepEqual(await rows(), []);
    // One that's gone by its time just leaves the queue, unchecked.
    await checks.screenshotLater({ computerId: "77", name: `77-${"f".repeat(16)}.jpg`, workspaceId: home });
    await due();
    const before = asked.length;
    assert.equal(await checks.sweep(), 1);
    assert.equal(asked.length, before);
    assert.deepEqual(await rows(), []);
  });

  await context.test("a picture or video too big to check isn't kept", async (t) => {
    const warned = t.mock.method(console, "warn", () => {});
    const huge = await save("huge.png", PICTURE);
    await fs.truncate(huge, 101 * 1024 * 1024);
    await checks.filesLater(turn(["huge.png"]));
    await due();
    const before = asked.length;
    assert.equal(await checks.sweep(), 1);
    assert.equal(existsSync(huge), false);
    assert.equal(asked.length, before, "it isn't read whole or sent");
    assert.match(warned.mock.calls[0].arguments[0], /huge\.png .* was removed: at 101 MB it's too big to check\.$/u);
    assert.deepEqual(await rows(), []);
  });

  await context.test("servers take different rows, a batch each, and hold them while they check", async () => {
    const names = Array.from({ length: 5 }, (_, at) => `shared-${at}.png`);
    for (const name of names) await save(name, PICTURE);
    await checks.filesLater(turn(names));
    const started = [];
    const leases = [];
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let allStarted;
    const fiveStarted = new Promise((resolve) => (allStarted = resolve));
    let fourStarted;
    const four = new Promise((resolve) => (fourStarted = resolve));
    pause = async (item) => {
      started.push(item.path);
      if (started.length === 4) fourStarted();
      if (started.length === 5) allStarted();
      const [row] = await knex("media_checks").where({ workspace_id: home, path: item.path })
        .select(knex.raw("round(extract(epoch from check_after - now()))::int as wait"));
      leases.push(row?.wait ?? null);
      await held;
    };
    // Each wait fails within seconds, rather than hanging, when the servers don't share the rows as they should.
    const within = async (promise, what) => {
      let timer;
      try {
        return await Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} never happened`)), 10000)))]);
      } finally {
        clearTimeout(timer);
      }
    };
    const first = Promise.all([server({ batch: 2 }).sweep(), server({ batch: 2 }).sweep()]);
    await within(four, "four checks starting");
    // While the first two servers hold four rows, a third takes only the one left.
    const third = server({ batch: 2 }).sweep();
    await within(fiveStarted, "the fifth check starting");
    release();
    assert.deepEqual(await first, [2, 2]);
    assert.equal(await third, 1);
    pause = null;
    assert.deepEqual([...started].sort(), names.map((name) => `/files/mine/${name}`).sort(), "each row was checked once");
    assert.ok(leases.every((wait) => wait > 290 && wait <= 300), `each taken row is held for its lease: ${leases}`);
    assert.deepEqual(await rows(), []);
  });
});
