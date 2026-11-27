import { CREDENTIALS_REFUSED, credentialsMissing } from "./credentials.js";
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
 * (D-80), say to sign in again. An app connected with API credentials (D-93) has no refresh key: its kind makes a new
 * key from the credentials (`mint`), and the app turning them down clears them, so an owner or admin enters them again.
 * @param {object} dependencies
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {import("./types.js").OAuthClient} dependencies.oauthClient
 * @param {(value: unknown) => object} dependencies.sealed seals with the vault key
 * @param {(value: object) => any} dependencies.opened
 */
export function createTokenRenewal({ accounts, oauthClient, sealed, opened }) {
  /**
   * The account's next keys, made by `renew` from its saved ones while its row is held: `{ tokens, renewed }`, `renewed`
   * when this call asked the app. `renew` answering null, or an error `final` takes as the app's last word, refuses
   * with `signedOut()`, the last also signing the account out; any other error is 502.
   */
  async function underLock(account, used, options, { name, renew, final, signedOut }) {
    const outcome = await accounts.withLockedAccount(account, options, async (locked, txOptions) => {
      if (!locked?.tokens || locked.status !== "connected") return { refused: signedOut() };
      const current = opened(locked.tokens);
      // Renewed meanwhile by another server or call: its key is the one to use.
      if (current.access !== used && fresh(current)) return { tokens: current, renewed: false };
      let next;
      try {
        next = await renew(current);
      } catch (error) {
        if (!final(error)) {
          return {
            refused: new ConnectionError(502, `${name} didn't renew the sign-in. Try again in a few minutes.`, {
              code: "integrations_renewal_failed",
              params: { provider: name }
            })
          };
        }
        await accounts.patchAccount(account, { tokens: null, status: "needs-auth", signInState: null, connectedAt: null }, txOptions);
        return { refused: signedOut() };
      }
      if (!next) return { refused: signedOut() };
      await accounts.patchAccount(account, { tokens: sealed(next) }, txOptions);
      return { tokens: next, renewed: true };
    });
    if (outcome.refused) throw outcome.refused;
    return outcome;
  }

  /**
   * A signed-in account's next keys, from its refresh key.
   * @param {{ id: string }} account a record a scoped read answered
   * @param {object} provider
   * @param {string} used the key that ran out, or that the provider turned down
   * @param {object} options
   * @returns {Promise<{ tokens: object, renewed: boolean }>} `renewed` when this call asked the provider
   */
  function renewedTokens(account, provider, used, options) {
    return underLock(account, used, options, {
      name: provider.name,
      renew: (current) => (current.refresh ? oauthClient.refresh(provider, current) : null),
      final: (error) => error?.error === "invalid_grant",
      signedOut: () => ranOut(provider)
    });
  }

  /**
   * The next key of an account connected with API credentials, made from them by their kind (credentials.js).
   * @param {{ id: string }} account a record a scoped read answered
   * @param {{ name: string, mint: (values: object) => Promise<{ access: string, expiresAt: number }> }} kind
   * @param {string} used the key that ran out, or that the app turned down
   * @param {object} options
   * @returns {Promise<{ tokens: object, renewed: boolean }>}
   */
  function mintedTokens(account, kind, used, options) {
    return underLock(account, used, options, {
      name: kind.name,
      renew: async (current) => ({ ...current, ...await kind.mint(current.values) }),
      final: (error) => error?.code === CREDENTIALS_REFUSED,
      signedOut: () => credentialsMissing(kind)
    });
  }

  return Object.freeze({
    renewedTokens,
    mintedTokens
  });
}
