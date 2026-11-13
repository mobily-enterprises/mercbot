import { randomBytes } from "node:crypto";
import { publicFetch } from "@local/account/public-address";
import { seal, unseal, vaultKey } from "@local/account/vault-crypto";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { createConnector } from "./connector.js";
import { createConnectorAccounts } from "./connectorAccounts.js";
import { ConnectionError, PROVIDERS, callbackUrl, createOAuth, credentials, fresh } from "./oauth.js";
import { createTokenRenewal, ranOut } from "./tokenRenewal.js";
import { mayUnlink, unlinkedEntry } from "./unlinking.js";

const STATE_MINUTES = 15;
// A sign-in to an app that hosts its own connection point (D-34), in oauth_states.provider.
const CONNECTOR = "connector";

const token = () => randomBytes(32).toString("base64url");
const olderThan = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

/** The search entries the owns entry of oauth_states adds. */
export const SIGN_IN_STATE_FILTERS = Object.freeze({
  createdBefore: { type: "dateTime", actualField: "created_at", filterOperator: "<" }
});

/** What this copy is called on the hub, e.g. "Pat's laptop". */
const copyName = (name) => String(name || "").trim().slice(0, 80) || "My Mercbot";

function hubUrl(env) {
  return String(env.MERCBOT_HUB_URL || "").replace(/\/+$/u, "");
}

/**
 * The hub's bridge, over HTTPS. A copy only ever sends its install token and its own references.
 * @param {string} base
 * @param {string | null} [installToken]
 */
function createHttpHub(base, installToken = null) {
  async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(installToken ? { authorization: `Bearer ${installToken}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    }).catch(() => {
      const host = base.replace(/^https?:\/\//u, "");
      throw new ConnectionError(502, `Couldn't reach ${host}. Check this server's internet connection and try again.`, {
        code: "integrations_hub_unreachable",
        params: { host }
      });
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    const answered = response.status === 401 ? 401 : 502;
    if (!result.error) throw new ConnectionError(answered, "Mercbot's hub didn't answer.", { code: "integrations_hub_silent" });
    // The hub's own refusal, passed on with its code.
    throw new ConnectionError(answered, result.error, { code: result.code || "integrations_hub_refused", params: result.params });
  }
  function createLinkRequest(name) {
    return call("POST", "/api/bridge/link-requests", { name });
  }

  function claim(id, pollSecret) {
    return call("POST", `/api/bridge/link-requests/${encodeURIComponent(id)}/claim`, { pollSecret });
  }

  function start(body) {
    return call("POST", "/api/bridge/connections", body);
  }

  function status(ref) {
    return call("GET", `/api/bridge/connections/${ref}`);
  }

  function connectionToken(ref) {
    return call("POST", `/api/bridge/connections/${ref}/token`, {});
  }

  function disconnect(ref) {
    return call("DELETE", `/api/bridge/connections/${ref}`);
  }

  function unlink() {
    return call("DELETE", "/api/bridge/install");
  }

  return Object.freeze({
    createLinkRequest,
    claim,
    start,
    status,
    token: connectionToken,
    disconnect,
    unlink
  });
}

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
 * unguessable state it carries.
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
  bridgedSignIns
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
  const connectorAccounts = createConnectorAccounts({ connector, accounts, oauthClient, pluginOf, sealed, opened });
  const { renewedTokens } = createTokenRenewal({ accounts, oauthClient, sealed, opened });

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

  async function startSignIn(provider, scopes, row, options) {
    const state = oauthClient.random();
    const verifier = oauthClient.random();
    await oauthStates.deleteWhere({ createdBefore: olderThan(STATE_MINUTES) }, passedOn(options));
    await oauthStates.create({
      id: state,
      provider: row.provider,
      accountId: row.accountId ?? null,
      bridgeConnectionId: row.bridgeId ?? null,
      verifier: sealed(verifier)
    }, { ...passedOn(options), returning: "none" });
    return { url: await oauthClient.authorizeUrl(provider, scopes, state, verifier) };
  }

  // ---- This copy's link to a hub ----

  /** This copy's one link to a hub, deployment-wide (bridge_link is `public`), or null. */
  async function linkRow(options) {
    const { records } = await bridgeLink.query({ sort: ["id"], page: { size: 1 } }, passedOn(options));
    return records[0] || null;
  }

  async function linkedHub(options) {
    const row = await linkRow(options);
    return row?.token ? hubFor(row.hubUrl, opened(row.token)) : null;
  }

  const unlinkRules = { managesHome: accounts.managesHome, isMember };

  async function linkStatus(options) {
    const row = await linkRow(options);
    return {
      hubUrl: row?.hubUrl || hubUrl(env),
      linked: Boolean(row?.token),
      pending: Boolean(row?.pending && !row?.token),
      name: row?.name || null,
      canUnlink: Boolean(row?.token) && (await mayUnlink(row, options, unlinkRules))
    };
  }

  /** Asks the hub for a link; the person approves it there, signed in to their account. */
  async function startLink(name, options) {
    const row = await linkRow(options);
    if (row?.token) throw new ConnectionError(409, "This copy is already linked.", { code: "integrations_link_already_linked" });
    const clean = copyName(name);
    const base = hubUrl(env);
    if (!base) {
      throw new ConnectionError(409, "No Mercbot to link to is set up for this copy (MERCBOT_HUB_URL).", {
        code: "integrations_link_hub_unset"
      });
    }
    const request = await hubFor(base).createLinkRequest(clean);
    await bridgeLink.deleteWhere({}, { ...passedOn(options), all: true });
    await bridgeLink.create({
      hubUrl: base,
      name: clean,
      linkedBy: resolveActorId(options.context),
      pending: sealed({ id: request.id, pollSecret: request.pollSecret })
    }, { ...passedOn(options), returning: "none" });
    return { approveUrl: request.approveUrl, code: request.code };
  }

  /** Picks up the install token once the person has approved the link. */
  async function checkLink(options) {
    const row = await linkRow(options);
    if (row?.pending && !row.token) {
      const { id, pollSecret } = opened(row.pending);
      const result = await hubFor(row.hubUrl).claim(id, pollSecret);
      if (result.token) {
        await bridgeLink.patch(row.id, { token: sealed(result.token), pending: null }, { ...passedOn(options), returning: "none", missing: "skip" });
      }
    }
    return linkStatus(options);
  }

  /**
   * Unlinks this copy from its hub: every account that borrowed the hub's sign-in is signed out, in
   * every home, and the call's home's Activity trail records who did it. A link still waiting for
   * approval is simply withdrawn.
   */
  async function unlink(options) {
    const row = await linkRow(options);
    if (!row) return linkStatus(options);
    if (row.token && !(await mayUnlink(row, options, unlinkRules))) {
      throw new ConnectionError(403, "Only the person who linked this copy, or an owner or admin of a home they're in, can unlink it.", {
        code: "integrations_unlink_forbidden"
      });
    }
    if (row.token) {
      await hubFor(row.hubUrl, opened(row.token))
        .unlink()
        .catch((error) => console.warn("Telling the hub about an unlink failed; this copy is unlinked anyway.", error));
    }
    await bridgeLink.deleteWhere({}, { ...passedOn(options), all: true });
    await accounts.signOutBridged(options);
    if (row.token && options.context?.workspace?.id) await recordActivity(unlinkedEntry(row, options.context), options);
    return linkStatus(options);
  }

  // ---- This copy's accounts ----

  /**
   * The consent screen to send the person to: through this copy's own app, or the hub's. A
   * home's account is signed in by its owners or admins (D-37).
   */
  async function connect(reach, accountId, options) {
    const account = await accounts.manageableAccount(reach, accountId, options);
    const { plugin, provider, scopes } = await signInFor(account.pluginId, options);
    // An app that hosts its own connection point is signed in to directly by every copy, never through the hub.
    if (plugin.mcp || credentials(provider, env)) {
      // Until it comes back, the account shows Needs auth with Reconnect.
      if (account.status !== "connected") await accounts.patchAccount(account, { signInState: "started" }, options);
      return startSignIn(provider, scopes, { provider: plugin.mcp ? CONNECTOR : plugin.oauth.provider, accountId: account.id }, options);
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
    return hub.start({ pluginId: plugin.id, remoteRef: ref });
  }

  /**
   * The person's accounts signed in through the hub turn connected once the hub has their
   * permission: their own, and the ones they added to the call's home. With `accountId`, only that
   * one (the screen waiting for its sign-in).
   * @param {object} options
   * @param {{ accountId?: string }} [only]
   */
  async function syncPending(options, { accountId } = {}) {
    const person = accounts.personOf(options);
    const one = accountId === undefined ? {} : { id: String(accountId) };
    if (!person || (one.id !== undefined && !/^\d+$/u.test(one.id))) return;
    const waiting = await accounts.reachable({ personal: true }, options, {
      filters: { userId: person, hasBridgeRef: true, statusNot: "connected", ...one }
    });
    if (!waiting.length) return;
    const hub = await linkedHub(options);
    if (!hub) return;
    for (const account of waiting) {
      const result = await hub.status(account.bridgeRef).catch(() => null);
      if (result?.connected) {
        await accounts.connectedThroughHub(account, { status: "connected", label: result.label || null, connectedAt: new Date().toISOString() }, options);
      }
    }
  }

  /**
   * A key for calling the provider's API for this account, valid for at least a minute (`renewed` when this call renewed
   * it): one about to run out is renewed, and so is `refused`, a key the provider turned down before it ran out (D-80).
   */
  async function accessToken(reach, accountId, options, { refused = "" } = {}) {
    const account = await accounts.reachableAccount(reach, accountId, options, { tokens: true });
    const { provider } = await signInFor(account.pluginId, options);
    if (account.tokens) {
      const stored = opened(account.tokens);
      if (fresh(stored) && stored.access !== refused) return { accessToken: stored.access, expiresAt: stored.expiresAt, renewed: false };
      const { tokens, renewed } = await renewedTokens(account, provider, refused || stored.access, options);
      return { accessToken: tokens.access, expiresAt: tokens.expiresAt, renewed };
    }
    const hub = account.bridgeRef ? await linkedHub(options) : null;
    if (hub) return hub.token(account.bridgeRef);
    throw new ConnectionError(409, `${account.name} isn't signed in to ${provider.name}.`, {
      code: "integrations_account_signed_out",
      params: { account: account.name, provider: provider.name }
    });
  }

  async function disconnect(reach, accountId, options) {
    const account = await accounts.manageableAccount(reach, accountId, options, { tokens: true });
    await connectorAccounts.withdraw(account, options);
    if (account.bridgeRef) {
      await (await linkedHub(options))
        ?.disconnect(account.bridgeRef)
        .catch((error) => console.warn("Telling the hub about a disconnect failed; the account is removed here anyway.", error));
    }
    await accounts.patchAccount(
      account,
      { tokens: null, bridgeRef: null, status: "needs-auth", signInState: null, label: null, connectedAt: null },
      options
    );
  }

  // ---- Where providers send people back (this copy's sign-ins and the ones it lends) ----

  async function callback(query, options) {
    // Taken once: of two callbacks with the same state, only the one whose delete removed it goes on.
    const state = String(query.state || "");
    const row = state ? await oauthStates.get(state, {}, { ...passedOn(options), missing: "skip" }) : null;
    const taken = row ? await oauthStates.delete(state, { ...passedOn(options), missing: "skip" }) : null;
    if (!row || taken == null || new Date(row.createdAt) < olderThan(STATE_MINUTES)) {
      throw new ConnectionError(400, "This sign-in link has expired. Start again from Connect apps.", {
        code: "integrations_sign_in_link_expired"
      });
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
    if (row.provider === CONNECTOR && !connecting) {
      throw new ConnectionError(400, "This sign-in link has expired. Start again from Connect apps.", { code: "integrations_sign_in_link_expired" });
    }
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
    const label = connecting
      ? await connectorAccounts.signedIn(connecting, tokens.access, options)
      : await oauthClient.whoami(provider, tokens.access).catch(() => null);
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
   * copy. It must be this copy's own return address, for a sign-in to one of their own accounts.
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
    const signIn = state ? await oauthStates.get(state, { fields: ["accountId"] }, { ...passedOn(options), missing: "skip" }) : null;
    // A sign-in of one of the person's own accounts: their own, or one they added to this home.
    const person = accounts.personOf(options);
    const mine = signIn?.accountId && person
      ? (await accounts.reachable({ personal: true }, options, { filters: { id: String(signIn.accountId), userId: person } })).length > 0
      : false;
    if (!mine) {
      throw new ConnectionError(400, "This sign-in has expired or was already finished. Start again with Sign in.", {
        code: "integrations_sign_in_state_unknown"
      });
    }
    return callback(query, options);
  }

  // ---- The sign-ins this copy lends (`bridgedSignIns`) ----

  /**
   * Starts signing someone in, with this copy's registered app, for a bridge connection of the feature it lends sign-ins
   * to: `connectionFor(pluginId)` makes or finds that connection and answers its id. Each copy signs in to an app that
   * hosts its own connection point itself (D-34), so those are never lent.
   */
  async function startBridgedSignIn(pluginId, connectionFor, options) {
    const found = pluginOf(pluginId);
    const { plugin, provider, scopes } = found?.mcp ? { plugin: found, provider: found } : await signInFor(pluginId, options);
    if (plugin.mcp || !credentials(provider, env)) {
      throw new ConnectionError(409, `${provider.name} sign-in isn't set up on the hub.`, {
        code: "integrations_hub_sign_in_unset",
        params: { provider: provider.name }
      });
    }
    const id = await connectionFor(plugin.id);
    return startSignIn(provider, scopes, { provider: plugin.oauth.provider, bridgeId: String(id) }, options);
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
    callback,
    finishPasted,
    accessToken,
    disconnect,
    syncPending,
    whenConnected: accounts.whenConnected,
    lacksAccess,
    linkStatus,
    startLink,
    checkLink,
    unlink,
    startBridgedSignIn,
    bridgedToken
  });
}
