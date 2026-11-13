import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import knexLib from "knex";
import { loadEnvFile } from "../../server/lib/envFile.js";
import { startPreviewAi, withoutCredentials } from "../../tools/previewAi.mjs";
import { startFakeDrive } from "./fakeDrive.mjs";
import { testPreviewExtensions } from "./testPreviewExtensions.mjs";

// Test Preview (Outputs target `test-app`): the app on the disposable test database, for browser
// suites that write data. It refuses to start unless it is really connected to TEST_DB_NAME (and
// that isn't the development database), turns off every outside effect (Turnstile, sign-in providers; the AI
// and Google Drive are replaced by local stand-ins), keeps files in .data-test, migrates, and makes its fixtures (its
// one person and their home's data) before the app answers. It opens with its key, as a person's own copy does: the
// Preview identity (tools/preview-identity .data-test) and the browser suite take it from its data folder. Usage:
// node tests/support/start-test-app.mjs HOST PORT
// The browser suite's own run (tests/e2e/globalSetup.mjs) starts one per worker: it builds once and
// sets MERCBOT_TEST_APP_BUILT=1, gives each its own TEST_DB_NAME (a copy of the test template it has
// just checked is current, so MERCBOT_TEST_DB_MIGRATED=1, with the fixtures already made, so
// MERCBOT_TEST_FIXTURES_DONE=1) and MERCBOT_TEST_DATA_DIR, and passes PORT 0, a port the system
// picks (below). A copy built on Mercbot adds its own settings and stand-ins in testPreviewExtensions.mjs.
const [host = "127.0.0.1", port = "3001"] = process.argv.slice(2);
const publicUrl = (listenPort) => `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${listenPort}`;
const dataDir = String(process.env.MERCBOT_TEST_DATA_DIR || "").trim() || ".data-test";

loadEnvFile();

const testDatabase = String(process.env.TEST_DB_NAME || "").trim();
const developmentDatabase = String(process.env.DB_NAME || "").trim();
if (!testDatabase || testDatabase === developmentDatabase) {
  console.error("TEST_DB_NAME must name a disposable test database, different from DB_NAME.");
  process.exit(1);
}

// No outside service's credential reaches the Test Preview, whatever its name (tools/previewAi.mjs): only the test
// database's password and the test runs' own secrets stay. .env is already loaded, so this sees every variable it set.
withoutCredentials(process.env);
// Every kind of AI, images too, is Mercbot's stand-in model (tools/previewAi.mjs, D-83): each names its provider, with
// no key, and every request goes to the stand-in, so none reaches a provider.
Object.assign(process.env, (await startPreviewAi()).env);
console.log(`This Test Preview's AI is the stand-in model at ${process.env.MERCBOT_TEST_AI_URL} (tools/standInModel.mjs), never a provider.`);

// Set before the server loads: .env never replaces a variable that is already set, even to "".
Object.assign(process.env, {
  DB_NAME: testDatabase,
  // Connections never reach the real hub.
  MERCBOT_HUB_URL: "",
  // Links and providers' return address point at this target; with PORT 0, once its port is known.
  APP_PUBLIC_URL: port === "0" ? "" : publicUrl(port),
  MERCBOT_DATA_DIR: dataDir,
  MERCBOT_FILES_DIR: path.join(dataDir, "files"),
  // Uploads such as avatars (JSKIT storage), apart from the development server's data/storage.
  JSKIT_STORAGE_FS_BASE_PATH: path.join(dataDir, "storage"),
  HOST: host,
  PORT: String(port)
});

// A home's files kept in Google Drive (D-80), and signing in to a Google Drive account in Connect apps, go to a local
// stand-in (fakeDrive.mjs): Mercbot calls it directly, rclone through its proxy, trusting its test authority.
const fakeDrive = await startFakeDrive();
Object.assign(process.env, {
  MERCBOT_TEST_GOOGLE_DRIVE_URL: fakeDrive.url,
  MERCBOT_TEST_GOOGLE_DRIVE_PROXY: fakeDrive.proxy,
  MERCBOT_TEST_GOOGLE_DRIVE_CA: fakeDrive.caFile
});
process.once("exit", () => rmSync(path.dirname(fakeDrive.caFile), { recursive: true, force: true }));

// What a copy built on Mercbot adds to its Test Preview: its own settings, and stand-ins for the services it reaches
// (testPreviewExtensions.mjs). Mercbot adds nothing.
Object.assign(process.env, await testPreviewExtensions());

const knex = knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabase }
});
const { name } = (await knex.raw("select current_database() as name")).rows[0];
await knex.destroy();
if (name !== testDatabase || name === developmentDatabase) {
  console.error(`Connected to "${name}", not the test database. Stopping.`);
  process.exit(1);
}

const run = (command, args) => new Promise((resolve, reject) => {
  spawn(command, args, { stdio: "inherit", env: process.env }).once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
});
// A copy of the current template has every migration already; migrating it again would only start
// npm and Knex's command line and find nothing to do (about 2 s a Test Preview).
if (process.env.MERCBOT_TEST_DB_MIGRATED !== "1") await run("npm", ["run", "db:migrate"]);

// Bots' files live in a plain folder here; its marker says it's ready, as a mounted volume's does.
await mkdir(process.env.MERCBOT_FILES_DIR, { recursive: true });
await writeFile(path.join(process.env.MERCBOT_FILES_DIR, ".mercbot-files"), "");

// The template gallery's badges (D-79) read this copy's own results: Pantry passing its end-to-end check today and
// Fernhill failing it, both as they are now and for how bots behave now, so the browser suite sees "Tested <date>",
// "Not tested yet", and, where a copy shows them, a failed check's reasons. They say nothing about the real checks
// (bot-templates/checks/results.json).
if (!process.env.MERCBOT_TEST_TEMPLATE_RESULTS) {
  const { behaviourFingerprint } = await import("../../packages/bots/src/server/templateResults.js");
  const { GALLERY } = await import("../../packages/bots/src/server/templates.js");
  const fingerprintOf = (slug) => GALLERY.find((template) => template.slug === slug).fingerprint;
  const run = { date: new Date().toISOString().slice(0, 10), commit: "test-copy", behaviour: behaviourFingerprint(), models: { premium: "stand-in", economy: "stand-in" } };
  const reasons = [
    "It didn't ask: Ask with a question card whether the plants are indoors, outdoors, or both. The judge: The bot never asked it and went on to its next question.",
    "Its routine \"Weekly plant care\" is running, but the person never said to start it."
  ];
  const results = path.resolve(dataDir, "template-results.json");
  await writeFile(results, `${JSON.stringify({
    results: {
      "weekly-meal-planner": { ...run, template: fingerprintOf("weekly-meal-planner"), passed: true, reasons: [] },
      "plant-care": { ...run, template: fingerprintOf("plant-care"), passed: false, reasons }
    }
  }, null, 2)}\n`);
  process.env.MERCBOT_TEST_TEMPLATE_RESULTS = results;
}

// Fixtures (the one person and their home's data, which the browser suites start from) are ready
// before the app answers. They run in their own process, so the app server below starts fresh.
// The browser suite's own run makes them once (MERCBOT_TEST_FIXTURES_ONLY=1 stops here, after
// them) and starts each Test Preview on a copy of that database (MERCBOT_TEST_FIXTURES_DONE=1).
if (process.env.MERCBOT_TEST_FIXTURES_DONE !== "1") await run(process.execPath, ["tests/support/fixtures.mjs"]);
if (process.env.MERCBOT_TEST_FIXTURES_ONLY === "1") process.exit(0);

// A production build, as deployed: Vite's development server rebuilds on demand, and a page that
// opened mid-rebuild failed ("The application could not open"), most often in tests that open
// several pages at once.
if (process.env.MERCBOT_TEST_APP_BUILT !== "1") await run("npm", ["run", "build"]);

// PORT 0: the system picks a free port just before the app starts, so runs side by side never
// share one, and links and the public address follow it.
if (port === "0") {
  const free = await new Promise((resolve, reject) => {
    const probe = createNetServer().once("error", reject);
    probe.listen(0, host, () => {
      const { port: picked } = probe.address();
      probe.close(() => resolve(picked));
    });
  });
  Object.assign(process.env, { PORT: String(free), APP_PUBLIC_URL: publicUrl(free) });
}
await import("../../bin/server.js");
// bin/server.js has said why the app didn't start; the local stand-ins would keep this alive.
if (process.exitCode) process.exit();
// Started over IPC (globalSetup.mjs): the parent learns where the app answers, and the app drains
// and stops when the parent goes away, so a Test Preview never outlives its run.
if (process.send) {
  process.send({ origin: process.env.APP_PUBLIC_URL });
  process.once("disconnect", () => process.kill(process.pid, "SIGTERM"));
}
