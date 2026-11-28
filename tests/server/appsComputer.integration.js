import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { startShell } from "../support/ownedHandles.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";

// Programs on the app's bot's computer (D-146): a button's or job's script runs a program with computer.run in the bots'
// own sandbox (gVisor, the toolbox), with the app's own files read-only beside its own, no internet, its own time limit
// and its computation recorded for the app's bot; never for a public app's visitor, and refused where there's no sandbox.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const SKIP = shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)";

const RUN = `async function main(input) {
  const result = await computer.run(input);
  return { exitCode: result.exitCode, output: result.output, timedOut: result.timedOut, files: result.files, kept: result.kept };
}`;
const TESTS = [{ name: "answers the run", input: { command: "true" }, computer: { run: { exitCode: 0, output: "", timedOut: false, files: {}, kept: {} } }, expect: { exitCode: 0, output: "", timedOut: false, files: {}, kept: {} } }];
const BOTS = [{ id: "41", name: "Main", main: true, archived: false }, { id: "42", name: "Coach", main: false, archived: false }];

/**
 * A home with an app "Runner" whose button script runs what it's given on the computer, its definition's `computer`
 * being `computer`, published; with the real sandbox unless `programs` says otherwise. Answers `{ press, ... }`.
 */
async function runner(context, { computer = undefined, programs = "real", slug = "apps-computer" } = {}) {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug });
  let scripts = null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-computer-"));
  cleanup.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const parts = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    recordFiles: {
      write: store.writeRecordFile,
      remove: store.removeRecordFile,
      real: async (homeId, virtualPath) => (await store.existingFile(store.homePlace(homeId), virtualPath)).real
    }
  });
  const metered = [];
  const meter = {
    startComputation: async (work) => ({ blockSeconds: 600, renew: async () => true, settle: async (seconds) => metered.push({ ...work, seconds }) })
  };
  const { shell } = await startShell(home.knex, cleanup, { store, meter });
  const real = { available: () => shell.available(), run: (request) => shell.runProgram(request) };
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = parts;
  scripts = createScripts({
    roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => BOTS,
    computer: () => (programs === "real" ? real : programs)
  });
  cleanup.after(() => scripts.close());
  const owner = { type: "person", id: String(home.userId), name: "Pat" };
  await apps.createApp(owner, { name: "Runner" }, home.options);
  const saved = await scripts.save(owner, "runner", { key: "run", kind: "action", summary: "Runs a program", code: RUN, tests: TESTS }, home.options);
  assert.deepEqual(saved.errors, []);
  const definition = { home: "main", screens: { main: { content: [{ type: "text", value: "Runner" }] } }, ...(computer ? { computer } : {}) };
  assert.deepEqual((await apps.saveDraft(owner, "runner", definition, "", home.options)).errors ?? [], []);
  await apps.publish(owner, "runner", {}, home.options);
  const app = await apps.find("runner", home.options);
  const press = (input, reach = null) => scripts.runNamed("action", app.id, "run", input, { kind: "button" }, reach, home.options);
  return { home, app, apps, gate, registry, owner, press, metered, store, dir };
}

test("a button's script runs a program on the computer and reads its output, exit code and the files it brings back", { skip: SKIP }, async (context) => {
  const { press, metered, home } = await runner(context);
  const program = "import sys\nprint('hello', 2 * 3)\nopen('out.txt', 'w').write('written by the program')\nsys.exit(3)\n";
  const result = await press({ command: "python3 main.py", files: { "main.py": program }, bring: ["out.txt", "missing.txt"] });
  assert.deepEqual(result, { exitCode: 3, output: "hello 6\n", timedOut: false, files: { "out.txt": "written by the program", "missing.txt": null }, kept: {} });
  // Its computation is the home's main bot's (the app has none of its own), for the person who pressed.
  assert.deepEqual(metered.map(({ workspaceId, botId, userId }) => ({ workspaceId, botId, userId })), [{ workspaceId: home.workspaceId, botId: "41", userId: home.userId }]);
});

test("an app's own files are in its program's folder, read-only, beside the script's", { skip: SKIP }, async (context) => {
  const computer = { files: { "lib/helper.py": "def double(x):\n    return 2 * x\n", "check.js": "console.log('node says', 40 + 2);\n" } };
  const { press } = await runner(context, { computer, slug: "apps-computer-files" });
  const command = "python3 main.py; node check.js; echo changed >> lib/helper.py; rm -f check.js; cat lib/helper.py";
  const result = await press({ command, files: { "main.py": "from lib.helper import double\nprint('double', double(21))\n" } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, [
    "double 42",
    "node says 42",
    "/bin/bash: line 1: lib/helper.py: Read-only file system",
    "rm: cannot remove 'check.js': Device or resource busy",
    "def double(x):",
    "    return 2 * x",
    ""
  ].join("\n"));
  await assert.rejects(press({ command: "true", files: { "check.js": "mine" } }), /check\.js is one of the app's own files, which a run can't replace/u);
});

test("a program has no internet", { skip: SKIP }, async (context) => {
  const { press } = await runner(context, { slug: "apps-computer-offline" });
  const result = await press({ command: "curl -sS -m 5 https://example.com; echo \"curl=$?\"" });
  assert.equal(result.output, "curl: (6) Could not resolve host: example.com\ncurl=6\n");
});

test("a program past its time limit is stopped, and the script is told", { skip: SKIP }, async (context) => {
  const { press } = await runner(context, { slug: "apps-computer-time" });
  const started = Date.now();
  const result = await press({ command: "echo started; sleep 30; echo late", seconds: 2 });
  assert.deepEqual([result.timedOut, result.output], [true, "started\n"]);
  assert.ok(Date.now() - started < 15000, "it ended at its limit, not after the sleep");
  await assert.rejects(press({ command: "true", seconds: 21 }), /seconds is 1 to 20 for a button/u);
});

test("a program reads a record's file and keeps what it writes in a record's file field", { skip: SKIP }, async (context) => {
  const { press, gate, registry, owner, home } = await runner(context, { slug: "apps-computer-records" });
  const ctx = home.ctx(owner);
  await registry.createTable(owner, { key: "books", fields: [{ key: "title", type: "text" }, { key: "file", type: "file" }, { key: "counts", type: "file" }] }, home.options);
  const book = await gate.create(ctx, "books", { title: "Seeds" });
  const source = path.join(os.tmpdir(), `mercbot-computer-book-${Date.now()}.txt`);
  await writeFile(source, "seeds sleep\nrain wakes seeds\n");
  context.after(() => rm(source, { force: true }));
  await gate.attachFile(ctx, "books", book.id, "file", { source, name: "seeds.txt", type: "text/plain" });
  const result = await press({
    command: "wc -w < book.txt > counts.txt; cat counts.txt",
    recordFiles: { "book.txt": { table: "books", id: book.id, field: "file" } },
    keep: { "counts.txt": { table: "books", id: book.id, field: "counts" } }
  });
  assert.deepEqual([result.output, result.kept], ["5\n", { "counts.txt": { name: "counts.txt", size: 2 } }]);
  assert.equal(await readFile((await gate.recordFile(ctx, "books", book.id, "counts")).real, "utf8"), "5\n");
});

test("a public app's visitor never runs a program", { skip: SKIP }, async (context) => {
  const { press } = await runner(context, { slug: "apps-computer-visitor" });
  await assert.rejects(press({ command: "true" }, { visitor: { id: "v1" }, access: {} }), /a public app's visitors can't run them/u);
});

test("where the server has no sandbox, a program is refused in words", async (context) => {
  const { press } = await runner(context, { programs: { available: () => false, run: async () => assert.fail("never runs") }, slug: "apps-computer-none" });
  await assert.rejects(press({ command: "true" }), /Apps can't run programs on this server: it has no computer for them/u);
});
