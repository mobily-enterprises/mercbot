import { randomBytes } from "node:crypto";
import { publicFetch } from "@local/account/public-address";
import { seal, unseal, vaultKey } from "@local/account/vault-crypto";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { createConnector } from "./connector.js";
import { createConnectorAccounts } from "./connectorAccounts.js";
import { createHttpHub, createHubLink } from "./hubLink.js";
import { createAppPeople } from "./appPeople.js";
import { createAppRequests } from "./appRequests.js";
import { credentialKind, credentialValues, credentialsMissing, credentialsOnly } from "./credentials.js";
import { ConnectionError, PROVIDERS, callbackUrl, createOAuth, credentials, fresh, publicUrl } from "./oauth.js";
import { SIGN_IN_MINUTES, newBinding, sameBrowser } from "./signInBinding.js";
import { createTokenRenewal, ranOut } from "./tokenRenewal.js";

// A sign-in to an app that hosts its own connection point (D-34), in oauth_states.provider.
const CONNECTOR = "connector";

const token = () => randomBytes(32).toString("base64url");
const olderThan = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

/** Two accounts' addresses are the same one, whatever their letters' case. */
const sameAddress = (one, other) => String(one).trim().toLowerCase() === String(other).trim().toLowerCase();

/**
 * A sign-in again of an account that already has an address, that came back as another: refused, so one line never
 * quietly becomes someone else's mailbox. A new mailbox is a new account (+ Add account).
 */
const otherAddress = (app, kept, signedInAs) =>
  new ConnectionError(
    409,
    `This ${app} account is ${kept}, but you signed in as ${signedInAs}, so nothing changed. To connect ${signedInAs}, use + Add account.`,
    { code: "integrations_sign_in_different_account", params: { app, account: kept, signedInAs } }
  );

/** A sign-in that is gone, ran out, or was finished already. */
const linkExpired = () =>
  new ConnectionError(400, "This sign-in link has expired. Start again from Connect apps.", { code: "integrations_sign_in_link_expired" });

/** The search entries the owns entry of oauth_states adds. */
export const SIGN_IN_STATE_FILTERS = Object.freeze({
  createdBefore: { type: "dateTime", actualField: "created_at", filterOperator: "<" }
});

/**
 * Whether what a sign-in was given lacks some of what the app asks for. Providers name scopes
 * in full or short ("https://graph.microsoft.com/Files.ReadWrite" or "Files.ReadWrite").
 */
function missingScopes(tokens, scopes) {
  const granted = tokens?.scope ? String(tokens.scope).split(/[\s,]+/u) : null;
  return (
    Boolean(granted) &&
    scopes.some((scope) => !granted.some((entry) => entry === scope || entry.endsWith(`/${scope}`) || scope.endsWith(`/${entry}`)))
  );
}

/**
 * Connected accounts (D-31): signing people in to the apps they add, the keys bot tools call apps with, and this copy's
 * side of the bridge between copies of Mercbot.
 *
 * Every copy of Mercbot works the same way:
 * - with its own registered app for a provider (Env), it signs people in directly;
 * - without one, if it's linked to another Mercbot that connects accounts for it (the hub, MERCBOT_HUB_URL), it
 *   borrows the hub's app: the hub keeps the long-lived permission and hands this copy hourly keys, and the data
 *   itself goes straight between this copy and the provider;
 * - a feature of this server can lend this copy's registered apps in turn (`bridgedSignIns`): this copy signs someone
 *   in for one of that feature's bridge connections, hands it the tokens, and renews them for it.
 * Everything lives in PostgreSQL, so any server can finish a sign-in or hand out a key (D-15).
 *
 * Every method takes the call's options last. The provider's callback has no one signed in: what proves it is the
 * unguessable state it carries, and the cookie of the browser the sign-in started in (D-97, signInBinding.js).
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources this feature's handles
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {import("./catalogue.js").Catalogue} dependencies.catalogue
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {typeof PROVIDERS} [dependencies.providers]
 * @param {import("./types.js").OAuthClient} [dependencies.oauthClient]
 * @param {typeof createHttpHub} [dependencies.hubFor]
 * @param {(homeId: string, userId: string, options: object) => Promise<boolean>} dependencies.isMember whether someone is
 *   an active member of a home (workspaces.memberships)
 * @param {(entry: object, options: object) => Promise<unknown>} dependencies.recordActivity adds an entry to the call's
 *   home's Activity trail (mercbot.apps)
 * @param {typeof fetch} [dependencies.fetch] how the general connector reaches apps: public addresses only (tests: publicFetch(true))
 * @param {import("./types.js").BridgedSignIns | null} dependencies.bridgedSignIns the feature this copy lends its
 *   registered apps' sign-ins to (`mercbot.integrations.bridged-sign-ins`), or null when none does
 * @param {Record<string, object>} dependencies.credentialKinds the apps connected with API credentials, by the kind
 *   plugin.json names (credentials.js, D-93)
 * @param {(options: object) => Promise<Array<{ id: string, name: string, email: string }>>} dependencies.homePeople the
 *   call's home's people, matched to the app's users when credentials are entered
 * @param {(userId: string, options: object) => Promise<string>} dependencies.emailOf a person's sign-in address
 * @param {(email: string, options: object) => Promise<string | null>} dependencies.memberWithEmail the id of the call's
 *   home's person who signs in with an address, or null
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope, for each account's turns (D-96)
 */
export function createConnections({
  resources,
  accounts,
  catalogue,
  env,
  providers = PROVIDERS,
  oauthClient = createOAuth({ env }),
  hubFor = createHttpHub,
  isMember,
  recordActivity,
  fetch: fetchImpl = publicFetch(),
  bridgedSignIns,
  credentialKinds,
  homePeople,
  emailOf,
  memberWithEmail,
  systemContext
}) {
  const { oauthStates, bridgeLink } = resources;
  const key = () => {
    const found = vaultKey(env);
    if (!found) throw new ConnectionError(503, "Connected accounts need MERCBOT_VAULT_KEY.", { code: "integrations_vault_key_missing" });
    return found;
  };
  const sealed = (value) => seal(value, key());
  const opened = (value) => unseal(value, key());
  const pluginOf = (pluginId) => catalogue.find((entry) => entry.id === pluginId) || null;
  const connector = createConnector({ connectorApps: resources.connectorApps, env, sealed, opened, fetch: fetchImpl });
  // Every request to a connected account's app waits its turn in the account's Request pace (D-96).
  const requests = createAppRequests({ turns: resources.pluginAccountTurns, systemContext });
  const connectorAccounts = createConnectorAccounts({
    connector,
    accounts,
    oauthClient,
    pluginOf,
    sealed,
    opened,
    paced: (account, plugin) => requests.fetchFor(account, plugin, fetchImpl)
  });
  const { renewedTokens, mintedTokens } = createTokenRenewal({ accounts, oauthClient, sealed, opened });

  /**
   * A connected account signed in before its app asked for more, as when Google Drive moved to full
   * Drive access (D-42). It keeps working with what it has, and shows as needing more access.
   */
  function lacksAccess(row) {
    const scopes = pluginOf(row.pluginId)?.oauth?.scopes;
    if (row.status !== "connected" || !row.tokens || !scopes) return false;
    try {
      return missingScopes(opened(row.tokens), scopes);
    } catch {
      return false;
    }
  }

  /**
   * A plugin people can sign in to, with its provider: this copy's own registered app for Google,
   * Microsoft or GitHub (D-31), or for an app that hosts its own connection point, the sign-in it
   * describes and the client this copy registered there (D-34).
   */
  async function signInFor(pluginId, options) {
    const plugin = pluginOf(pluginId);
    // Entered in Connect apps, never signed in to, on this copy or through the hub (D-93).
    if (plugin?.credentials) throw credentialsOnly(plugin);
    if (plugin?.mcp) return { plugin, provider: await connector.provider(plugin, options), scopes: [] };
    const provider = plugin?.oauth && providers[plugin.oauth.provider];
    if (!provider) {
      const app = plugin?.name || "this app";
      throw new ConnectionError(409, `Signing in to ${app} isn't available yet.`, {
        code: "integrations_sign_in_unavailable",
        params: { app }
      });
    }
    return { plugin, provider, scopes: plugin.oauth.scopes || [] };
  }

  /**
   * Starts a sign-in, kept with its PKCE verifier and what it is for. It belongs to the browser of the call (D-97): the
   * answer's `cookie` is for that browser, and `url` is the provider's consent screen. A sign-in lent to a linked copy
   * (`lentTo`, the account that copy is linked to) is begun here by that account, signed in: its `url` is that page,
   * and it gets its browser there (beginLentSignIn).
   */
  async function startSignIn(provider, scopes, row, options, { loginHint = "" } = {}) {
    const state = oauthClient.random();
    const verifier = oauthClient.random();
    const lent = row.lentTo != null;
    const { cookie, binding } = newBinding(state);
    await oauthStates.deleteWhere({ createdBefore: olderThan(SIGN_IN_MINUTES) }, passedOn(options));
    await oauthStates.create({
      id: state,
      provider: row.provider,
      accountId: row.accountId ?? null,
      bridgeConnectionId: row.bridgeId ?? null,
      lentTo: lent ? String(row.lentTo) : null,
      binding: lent ? null : binding,
      verifier: sealed(verifier)
    }, { ...passedOn(options), returning: "none" });
    if (lent) return { url: `${publicUrl(env)}/account/connect?${new URLSearchParams({ lent: state })}` };
    return { url: await oauthClient.authorizeUrl(provider, scopes, state, verifier, { loginHint }), cookie };
  }

  // This copy's one link to a hub (hubLink.js).
  const hubLink = createHubLink({ bridgeLink, env, hubFor, sealed, opened, accounts, isMember, recordActivity });
  const { linkedHub } = hubLink;

  // ---- This copy's accounts ----

  /**
   * The consent screen to send the person to: through this copy's own app, with the `cookie` for the browser that asked
   * (D-97), or the hub's (whose page the person begins it on, signed in there). An account is signed in by the person who
   * added it or the home's owners and admins (D-111). An account that already has an address suggests it to the
   * provider, and only that address may sign it in again (finishSignIn).
   */
  async function connect(accountId, options) {
    const account = await accounts.manageableAccount(accountId, options);
    const { plugin, provider, scopes } = await signInFor(account.pluginId, options);
    // An app that hosts its own connection point is signed in to directly by every copy, never through the hub.
    if (plugin.mcp || credentials(provider, env)) {
      // Until it comes back, the account shows Needs auth with Reconnect.
      if (account.status !== "connected") await accounts.patchAccount(account, { signInState: "started" }, options);
      const row = { provider: plugin.mcp ? CONNECTOR : plugin.oauth.provider, accountId: account.id };
      return startSignIn(provider, scopes, row, options, { loginHint: account.label || "" });
    }
    const hub = await linkedHub(options);
    if (!hub) {
      throw new ConnectionError(
        409,
        `This copy of Mercbot can't sign in to ${provider.name} yet.` +
          ` Link it to a Mercbot account in Settings → Mercbot account, or register your own ${provider.name} app.`,
        { code: "integrations_sign_in_needs_link", params: { provider: provider.name } }
      );
    }
    const ref = account.bridgeRef || token();
    if (!account.bridgeRef) await accounts.patchAccount(account, { bridgeRef: ref }, options);
    // The hub's page that begins it, signed in there (D-97); a browser here has nothing to keep.
    const { url } = await hub.start({ pluginId: plugin.id, remoteRef: ref });
    return { url };
  }

  /**
   * The accounts the person added to the call's home and signed in through the hub turn connected once
   * the hub has their permission. With `accountId`, only that one (the screen waiting for its sign-in).
   * @param {object} options
   * @param {{ accountId?: string }} [only]
   */
  async function syncPending(options, { accountId } = {}) {
    const person = accounts.personOf(options);
    const one = accountId === undefined ? {} : { id: String(accountId) };
    if (!person || (one.id !== undefined && !/^\d+$/u.test(one.id))) return;
    const waiting = await accounts.reachable(options, {
      filters: { userId: person, hasBridgeRef: true, statusNot: "connected", ...one }
    });
    if (!waiting.length) return;
    const hub = await linkedHub(options);
    if (!hub) return;
    for (const account of waiting) {
      const result = await hub.status(account.bridgeRef).catch(() => null);
      if (!result?.connected) continue;
      // Signed in again as another address: the hub's sign-in is withdrawn and the account stays as it was, to retry.
      if (account.label && result.label && !sameAddress(account.label, result.label)) {
        await hub.disconnect(account.bridgeRef).catch((error) => console.warn("Withdrawing a sign-in as another address at the hub failed.", error));
        await accounts.patchAccount(account, { bridgeRef: null, signInState: "failed" }, options);
        continue;
      }
      const label = result.label || account.label || null;
      await accounts.connectedHere(account, { status: "connected", label, connectedAt: new Date().toISOString() }, options);
    }
  }

  /**
   * A key for calling the provider's API for this account, valid for at least a minute (`renewed` when this call renewed
   * it): one about to run out is renewed, and so is `refused`, a key the provider turned down before it ran out (D-80).
   * `fetch` is the account's own way to its app, the only one its callers use: each request waits its turn in the
   * account's Request pace, and a busy app says when to try again (appRequests.js, D-96).
   */
  async function accessToken(accountId, options, { refused = "" } = {}) {
    const account = await accounts.reachableAccount(accountId, options, { tokens: true });
    const paced = requests.fetchFor(account, pluginOf(account.pluginId));
    if (pluginOf(account.pluginId)?.credentials) return { ...await credentialToken(account, options, refused), fetch: paced };
    const { provider } = await signInFor(account.pluginId, options);
    if (account.tokens) {
      const stored = opened(account.tokens);
      if (fresh(stored) && stored.access !== refused) {
        return { accessToken: stored.access, expiresAt: stored.expiresAt, renewed: false, fetch: paced };
      }
      const { tokens, renewed } = await renewedTokens(account, provider, refused || stored.access, options);
      return { accessToken: tokens.access, expiresAt: tokens.expiresAt, renewed, fetch: paced };
    }
    const hub = account.bridgeRef ? await linkedHub(options) : null;
    if (hub) return { ...await hub.token(account.bridgeRef), fetch: paced };
    throw new ConnectionError(409, `${account.name} isn't signed in to ${provider.name}.`, {
      code: "integrations_account_signed_out",
      params: { account: account.name, provider: provider.name }
    });
  }

  // ---- Apps connected with API credentials (D-93) ----

  /**
   * An hourly key for an account connected with API credentials, made from them when the last one runs out or the app
   * refused it, under the account's row lock (tokenRenewal.js), and `api`: the address the key is for, which the app's
   * kind builds from the credentials alone.
   */
  async function credentialToken(account, options, refused) {
    const kind = credentialKind(pluginOf(account.pluginId), credentialKinds);
    if (!account.tokens || account.status !== "connected") throw credentialsMissing(kind);
    const stored = opened(account.tokens);
    const api = kind.api(stored.values);
    if (fresh(stored) && stored.access !== refused) return { accessToken: stored.access, expiresAt: stored.expiresAt, renewed: false, api };
    const { tokens, renewed } = await mintedTokens(account, kind, refused || stored.access, options);
    return { accessToken: tokens.access, expiresAt: tokens.expiresAt, renewed, api };
  }

  /**
   * Saves an account's API credentials, entered in Connect apps by someone who may change it; credentials that are the
   * whole home's (D-93), only by its owners and admins. Nothing is saved until the app has taken them: a key is made,
   * and the kind's check reads who they belong to (the account's label) and matches the home's people to the app's
   * users by address. Answers the label and who was matched; the others pick themselves (appPeople.js).
   * @param {string} accountId
   * @param {Record<string, unknown>} body the form's values, by field id
   * @param {object} options
   */
  async function saveCredentials(accountId, body, options) {
    const account = await accounts.manageableAccount(accountId, options);
    const plugin = pluginOf(account.pluginId);
    const kind = credentialKind(plugin, credentialKinds);
    if (plugin.credentials.home && !accounts.managesHome(options)) {
      throw new ConnectionError(403, `Only the home's owners and admins can enter ${plugin.name}'s credentials: they're the whole home's.`, {
        code: "integrations_home_app_forbidden",
        params: { app: plugin.name }
      });
    }
    const values = kind.normalize(credentialValues(plugin, body));
    const minted = await kind.mint(values);
    const access = { token: minted.access, fetch: requests.fetchFor(account, plugin) };
    const checked = await kind.check({ values, access, people: await homePeople(options) });
    await accounts.connectedHere(account, {
      tokens: sealed({ values, access: minted.access, expiresAt: minted.expiresAt }),
      label: checked.label,
      status: "connected",
      signInState: null,
      connectedAt: new Date().toISOString()
    }, options);
    return { app: plugin.name, label: checked.label, matched: checked.matched, unmatched: checked.unmatched, more: checked.more };
  }

  const people = createAppPeople({
    accounts,
    links: resources.pluginAccountPeople,
    kindOf: (account) => credentialKind(pluginOf(account.pluginId), credentialKinds),
    keyFor: async (account, options) => ({
      access: { token: (await credentialToken(account, options, "")).accessToken, fetch: requests.fetchFor(account, pluginOf(account.pluginId)) },
      values: opened(account.tokens).values
    }),
    homePeople,
    emailOf,
    memberWithEmail
  });

  /**
   * Withdraws an account's sign-in where it was given, before the account is removed (integrationsService.removeAccount):
   * at the app, where it offers that, and at the hub when it borrowed the hub's. Each is a courtesy that may fail, so the
   * account is removed here anyway. `account` is a scoped read's record with its tokens.
   * @param {{ id: string, pluginId: string, tokens?: object | null, bridgeRef?: string | null }} account
   * @param {object} options
   */
  async function withdraw(account, options) {
    await connectorAccounts.withdraw(account, options);
    if (account.bridgeRef) {
      await (await linkedHub(options))
        ?.disconnect(account.bridgeRef)
        .catch((error) => console.warn("Telling the hub about a removed account failed; the account is removed here anyway.", error));
    }
  }

  /**
   * Disconnects any account by its id, in any home, for whoever runs the copy: its sign-in withdrawn as a removal's
   * is, then its keys, label and status cleared, the account kept for its person to sign in again or remove. Answers
   * what it disconnected, `{ id, pluginId, name, label, status, userId, workspaceId }`; 404 when there is none.
   * @param {string | number} accountId
   * @param {object} [options] the call's transaction, if any
   */
  async function disconnectAnywhere(accountId, options = {}) {
    const account = await accounts.anyAccount(accountId, options);
    if (!account) throw new ConnectionError(404, "Account not found.", { code: "integrations_account_not_found" });
    await disconnected(account, accounts.anywhere(options));
    const { tokens: _keys, signInState: _state, bridgeRef: _bridge, ...shown } = account;
    return shown;
  }

  /** Withdraws an account's sign-in at the app and the hub, and clears it here: its keys, label and status. */
  async function disconnected(account, options) {
    await withdraw(account, options);
    await accounts.patchAccount(
      account,
      { tokens: null, bridgeRef: null, status: "needs-auth", signInState: null, label: null, connectedAt: null },
      options
    );
  }

  // ---- Where providers send people back (this copy's sign-ins and the ones it lends) ----

  /**
   * The provider sending a browser back, with that request's cookies. Only the browser the sign-in started in finishes
   * it (D-97): any other, such as one someone sent the consent link of a sign-in they started, is refused before
   * anything is taken or saved, and the sign-in stays for its own browser.
   * @param {Record<string, string>} query
   * @param {Record<string, string | undefined>} cookies
   * @param {object} options
   */
  async function callback(query, cookies, options) {
    const state = String(query.state || "");
    const row = state ? await oauthStates.get(state, {}, { ...passedOn(options), missing: "skip" }) : null;
    if (row && !sameBrowser(row, cookies)) {
      throw new ConnectionError(
        400,
        "This sign-in was started in another browser, so nothing was connected. To connect an account, start from Connect apps in this browser.",
        { code: "integrations_sign_in_other_browser" }
      );
    }
    return finish(row, query, options);
  }

  async function finish(row, query, options) {
    // Taken once: of two callbacks with the same state, only the one whose delete removed it goes on.
    const taken = row ? await oauthStates.delete(row.id, { ...passedOn(options), missing: "skip" }) : null;
    if (!row || taken == null || new Date(row.createdAt) < olderThan(SIGN_IN_MINUTES)) {
      throw linkExpired();
    }
    try {
      return await finishSignIn(row, query, options);
    } catch (error) {
      // A cancelled or refused sign-in leaves the account with Needs auth and Retry.
      if (row.accountId) await accounts.signInFailed(row.accountId, options).catch(() => {});
      throw error;
    }
  }

  /**
   * A work or school account whose organisation must approve Mercbot first: Microsoft's
   * AADSTS65001/90094/90095 or "admin" in the reason, Google's admin_policy_enforced.
   */
  function needsAdmin(provider, query) {
    const said = `${query.error || ""} ${query.error_description || ""}`;
    if (provider === providers.google) return /admin_policy_enforced|org_internal/iu.test(said);
    if (provider === providers.microsoft) return /AADSTS(65001|90094|90095|900941)\b|admin (approval|consent)/iu.test(said);
    return false;
  }

  function approvalLink(provider, scopes) {
    const id = credentials(provider, env)?.id || "";
    if (provider === providers.microsoft) {
      const consent = new URLSearchParams({ client_id: id, scope: scopes.join(" "), redirect_uri: callbackUrl(env) });
      return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${consent}`;
    }
    return `https://admin.google.com/ac/owl/list?tab=configuredApps (app client ID ${id})`;
  }

  /** The app a sign-in is for: its account's, or that of the bridge connection it was lent for. */
  async function signInPluginId(row, options) {
    if (row.accountId) return (await accounts.signingIn(row.accountId, options))?.pluginId ?? null;
    if (!row.bridgeConnectionId || !bridgedSignIns) return null;
    return (await bridgedSignIns.pluginOf(String(row.bridgeConnectionId), options)) ?? null;
  }

  async function finishSignIn(row, query, options) {
    const connecting = row.provider === CONNECTOR ? pluginOf(await signInPluginId(row, options)) : null;
    if (row.provider === CONNECTOR && !connecting) throw linkExpired();
    const provider = connecting ? (await signInFor(connecting.id, options)).provider : providers[row.provider];
    if (query.error) {
      const pluginId = row.accountId ? await signInPluginId(row, options) : null;
      if (needsAdmin(provider, query)) {
        throw new ConnectionError(
          400,
          `Your organisation's admin needs to approve Mercbot before this ${provider.name} account can connect.` +
            ` You did nothing wrong: send them the approval link below, then sign in again once they've approved it.`,
          {
            code: "integrations_sign_in_needs_admin",
            params: { provider: provider.name },
            approval: approvalLink(provider, pluginOf(pluginId)?.oauth?.scopes || [])
          }
        );
      }
      throw new ConnectionError(
        400,
        `The ${provider.name} sign-in was cancelled, so nothing was connected. You can try again from Connect apps.`,
        { code: "integrations_sign_in_cancelled", params: { provider: provider.name } }
      );
    }
    const tokens = await oauthClient.exchange(provider, new URLSearchParams(query), row.id, opened(row.verifier)).catch((error) => {
      // The provider's own reason (e.g. "invalid_grant: AADSTS70008 … expired"), first line only.
      const reason =
        [error?.error, String(error?.error_description || "").split(/\r?\n/u)[0]].filter(Boolean).join(": ") ||
        error?.message ||
        String(error);
      console.error(`${provider.name} sign-in failed: ${reason}`);
      // The app no longer knows this copy's registration: the next sign-in registers again.
      if (connecting && /invalid_client/iu.test(reason)) {
        connector.forget(connecting.id, options).catch(() => {});
      }
      const expired = /invalid_grant|expired|already (been )?(used|redeemed)/iu.test(reason);
      if (expired) {
        throw new ConnectionError(
          400,
          `${provider.name} didn't accept the sign-in; it may have taken too long. Start again with Sign in.`,
          {
            code: "integrations_sign_in_expired",
            params: { provider: provider.name }
          }
        );
      }
      const said = reason.slice(0, 240);
      throw new ConnectionError(400, `${provider.name} didn't accept the sign-in (${said}).`, {
        code: "integrations_sign_in_refused",
        params: { provider: provider.name, reason: said }
      });
    });
    const { plugin, scopes } = connecting
      ? { plugin: connecting, scopes: [] }
      : await signInFor(await signInPluginId(row, options), options);
    if (missingScopes(tokens, scopes)) {
      throw new ConnectionError(
        400,
        `${provider.name} didn't give ${plugin.name} access: a box on ${provider.name}'s screen was left unticked.` +
          ` Sign in again and allow everything ${plugin.name} asks for.`,
        { code: "integrations_sign_in_scopes_missing", params: { provider: provider.name, app: plugin.name } }
      );
    }
    const signedInAs = connecting
      ? await connectorAccounts.signedIn(connecting, tokens.access, options)
      : await oauthClient.whoami(provider, tokens.access).catch(() => null);
    // An account signed in again keeps its own address: another one is refused, and none found keeps the one it had.
    const kept = row.accountId ? (await accounts.signingIn(row.accountId, options))?.label : null;
    if (kept && signedInAs && !sameAddress(kept, signedInAs)) throw otherAddress(plugin.name, kept, signedInAs);
    const label = signedInAs || kept || null;
    const update = { tokens: sealed(tokens), label };
    if (row.accountId) {
      await accounts.signedIn(row.accountId, { ...update, status: "connected", signInState: null, connectedAt: new Date().toISOString() }, options);
    } else {
      await bridgedSignIns.signedIn(String(row.bridgeConnectionId), update, options);
    }
    return { provider: provider.name, label };
  }

  /**
   * The address a provider sent the person back to, pasted when their browser couldn't reach this
   * copy. It must be this copy's own return address, for a sign-in to an account they may change: the person pasting it,
   * signed in, is what ties it to them, in place of the callback's cookie (D-97).
   */
  async function finishPasted(address, options) {
    let url;
    try {
      url = new URL(String(address || "").trim());
    } catch {
      url = null;
    }
    const expected = callbackUrl(env);
    if (!url || `${url.origin}${url.pathname}` !== expected) {
      throw new ConnectionError(400, `That isn't the address the sign-in ended on. Copy the whole address starting with ${expected}.`, {
        code: "integrations_sign_in_address_wrong",
        params: { address: expected }
      });
    }
    const query = Object.fromEntries(url.searchParams);
    const state = String(query.state || "");
    const signIn = state ? await oauthStates.get(state, {}, { ...passedOn(options), missing: "skip" }) : null;
    // A sign-in of an account of this home the person may change (accounts.mayChange).
    const [account] = signIn?.accountId ? await accounts.reachable(options, { filters: { id: String(signIn.accountId) } }) : [];
    if (!account || !accounts.mayChange(account, options)) {
      throw new ConnectionError(400, "This sign-in has expired or was already finished. Start again with Sign in.", {
        code: "integrations_sign_in_state_unknown"
      });
    }
    return finish(signIn, query, options);
  }

  // ---- The sign-ins this copy lends (`bridgedSignIns`) ----

  /**
   * Starts signing someone in, with this copy's registered app, for a bridge connection of the feature it lends sign-ins
   * to: `connectionFor(pluginId)` makes or finds that connection and answers its id, and `lentTo` is the account here the
   * linked copy is linked to, the only one who may begin it (D-97). Answers the page here that begins it. Each copy signs
   * in to an app that hosts its own connection point itself (D-34), so those are never lent.
   * @param {string} pluginId
   * @param {{ connectionFor: (pluginId: string) => Promise<string>, lentTo: string }} lending
   * @param {object} options
   */
  async function startBridgedSignIn(pluginId, { connectionFor, lentTo }, options) {
    const found = pluginOf(pluginId);
    const { plugin, provider, scopes } = found?.mcp ? { plugin: found, provider: found } : await signInFor(pluginId, options);
    if (plugin.mcp || !credentials(provider, env)) {
      throw new ConnectionError(409, `${provider.name} sign-in isn't set up on the hub.`, {
        code: "integrations_hub_sign_in_unset",
        params: { provider: provider.name }
      });
    }
    if (!/^\d+$/u.test(String(lentTo ?? ""))) throw new TypeError("A lent sign-in needs the account the copy is linked to (lentTo).");
    const id = await connectionFor(plugin.id);
    return startSignIn(provider, scopes, { provider: plugin.oauth.provider, bridgeId: String(id), lentTo }, options);
  }

  /**
   * Begins a sign-in this copy lends a linked copy, in the browser of the account that copy is linked to, signed in here
   * (D-97): the provider's consent screen, the app's name, and the `cookie` that ties the sign-in to this browser. Anyone
   * else is refused, so its page sent to someone else signs no one in. Beginning it again moves it to the browser that
   * did.
   * @param {string} state
   * @param {object} options
   */
  async function beginLentSignIn(state, options) {
    const row = state ? await oauthStates.get(String(state), {}, { ...passedOn(options), missing: "skip" }) : null;
    if (!row?.lentTo || new Date(row.createdAt) < olderThan(SIGN_IN_MINUTES)) throw linkExpired();
    if (String(row.lentTo) !== String(resolveActorId(options.context) ?? "")) {
      throw new ConnectionError(
        403,
        "This sign-in is for another Mercbot account, the one the copy of Mercbot that started it is linked to." +
          " Sign in here with that account, then start again from that copy.",
        { code: "integrations_sign_in_other_account" }
      );
    }
    const { plugin, provider, scopes } = await signInFor(await signInPluginId(row, options), options);
    const { cookie, binding } = newBinding(row.id);
    await oauthStates.patch(row.id, { binding }, { ...passedOn(options), returning: "none", missing: "skip" });
    return { url: await oauthClient.authorizeUrl(provider, scopes, row.id, opened(row.verifier)), app: plugin.name, cookie };
  }

  /**
   * An hourly key from a lent sign-in's sealed tokens: renewed when it ran out, and the renewed tokens handed to `save`,
   * sealed. The long-lived permission never leaves this server.
   */
  async function bridgedToken(pluginId, sealedTokens, save, options) {
    const { provider } = await signInFor(pluginId, options);
    let tokens = opened(sealedTokens);
    if (!fresh(tokens)) {
      if (!tokens?.refresh) throw ranOut(provider);
      tokens = await oauthClient.refresh(provider, tokens);
      await save(sealed(tokens));
    }
    return { accessToken: tokens.access, expiresAt: tokens.expiresAt };
  }

  return Object.freeze({
    // Apps that host their own connection point (D-34): an account's actions, one run, and every app's actions as stored.
    connectorTools: connectorAccounts.tools,
    connectorCall: connectorAccounts.call,
    storedConnectorActions: connector.storedTools,
    connect,
    saveCredentials,
    appPerson: people.appPerson,
    appUsers: people.appUsers,
    pickAppUser: people.pickAppUser,
    confirmAppPerson: people.confirmAppPerson,
    forgetAppPerson: people.forgetAppPerson,
    appPeople: people.appPeople,
    callback,
    finishPasted,
    accessToken,
    withdraw,
    disconnectAnywhere,
    syncPending,
    whenConnected: accounts.whenConnected,
    lacksAccess,
    linkStatus: hubLink.linkStatus,
    startLink: hubLink.startLink,
    checkLink: hubLink.checkLink,
    unlink: hubLink.unlink,
    startBridgedSignIn,
    beginLentSignIn,
    bridgedToken
  });
}
