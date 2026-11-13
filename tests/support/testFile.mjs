// Preloaded into each test file's process by the npm test scripts (node --import). When its run
// prepared a test template (testRun.mjs), the file gets its own copy of it, as DB_NAME and
// TEST_DB_NAME. It records how long the file's process lived, how long it lived on after its last
// test, and how long its copy took, for the run's report. It stops a file still running at its
// run's coarse bound (a hang), or still alive at the linger bound after its last test (a timer,
// pool or server left running). The runner's own process loads this too, before the run's setup,
// and so does every worker thread a test starts (the apps' script pool), since workers inherit
// node's --import: in both it does nothing.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { isMainThread } from "node:worker_threads";

const timesFile = process.env.MERCBOT_TEST_TIMES_FILE;
const boundMs = Number(process.env.MERCBOT_TEST_FILE_BOUND_MS) || 0;
const lingerBoundMs = Number(process.env.MERCBOT_TEST_LINGER_BOUND_MS) || 0;
const file = path.relative(process.cwd(), process.argv[1] || "");

if (timesFile && process.env.NODE_TEST_CONTEXT && isMainThread) {
  let copyMs = null;
  let testsEndedMs = null;
  // Runs once the file's tests have all finished, their own after hooks included.
  const { after } = await import("node:test");
  after(() => {
    testsEndedMs = performance.now();
    if (!lingerBoundMs) return;
    setTimeout(() => {
      console.error(`${file} is still alive ${lingerBoundMs / 1000} s after its last test: a timer, pool or server keeps it running.`);
      process.exit(1);
    }, lingerBoundMs).unref();
  });
  process.once("exit", () => {
    const endedMs = performance.now();
    const lingered = testsEndedMs === null ? null : (endedMs - testsEndedMs) / 1000;
    appendFileSync(timesFile, `${JSON.stringify({ file, seconds: endedMs / 1000, lingered, copyMs })}\n`);
  });
  if (boundMs) {
    setTimeout(() => {
      console.error(`${file} is still running after ${boundMs / 1000} s, far past its usual time: find what hangs or keeps it alive.`);
      process.exit(1);
    }, boundMs).unref();
  }
  if (process.env.MERCBOT_TEST_TEMPLATE) {
    const { copyTestTemplate, testCopyName } = await import("./testDatabase.mjs");
    const started = performance.now();
    const name = await copyTestTemplate(testCopyName(process.env.MERCBOT_TEST_RUN, process.pid));
    // Measured: 0.1–1.9 s on a busy machine, median 0.2–0.8 s; it counts in the file's time.
    copyMs = Math.round(performance.now() - started);
    process.env.DB_NAME = name;
    process.env.TEST_DB_NAME = name;
  }
}
