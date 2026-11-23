import { GithubAppError, REPOSITORY_NAME, signedInThroughApp } from "./githubApp.js";

// A person's own GitHub, as bots' commands and a bot's card use it (D-128): only the GitHub accounts the person whose
// call it is connected in the call's home, signed in through the GitHub App. Every home's account is everyone's for
// the reading tools (D-111), but a key that pushes acts as its person, so a bot working for someone in a room uses that
// person's GitHub and never another's. The installations each account reaches are kept with its sealed keys
// (`installations`), read again whenever a search reads them, for Connect apps to show.

/**
 * @param {object} dependencies
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {{ accessToken: (accountId: string, options: object) => Promise<{ accessToken: string, fetch: typeof fetch }> }} dependencies.connections
 * @param {ReturnType<typeof import("./githubApp.js").createGithubApp>} dependencies.app
 * @param {(value: unknown) => object} dependencies.sealed
 * @param {(value: object) => any} dependencies.opened
 */
export function createGithubAccess({ accounts, connections, app, sealed, opened }) {
  const openedOrNull = (tokens) => {
    try {
      return tokens ? opened(tokens) : null;
    } catch {
      return null;
    }
  };

  /**
   * The call person's own connected GitHub accounts in the call's home: `app`, those signed in through the GitHub App,
   * and `before`, how many were signed in before it (D-128: they read, and push once signed in again).
   * @param {object} options
   */
  async function ownAccounts(options) {
    const person = String(accounts.personOf(options) ?? "");
    if (!person) return { app: [], before: 0 };
    const found = await accounts.reachable(options, { filters: { userId: person, pluginIds: ["github"], status: "connected" }, tokens: true });
    const through = found.filter((account) => signedInThroughApp(openedOrNull(account.tokens)));
    return { app: through, before: found.length - through.length };
  }

  /** Why the call's person can't use GitHub in commands yet, as a refusal, or null when they can. */
  function unusable({ app: through, before }) {
    if (!app.configured()) {
      return new GithubAppError(409, "GitHub for bots' commands isn't set up on this copy of Mercbot.", { code: "integrations_github_app_unset" });
    }
    if (through.length) return null;
    if (before) {
      return new GithubAppError(409, "Their GitHub was connected before bots could push: they sign in to GitHub again in Connect apps first.", {
        code: "integrations_github_sign_in_again"
      });
    }
    return new GithubAppError(409, "They haven't connected their own GitHub in this home.", { code: "integrations_github_not_connected" });
  }

  const keyOf = async (account, options) => {
    const { accessToken, fetch } = await connections.accessToken(account.id, options);
    return { token: accessToken, fetch };
  };

  /** Keeps what installations an account reaches with its keys, under its row lock (D-15). */
  async function keep(account, installations, options) {
    await accounts.withLockedAccount(account, options, async (locked, txOptions) => {
      const current = openedOrNull(locked?.tokens);
      if (!current) return;
      await accounts.patchAccount(account, { tokens: sealed({ ...current, installations }) }, txOptions);
    });
  }

  /**
   * A page of the call person's repositories that the app reaches, whose owner/name holds `words`, for a bot's card to
   * choose from (`next` goes on), and `installUrl`, where they add more on GitHub. Each account's installations are
   * read live and kept.
   * @param {object} options
   * @param {{ words?: string, after?: string | null }} [search]
   */
  async function repositories(options, { words = "", after = null } = {}) {
    const own = await ownAccounts(options);
    const refusal = unusable(own);
    if (refusal) throw refusal;
    const keys = await Promise.all(own.app.map((account) => keyOf(account, options)));
    const installationsOf = async (index) => {
      const found = await app.installations(keys[index]);
      await keep(own.app[index], found, options).catch((error) => console.warn(`Keeping a GitHub account's installations failed: ${error?.message}`));
      return found;
    };
    const page = await app.searchRepositories(keys, { words: String(words || "").slice(0, 100), after, installationsOf });
    return { ...page, installUrl: app.installUrl() };
  }

  /**
   * One repository the call person reaches through the app with one of their accounts: `{ repository, accountId }`, or
   * null when none of their accounts does.
   * @param {object} options
   * @param {string} fullName owner/name
   */
  async function repository(options, fullName) {
    const own = await ownAccounts(options);
    const refusal = unusable(own);
    if (refusal) throw refusal;
    if (!REPOSITORY_NAME.test(String(fullName || ""))) return null;
    for (const account of own.app) {
      const found = await app.repository(await keyOf(account, options), String(fullName));
      if (found) return { repository: found, accountId: account.id };
    }
    return null;
  }

  /**
   * A key for a command on one repository the call person reaches (`repository()`'s answer): the app's key for that
   * repository alone, doing no more there than the person may, for at most an hour; `revoke` withdraws it once the
   * command ends. The app's private key stays here.
   * @param {{ id: string, fullName: string, write: boolean }} found
   */
  async function commandKey(found) {
    const made = await app.repositoryKey(found);
    return { ...made, revoke: () => app.revoke(made.token) };
  }

  /**
   * What Connect apps shows of a connected GitHub account (D-128): for one signed in through the app, the accounts the
   * app is installed on, as last read, and where to choose its repositories on GitHub; for one signed in before it,
   * nothing (it shows as needing more access).
   * @param {{ pluginId: string, status: string, tokens?: object | null }} row
   */
  function shown(row) {
    if (row.pluginId !== "github" || row.status !== "connected" || !app.configured()) return null;
    const tokens = openedOrNull(row.tokens);
    if (!signedInThroughApp(tokens)) return null;
    const installations = Array.isArray(tokens.installations) ? tokens.installations : [];
    return {
      reaches: installations.map((entry) => ({ account: entry.account, all: Boolean(entry.all) })),
      chooseUrl: app.installUrl()
    };
  }

  /** Whether an account signed in before the GitHub App, now that this copy has one, needs signing in again to push. */
  function signedInBefore(row) {
    if (row.pluginId !== "github" || row.status !== "connected" || !row.tokens || !app.configured()) return false;
    const tokens = openedOrNull(row.tokens);
    return Boolean(tokens) && !signedInThroughApp(tokens);
  }

  /** Whether this copy has its GitHub App, so its bots' commands can sign in to GitHub. */
  function ready() {
    return app.configured();
  }

  /** Where a person installs the App on GitHub and chooses its repositories. */
  function installUrl() {
    return app.installUrl();
  }

  /** The App's name on GitHub as its commits show it, `<slug>[bot]`. */
  function botLogin() {
    return app.botLogin();
  }

  return Object.freeze({
    ready,
    installUrl,
    botLogin,
    ownAccounts,
    unusable,
    repositories,
    repository,
    commandKey,
    keep,
    shown,
    signedInBefore
  });
}
