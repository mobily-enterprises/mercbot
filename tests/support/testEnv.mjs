import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { withoutCredentials } from "../../tools/previewAi.mjs";

// The environment a test gives a server or feature it starts itself: the test database's connection (DB_*,
// TEST_DB_NAME), where this machine's toolbox is, and the process basics, from this process, and nothing else of it,
// whatever .env or a session's Development Env holds (AI keys, Stripe's, mail, sign-in apps', a bucket's, Turnstile's):
// the test sets every other setting itself, so a test's server reaches no outside service with a real credential.
// A test never spreads `process.env` into a server's env; it starts from testServerEnv().
const KEPT = new Set([
  "TEST_DB_NAME",
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "MERCBOT_TOOLS_DIR",
  "MERCBOT_TOOLBOX_DIR",
  "MERCBOT_TOOLBOX_STORE",
  "MERCBOT_TOOLBOX_MESA",
  "MERCBOT_TOOLBOX_LIBRARIES",
  "MERCBOT_TOOLBOX_CERTIFICATES"
]);

// What the node suites take from .env: the test database's connection, where the copy runs and its own session secret.
const FROM_ENV_FILE = new Set(["TEST_DB_NAME", "APP_ENV", "NODE_ENV", "AUTH_LOCAL_SESSION_SECRET"]);
// A payment provider's test-mode key, which a Test Preview keeps (D-116) and a node test never needs.
const TEST_MODE_PAYMENT_KEY = /^(sk|rk)_test_/u;

/**
 * This process's database connection and machine basics, with `settings` on top.
 * @param {Record<string, string | undefined>} [settings]
 * @returns {Record<string, string>}
 */
export function testServerEnv(settings = {}) {
  const kept = Object.entries(process.env).filter(([name, value]) => value !== undefined && (name.startsWith("DB_") || KEPT.has(name)));
  return { ...Object.fromEntries(kept), ...settings };
}

/**
 * Keeps every outside service's settings out of a node suite's test processes (testRun.mjs's global setup, whose
 * environment each file's process inherits), whatever `file` (.env, in a session the Development Env) or the shell
 * holds, so a feature a test makes with this process's environment, or a module reading it, reaches no outside service
 * with a real credential. From `file` only the test database's connection, APP_ENV, NODE_ENV and the session secret
 * load, where `env` lacks them; every other setting it names is set empty, so nothing loading .env later fills it (.env
 * never replaces a variable that is set, even to ""). Every setting shaped like a credential is emptied too
 * (withoutCredentials), a payment provider's test-mode key included. A test that needs one sets its own stand-in.
 * @param {Record<string, string | undefined>} env
 * @param {string} file
 */
export function withoutOutsideSettings(env, file) {
  let named = {};
  try {
    named = parseEnv(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const [name, value] of Object.entries(named)) {
    if (!name.startsWith("DB_") && !FROM_ENV_FILE.has(name)) env[name] = "";
    else if (env[name] === undefined) env[name] = value;
  }
  withoutCredentials(env);
  for (const name of Object.keys(env)) if (TEST_MODE_PAYMENT_KEY.test(String(env[name] ?? "").trim())) env[name] = "";
}
