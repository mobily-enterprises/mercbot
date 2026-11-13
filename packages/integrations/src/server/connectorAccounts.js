import { ConnectorAuthError } from "./connector.js";
import { ConnectionError, fresh } from "./oauth.js";

// How long a server keeps an account's list of an app's actions before asking the app again.
const TOOLS_MINUTES = 10;

/**
 * The connected accounts of apps that host their own connection point (D-34), once connections.js has signed them in:
 * who signed in and the app's actions right after a sign-in, each action run with a key that is renewed when it runs out
 * or the app refuses it, an account signed out when the app no longer takes its sign-in, and the sign-in withdrawn at
 * the app on disconnecting.
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./connector.js").createConnector>} dependencies.connector
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {import("./types.js").OAuthClient} dependencies.oauthClient
 * @param {(pluginId: string) => object | null} dependencies.pluginOf the catalogue's entry for an app
 * @param {(value: unknown) => object} dependencies.sealed seals with the vault key
 * @param {(value: object) => any} dependencies.opened
 */
export function createConnectorAccounts({ connector, accounts, oauthClient, pluginOf, sealed, opened }) {
  // Each account's list of its app's actions, as this server last asked for it: a bot asks for the
  // list before using an app, and each action it runs is checked against it.
  const toolLists = new Map();

  /** Right after a sign-in: the label (who signed in) and the app's actions, kept for its page's switches. */
  async function signedIn(plugin, access, options) {
    try {
      const { tools, label } = await connector.signedIn(plugin, access);
      await connector.storeTools(plugin.id, tools, options);
      return label;
    } catch (error) {
      console.warn(`Reading ${plugin.name}'s actions after a sign-in failed; it's connected anyway.`, error?.message || error);
      return null;
    }
  }

  /**
   * An account whose app no longer takes its sign-in (withdrawn on the app's own site, or run out):
   * it shows as needing sign-in again in Connect apps, still named, and the bot says so plainly.
   */
  async function signedOutByApp(account, plugin, options) {
    toolLists.delete(account.id);
    await accounts.patchAccount(account, { tokens: null, status: "needs-auth", signInState: null, connectedAt: null }, options);
    return new ConnectionError(
      409,
      `${plugin.name} isn't connected any more: its sign-in was withdrawn or has run out. Sign in again from Connect apps.`,
      { code: "integrations_connector_signed_out", params: { app: plugin.name, account: account.label || account.name } }
    );
  }

  const notConnected = (account, plugin) =>
    new ConnectionError(409, `${plugin.name} isn't connected. Connect it in Connect apps.`, {
      code: "integrations_account_signed_out",
      params: { account: account.name, provider: plugin.name }
    });

  /**
   * Runs `work` with a key for one of the call's connected accounts of such an app. A key about to
   * run out is renewed first; a key the app refuses is renewed once and tried again. A renewal the
   * app refuses (invalid_grant, or no way to renew) signs the account out: the apps say such a
   * refusal is final. A renewal holds the account's row: Notion and Todoist take each refresh key
   * once, so of two servers (or calls) renewing at once the second waits and takes the first's new
   * key instead of being refused (D-15).
   */
  async function withKey(reach, accountId, options, work) {
    const account = await accounts.reachableAccount(reach, accountId, options, { tokens: true });
    const plugin = pluginOf(account.pluginId);
    if (!plugin?.mcp) {
      throw new ConnectionError(400, `${plugin?.name || "That app"} has its own tools, not a connection point.`, {
        code: "integrations_connector_not_connector",
        params: { app: plugin?.name || account.pluginId }
      });
    }
    if (!account.tokens || account.status !== "connected") throw notConnected(account, plugin);
    const provider = await connector.provider(plugin, options);
    let tokens = opened(account.tokens);
    const renew = async () => {
      const used = tokens.access;
      const renewed = await accounts.withLockedAccount(account, options, async (locked, txOptions) => {
        if (!locked?.tokens || locked.status !== "connected") return { refused: notConnected(account, plugin) };
        const current = opened(locked.tokens);
        // Renewed meanwhile by another server or call: its key is the one to use.
        if (current.access !== used && fresh(current)) return { tokens: current };
        if (!current.refresh) return { refused: await signedOutByApp(account, plugin, txOptions) };
        try {
          const next = await oauthClient.refresh(provider, current);
          await accounts.patchAccount(account, { tokens: sealed(next) }, txOptions);
          return { tokens: next };
        } catch (error) {
          if (error?.error === "invalid_grant" || error?.error === "invalid_client") return { refused: await signedOutByApp(account, plugin, txOptions) };
          throw new ConnectionError(502, `${plugin.name} didn't renew the sign-in. Try again in a few minutes.`, {
            code: "integrations_connector_renewal_failed",
            params: { app: plugin.name }
          });
        }
      });
      if (renewed.refused) throw renewed.refused;
      tokens = renewed.tokens;
    };
    if (!fresh(tokens)) await renew();
    try {
      return await work(plugin, tokens.access, account);
    } catch (error) {
      if (!(error instanceof ConnectorAuthError)) throw error;
    }
    await renew();
    try {
      return await work(plugin, tokens.access, account);
    } catch (error) {
      if (error instanceof ConnectorAuthError) throw await signedOutByApp(account, plugin, options);
      throw error;
    }
  }

  /**
   * The app's actions for one account: `{ name, title, description, inputSchema, annotations }`, as
   * the app lists them, kept for a few minutes.
   */
  function tools(reach, accountId, options) {
    return withKey(reach, accountId, options, async (plugin, access, account) => {
      const kept = toolLists.get(account.id);
      if (kept && kept.at > Date.now() - TOOLS_MINUTES * 60000) return kept.tools;
      const listed = await connector.tools(plugin, access);
      toolLists.set(account.id, { at: Date.now(), tools: listed });
      await connector.storeTools(plugin.id, listed, options).catch(() => {});
      return listed;
    });
  }

  /** Runs one of the app's actions as the account: what the app answered (`content`, `isError`). */
  function call(reach, accountId, name, input, options) {
    return withKey(reach, accountId, options, (plugin, access) => connector.call(plugin, access, name, input));
  }

  /** On disconnecting: the app withdraws its own permission too, where it offers that. */
  async function withdraw(account, options) {
    toolLists.delete(account.id);
    const plugin = pluginOf(account.pluginId);
    if (!account.tokens || !plugin?.mcp) return;
    const tokens = opened(account.tokens);
    await connector.provider(plugin, options)
      .then((provider) => oauthClient.revoke(provider, tokens.refresh || tokens.access))
      .catch((error) => console.warn(`Withdrawing the ${plugin.name} sign-in at the app failed; it is removed here anyway.`, error?.message || error));
  }

  return Object.freeze({
    signedIn,
    tools,
    call,
    withdraw
  });
}
