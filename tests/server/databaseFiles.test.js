import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DB, createFileStore } from "../../packages/files/src/server/fileStore.js";

// Database files (D-130): the files and pictures a home's records hold, at a fixed place per table, record and field
// under /files/db. Only the records' own writes put a file there (writeRecordFile) or take one away (removeRecordFile);
// a person, a bot's file tools or anyone else reads and copies them, and is refused moving, renaming, deleting,
// writing or making folders there, so a record's link never breaks.
async function store(context) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-db-files-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const made = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const source = path.join(dir, "poster.png");
  await writeFile(source, "picture bytes");
  return { dir, store: made, source };
}

const protectedRefusal = (error) => error.statusCode === 403 && error.code === "files_db_protected";

test("a record's file lands at its fixed place, a taken name gets a number, and only that place is ever removed", async (context) => {
  const { store: files, source } = await store(context);
  const at = { table: "graphics", record: "42", field: "picture" };
  const first = await files.writeRecordFile("7", at, source, "poster.png");
  assert.deepEqual(first, { path: `${DB}/tables/graphics/42/picture/poster.png`, name: "poster.png", size: 13 });
  const second = await files.writeRecordFile("7", at, source, "../../poster.png");
  assert.equal(second.path, `${DB}/tables/graphics/42/picture/poster (2).png`, "a name taken gets a number, and a path in the name is dropped");
  await assert.rejects(files.writeRecordFile("7", { ...at, table: "../shared" }, source, "x.png"), /plain names/u);

  const home = files.homePlace("7");
  const read = await files.existingFile(home, first.path);
  assert.equal(await readFile(read.real, "utf8"), "picture bytes", "everyone reads it");
  await files.removeRecordFile("7", first.path);
  await assert.rejects(files.existingFile(home, first.path), { code: "files_file_gone" });
  await files.removeRecordFile("7", "/files/shared/anything.txt");
  await files.removeRecordFile("7", `${DB}/tables/../../shared/x`);
});

test("two files of one name written at once each keep their own, never one over the other", async (context) => {
  const { dir, store: files } = await store(context);
  const at = { table: "graphics", record: "42", field: "picture" };
  const sources = await Promise.all(["one", "two", "three"].map(async (text) => {
    const source = path.join(dir, `${text}.png`);
    await writeFile(source, text);
    return source;
  }));
  const written = await Promise.all(sources.map((source) => files.writeRecordFile("7", at, source, "poster.png")));
  assert.equal(new Set(written.map((file) => file.path)).size, 3, written.map((file) => file.path).join(", "));
  const home = files.homePlace("7");
  const contents = await Promise.all(written.map(async (file) => readFile((await files.existingFile(home, file.path)).real, "utf8")));
  assert.deepEqual(contents, ["one", "two", "three"]);
});

test("nobody moves, renames, deletes, writes or makes folders in Database files, from any place; copying out works", async (context) => {
  const { store: files, source } = await store(context);
  const { path: picture } = await files.writeRecordFile("7", { table: "contacts", record: "3", field: "photo" }, source, "ana.png");
  const home = files.homePlace("7");
  const chat = files.placeFor({ homeId: "7", chatId: "11", chatKind: "public", botId: "5" });
  for (const place of [home, chat]) {
    await files.prepare(place);
    await assert.rejects(files.move(place, picture, `${DB}/tables/contacts/3/photo/renamed.png`), protectedRefusal, "rename");
    await assert.rejects(files.move(place, picture, "/files/shared/ana.png"), protectedRefusal, "move out");
    await assert.rejects(files.remove(place, picture), protectedRefusal, "delete");
    await assert.rejects(files.resolve(place, `${DB}/tables/contacts/3/photo/new.png`), protectedRefusal, "write");
    await assert.rejects(files.makeFolder(place, `${DB}/tables/extra`), protectedRefusal, "make a folder");
    await assert.rejects(files.transfer({ from: { place, path: "/files/shared/x.txt" }, to: { place, folder: `${DB}/tables` } }).catch(async (error) => {
      if (error.code === "files_file_gone") {
        await writeFile(path.join((await files.prepare(place)).shared, "x.txt"), "x");
        return files.transfer({ from: { place, path: "/files/shared/x.txt" }, to: { place, folder: `${DB}/tables` } });
      }
      throw error;
    }), protectedRefusal, "copy in");
  }
  const copied = await files.transfer({ from: { place: chat, path: picture }, to: { place: chat, folder: "/files/chat" } });
  assert.equal(copied.path, "/files/chat/ana.png");
  assert.ok((await files.existingFile(home, picture)).real, "the record's own file is still there");
  assert.equal(Object.keys(await files.folderTree(home)).includes("db"), false, "never offered as a place to move things to");
  assert.ok((await files.list(chat)).db.some((entry) => entry.path === picture), "bots see it in their listing");
});
