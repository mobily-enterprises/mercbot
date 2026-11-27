import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { testServerEnv, withoutOutsideSettings } from "../support/testEnv.mjs";

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

// A node suite's test processes (testRun.mjs's global setup) take from .env only the test database's connection, where
// the copy runs and its session secret; every other setting .env names is empty, so a later load of .env fills none,
// and so is every credential the shell gives, a payment provider's test-mode key included.
test("a test process takes no outside service's setting from .env or the shell", async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-test-env-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  await writeFile(file, [
    "DB_HOST=db.from-file", "DB_NAME=from_file", "TEST_DB_NAME=from_file", "APP_ENV=development",
    "AUTH_LOCAL_SESSION_SECRET=file-secret", "AI_PREMIUM_PROVIDER=deepinfra", "AI_PREMIUM_API_KEY=file-key",
    "MAIL_URL=smtps://user:pass@mail.example.test:465", "MERCBOT_HUB_URL=https://hub.example.test", ""
  ].join("\n"));
  const env = { PATH: "/bin", DB_HOST: "db.shell", STRIPE_SECRET_KEY: "sk_test_shell", MERCBOT_PAY_KEY: "rk_test_shell", GOOGLE_CLIENT_SECRET: "shell-google" };
  withoutOutsideSettings(env, file);
  assert.deepEqual(env, {
    PATH: "/bin",
    DB_HOST: "db.shell",
    DB_NAME: "from_file",
    TEST_DB_NAME: "from_file",
    APP_ENV: "development",
    AUTH_LOCAL_SESSION_SECRET: "file-secret",
    AI_PREMIUM_PROVIDER: "",
    AI_PREMIUM_API_KEY: "",
    MAIL_URL: "",
    MERCBOT_HUB_URL: "",
    STRIPE_SECRET_KEY: "",
    MERCBOT_PAY_KEY: "",
    GOOGLE_CLIENT_SECRET: ""
  });
  // A missing .env is no setting at all.
  const bare = { PATH: "/bin", AI_IMAGES_API_KEY: "shell-key" };
  withoutOutsideSettings(bare, path.join(dir, "missing.env"));
  assert.deepEqual(bare, { PATH: "/bin", AI_IMAGES_API_KEY: "" });
});

// And so this process holds none, whatever the shell that started the run gave it.
test("this test process holds no credential", () => {
  const credential = /(^|_)(API_KEY|CLIENT_ID|CLIENT_SECRET|SECRET_KEY|SITE_KEY|ACCESS_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|TOKEN|PRIVATE_KEY)$/u;
  const held = Object.keys(process.env).filter((name) => {
    const value = String(process.env[name] ?? "").trim();
    return value && (credential.test(name) || /^(sk|rk)_(test|live)_/u.test(value));
  });
  assert.deepEqual(held, []);
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

// testEnv.mjs reads this process's environment to keep what it may; publicUrl.test.js tests resolveRuntimeEnv itself.
const READS_THE_WHOLE = new Set(["tests/support/testEnv.mjs", "tests/server/publicUrl.test.js"]);

test("no test starts a server or feature on the test process's whole environment", () => {
  const whole = [["...", "process.env"], ["Object.entries(", "process.env)"], ["resolveRuntimeEnv", "()"]].map((parts) => parts.join(""));
  const copying = testFiles("tests").filter((file) => {
    if (SCRIPT_RUNS.has(file) || READS_THE_WHOLE.has(file)) return false;
    const text = readFileSync(path.join(ROOT, file), "utf8");
    return whole.some((pattern) => text.includes(pattern));
  });
  assert.deepEqual(copying, [], "start from testServerEnv() (tests/support/testEnv.mjs)");
});
