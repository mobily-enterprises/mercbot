import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import test from "node:test";
import { testRun } from "../support/testRun.mjs";

// A node suite's bound (tests/support/testRun.mjs) is on the work its files did, their times summed, which doesn't
// depend on how many files the machine's test budget runs at once, as the suite's wall time does (the database suite:
// 104-124 s at six at a time, 475-709 s at two, for much the same work). A run's teardown, given its files' times, fails
// the suite past the bound, however quickly the run itself ended, and passes it within the bound.

const RUN_ENV = ["MERCBOT_TEST_TIMES_FILE", "MERCBOT_TEST_FILE_BOUND_MS", "MERCBOT_TEST_LINGER_BOUND_MS"];

/**
 * A run's teardown, its files having taken `seconds` each: whether it failed the suite, and what it said. This file's
 * own run (its environment and exit code) is left as it was.
 * @param {import("node:test").TestContext} context
 * @param {number[]} seconds
 * @param {number} summedBoundSeconds
 */
async function teardownOf(context, seconds, summedBoundSeconds) {
  const env = Object.fromEntries(RUN_ENV.map((name) => [name, process.env[name]]));
  const exitCode = process.exitCode;
  const said = [];
  context.mock.method(console, "log", (line) => said.push(line));
  context.mock.method(console, "error", (line) => said.push(line));
  const run = testRun({ suite: "stand-in", fileBoundSeconds: 120, summedBoundSeconds });
  try {
    await run.globalSetup();
    for (const [index, each] of seconds.entries()) {
      const file = `tests/server/standIn${index}.integration.js`;
      appendFileSync(process.env.MERCBOT_TEST_TIMES_FILE, `${JSON.stringify({ file, seconds: each, lingered: 0.1, copyMs: null })}\n`);
    }
    process.exitCode = 0;
    await run.globalTeardown();
    return { failed: process.exitCode === 1, said: said.join("\n") };
  } finally {
    process.exitCode = exitCode;
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    context.mock.restoreAll();
  }
}

test("a suite whose files took more than its bound, summed, fails, however quickly the run ended", async (context) => {
  const { failed, said } = await teardownOf(context, [1000, 1000, 800], 2750);
  assert.equal(failed, true, said);
  assert.match(said, /The stand-in tests' files took 2800\.0 s summed, far past their usual time/u);
});

test("a suite whose files took less than its bound, summed, passes, and the run says both times", async (context) => {
  const { failed, said } = await teardownOf(context, [900, 900, 900], 2750);
  assert.equal(failed, false, said);
  assert.match(said, /stand-in tests took \d+\.\d s, their files 2700\.0 s summed \(bound 2750 s summed\)/u);
});
