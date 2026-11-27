import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";

// What scripts see of each kind of field: a tag list as the list, a file or picture as its name, size and type (never
// where it's stored), a link as its id, a time as its text. Tags and files once came out empty.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

test("scripts see tags, files, pictures, links and times as they are", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-script-values" });
  const { userId, options } = home;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-script-values-"));
  cleanup.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args),
    recordFiles: {
      write: store.writeRecordFile,
      remove: store.removeRecordFile,
      real: async (homeId, virtualPath) => (await store.existingFile(store.homePlace(homeId), virtualPath)).real
    }
  });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => [] });
  cleanup.after(() => scripts.close());
  const actor = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(actor);
  await registry.createTable(actor, { key: "companies", fields: [{ key: "name", type: "text" }] }, options);
  await registry.createTable(actor, {
    key: "notes",
    fields: [
      { key: "title", type: "text" },
      { key: "labels", type: "tags" },
      { key: "scan", type: "file" },
      { key: "photo", type: "image" },
      { key: "company", type: "link", target: "companies" },
      { key: "seen", type: "datetime" }
    ]
  }, options);
  await apps.createApp(actor, { name: "Notes" }, options);
  const acme = await gate.create(ctx, "companies", { name: "Acme" });
  const note = await gate.create(ctx, "notes", { title: "Visit", labels: ["urgent", "site"], company: acme.id, seen: "2026-11-27T09:30:00Z" });
  const source = path.join(dir, "upload");
  await writeFile(source, PNG);
  await gate.attachFile(ctx, "notes", note.id, "scan", { source, name: "scan.png", type: "image/png" });
  await gate.attachFile(ctx, "notes", note.id, "photo", { source, name: "photo.png", type: "image/png" });

  const saved = await scripts.save(actor, "notes", {
    key: "peek", kind: "source", summary: "peek",
    code: "async function main(input) { const note = await records.get('notes', input.id); return input.check ? note.title : note }",
    tests: [{ name: "t", input: { id: "1", check: true }, records: { notes: [{ title: "x" }] }, expect: "x" }]
  }, options);
  assert.deepEqual(saved.errors, []);
  // A saved script is the draft's until it's published (D-139).
  await apps.publish(actor, "notes", {}, options);
  const seen = await scripts.runNamed("source", (await apps.find("notes", options)).id, "peek", { id: note.id }, { kind: "screen" }, null, options);
  assert.deepEqual(seen.labels, ["urgent", "site"]);
  assert.deepEqual(seen.scan, { name: "scan.png", size: PNG.length, type: "image/png" });
  assert.deepEqual(seen.photo, { name: "photo.png", size: PNG.length, type: "image/png" });
  assert.equal(seen.company, acme.id);
  assert.match(String(seen.seen), /^2026-11-27T09:30/u);
  assert.ok(!JSON.stringify(seen).includes(dir), "never where a file is stored");
});
