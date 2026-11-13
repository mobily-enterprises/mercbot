// The browser suite's own Test Previews, when Vibe64 doesn't give it one (playwright.config.mjs):
// one per worker, so the workers run side by side and each spec still has the fixture home to
// itself. It builds the app once and, meanwhile, prepares the test template once
// (tests/support/testDatabase.mjs) and makes the fixtures once on a copy of it. Then it starts each
// Test Preview (tests/support/start-test-app.mjs) on its own copy of that fixtures database,
// a port the system picks (or PLAYWRIGHT_PORT and the next ones, when set) and its own data folder,
// and signs a browser state in there as the first saved Preview identity, opening it with the key in
// its data folder, as a person's own copy opens. Their logs, data and
// signed-in states live in a temporary folder outside the source tree. harness.ts hands each worker
// its own. The returned teardown stops them, drops their databases and removes the folder.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "../../server/lib/envFile.js";
import { copyTestTemplate, dropTestCopies, prepareTestTemplate, testCopyName } from "../support/testDatabase.mjs";
import { signInAsPreviewOwner } from "../support/previewSignIn.mjs";

// Coarse: a Test Preview answers 10–20 s after it starts on a busy machine (migrations, fixtures, boot).
const START_BOUND_MS = 60_000;

function run(command, args) {
  return new Promise((resolve, reject) => {
    spawn(command, args, { stdio: "inherit" }).once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}

async function timed(phases, phase, work) {
  const started = performance.now();
  const result = await work();
  phases.push(`${phase} ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return result;
}

/** The end of a Test Preview's log, for an error that outlives the temporary folder. */
async function logTail(log) {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.trimEnd().split("\n").slice(-15).join("\n");
}

/**
 * Starts a Test Preview on `port` (0: the system picks one) and resolves with its origin once it
 * answers there, as it says over IPC; rejects when it stops first or takes too long. `servers`
 * collects the process, so the teardown stops it whatever happens.
 */
async function startPreview(port, env, log, servers) {
  const output = createWriteStream(log, { flags: "a" });
  await new Promise((resolve) => output.once("open", resolve));
  const server = spawn(process.execPath, ["tests/support/start-test-app.mjs", "127.0.0.1", String(port)], {
    stdio: ["ignore", output, output, "ipc"],
    env
  });
  servers.push(server);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`didn't answer within ${START_BOUND_MS / 1000} s`)), START_BOUND_MS);
      server.once("message", ({ origin }) => {
        clearTimeout(timer);
        resolve(origin);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`stopped (exit ${code})`));
      });
    });
  } catch (error) {
    throw new Error(`A Test Preview ${error.message}. The end of its log:\n${await logTail(log)}`);
  }
}

/**
 * Makes the fixtures on `env`'s TEST_DB_NAME: start-test-app.mjs with MERCBOT_TEST_FIXTURES_ONLY=1,
 * which stops once they are made. Rejects with the end of its log when it fails or takes too long.
 */
async function makeFixtures(env, log, servers) {
  const output = createWriteStream(log, { flags: "a" });
  await new Promise((resolve) => output.once("open", resolve));
  const child = spawn(process.execPath, ["tests/support/start-test-app.mjs", "127.0.0.1", "0"], {
    stdio: ["ignore", output, output],
    env: { ...env, MERCBOT_TEST_FIXTURES_ONLY: "1" }
  });
  servers.push(child);
  const ended = await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), START_BOUND_MS);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? signal);
    });
  });
  if (ended !== 0) throw new Error(`The browser suite's fixtures failed (${ended}). The end of their log:\n${await logTail(log)}`);
}

function stop(server) {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const killer = setTimeout(() => server.kill("SIGKILL"), 10_000);
    server.once("exit", () => {
      clearTimeout(killer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

/**
 * A Test Preview's environment, on its own database and data folder.
 * @param {{ database: string, dataDir: string }} where
 */
const previewEnvironment = ({ database, dataDir }) => ({
  AUTH_LOCAL_SESSION_SECRET: "browser-tests-only-session-secret",
  ...process.env,
  TEST_DB_NAME: database,
  MERCBOT_TEST_DATA_DIR: dataDir,
  MERCBOT_TEST_APP_BUILT: "1",
  // A copy of the template prepareTestTemplate just checked against the migrations.
  MERCBOT_TEST_DB_MIGRATED: "1"
});

/** @param {import("@playwright/test").FullConfig} config */
export default async function globalSetup(config) {
  loadEnvFile();
  const runDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-e2e-"));
  const phases = [];
  const started = performance.now();
  const basePort = Number(process.env.PLAYWRIGHT_PORT) || 0;
  const servers = [];
  const teardown = async () => {
    await Promise.all(servers.map(stop));
    await dropTestCopies(process.pid);
    await rm(runDir, { recursive: true, force: true });
  };
  const previewEnv = (database, data) => previewEnvironment({ database, dataDir: path.join(runDir, data) });
  try {
    // The fixtures are made once, on a copy of the template, while the app builds (they need only its
    // API), instead of once in every Test Preview; each Test Preview starts on a copy of that.
    const [{ phases: templatePhases, fixtures }] = await Promise.all([
      (async () => {
        const template = await timed(phases, "template", () => prepareTestTemplate());
        // The fixtures and the Test Previews connect with it (tests/support/testDatabase.mjs).
        process.env.MERCBOT_TEST_PACKAGE_MIGRATIONS = JSON.stringify(template.packageMigrations);
        const fixtures = await timed(phases, "fixtures", async () => {
          const database = await copyTestTemplate(testCopyName(process.pid, "fx"));
          await makeFixtures(previewEnv(database, "data-fixtures"), path.join(runDir, "fixtures.log"), servers);
          return database;
        });
        return { ...template, fixtures };
      })(),
      timed(phases, "build", () => run("npm", ["run", "build"]))
    ]);
    const targets = await timed(phases, `${config.workers} Test Preview(s)`, () => Promise.all(Array.from({ length: config.workers }, async (_, index) => {
      const database = await copyTestTemplate(testCopyName(process.pid, `e${index}`), process.env, fixtures);
      const env = { ...previewEnv(database, `data-${index}`), MERCBOT_TEST_FIXTURES_DONE: "1" };
      const start = () => startPreview(basePort && basePort + index, env, path.join(runDir, `server-${index}.log`), servers);
      // Another process can take a picked port in the moment before the app listens on it (rare):
      // then it starts once more, on a new one.
      const origin = await start().catch((error) => {
        if (basePort || !/EADDRINUSE/u.test(error.message)) throw error;
        return start();
      });
      const storageState = path.join(runDir, `signed-in-${index}.json`);
      await signInAsPreviewOwner(origin, storageState, { ...process.env, MERCBOT_DATA_DIR: env.MERCBOT_TEST_DATA_DIR });
      return { baseURL: origin, storageState, database };
    })));
    const file = path.join(runDir, "targets.json");
    await writeFile(file, JSON.stringify(targets, null, 2));
    // The workers start after this, with this environment (harness.ts reads it).
    process.env.MERCBOT_E2E_TARGETS = file;
    console.log(`Browser tests: ${phases.join(", ")} (template: ${templatePhases.join(", ")}); ready in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
