import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { filesFolder } from "../../packages/account/src/server/dataFolder.js";
import { FilesError, createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createFilesRuntime } from "../../packages/files/src/server/filesRuntime.js";
import { createOfficeApps } from "../../packages/files/src/server/officeApps.js";
import { runsc, toolsDir } from "../../packages/files/src/server/gvisor.js";

// Bots' files (D-20, D-21, D-36, D-47): a bot reaches the person's own folder with it, its own
// folder for everyone who uses it, and the home's shared one, nothing else. A place is
// { homeId, botId, userId }, { homeId, botId, everyone: true } or { homeId, home: true }.
const at = (homeId, botId, userId) => ({ homeId, botId, userId });

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-files-test-"));
  return { dir, store: createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} }) };
}

// One data folder (docs/standalone-plan.md, change 4): without a volume, files are kept in MERCBOT_DATA_DIR, so a new
// release folder finds them; a volume (D-20) still holds them when there is one.
test("files live in the data folder without a volume", () => {
  assert.equal(filesFolder({ MERCBOT_DATA_DIR: "/srv/mercbot/data" }), path.join("/srv/mercbot/data", "files"));
  assert.equal(filesFolder({ MERCBOT_DATA_DIR: "/srv/mercbot/data", MERCBOT_FILES_DIR: "/mnt/files" }), "/mnt/files");
  assert.equal(filesFolder({}), path.resolve(".data", "files"));
});

// A single-user copy (D-81) has no volume: moving a home's files back to Mercbot's storage (D-80, fileMoves.js) brings
// them into the data folder's files/, beside the copy's other files, so a new release folder still finds them.
test("a move to Mercbot's storage ends in the data folder without a volume", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-files-test-"));
  const files = createFilesRuntime({ resources: {}, systemContext: () => ({}), env: { MERCBOT_DATA_DIR: dir }, integrations: {} });
  try {
    assert.equal(await files.store.ownFolder(7), path.join(dir, "files", "homes", "7"));
  } finally {
    await files.mounts.closeAll();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// A coding run (D-77) in a person's own copy (D-81): the project its sandbox is given (store.existingFolder) is in the
// copy's data folder, so the work stays when the copy moves to a new release, and the sandbox runs the gVisor the copy's
// installer trusts (MERCBOT_RUNSC, scripts/hosting/local.sh), as every sandbox there does: Ubuntu refuses the tools' own.
test("in a person's own copy, a coding run works on its project in the copy's data folder, in the gVisor it trusts", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-own-copy-")));
  const env = { MERCBOT_DATA_DIR: dir, MERCBOT_RUNSC: "/usr/local/lib/mercbot/runsc" };
  // The home keeps its files in Mercbot's storage: it has no file_storage row.
  const resources = { fileStorage: { queryAll: async () => [] } };
  const files = createFilesRuntime({ resources, systemContext: () => ({ forWorkspace: () => ({}) }), env, integrations: {} });
  try {
    const { mine } = await files.store.prepare(at(3, 7, 1));
    await fs.mkdir(path.join(mine, "site"));
    assert.deepEqual(await files.store.existingFolder(at(3, 7, 1), "/files/mine/site"), {
      real: path.join(dir, "files", "homes", "3", "bots", "7", "people", "1", "site"),
      virtualPath: "/files/mine/site"
    });
    assert.deepEqual(runsc(env, ["--version"]), ["/usr/local/lib/mercbot/runsc", ["--version"]]);
  } finally {
    await files.mounts.closeAll();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// A home's own storage (D-26, D-80: its Google Drive folder's mount, or WebDAV) holds a coding run's project as it holds
// the bot's other files. While the home's files are being moved (D-80) they're read-only, and a coding run's folder is
// for writing, so it's refused as a command's folders are, with the move's own reason; reading still works.
test("a coding run's folder is in the home's own storage, and is refused while the home's files are moved", async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-own-storage-")));
  // Where the home's storage is mounted (remoteMounts.js), and whether a move is going (storageSettings.js `folder`).
  const mount = path.join(dir, "mount");
  let moving = false;
  const store = createFileStore({
    root: "",
    fallback: path.join(dir, "mercbot"),
    ownStorage: async (homeId, { reading }) => {
      if (moving && !reading) {
        throw new FilesError(409, "Moving this home's files to the storage it chose: they're read-only until that's done, usually in a few minutes.", {
          code: "files_storage_moving"
        });
      }
      return mount;
    },
    settle: async () => {},
    explain: async () => {}
  });
  try {
    const { mine } = await store.prepare(at(3, 7, 1));
    await fs.mkdir(path.join(mine, "site"));
    assert.equal((await store.existingFolder(at(3, 7, 1), "/files/mine/site")).real, path.join(mount, "bots", "7", "people", "1", "site"));
    assert.equal(existsSync(path.join(dir, "mercbot")), false, "nothing of it is on Mercbot's own storage");

    moving = true;
    for (const folder of ["/files/mine/site", "/files/mine", "/files/shared"]) {
      await assert.rejects(store.existingFolder(at(3, 7, 1), folder), { code: "files_storage_moving" }, folder);
    }
    assert.deepEqual((await store.list(at(3, 7, 1))).mine, [], "the files can still be read");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("paths stay inside the bot's own and the shared folder", async () => {
  const { dir, store } = await tempStore();
  try {
    assert.ok((await store.resolve(at(3, 7, 1), "/files/mine/a/report.docx")).endsWith(path.join("homes", "3", "bots", "7", "people", "1", "a", "report.docx")));
    assert.ok((await store.resolve(at(3, 7, 1), "/files/shared/x.xlsx")).endsWith(path.join("homes", "3", "shared", "x.xlsx")));
    for (const outside of ["/files/mine/../2/x", "/files/shared/../../4/shared/x", "/files/mine", "/etc/passwd", "report.docx", "/files/other/x"]) {
      assert.equal(await store.resolve(at(3, 7, 1), outside), null, outside);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a link made inside a folder can't lead a download elsewhere", async () => {
  const { dir, store } = await tempStore();
  try {
    const { mine } = await store.prepare(at(3, 7, 1));
    await fs.writeFile(path.join(dir, "secret.txt"), "secret");
    await fs.symlink(path.join(dir, "secret.txt"), path.join(mine, "link.txt"));
    await assert.rejects(store.existingFile(at(3, 7, 1), "/files/mine/link.txt"), /isn't there/);
    await fs.writeFile(path.join(mine, "ok.txt"), "fine");
    assert.equal((await store.existingFile(at(3, 7, 1), "/files/mine/ok.txt")).stat.size, 4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a coding run's folder is a real folder of the bot's, never a link or a path out of its folders", async () => {
  const { dir, store } = await tempStore();
  try {
    const { mine } = await store.prepare(at(3, 7, 1));
    await fs.mkdir(path.join(mine, "site"));
    await fs.mkdir(path.join(dir, "elsewhere"));
    await fs.symlink(path.join(dir, "elsewhere"), path.join(mine, "linked"));
    assert.deepEqual(await store.existingFolder(at(3, 7, 1), "/files/mine/site/"), { real: await fs.realpath(path.join(mine, "site")), virtualPath: "/files/mine/site" });
    assert.deepEqual(await store.existingFolder(at(3, 7, 1), "/files/mine"), { real: await fs.realpath(mine), virtualPath: "/files/mine" });
    await assert.rejects(store.existingFolder(at(3, 7, 1), "/files/mine/linked"), /isn't there/);
    await assert.rejects(store.existingFolder(at(3, 7, 1), "/files/mine/missing"), /isn't there/);
    for (const outside of ["/files/mine/../../../..", "/files", "/etc", "/files/mine/../2"]) {
      await assert.rejects(store.existingFolder(at(3, 7, 1), outside), /not one of the bot's files/, outside);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a person's files with a bot are theirs alone; shared files reach the whole home only", async () => {
  const { dir, store } = await tempStore();
  try {
    const { mine } = await store.prepare(at(3, 7, 1));
    await fs.writeFile(path.join(mine, "sales.xlsx"), "x");
    // Someone else in the home, with the same bot, doesn't see it.
    assert.deepEqual((await store.list(at(3, 7, 2))).mine, []);
    await assert.rejects(store.existingFile(at(3, 7, 2), "/files/mine/sales.xlsx"), /isn't there/);
    assert.deepEqual((await store.list(at(3, 8, 2))).shared, []);
    await store.move(at(3, 7, 1), "/files/mine/sales.xlsx", "/files/shared/sales.xlsx");
    // Shared: every person and bot in the home, and nobody in another home.
    assert.deepEqual((await store.list(at(3, 8, 2))).shared.map((file) => file.path), ["/files/shared/sales.xlsx"]);
    assert.deepEqual((await store.list(at(3, 7, 1))).mine, []);
    assert.deepEqual((await store.list(at(4, 9, 1))).shared, []);
    await assert.rejects(store.move(at(3, 8, 1), "/files/mine/nothing.xlsx", "/files/shared/n.xlsx"), /isn't there/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("three folders: the person's, the bot's for everyone using it, and the home's", async () => {
  const { dir, store } = await tempStore();
  try {
    const { mine, bot } = await store.prepare(at(3, 7, 1));
    await fs.writeFile(path.join(mine, "notes.txt"), "mine");
    await store.move(at(3, 7, 1), "/files/mine/notes.txt", "/files/bot/notes.txt");
    // Everyone using the bot sees its folder; a conversation everyone shares has no private one,
    // and its old /files/mine paths lead to the bot's folder.
    assert.deepEqual((await store.list(at(3, 7, 2))).bot.map((file) => file.path), ["/files/bot/notes.txt"]);
    const everyone = { homeId: 3, botId: 7, everyone: true };
    const listed = await store.list(everyone);
    assert.equal(listed.mine, undefined);
    assert.deepEqual(listed.bot.map((file) => file.path), ["/files/bot/notes.txt"]);
    assert.equal((await store.existingFile(everyone, "/files/mine/notes.txt")).real, await fs.realpath(path.join(bot, "notes.txt")));
    // Another bot's folder is out of reach; the home's own place sees only the shared folder.
    assert.deepEqual((await store.list(at(3, 8, 1))).bot, []);
    const homePlace = store.homePlace(3);
    assert.equal(await store.resolve(homePlace, "/files/bot/notes.txt"), null);
    await store.move(at(3, 7, 2), "/files/bot/notes.txt", "/files/shared/Team/notes.txt");
    assert.deepEqual((await store.list(homePlace)).shared.map((file) => file.path), ["/files/shared/Team/notes.txt"]);
    assert.deepEqual((await store.listFolder(homePlace, "/files/shared")).entries.map((entry) => [entry.path, Boolean(entry.folder)]), [["/files/shared/Team", true]]);
    assert.deepEqual((await store.listFolder(homePlace, "/files/shared/Team")).entries.map((entry) => [entry.path, Boolean(entry.folder)]), [["/files/shared/Team/notes.txt", false]]);
    // Folders: made, renamed (not into themselves), deleted only when empty; roots stay.
    await store.makeFolder(homePlace, "/files/shared/Archive");
    await assert.rejects(store.move(homePlace, "/files/shared/Team", "/files/shared/Team/Inner"), /inside itself/);
    await assert.rejects(store.remove(homePlace, "/files/shared/Team"), /isn't empty/);
    await store.move(homePlace, "/files/shared/Team/notes.txt", "/files/shared/Archive/notes.txt");
    await store.remove(homePlace, "/files/shared/Team");
    await store.move(homePlace, "/files/shared/Archive", "/files/shared/Old");
    assert.deepEqual((await store.list(homePlace)).shared.map((file) => file.path), ["/files/shared/Old/notes.txt"]);
    await assert.rejects(store.remove(homePlace, "/files/shared"), /not one of the bot's files/);
    await store.remove(homePlace, "/files/shared/Old/notes.txt");
    await assert.rejects(store.existingFile(homePlace, "/files/shared/Old/notes.txt"), /isn't there/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the file browser reads one folder at a time, so a folder's old files show however many newer ones the rest has", async () => {
  const { dir, store } = await tempStore();
  try {
    const place = at(3, 7, 1);
    const { bot, shared } = await store.prepare(place);
    const stamp = async (file, minutesAgo) => {
      await fs.writeFile(file, "x");
      const time = new Date(Date.UTC(2026, 0, 1) - minutesAgo * 60000);
      await fs.utimes(file, time, time);
    };
    // 310 new files at the top of the home's folder; an older folder of three files, with one more folder inside.
    for (let index = 0; index < 310; index += 1) await stamp(path.join(shared, `new-${String(index).padStart(3, "0")}.txt`), index);
    await fs.mkdir(path.join(shared, "Old", "Deeper"), { recursive: true });
    for (const [name, minutesAgo] of [["a.txt", 10001], ["b.txt", 10002], ["c.txt", 10003]]) await stamp(path.join(shared, "Old", name), minutesAgo);
    await stamp(path.join(shared, "Old", "Deeper", "d.txt"), 20000);
    // The whole folder's newest 300, which the browser used to cut every folder view from, leave Old out.
    assert.ok(!(await store.list(place)).shared.some((file) => file.path.startsWith("/files/shared/Old/")));

    const top = await store.listFolder(place, "/files/shared");
    assert.equal(top.path, "/files/shared");
    assert.deepEqual(top.entries[0], { path: "/files/shared/Old", folder: true }, "folders first, however old");
    assert.equal(top.entries.length, 301);
    assert.equal(top.entries[1].path, "/files/shared/new-000.txt");
    assert.equal(top.entries.at(-1).path, "/files/shared/new-299.txt");
    assert.deepEqual([top.left, top.partial], [10, false]);
    const old = await store.listFolder(place, "/files/shared/Old/");
    assert.equal(old.path, "/files/shared/Old");
    assert.deepEqual(old.entries.map((entry) => entry.path), ["/files/shared/Old/Deeper", "/files/shared/Old/a.txt", "/files/shared/Old/b.txt", "/files/shared/Old/c.txt"]);
    assert.deepEqual(old.entries.slice(1).map((entry) => entry.size), [1, 1, 1]);
    assert.deepEqual((await store.listFolder(place, "/files/shared/Old/Deeper")).entries.map((entry) => entry.path), ["/files/shared/Old/Deeper/d.txt"]);

    // A folder that has gone is empty; a file, a link and anything outside the place's folders are not listed.
    assert.deepEqual((await store.listFolder(place, "/files/shared/Gone")).entries, []);
    await assert.rejects(store.listFolder(place, "/files/shared/new-000.txt"), /not a folder/);
    await assert.rejects(store.listFolder(place, "/files/shared/../../4/shared"), /not one of the bot's files/);
    await assert.rejects(store.listFolder(store.homePlace(3), "/files/bot"), /not one of the bot's files/);
    await fs.symlink(dir, path.join(shared, "Elsewhere"));
    assert.deepEqual((await store.listFolder(place, "/files/shared/Elsewhere")).entries, []);
    assert.ok(!(await store.listFolder(place, "/files/shared")).entries.some((entry) => entry.path === "/files/shared/Elsewhere"));

    // Every folder, for Move to…: the person's own only when the place is theirs.
    await fs.mkdir(path.join(bot, "Invoices"));
    assert.deepEqual(await store.folderTree(place), { mine: [], bot: ["/files/bot/Invoices"], shared: ["/files/shared/Old", "/files/shared/Old/Deeper"] });
    assert.deepEqual(await store.folderTree({ homeId: 3, botId: 7, everyone: true }), { bot: ["/files/bot/Invoices"], shared: ["/files/shared/Old", "/files/shared/Old/Deeper"] });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a folder with more than 300 files lists its newest 300 and says how many are left out", async () => {
  const { dir, store } = await tempStore();
  try {
    const { shared } = await store.prepare(at(3, 7, 1));
    // file-320 is the newest and file-001 the oldest. A folder is read in no particular order, so
    // only sorting before cutting keeps the newest 300.
    for (let index = 1; index <= 320; index += 1) {
      const file = path.join(shared, `file-${String(321 - index).padStart(3, "0")}.txt`);
      await fs.writeFile(file, "x");
      const time = new Date(Date.UTC(2026, 0, 1) - index * 60000);
      await fs.utimes(file, time, time);
    }
    const listed = await store.list(at(3, 7, 1));
    assert.equal(listed.shared.length, 300);
    assert.equal(listed.shared[0].path, "/files/shared/file-320.txt");
    assert.equal(listed.shared.at(-1).path, "/files/shared/file-021.txt");
    assert.deepEqual(listed.left, { shared: 20 });
    assert.deepEqual(listed.partial, []);
    assert.deepEqual((await store.list(at(4, 7, 1))).left, {}, "folders within the limit are whole");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a listing stops walking a folder at 5,000 entries and names it as partial", async () => {
  const { dir, store } = await tempStore();
  try {
    const { shared } = await store.prepare(at(3, 7, 1));
    const deep = path.join(shared, "unpacked");
    await fs.mkdir(deep);
    for (let index = 0; index < 5100; index += 1) await fs.writeFile(path.join(deep, `f${index}.txt`), "");
    const listed = await store.list(at(3, 7, 1));
    assert.equal(listed.shared.length, 300);
    assert.deepEqual(listed.left, { shared: 4700 }, "the walk read 5,000 entries and no more");
    assert.deepEqual(listed.partial, ["shared"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a listing looks at a folder's files several at a time, never more than 32 at once per folder", async (context) => {
  const { dir, store } = await tempStore();
  try {
    const place = at(3, 7, 1);
    const { bot, shared } = await store.prepare(place);
    await fs.mkdir(path.join(shared, "Team"));
    for (let index = 0; index < 80; index += 1) await fs.writeFile(path.join(shared, "Team", `f${index}.txt`), "x");
    await fs.writeFile(path.join(bot, "notes.txt"), "x");
    // Each look at a file takes a moment, as on the shared volume; count how many are under way at once.
    const stat = fs.stat;
    let open = 0;
    let most = 0;
    context.mock.method(fs, "stat", async (...args) => {
      open += 1;
      most = Math.max(most, open);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await stat(...args);
      } finally {
        open -= 1;
      }
    });
    const listed = await store.list(place);
    assert.deepEqual([listed.shared.length, listed.bot.length], [80, 1]);
    assert.ok(most > 1, "one file after another");
    assert.ok(most <= 32 * 3, `${most} at once`);
    most = 0;
    assert.equal((await store.listFolder(place, "/files/shared/Team")).entries.length, 80);
    assert.ok(most > 1 && most <= 32, `${most} at once in one folder`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a configured folder without its marker is unavailable, so nothing lands on the local disk", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-files-test-"));
  try {
    const store = createFileStore({ root: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
    assert.equal(await store.available(), false);
    await assert.rejects(store.prepare(at(3, 7, 1)), /aren't available/);
    await fs.writeFile(path.join(dir, ".mercbot-files"), "");
    assert.equal(await store.available(), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Needs the apps and gVisor with its toolbox (scripts/install-tools.sh); skipped where they aren't
// installed. Everything here runs in gVisor (D-49).
test("the office apps, in gVisor, save only into the bot's folders", async (t) => {
  const { dir, store } = await tempStore();
  const apps = createOfficeApps({ store, env: process.env });
  if (!await apps.available()) {
    t.skip("office apps or gVisor not installed");
    return;
  }
  const session = apps.session(at(3, 7, 1));
  try {
    await session.call("word", "new_document", {});
    await session.call("word", "type_text", { text: "Hello" });
    assert.equal((await session.call("word", "save_document", { path: "/files/mine/hello.docx" })).ok, true);
    assert.equal((await session.call("word", "save_document", { path: "/etc/hello.docx" })).ok, false);
    assert.deepEqual((await store.list(at(3, 7, 1))).mine.map((file) => file.path), ["/files/mine/hello.docx"]);
    const preview = await apps.pagesOf(at(3, 7, 1), "/files/mine/hello.docx");
    assert.equal(preview.pages.length, 1);
    assert.equal(preview.pages[0].subarray(1, 4).toString(), "PNG");
    assert.match(await apps.textOf(at(3, 7, 1), "/files/mine/hello.docx"), /Hello/u);
    await apps.chartImage(at(3, 7, 1), { title: "Sales", categories: ["A", "B"], series: [{ name: "Sales", values: [3, 5] }] }, "/files/mine/chart.png");
    assert.equal((await fs.readFile(path.join(dir, "homes/3/bots/7/people/1/chart.png"))).subarray(1, 4).toString(), "PNG");
    if (existsSync(path.join(toolsDir(process.env), "piper", "piper"))) {
      const memo = await apps.voiceMemo(at(3, 7, 1), "Hello from the sandbox.", "/files/mine/Voice/memo.wav");
      assert.ok(memo.seconds > 0.5, JSON.stringify(memo));
    }
  } finally {
    session.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
