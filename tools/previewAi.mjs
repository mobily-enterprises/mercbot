import { AI_KINDS } from "@local/account/model";
import { startStandInModel } from "./standInModel.mjs";

// Every outside service's credential, whatever its name: the AI keys (AI_PREMIUM_API_KEY, AI_IMAGES_API_KEY, ...),
// Turnstile's, and every sign-in or connection app's (AUTH_<PROVIDER>_CLIENT_ID, <APP>_CLIENT_SECRET, and the
// <APP>_TEST_CLIENT_ID pair the integrations use on a local address), and the files volume's object storage keys
// (ACCESS_KEY, SECRET_KEY). The database's password and the copy's own secrets (the session secret, the Vault key, the
// files passphrase) don't match.
const CREDENTIAL = /(^|_)(API_KEY|CLIENT_ID|CLIENT_SECRET|SECRET_KEY|SITE_KEY|ACCESS_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|TOKEN)$/u;

/**
 * Empties every setting of `env` shaped like an outside service's credential, so a Preview or Test Preview reaches no
 * outside service with one: a feature without its key is off there, or has its stand-in. Run it after .env is loaded,
 * which never replaces a variable that is set, even to "".
 * @param {Record<string, string | undefined>} env
 */
export function withoutCredentials(env) {
  for (const name of Object.keys(env)) {
    if (CREDENTIAL.test(name)) env[name] = "";
  }
}

/**
 * A Preview's and a Test Preview's AI (bin/develop.js, tests/support/start-test-app.mjs, D-83): Mercbot's stand-in
 * model (standInModel.mjs) on a local port for every kind, which the app is sent to with MERCBOT_TEST_AI_URL. Each kind
 * names its provider, as it would with a key, and has none: nothing the copy asks of its AI reaches a provider, and
 * nothing waits on a real call failing.
 * @returns {Promise<{ env: Record<string, string>, standIn: Awaited<ReturnType<typeof startStandInModel>>, stop: () => Promise<void> }>}
 */
export async function startPreviewAi() {
  const standIn = await startStandInModel();
  const env = { MERCBOT_TEST_AI_URL: standIn.url };
  for (const kind of Object.values(AI_KINDS)) {
    env[kind.providerSetting] = Object.keys(kind.types)[0];
    env[kind.keySetting] = "";
  }
  return { env, standIn, stop: standIn.stop };
}
