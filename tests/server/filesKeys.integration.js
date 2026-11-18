import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { bucketId, createFilesVolume, databaseFilesKeys } from "../../packages/files/src/server/filesVolume.js";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { startS3Bucket } from "../support/s3Bucket.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Which files key a new files bucket keeps, decided in PostgreSQL (files_keys, D-91): two servers, each with its own
// connection, start together on a new bucket, each makes a key and offers it, and both end with the one the database
// kept, which is the bucket's record; on a store that takes conditional writes and on one that refuses them 501
// NotImplemented, as some stores do. No request carries a condition.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const place = { homeId: 3, botId: 7, userId: 1 };

/** One server: its own connection, its files folder, its volume on the bucket and its store, all closed after. */
async function server(context, s3, offers) {
  const knex = await connectTestDatabase();
  const { resources, systemContext } = (await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS })).features["mercbot.files"];
  const kept = databaseFilesKeys({ filesKeys: resources.filesKeys, systemContext });
  const keys = {
    keep(bucket, record) {
      offers.push(record);
      return kept.keep(bucket, record);
    }
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-files-keys-"));
  const logs = [];
  const volume = createFilesVolume({ env: { ...s3.env, MERCBOT_FILES_DIR: dir }, folder: dir, keys, log: (line) => logs.push(line) });
  const store = createFileStore({ root: dir, fallback: dir, volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  context.after(async () => {
    await volume.stop();
    await knex.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  return { knex, volume, store, logs };
}

for (const [store, options] of Object.entries({ "takes conditional writes": {}, "refuses them 501": { refuseConditionalWrites: true } })) {
  test(`two servers starting together on a new bucket that ${store} keep one files key, the database's`, async (context) => {
    const s3 = await startS3Bucket(context, options);
    const id = bucketId({ endpoint: s3.endpoint, bucket: "mercbot-files", prefix: "" });
    const offers = [];
    const [one, two] = [await server(context, s3, offers), await server(context, s3, offers)];
    context.after(async () => {
      const knex = await connectTestDatabase();
      await knex("files_keys").where({ bucket: id }).del();
      await knex.destroy();
    });

    assert.deepEqual(await Promise.all([one.volume.available(), two.volume.available()]), [true, true], [...one.logs, ...two.logs].join("\n"));
    // Both found the bucket without a key and offered their own; PostgreSQL kept one, the record the bucket now holds.
    assert.equal(offers.length, 2);
    assert.notEqual(offers[0], offers[1], "each server made its own key");
    const rows = await one.knex("files_keys").where({ bucket: id }).select("record");
    assert.equal(rows.length, 1);
    assert.ok(offers.includes(rows[0].record));
    assert.equal(s3.objects.get(".mercbot-files").body.toString("utf8"), rows[0].record);
    assert.deepEqual(s3.requests.filter((request) => request.headers["if-none-match"] || request.headers["if-match"]), [], "no conditional write");

    // What one server saves, the other opens: they seal with the one key.
    const { shared } = await one.store.prepare(place);
    await writeFile(path.join(shared, "plan.txt"), "one key for both");
    await one.store.settle(3);
    const found = await two.store.existingFile(place, "/files/shared/plan.txt");
    assert.equal(await readFile(found.real, "utf8"), "one key for both");
  });
}
