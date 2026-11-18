import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import test from "node:test";
import { missingKeyLines } from "../../packages/account/src/server/keys.js";
import { createRetention } from "../../packages/account/src/server/retention.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { PIECE_BYTES, SealError, newSealedKey, openSealedKey, openStream, sealStream, sealedSize } from "../../packages/files/src/server/filesCipher.js";
import { bucketId, createFilesVolume } from "../../packages/files/src/server/filesVolume.js";
import { S3Error, createS3Bucket, s3Settings } from "../../packages/files/src/server/s3Bucket.js";
import { startS3Bucket } from "../support/s3Bucket.mjs";

// Bots' files in an S3 bucket (D-91), with no FUSE: each server works on a copy of what it uses in its files folder,
// pulled from the bucket before it's read and pushed once it's settled, every file sealed with a key only the
// passphrase opens. The bucket is a stand-in (tests/support/s3Bucket.mjs) reached path-style at its own endpoint, as
// Garage and MinIO are, and checking every request's signature.
const at = (homeId, botId, userId) => ({ homeId, botId, userId });
// Another server sees a change at its next pull, which comes once its last is a second old (syncedTree.js).
const nextPull = () => new Promise((resolve) => setTimeout(resolve, 1100));

// The database's files_keys, as databaseFilesKeys keeps it: the first record offered for a bucket is kept, and every
// offer answers it (tests/server/filesKeys.integration.js keeps them in PostgreSQL). One for every server here.
const keptKeys = new Map();
const offered = [];
const keys = Object.freeze({
  async keep(bucket, record) {
    offered.push(bucket);
    if (!keptKeys.has(bucket)) keptKeys.set(bucket, record);
    return keptKeys.get(bucket);
  }
});

/** One server on the bucket: its files folder, volume and store, stopped after the test. */
async function server(context, s3, { env = {}, folder = null } = {}) {
  const dir = folder ?? await mkdtemp(path.join(os.tmpdir(), "mercbot-bucket-"));
  const logs = [];
  const serverEnv = { ...s3.env, MERCBOT_FILES_DIR: dir, ...env };
  const volume = createFilesVolume({ env: serverEnv, folder: dir, keys, log: (line) => logs.push(line) });
  const store = createFileStore({ root: dir, fallback: dir, volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  context.after(async () => {
    await volume.stop();
    if (!folder) await rm(dir, { recursive: true, force: true });
  });
  return { dir, env: serverEnv, volume, store, logs };
}

const seal = (key, data, chunk = data.length || 1) => {
  const pieces = [];
  for (let index = 0; index < data.length; index += chunk) pieces.push(data.subarray(index, index + chunk));
  return buffer(Readable.from(pieces).pipe(sealStream(key)));
};
const open = (key, sealed) => buffer(Readable.from([sealed]).pipe(openStream(key)));

test("files are sealed before they reach the bucket, and only the files key opens them, whole and unchanged", async () => {
  const { key, record } = await newSealedKey("correct horse");
  assert.ok((await openSealedKey("correct horse", record)).equals(key));
  await assert.rejects(openSealedKey("wrong horse", record), (error) => error instanceof SealError && error.message === "MERCBOT_FILES_PASSPHRASE doesn't open the files bucket's key.");
  assert.doesNotMatch(record, new RegExp(key.toString("base64").replace(/[+/=]/gu, "."), "u"), "the record never holds the key itself");

  for (const size of [0, 1, PIECE_BYTES - 1, PIECE_BYTES, PIECE_BYTES + 1, 3 * PIECE_BYTES + 5]) {
    const data = Buffer.alloc(size, 0).map((_, index) => (index * 7) % 251);
    const sealed = await seal(key, data, 1000);
    assert.equal(sealed.length, sealedSize(size), `${size} bytes sealed`);
    assert.ok(sealed.subarray(0, 4).equals(Buffer.from("MBF1")));
    assert.ok((await open(key, sealed)).equals(data), `${size} bytes opened`);
  }
  const data = Buffer.alloc(3 * PIECE_BYTES + 5, 9);
  const sealed = await seal(key, data);
  const piece = PIECE_BYTES + 16;
  const changed = Buffer.from(sealed);
  changed[20 + piece + 100] ^= 1;
  const broken = {
    "a changed byte": changed,
    "the end cut off": sealed.subarray(0, sealed.length - 10),
    "the last piece dropped": sealed.subarray(0, 20 + 3 * piece),
    "a piece dropped": Buffer.concat([sealed.subarray(0, 20 + piece), sealed.subarray(20 + 2 * piece)]),
    "pieces swapped": Buffer.concat([sealed.subarray(0, 20), sealed.subarray(20 + piece, 20 + 2 * piece), sealed.subarray(20, 20 + piece), sealed.subarray(20 + 2 * piece)]),
    "not a sealed file": Buffer.from("plain text, never sealed")
  };
  for (const [why, bytes] of Object.entries(broken)) await assert.rejects(open(key, bytes), SealError, why);
  await assert.rejects(open((await newSealedKey("other")).key, sealed), SealError, "another key");
});

test("the bucket is reached path-style at its own endpoint, as Garage and MinIO are, under its prefix, with any key's name", async (context) => {
  const s3 = await startS3Bucket(context, { pageSize: 2 });
  const settings = s3Settings({ ...s3.env, MERCBOT_FILES_S3_ENDPOINT: `${s3.endpoint}//`, MERCBOT_FILES_S3_PREFIX: "tenant/one" });
  assert.deepEqual([settings.endpoint, settings.prefix, settings.missing], [s3.endpoint, "tenant/one/", []]);
  const bucket = createS3Bucket(settings);
  context.after(() => bucket.close());
  const names = ["plain.txt", "with space.txt", "plus+sign.txt", "percent%20.txt", "hash#and?query=1&x.txt", "ünïcødé/文件.txt", "(parens) 'quotes'!*~.txt", "deep/a/b/c.txt"];
  for (const name of names) assert.match(await bucket.write(name, Buffer.from(`body of ${name}`)), /^"[0-9a-f]{32}"$/u, name);
  for (const name of names) assert.equal((await bucket.read(name)).toString(), `body of ${name}`, name);
  assert.deepEqual([...s3.objects.keys()].sort(), names.map((name) => `tenant/one/${name}`).sort(), "every key under the prefix");

  // Listed in pages (two keys a page here, a thousand on S3), each key as written, with its size, ETag and time.
  const before = s3.requests.length;
  const listed = await bucket.list("");
  assert.deepEqual(listed.map((object) => object.key), [...names].sort());
  assert.ok(listed.every((object) => object.size === Buffer.byteLength(`body of ${object.key}`) && /^"[0-9a-f]{32}"$/u.test(object.etag) && object.modified > 0));
  const pages = s3.requests.slice(before);
  assert.equal(pages.length, 4);
  assert.ok(pages.slice(1).every((request) => request.path.includes("continuation-token=")));
  assert.deepEqual((await bucket.list("deep/")).map((object) => object.key), ["deep/a/b/c.txt"]);

  // Path-style: every request is <endpoint>/<bucket>/<key>, signed for the bucket's region.
  assert.ok(s3.requests.every((request) => request.path.startsWith("/mercbot-files/") || request.path.startsWith("/mercbot-files?")));
  assert.ok(s3.requests.every((request) => request.headers.host === new URL(s3.endpoint).host && request.status < 300));
  assert.match(s3.requests[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=GKtest\/\d{8}\/garage\/s3\/aws4_request, /u);

  await bucket.remove("plain.txt");
  await bucket.remove("plain.txt");
  assert.equal(await bucket.read("plain.txt"), null);
  s3.failNext(1);
  await assert.rejects(bucket.read("deep/a/b/c.txt"), (error) => error instanceof S3Error && error.status === 503 && error.code === "SlowDown");
  const wrong = createS3Bucket({ ...settings, secretAccessKey: "not it" });
  context.after(() => wrong.close());
  await assert.rejects(wrong.read("deep/a/b/c.txt"), (error) => error instanceof S3Error && error.status === 403 && error.code === "SignatureDoesNotMatch");
});

test("the bucket's settings come from the environment, naming each that's missing, never a value", () => {
  assert.equal(s3Settings({}), null);
  const aws = s3Settings({ MERCBOT_FILES_S3_BUCKET: "b", MERCBOT_FILES_S3_REGION: "eu-west-1", MERCBOT_FILES_S3_ACCESS_KEY_ID: "id", MERCBOT_FILES_S3_SECRET_ACCESS_KEY: "secret" });
  assert.deepEqual([aws.endpoint, aws.prefix, aws.missing], ["https://s3.eu-west-1.amazonaws.com", "", []]);
  assert.deepEqual(s3Settings({ MERCBOT_FILES_S3_BUCKET: "b", MERCBOT_FILES_S3_ACCESS_KEY_ID: "id" }).missing, [
    "MERCBOT_FILES_S3_REGION", "MERCBOT_FILES_S3_SECRET_ACCESS_KEY"
  ]);
  assert.deepEqual(s3Settings({ ...aws, MERCBOT_FILES_S3_BUCKET: "b", MERCBOT_FILES_S3_REGION: "r", MERCBOT_FILES_S3_ACCESS_KEY_ID: "i", MERCBOT_FILES_S3_SECRET_ACCESS_KEY: "s", MERCBOT_FILES_S3_PREFIX: "../up" }).missing, [
    "MERCBOT_FILES_S3_PREFIX (letters, digits, dots, hyphens and underscores, in folders, never \".\" or \"..\")"
  ]);
});

test("without every bucket setting files stay in the files folder, the bucket is never asked, and the start says what's missing", async (context) => {
  const s3 = await startS3Bucket(context);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-bucket-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of Object.keys(s3.env)) {
    const env = { ...s3.env, [name]: "" };
    if (name === "MERCBOT_FILES_S3_ENDPOINT") continue;
    assert.equal(createFilesVolume({ env, folder: dir, keys }).kind, "folder", name);
    assert.deepEqual(missingKeyLines(env).filter((line) => line.includes("Bots' file storage")), [
      `${name} isn't set, so this is off: Bots' file storage. Files stay in a folder on this machine, which only suits a single server.`
    ], name);
  }
  assert.equal(createFilesVolume({ env: { ...s3.env, MERCBOT_FILES_S3_ENDPOINT: "" }, folder: dir, keys }).kind, "bucket", "the endpoint is AWS's by default");
  assert.deepEqual(s3.requests, []);
});

test("two servers on one bucket see each other's files once they're settled, and the bucket holds none readable", async (context) => {
  const s3 = await startS3Bucket(context);
  const [one, two] = [await server(context, s3), await server(context, s3)];
  const text = "Quarterly report: confidential figures.";

  // Written on one server, settled (a reply's end, D-19): the other finds it, whole.
  const { mine } = await one.store.prepare(at(3, 7, 1));
  await writeFile(path.join(mine, "report.txt"), text);
  await mkdir(path.join(mine, "Drafts"));
  await one.store.settle(3);
  assert.deepEqual((await two.store.list(at(3, 7, 1))).mine.map((file) => file.path), ["/files/mine/report.txt"]);
  assert.equal(await readFile((await two.store.existingFile(at(3, 7, 1), "/files/mine/report.txt")).real, "utf8"), text);
  assert.deepEqual((await two.store.listFolder(at(3, 7, 1), "/files/mine")).entries.map((entry) => entry.path), ["/files/mine/Drafts", "/files/mine/report.txt"]);
  const sealed = [...s3.objects].filter(([key]) => !key.endsWith("/") && key !== ".mercbot-files");
  assert.deepEqual(sealed.map(([key]) => key), ["homes/3/bots/7/people/1/report.txt"]);
  assert.ok(sealed.every(([, object]) => object.body.subarray(0, 4).toString() === "MBF1" && !object.body.includes(text)));

  // A person's files stay theirs, and another home's stay its own.
  assert.deepEqual((await two.store.list(at(3, 7, 2))).mine, []);
  await assert.rejects(two.store.existingFile(at(3, 7, 2), "/files/mine/report.txt"), /isn't there/);
  assert.deepEqual((await two.store.list(at(4, 7, 1))).mine, []);

  // Moved, made and removed on the second: the first sees it at its next pull.
  await two.store.move(at(3, 7, 1), "/files/mine/report.txt", "/files/shared/Team/report.txt");
  await two.store.makeFolder(two.store.homePlace(3), "/files/shared/Archive");
  await two.store.remove(at(3, 7, 1), "/files/mine/Drafts");
  await two.store.settle(3);
  await nextPull();
  assert.deepEqual((await one.store.list(at(3, 8, 2))).shared.map((file) => file.path), ["/files/shared/Team/report.txt"]);
  assert.deepEqual((await one.store.list(at(3, 7, 1))).mine, []);
  assert.deepEqual((await one.store.listFolder(one.store.homePlace(3), "/files/shared")).entries.map((entry) => entry.path), ["/files/shared/Archive", "/files/shared/Team"]);
  assert.deepEqual((await one.store.listFolder(at(3, 7, 1), "/files/mine")).entries, []);
  await one.store.remove(one.store.homePlace(3), "/files/shared/Team/report.txt");
  await one.store.settle(3);
  await nextPull();
  await assert.rejects(two.store.existingFile(at(3, 7, 1), "/files/shared/Team/report.txt"), /isn't there/);
  assert.ok(![...s3.objects.keys()].some((key) => key.endsWith("report.txt")));
});

test("a file another server settled a moment ago is found at once, without waiting for the next pull", async (context) => {
  const s3 = await startS3Bucket(context);
  const [one, two] = [await server(context, s3), await server(context, s3)];
  assert.deepEqual((await two.store.list(at(3, 7, 1))).shared, []);
  const { shared } = await one.store.prepare(at(3, 7, 1));
  await writeFile(path.join(shared, "new.txt"), "just made");
  await one.store.settle(3);
  assert.equal(await readFile((await two.store.existingFile(at(3, 7, 1), "/files/shared/new.txt")).real, "utf8"), "just made");
});

test("a change made here and not yet sent wins over the bucket's, and goes when it's sent; a stopping server sends what's left", async (context) => {
  const s3 = await startS3Bucket(context);
  const [one, two] = [await server(context, s3), await server(context, s3)];
  const { shared } = await one.store.prepare(at(3, 7, 1));
  await writeFile(path.join(shared, "plan.txt"), "first");
  await one.store.settle(3);
  const theirs = path.join((await two.store.prepare(at(3, 7, 1))).shared, "plan.txt");
  assert.equal(await readFile(theirs, "utf8"), "first");

  await writeFile(theirs, "changed on two");
  await writeFile(path.join(shared, "plan.txt"), "changed on one, sent first");
  await one.store.settle(3);
  await nextPull();
  await two.store.list(at(3, 7, 1));
  assert.equal(await readFile(theirs, "utf8"), "changed on two", "kept until it's sent");
  await two.store.settle(3);
  await nextPull();
  await one.store.list(at(3, 7, 1));
  assert.equal(await readFile(path.join(shared, "plan.txt"), "utf8"), "changed on two", "then everyone's");

  // Written and never settled: the server sends it as it stops (D-19).
  await writeFile(theirs, "written as the server stopped");
  await two.volume.stop();
  await nextPull();
  await one.store.list(at(3, 7, 1));
  assert.equal(await readFile(path.join(shared, "plan.txt"), "utf8"), "written as the server stopped");
});

test("servers that start together on a new bucket use one files key, the database's, whatever the store does with conditional writes", async (context) => {
  // A store that takes If-None-Match, one that ignores it, and one that refuses it 501 NotImplemented.
  const stores = { takes: {}, ignores: { ignoreIfNoneMatch: true }, refuses: { refuseConditionalWrites: true } };
  for (const [store, options] of Object.entries(stores)) {
    const s3 = await startS3Bucket(context, options);
    const servers = [];
    for (let index = 0; index < 3; index += 1) servers.push(await server(context, s3));
    const before = offered.length;
    assert.deepEqual(await Promise.all(servers.map(({ volume }) => volume.available())), [true, true, true], store);
    // Each server offered the key it made, at once; the database kept one, which is the bucket's record.
    assert.equal(offered.length - before, 3, store);
    const id = bucketId({ endpoint: s3.endpoint, bucket: "mercbot-files", prefix: "" });
    assert.equal(s3.objects.get(".mercbot-files").body.toString("utf8"), keptKeys.get(id), store);
    assert.equal(s3.requests.filter((one) => one.headers["if-none-match"] || one.headers["if-match"]).length, 0, `${store}: no conditional write`);
    assert.equal(s3.requests.filter((one) => one.status >= 500).length, 0, store);
    const { shared } = await servers[0].store.prepare(at(3, 7, 1));
    await writeFile(path.join(shared, "made-first.txt"), "one key for all");
    await servers[0].store.settle(3);
    for (const other of servers.slice(1)) {
      const found = await other.store.existingFile(at(3, 7, 1), "/files/shared/made-first.txt");
      assert.equal(await readFile(found.real, "utf8"), "one key for all", store);
    }
    // A server starting later reads the bucket's record and asks the database nothing.
    const later = await server(context, s3);
    assert.equal(await later.volume.available(), true, store);
    assert.equal(offered.length - before, 3, `${store}: the bucket's record is enough`);
  }
});


test("a wrong passphrase, or a files folder holding anything else, keeps the bucket off and says why; nothing is written", async (context) => {
  const s3 = await startS3Bucket(context);
  const one = await server(context, s3);
  assert.equal(await one.volume.available(), true);

  const wrong = await server(context, s3, { env: { MERCBOT_FILES_PASSPHRASE: "not the one" } });
  assert.equal(await wrong.volume.available(), false);
  assert.deepEqual(wrong.logs, ["The files bucket isn't available, so files can't be read or saved: MERCBOT_FILES_PASSPHRASE doesn't open the files bucket's key."]);
  await assert.rejects(wrong.store.list(at(3, 7, 1)), { code: "files_unavailable", message: "Files aren't available on this server right now." });

  const folder = await mkdtemp(path.join(os.tmpdir(), "mercbot-bucket-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(path.join(folder, "kept.txt"), "a person's own file");
  const foreign = await server(context, s3, { folder });
  assert.equal(await foreign.volume.available(), false);
  assert.match(foreign.logs[0], /holds files that aren't a copy of the files bucket; empty it, or set MERCBOT_FILES_DIR to an empty folder$/u);
  assert.equal(await readFile(path.join(folder, "kept.txt"), "utf8"), "a person's own file");

  // A server's own copy from before it restarted is emptied: the bucket holds what it sent.
  await rm(path.join(folder, "kept.txt"));
  const before = await server(context, s3, { folder });
  const { shared } = await before.store.prepare(at(3, 7, 1));
  await writeFile(path.join(shared, "sent.txt"), "in the bucket");
  await before.volume.stop();
  const after = await server(context, s3, { folder });
  assert.equal(await after.volume.available(), true);
  assert.deepEqual((await readdir(folder)).sort(), [".mercbot-files", ".mercbot-files-working"]);
  assert.equal(await readFile((await after.store.existingFile(at(3, 7, 1), "/files/shared/sent.txt")).real, "utf8"), "in the bucket");
});

test("a computer's screenshot, a conversation's command outputs, a profile picture and a private folder reach every server", async (context) => {
  const s3 = await startS3Bucket(context);
  const [one, two] = [await server(context, s3), await server(context, s3)];

  const computer = await one.store.computerFolder(5);
  await mkdir(path.join(computer, "screenshots"));
  await writeFile(path.join(computer, "screenshots", "s1.png"), "png bytes");
  await writeFile(path.join(computer, "browser.json"), "saved browser");
  await one.store.settleComputer(5);
  assert.equal(await readFile(await two.store.computerFile(5, "screenshots/s1.png"), "utf8"), "png bytes");
  assert.equal(await two.store.computerFile(5, "screenshots/none.png"), null);
  assert.equal(await readFile(path.join(await two.store.computerFolder(5), "browser.json"), "utf8"), "saved browser");
  assert.deepEqual(await two.store.computerIds(), ["5"]);
  await two.store.removeComputerFolder(5);
  assert.deepEqual(await one.store.computerIds(), []);
  assert.ok(![...s3.objects.keys()].some((key) => key.startsWith("computers/")));

  await writeFile(path.join(await one.store.runsFolder(9), "17.log"), "whole output");
  await one.store.settleRuns(9);
  assert.deepEqual((await two.store.runOutputs()).map(({ conversation, name }) => [conversation, name]), [["9", "17.log"]]);
  assert.equal(await readFile(path.join(await two.store.runsFolder(9), "17.log"), "utf8"), "whole output");
  await two.store.removeRunOutput("9", "17.log");
  assert.deepEqual(await one.store.runOutputs(), []);

  const pictures = await one.store.profilePicturesFolder(4);
  await mkdir(path.join(pictures, "4"), { recursive: true });
  await writeFile(path.join(pictures, "4", "picture.webp"), "webp bytes");
  await one.store.settleProfilePicture(4);
  assert.equal(await readFile(path.join(await two.store.profilePicturesFolder(4), "4", "picture.webp"), "utf8"), "webp bytes");

  await writeFile(path.join(await one.store.privateFolder("safety-evidence"), "case.json"), "{}");
  await one.store.settlePrivate("safety-evidence");
  assert.equal(await readFile(path.join(await two.store.privateFolder("safety-evidence"), "case.json"), "utf8"), "{}");
});

test("archives of the usage kept older than seven years are deleted from the bucket, whichever server archived them", async (context) => {
  const s3 = await startS3Bucket(context);
  const [one, two] = [await server(context, s3), await server(context, s3)];
  assert.equal(await one.volume.available(), true);
  const old = path.join(one.dir, "usage-archive", "daily", "2001-02");
  await mkdir(old, { recursive: true });
  await writeFile(path.join(old, "homes-000000000000-000000099999.csv.gz"), "archived long ago");
  const young = path.join(one.dir, "usage-archive", "daily", "2099-01");
  await mkdir(young, { recursive: true });
  await writeFile(path.join(young, "homes-000000000000-000000099999.csv.gz"), "kept");
  assert.deepEqual(await one.volume.stop().then(() => [...s3.objects.keys()].filter((key) => key.endsWith(".csv.gz")).sort()), [
    "usage-archive/daily/2001-02/homes-000000000000-000000099999.csv.gz", "usage-archive/daily/2099-01/homes-000000000000-000000099999.csv.gz"
  ]);

  // The sweep's database work done (no month left to archive), the other server deletes what's too old.
  const knex = { raw: async () => ({ rows: [] }) };
  const filesSync = () => two.volume.sync;
  await createRetention({ resources: { usageJobs: {} }, systemContext: () => ({}), env: two.env, knex, archivedColumns: [], filesSync }).sweep();
  assert.deepEqual([...s3.objects.keys()].filter((key) => key.startsWith("usage-archive/daily/2001-02")), []);
  assert.deepEqual([...s3.objects.keys()].filter((key) => key.endsWith(".csv.gz")), ["usage-archive/daily/2099-01/homes-000000000000-000000099999.csv.gz"]);
});
