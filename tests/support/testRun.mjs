// A node --test run's setup and teardown (--test-global-setup), shared by the suites in
// unitRun.mjs and databaseRun.mjs. Its bounds are coarse, about five times the measured times on a
// busy test machine, so they catch a file or a suite that is clearly broken (a hang, minutes where
// seconds are normal) and never a loaded host: testFile.mjs stops a file still running at its
// bound, and the teardown fails the suite past its own. A file's process also ends by itself
// within moments of its last test, whatever the load, so testFile.mjs stops one still alive
// LINGER_BOUND_SECONDS after it: a timer, pool or server was left running. Every run prints its ten
// slowest files against the file bound, and the longest any process lived on after its tests. A
// database suite also prepares the test template once, and drops the copies its files made. The
// runs never pass --test-force-exit: it ends the run before this teardown, and hides a file that
// keeps its process alive.
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "../../server/lib/envFile.js";
import { dropTestCopies, prepareTestTemplate } from "./testDatabase.mjs";

// Measured: a file's process ends 0.0–0.5 s after its last test on a busy machine.
const LINGER_BOUND_SECONDS = 10;

/** The run's files, slowest first, as testFile.mjs recorded them. */
function recordedFiles(timesFile) {
  let text = "";
  try {
    text = readFileSync(timesFile, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line)).sort((left, right) => right.seconds - left.seconds);
}

/** Prints the ten slowest files and the files' summed time. */
function reportFiles(suite, files, fileBoundSeconds) {
  if (!files.length) return;
  const summed = files.reduce((total, entry) => total + entry.seconds, 0);
  const copies = files.map((entry) => entry.copyMs).filter((ms) => ms !== null).sort((left, right) => left - right);
  console.log(`${suite} tests: ${files.length} files, ${summed.toFixed(1)} s summed; slowest, against the ${fileBoundSeconds} s file bound:`);
  for (const entry of files.slice(0, 10)) {
    console.log(`  ${entry.seconds.toFixed(1).padStart(6)} s / ${fileBoundSeconds} s  ${entry.file}${entry.copyMs === null ? "" : ` (database copy ${entry.copyMs} ms)`}`);
  }
  if (copies.length) {
    console.log(`  database copies: median ${copies[Math.floor((copies.length - 1) / 2)]} ms, slowest ${copies.at(-1)} ms`);
  }
  const lingered = files.filter((entry) => typeof entry.lingered === "number").sort((left, right) => right.lingered - left.lingered)[0];
  if (lingered) {
    console.log(`  longest a process lived on after its tests: ${lingered.lingered.toFixed(1)} s / ${LINGER_BOUND_SECONDS} s (${lingered.file})`);
  }
}

/**
 * @param {{ suite: string, fileBoundSeconds: number, suiteBoundSeconds: number, databases?: boolean }} options
 */
export function testRun({ suite, fileBoundSeconds, suiteBoundSeconds, databases = false }) {
  let started = 0;
  const timesFile = path.join(os.tmpdir(), `mercbot-test-times-${process.pid}.jsonl`);
  return {
    async globalSetup() {
      started = performance.now();
      // Read by testFile.mjs in each file's process, which inherits this environment.
      process.env.MERCBOT_TEST_TIMES_FILE = timesFile;
      process.env.MERCBOT_TEST_FILE_BOUND_MS = String(fileBoundSeconds * 1000);
      process.env.MERCBOT_TEST_LINGER_BOUND_MS = String(LINGER_BOUND_SECONDS * 1000);
      if (!databases) return;
      loadEnvFile();
      const { template, packageMigrations, phases } = await prepareTestTemplate();
      process.env.MERCBOT_TEST_TEMPLATE = template;
      process.env.MERCBOT_TEST_PACKAGE_MIGRATIONS = JSON.stringify(packageMigrations);
      process.env.MERCBOT_TEST_RUN = String(process.pid);
      console.log(`${suite} tests: template ${template} (${phases.join(", ")}); each file gets its own copy.`);
    },
    async globalTeardown() {
      if (databases) await dropTestCopies(process.pid);
      reportFiles(suite, recordedFiles(timesFile), fileBoundSeconds);
      rmSync(timesFile, { force: true });
      const seconds = (performance.now() - started) / 1000;
      console.log(`${suite} tests took ${seconds.toFixed(1)} s (bound ${suiteBoundSeconds} s).`);
      if (seconds > suiteBoundSeconds) {
        // Not thrown: Node's test runner runs a global teardown that throws after its database work again and again,
        // and SIGTERM doesn't stop it, so the run would never end. The exit code fails it instead.
        console.error(`The ${suite} tests took ${seconds.toFixed(1)} s, far past their usual time: find what got slow.`);
        process.exitCode = 1;
      }
    }
  };
}
