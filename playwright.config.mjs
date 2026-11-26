import { defineConfig } from "@playwright/test";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";
import { runnerWorkers, runWorkers } from "./tests/support/browserRun.mjs";

// Two ways to run the browser suite (tests/e2e), both on the Test Preview target's fixtures:
// - Vibe64's managed run (vibe64-helper playwright --target test-app) gives one running target, its
//   address and a signed-in state. Every spec then uses its one fixture home, and several count or
//   change its records, so the specs run one at a time.
// - Otherwise the run starts its own (tests/e2e/globalSetup.mjs): a Test Preview per worker, each on
//   its own copy of the test database and a port the system picks (or PLAYWRIGHT_PORT and the next
//   ones, when set), with as many workers as the machine's test budget allows.
const managedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "")
  .trim()
  .replace(/\/+$/u, "");
const storageState = String(process.env.PLAYWRIGHT_STORAGE_STATE || "").trim();

// Bounds for what is clearly broken, a hang, not for slowness. A test has 60 s; the slowest takes about 23 s
// (team-add.spec.ts, on the test machine usone, 26 Nov). The whole run's bound follows the workers it
// gets (runWorkers: the command line's --workers, else the config's own below), as the node suites bound their files' summed
// time (tests/support/testRun.mjs): the tests' summed time is the same work however many workers share it, while the
// run's wall time isn't. Summed, they took 666 to 745 s on usone at one worker and at three; each worker gets its share
// of about 1.3 times the most, after the global setup's bound: it builds the app, prepares the template and the fixtures
// and starts the Test Previews, about 10 s, each of its steps bounded at 60 s (globalSetup.mjs). At one worker that is
// about 18 minutes for a run of about 13, at three about 6.5 for about 4.5.
export const SUMMED_BOUND_SECONDS = 1000;
export const SETUP_BOUND_SECONDS = 60;
const workers = runWorkers({ managed: Boolean(managedBaseUrl) });
const named = runnerWorkers();

export default defineConfig({
  testDir: "./tests/e2e",
  // One worker for the managed target, as JSKIT's browserTestConfig() does; otherwise the browser workers a test
  // host's runner names (PLAYWRIGHT_WORKERS, one per heavy slot the run holds), else the machine's test budget.
  ...(managedBaseUrl ? { workers: 1 } : named ? { workers: named } : { workers: testConcurrency() }),
  timeout: 60_000,
  // In milliseconds, a number first, as jskit check reads a bound (test/playwright-global-timeout).
  globalTimeout: 1000 * (SETUP_BOUND_SECONDS + Math.ceil(SUMMED_BOUND_SECONDS / workers)),
  // Every run lists its ten slowest files.
  reportSlowTests: { max: 10, threshold: 0 },
  expect: {
    timeout: 10_000
  },
  use: {
    headless: true,
    ...(managedBaseUrl ? { baseURL: managedBaseUrl } : {}),
    ...(storageState ? { storageState } : {})
  },
  ...(managedBaseUrl ? {} : { globalSetup: "./tests/e2e/globalSetup.mjs" })
});
