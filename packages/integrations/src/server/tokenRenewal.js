import { ConnectionError, fresh } from "./oauth.js";

/** A sign-in that ran out or was refused: 409, sign in again from Connect apps. */
export const ranOut = (provider) =>
  new ConnectionError(409, `The ${provider.name} sign-in has run out; sign in again from Connect apps.`, {
    code: "integrations_sign_in_ran_out",
    params: { provider: provider.name }
  });

/**
 * Renewing a directly signed-in account's key (connections.js), holding the account's row until the renewal is saved
 * (D-15): of two servers (or calls) renewing at once, the second waits and takes the first's new key, so the provider
 * is asked once. The same holds for a key the provider turned down before it ran out (`used`, D-80): it's renewed
 * once, however many servers saw it refused. A renewal the provider refuses (invalid_grant: the person took Mercbot's
 * access back, or a testing app's week ran out) signs the account out, so Connect apps, and a home's files kept in it
 * (D-80), say to sign in again.
 * @param {object} dependencies
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {import("./types.js").OAuthClient} dependencies.oauthClient
 * @param {(value: unknown) => object} dependencies.sealed seals with the vault key
 * @param {(value: object) => any} dependencies.opened
 */
export function createTokenRenewal({ accounts, oauthClient, sealed, opened }) {
  /**
   * @param {{ id: string, home: boolean }} account a record a scoped read answered
   * @param {object} provider
   * @param {string} used the key that ran out, or that the provider turned down
   * @param {object} options
   * @returns {Promise<{ tokens: object, renewed: boolean }>} `renewed` when this call asked the provider
   */
  async function renewedTokens(account, provider, used, options) {
    const outcome = await accounts.withLockedAccount(account, options, async (locked, txOptions) => {
      if (!locked?.tokens || locked.status !== "connected") return { refused: ranOut(provider) };
      const current = opened(locked.tokens);
      // Renewed meanwhile by another server or call: its key is the one to use.
      if (current.access !== used && fresh(current)) return { tokens: current, renewed: false };
      if (!current.refresh) return { refused: ranOut(provider) };
      try {
        const next = await oauthClient.refresh(provider, current);
        await accounts.patchAccount(account, { tokens: sealed(next) }, txOptions);
        return { tokens: next, renewed: true };
      } catch (error) {
        if (error?.error !== "invalid_grant") {
          return {
            refused: new ConnectionError(502, `${provider.name} didn't renew the sign-in. Try again in a few minutes.`, {
              code: "integrations_renewal_failed",
              params: { provider: provider.name }
            })
          };
        }
        await accounts.patchAccount(account, { tokens: null, status: "needs-auth", signInState: null, connectedAt: null }, txOptions);
        return { refused: ranOut(provider) };
      }
    });
    if (outcome.refused) throw outcome.refused;
    return outcome;
  }

  return Object.freeze({ renewedTokens });
}
