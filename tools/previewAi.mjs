import { AI_KINDS } from "@local/account/model";
import { startStandInModel } from "./standInModel.mjs";

// Every outside service's credential, whatever its name: the AI keys (AI_PREMIUM_API_KEY, AI_IMAGES_API_KEY, ...),
// Turnstile's, and every sign-in or connection app's (AUTH_<PROVIDER>_CLIENT_ID, <APP>_CLIENT_SECRET, and the
// <APP>_TEST_CLIENT_ID pair the integrations use on a local address), and the files bucket's keys
// (MERCBOT_FILES_S3_ACCESS_KEY_ID, MERCBOT_FILES_S3_SECRET_ACCESS_KEY), so a Preview's files stay in its own folder,
// and a GitHub App's private key (GITHUB_APP_PRIVATE_KEY, D-128), which makes keys to people's repositories. The database's password and the copy's own secrets (the session secret, the Vault key, the
// files passphrase) don't match.
const CREDENTIAL = /(^|_)(API_KEY|CLIENT_ID|CLIENT_SECRET|SECRET_KEY|SITE_KEY|ACCESS_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|TOKEN|PRIVATE_KEY)$/u;
// A payment provider's test-mode key, which says so in its value and can't move money: Stripe's secret and restricted
// test keys. Its live keys (sk_live_, rk_live_) are emptied like every other credential (D-116).
const TEST_MODE_PAYMENT_KEY = /^(sk|rk)_test_/u;
// A payment provider's live key, which takes real money: emptied whatever its setting is called.
const LIVE_PAYMENT_KEY = /^(sk|rk)_live_/u;

/**
 * Empties every setting of `env` shaped like an outside service's credential, and every live payment key whatever its
 * name, so a Preview or Test Preview reaches no outside service with one: a feature without its key is off there, or has its stand-in. A Preview then gives its AI
 * keys back (aiKeysOf, D-118). The one exception is a payment
 * provider's test-mode key (Stripe's `sk_test_…` and `rk_test_…`), kept so a copy built on Mercbot that takes payments
 * can try them in its Preview (D-116). Run it after .env is loaded, which never replaces a variable that is set, even
 * to "".
 * @param {Record<string, string | undefined>} env
 */
export function withoutCredentials(env) {
  for (const name of Object.keys(env)) {
    const value = String(env[name] ?? "").trim();
    if ((CREDENTIAL.test(name) && !TEST_MODE_PAYMENT_KEY.test(value)) || LIVE_PAYMENT_KEY.test(value)) env[name] = "";
  }
}

/**
 * The AI keys `env` gives, with their providers (AI_PREMIUM_API_KEY and AI_PREMIUM_PROVIDER, ...): what a Preview keeps
 * of its credentials, so its bots work as they do anywhere (D-118). Read it before withoutCredentials empties them.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function aiKeysOf(env) {
  const kept = {};
  for (const kind of Object.values(AI_KINDS)) {
    if (!String(env[kind.keySetting] ?? "").trim()) continue;
    kept[kind.keySetting] = String(env[kind.keySetting]);
    kept[kind.providerSetting] = String(env[kind.providerSetting] ?? "");
  }
  return kept;
}

/**
 * A Preview's and a Test Preview's AI (bin/develop.js, tests/support/start-test-app.mjs, D-83): Mercbot's stand-in
 * model (standInModel.mjs) on a local port, which the app is sent to with MERCBOT_TEST_AI_URL, for every kind `kept`
 * gives no key (aiKeysOf): such a kind names its provider, as it would with a key, and has none, so nothing it asks
 * reaches a provider and nothing waits on a real call failing. A Test Preview keeps no key, so all its AI is the
 * stand-in; a Preview's kinds with their keys use their providers (D-118).
 * @param {Record<string, string>} [kept]
 * @returns {Promise<{ env: Record<string, string>, standIn: Awaited<ReturnType<typeof startStandInModel>>, stop: () => Promise<void> }>}
 */
export async function startPreviewAi(kept = {}) {
  const standIn = await startStandInModel();
  const env = { MERCBOT_TEST_AI_URL: standIn.url, ...kept };
  for (const kind of Object.values(AI_KINDS)) {
    if (kept[kind.keySetting]) continue;
    env[kind.providerSetting] = Object.keys(kind.types)[0];
    env[kind.keySetting] = "";
  }
  return { env, standIn, stop: standIn.stop };
}
