import assert from "node:assert/strict";
import test from "node:test";
import { runWorkers } from "../support/browserRun.mjs";

// The browser suite's whole-run bound follows the workers the run gets (playwright.config.mjs, tests/support/browserRun.mjs):
// the tests' summed time is the same work however many workers share it, so one worker gets the whole of its bound
// and four a quarter each, after the global setup's. The workers are read as Playwright reads them: the command line's
// --workers in each of its forms, else the config's own (1 on Vibe64's managed target, else the browser workers a test
// host's runner names in PLAYWRIGHT_WORKERS, else the machine's test budget).

const PLAYWRIGHT = ["node", "playwright", "test"];
let loads = 0;

/**
 * playwright.config.mjs as a run with these arguments and this environment reads it.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [env]
 */
async function configOf(args, env = {}) {
  const saved = { argv: process.argv, env: Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]])) };
  process.argv = [...PLAYWRIGHT, ...args];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    loads += 1;
    return await import(`../../playwright.config.mjs?load=${loads}`);
  } finally {
    process.argv = saved.argv;
    for (const [name, value] of Object.entries(saved.env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("the run's workers are the command line's, in each of its forms, else the config's own", () => {
  const workers = (args, options = {}) => runWorkers({ argv: [...PLAYWRIGHT, ...args], env: { V64_TEST_CONCURRENCY: "6" }, ...options });
  assert.equal(workers(["--workers=1"]), 1);
  assert.equal(workers(["--workers", "3"]), 3);
  assert.equal(workers(["-j", "4"]), 4);
  assert.equal(workers(["-j2", "tests/e2e/shell.spec.ts"]), 2);
  assert.ok(workers(["--workers=50%"]) >= 1, "a share of the CPUs, at least one");
  assert.equal(workers([]), 6, "the machine's test budget");
  assert.equal(workers([], { managed: true }), 1, "Vibe64's managed target, one at a time");
  assert.equal(workers(["--workers=3"], { managed: true }), 3, "the command line wins");
  assert.equal(workers(["--workers=4", "--debug"]), 1, "Playwright runs --debug on one worker");
  assert.throws(() => workers(["--workers=none"]), /Give --workers a number of workers or a percentage, not none/u);
});

test("a test host's runner names the browser workers, one per heavy slot it holds, ahead of the CPU budget", () => {
  // 26 Nov: on a host of 8 threads a run holding all 3 of its heavy slots gets the CPU budget of all 8
  // (V64_TEST_CONCURRENCY), the node runners' concurrency; as browser workers, each a browser and a Test Preview,
  // every test took 6 to 7 times its time alone and the run met its bound.
  const host = { V64_TEST_CONCURRENCY: "8", PLAYWRIGHT_WORKERS: "3" };
  const workers = (args, env = host, options = {}) => runWorkers({ argv: [...PLAYWRIGHT, ...args], env, ...options });
  assert.equal(workers([]), 3, "the runner's browser workers, not the CPU budget");
  assert.equal(workers(["--workers=2"]), 2, "the command line wins");
  assert.equal(workers([], host, { managed: true }), 1, "Vibe64's managed target, one at a time");
  assert.equal(workers([], { ...host, PLAYWRIGHT_WORKERS: "config" }), 8, "config leaves them to the config's own");
  assert.equal(workers([], { ...host, PLAYWRIGHT_WORKERS: "" }), 8, "none named, the machine's test budget");
  assert.throws(() => workers([], { ...host, PLAYWRIGHT_WORKERS: "some" }), /Give PLAYWRIGHT_WORKERS a number of workers or a percentage, not some/u);
});

test("the whole run's bound is the setup's, then each worker's share of the tests' summed bound", async () => {
  const bound = ({ SETUP_BOUND_SECONDS, SUMMED_BOUND_SECONDS }, workers) => 1000 * (SETUP_BOUND_SECONDS + Math.ceil(SUMMED_BOUND_SECONDS / workers));
  const one = await configOf(["--workers=1"], { PLAYWRIGHT_BASE_URL: undefined });
  assert.equal(one.default.globalTimeout, bound(one, 1));
  const four = await configOf(["-j", "4"], { PLAYWRIGHT_BASE_URL: undefined });
  assert.equal(four.default.globalTimeout, bound(four, 4));
  assert.ok(four.default.globalTimeout < one.default.globalTimeout, "four workers share the work");
  const budget = await configOf([], { PLAYWRIGHT_BASE_URL: undefined, PLAYWRIGHT_WORKERS: undefined, V64_TEST_CONCURRENCY: "3" });
  assert.deepEqual([budget.default.workers, budget.default.globalTimeout], [3, bound(budget, 3)]);
  const held = await configOf([], { PLAYWRIGHT_BASE_URL: undefined, PLAYWRIGHT_WORKERS: "3", V64_TEST_CONCURRENCY: "8" });
  assert.deepEqual([held.default.workers, held.default.globalTimeout], [3, bound(held, 3)], "the runner's browser workers, and the bound for them");
  const managed = await configOf([], { PLAYWRIGHT_BASE_URL: "http://127.0.0.1:9", PLAYWRIGHT_WORKERS: "3", V64_TEST_CONCURRENCY: "3" });
  assert.deepEqual([managed.default.workers, managed.default.globalTimeout], [1, bound(managed, 1)]);
});
