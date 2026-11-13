import { defineConfig } from "@playwright/test";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

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

export default defineConfig({
  testDir: "./tests/e2e",
  // One worker for the managed target, as JSKIT's browserTestConfig() does; otherwise the machine's test budget.
  ...(managedBaseUrl ? { workers: 1 } : { workers: testConcurrency() }),
  // Coarse bounds, about five times the measured times, for what is clearly broken: the slowest test
  // takes about 14 s on a busy machine and the whole suite about 2 minutes.
  timeout: 60_000,
  globalTimeout: 600_000,
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
