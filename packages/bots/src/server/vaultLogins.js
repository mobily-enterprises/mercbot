import { seal, unseal, vaultKey } from "@local/account/vault-crypto";

/**
 * Logins in the person's vault (D-17), for filling into a bot's browser without the bot ever
 * seeing the password.
 */
const siteOf = (value) => String(value || "").trim().toLowerCase()
  .replace(/^https?:\/\//u, "").replace(/^www\./u, "").split(/[/?#]/u)[0];

const sameSite = (a, b) => Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

/**
 * The person's saved login for a site, with its password, or null. The person is the call's.
 * @param {{ savedLogins: (options: object) => Promise<object[]> }} account the account capability
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string} site
 * @param {object} options the call's options
 */
export async function savedLogin(account, env, site, options) {
  const key = vaultKey(env);
  if (!key) return null;
  const wanted = siteOf(site);
  const login = (await account.savedLogins(options)).find((entry) => sameSite(siteOf(entry.data.website), wanted));
  if (!login) return null;
  return { id: String(login.id), label: login.label, username: login.data.username || "", password: unseal(login.data.secret, key).password };
}

/**
 * A login given through the secure form, saved in the person's vault for next time when they ticked the box.
 * @param {{ saveLogin: (login: { label: string, data: object }, options: object) => Promise<{ id: string, label: string }> }} account
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string} site
 * @param {string} username
 * @param {string} password
 * @param {object} options the call's options
 */
export async function saveLogin(account, env, site, username, password, options) {
  const key = vaultKey(env);
  if (!key) return null;
  const website = siteOf(site);
  const saved = await account.saveLogin({
    label: website,
    data: {
      website,
      username: String(username || "").slice(0, 200),
      secret: seal({ password: String(password).slice(0, 500), notes: "" }, key)
    }
  }, options);
  return { id: String(saved.id), label: saved.label };
}

/**
 * Every saved password, for keeping them out of what a bot writes.
 * @param {{ savedLogins: (options: object) => Promise<object[]> }} account
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {object} options the call's options
 */
export async function vaultPasswords(account, env, options) {
  const key = vaultKey(env);
  if (!key) return [];
  return (await account.savedLogins(options)).map((login) => String(unseal(login.data.secret, key).password || ""));
}
