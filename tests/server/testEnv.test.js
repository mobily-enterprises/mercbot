import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { testServerEnv } from "../support/testEnv.mjs";

// A test's own server or feature takes only the test database's connection and the machine's basics from the test's
// process (tests/support/testEnv.mjs): .env and a session's Development Env hold real keys, and a server given them
// would reach AI providers, Stripe, mail or a sign-in provider with them.
const ROOT = path.resolve(import.meta.dirname, "../..");
const PARENT = {
  AI_PREMIUM_PROVIDER: "deepinfra",
  AI_PREMIUM_API_KEY: "parent-key",
  STRIPE_SECRET_KEY: "sk_test_parent",
  TURNSTILE_SECRET_KEY: "parent-turnstile",
  GOOGLE_CLIENT_SECRET: "parent-google",
  MAIL_URL: "smtps://user:pass@mail.example.test:465",
  MERCBOT_FILES_S3_SECRET_ACCESS_KEY: "parent-bucket",
  MERCBOT_HUB_URL: "https://hub.example.test"
};

test("a test's server env keeps the database's connection and the toolbox, and none of the test process's keys", (context) => {
  const before = Object.assign({}, process.env);
  context.after(() => {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
  });
  Object.assign(process.env, PARENT, { DB_HOST: "db.test", DB_NAME: "copy_1", TEST_DB_NAME: "copy_1", MERCBOT_TOOLS_DIR: "/opt/tools" });
  const env = testServerEnv({ APP_ENV: "test" });
  assert.deepEqual(Object.keys(PARENT).filter((name) => name in env), [], "no key of the test's process");
  assert.deepEqual(
    [env.DB_HOST, env.DB_NAME, env.TEST_DB_NAME, env.MERCBOT_TOOLS_DIR, env.APP_ENV],
    ["db.test", "copy_1", "copy_1", "/opt/tools", "test"]
  );
});

// Child processes running the project's own scripts and tools get the test process's environment with their own
// settings on top (each blanks what it must), and so do the browser suite's Test Previews, which load .env themselves
// and empty every credential but a payment provider's test-mode key (tests/support/start-test-app.mjs, D-116); a server
// or feature a test starts in its own process never does.
const SCRIPT_RUNS = new Set([
  "tests/agent-evals/hard/notes-api/judge.mjs",
  "tests/e2e/globalSetup.mjs",
  "tests/server/fileMoves.integration.js",
  "tests/server/hostingScript.test.js",
  "tests/server/sessionLog.test.js",
  "tests/server/storeToolbox.test.js",
  "tests/server/templateChecks.test.js",
  "tests/server/toolboxRun.test.js",
  "tests/server/toolsStore.test.js",
  "tests/server/xtermWindow.test.js"
]);

function testFiles(folder) {
  return readdirSync(path.join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFiles(relative);
    return /\.(?:m?js|ts)$/u.test(entry.name) ? [relative] : [];
  });
}

test("no test starts a server or feature on the test process's whole environment", () => {
  const spread = ["...", "process.env"].join("");
  const spreading = testFiles("tests").filter((file) => !SCRIPT_RUNS.has(file) && readFileSync(path.join(ROOT, file), "utf8").includes(spread));
  assert.deepEqual(spreading, [], "start from testServerEnv() (tests/support/testEnv.mjs)");
});
