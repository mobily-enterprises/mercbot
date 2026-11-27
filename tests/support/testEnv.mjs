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

/**
 * This process's database connection and machine basics, with `settings` on top.
 * @param {Record<string, string | undefined>} [settings]
 * @returns {Record<string, string>}
 */
export function testServerEnv(settings = {}) {
  const kept = Object.entries(process.env).filter(([name, value]) => value !== undefined && (name.startsWith("DB_") || KEPT.has(name)));
  return { ...Object.fromEntries(kept), ...settings };
}
