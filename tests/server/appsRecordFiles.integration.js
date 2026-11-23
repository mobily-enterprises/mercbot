import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { buildAppTools } from "../../packages/bots/src/server/appTools.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";

// A record's file or picture (D-127), through the data gate on the test database and a real file store: the gate writes
// it to the home's Database files at the record's own place and sets it in one change; a change that fails leaves no
// file; a replaced or cleared file goes once the change is in; an obsolete record keeps its files; a picture field takes
// only pictures; nobody sets a file by sending a path; a draft's practice data and a visitor add none.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

async function setup(context) {
  const home = await appsHome(context, { slug: "apps-files" });
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-record-files-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const { registry, gate, watches, views } = appsParts(home, { recordFiles: {
    write: store.writeRecordFile,
    remove: store.removeRecordFile,
    real: async (homeId, virtualPath) => (await store.existingFile(store.homePlace(homeId), virtualPath)).real
  } });
  const person = { type: "person", id: String(home.userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "data" });
  const graphics = await registry.createTable(person, {
    key: "graphics",
    fields: [{ key: "title", type: "text", required: true }, { key: "picture", type: "image" }, { key: "source", type: "file" }]
  }, home.options);
  const sourceFile = async (name, bytes) => {
    const at = path.join(dir, name);
    await writeFile(at, bytes);
    return { source: at, name, type: "application/octet-stream" };
  };
  const exists = async (virtualPath) => store.existingFile(store.homePlace(home.workspaceId), virtualPath).then(() => true, () => false);
  const idOf = (key) => graphics.fields.find((field) => field.key === key).id;
  return { home, store, gate, registry, watches, views, ctx, graphics, sourceFile, exists, idOf };
}

test("a picture lands at its record's place in Database files; replaced or cleared, the old one goes; obsolete, it stays", async (context) => {
  const { home, gate, ctx, sourceFile, exists, idOf } = await setup(context);
  const poster = await gate.create(ctx, "graphics", { title: "Poster" });
  const set = await gate.attachFile(ctx, "graphics", poster.id, "picture", await sourceFile("poster.png", PNG));
  const first = set[idOf("picture")];
  assert.deepEqual(first, { path: `/files/db/tables/graphics/${poster.id}/picture/poster.png`, name: "poster.png", size: PNG.length, type: "image/png" });
  assert.ok(await exists(first.path));
  assert.deepEqual((await gate.history(ctx, "graphics", poster.id))[0].changes[idOf("picture")][1].path, first.path, "audited");

  const second = (await gate.attachFile(ctx, "graphics", poster.id, idOf("picture"), await sourceFile("poster-2.png", PNG)))[idOf("picture")];
  assert.equal(second.path, `/files/db/tables/graphics/${poster.id}/picture/poster-2.png`);
  assert.equal(await exists(first.path), false, "the replaced picture went");
  await gate.attachFile(ctx, "graphics", poster.id, "source", await sourceFile("poster.psd", "layers"));
  await gate.update(ctx, "graphics", poster.id, { source: null });
  assert.equal(await exists(`/files/db/tables/graphics/${poster.id}/source/poster.psd`), false, "a cleared file went");

  await gate.markObsolete(ctx, "graphics", poster.id);
  assert.ok(await exists(second.path), "an obsolete record keeps its files");
  await gate.restore(ctx, "graphics", poster.id);
  assert.equal((await gate.get(ctx, "graphics", poster.id))[idOf("picture")].path, second.path);
  assert.ok(home.workspaceId);
});

test("a picture field takes only pictures, nobody sets a file by sending a path, and a failed change leaves no file", async (context) => {
  const { home, gate, ctx, sourceFile, exists } = await setup(context);
  const poster = await gate.create(ctx, "graphics", { title: "Poster" });
  await assert.rejects(gate.attachFile(ctx, "graphics", poster.id, "picture", await sourceFile("fake.png", "<svg onload=alert(1)>")), { code: "apps_image_not_picture" });
  await assert.rejects(gate.attachFile(ctx, "graphics", poster.id, "title", await sourceFile("a.png", PNG)), { code: "apps_record_field_unknown" });
  await assert.rejects(gate.update(ctx, "graphics", poster.id, { picture: { path: "/files/shared/secret.png", name: "x", size: 1, type: "image/png" } }), { code: "apps_value_file_from_upload" });
  await assert.rejects(gate.create(ctx, "graphics", { title: "Sneaky", source: { path: "/files/shared/secret.txt" } }), { code: "apps_value_file_from_upload" });
  await assert.rejects(gate.attachFile(ctx, "graphics", "999999999", "picture", await sourceFile("ghost.png", PNG)), { code: "apps_record_not_found" });
  assert.equal(await exists("/files/db/tables/graphics/999999999/picture/ghost.png"), false, "no file left by the failed change");
  await assert.rejects(gate.attachFile({ ...ctx, practice: { id: "p1", changes: [] } }, "graphics", poster.id, "picture", await sourceFile("p.png", PNG)), { code: "apps_files_not_in_practice" });
  await assert.rejects(gate.attachFile({ ...ctx, visitor: { signedIn: false }, access: {} }, "graphics", poster.id, "picture", await sourceFile("v.png", PNG)), (error) => error.statusCode >= 400);
  assert.ok(home.workspaceId);
});

test("a bot puts one of its files on a record as the record's own copy, and reads it back by its path", async (context) => {
  const { home, store, gate, registry, watches, views, ctx, sourceFile, exists } = await setup(context);
  const poster = await gate.create(ctx, "graphics", { title: "Poster" });
  const place = store.homePlace(home.workspaceId);
  const { source } = await sourceFile("logo.png", PNG);
  const shared = `/files/shared/logo.png`;
  await writeFile(path.join((await store.prepare(place)).shared, "logo.png"), await readFile(source));
  const tools = buildAppTools({
    apps: { registry, gate, watches, views },
    directory: { findBot: async () => ({ name: "Tess" }) },
    call: home.options,
    botId: "1",
    chatBotId: null,
    userId: String(home.userId),
    isBuilder: false,
    after: [],
    attempted: [],
    via: null,
    fileAt: (wanted) => store.existingFile(place, wanted)
  });
  const attached = await tools.dataAttachFile.execute({ table: "graphics", id: poster.id, field: "picture", path: shared }, {});
  assert.equal(attached.status, "attached", JSON.stringify(attached));
  assert.equal(attached.record.picture, `/files/db/tables/graphics/${poster.id}/picture/logo.png`);
  assert.ok(await exists(shared), "the bot's own file stays");
  assert.ok(await exists(attached.record.picture));
  assert.match((await tools.dataAttachFile.execute({ table: "graphics", id: poster.id, field: "picture", path: "/files/shared/none.png" }, {})).error, /./u);
  const sneaky = await tools.dataUpdate.execute({ table: "graphics", id: poster.id, values: { picture: { path: shared } } }, {});
  assert.match(sneaky.error, /upload|file/iu, "a file value in values is refused");
});

test("a visitor gets a record's picture only by its record, from a record and field the public app lets them read", async (context) => {
  const { home, gate, registry, ctx, sourceFile } = await setup(context);
  const shown = await gate.create(ctx, "graphics", { title: "Poster" });
  const hidden = await gate.create(ctx, "graphics", { title: "Secret" });
  for (const record of [shown, hidden]) {
    await gate.attachFile(ctx, "graphics", record.id, "picture", await sourceFile("p.png", PNG));
    await gate.attachFile(ctx, "graphics", record.id, "source", await sourceFile("p.psd", "layers"));
  }
  const tables = await registry.loadTables(home.options);
  const visitor = { signedIn: false, email: "" };
  const definition = { public: { tables: { graphics: { can: ["list", "get"], rows: '=title != "Secret"', read: ["title", "picture"] } } } };
  const visitorCtx = { workspaceId: home.workspaceId, actor: { type: "visitor", id: null, name: "Gallery" }, via: { kind: "public" }, visitor, access: compile(definition, tables, visitor), options: home.options };

  const served = await gate.recordFile(visitorCtx, "graphics", shown.id, "picture");
  assert.deepEqual([await readFile(served.real), served.name, served.type], [PNG, "p.png", "image/png"]);
  await assert.rejects(gate.recordFile(visitorCtx, "graphics", shown.id, "source"), { code: "apps_record_file_missing" }, "a field the app doesn't let them read");
  await assert.rejects(gate.recordFile(visitorCtx, "graphics", hidden.id, "picture"), { code: "apps_record_not_found" }, "a record outside its rows");
  await assert.rejects(gate.recordFile(visitorCtx, "graphics", shown.id, "title"), { code: "apps_record_file_missing" }, "not a file field");
  await assert.rejects(gate.recordFile({ ...visitorCtx, access: undefined }, "graphics", shown.id, "picture"), (error) => error.statusCode === 403);
  assert.equal((await gate.recordFile(ctx, "graphics", hidden.id, "source")).name, "p.psd", "a member gets any record's file");
});
