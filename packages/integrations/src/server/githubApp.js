import { createPrivateKey, createSign } from "node:crypto";
import { ConnectionError, isLocal } from "./oauth.js";

// This copy's GitHub App (D-128): the app people install on their GitHub accounts, choosing its repositories there, and
// sign in to (user-to-server). Signing in gives Mercbot a person's own key, which sees only what both the person and
// the app can reach. A bot's command that works on one repository gets a key of the app's for that repository alone
// (an installation access token, narrowed with `repository_ids` and `permissions`, lasting at most an hour), made here
// with the app's private key, which never leaves this server. The app comes from Env: <ENV>_APP_ID, <ENV>_APP_SLUG and
// <ENV>_APP_PRIVATE_KEY (PEM) beside <ENV>_CLIENT_ID and <ENV>_CLIENT_SECRET, its own client, or the <ENV>_TEST_ ones
// while this copy's public address is a local one (oauth.js credentials).

export const GITHUB_API = "https://api.github.com";
export const GITHUB_WEB = "https://github.com";

/** What a command's key may do in a repository the person can push to: no Workflows, nothing of the account's. */
export const WRITE_PERMISSIONS = Object.freeze({
  contents: "write",
  pull_requests: "write",
  issues: "write",
  actions: "read",
  checks: "read",
  statuses: "read",
  metadata: "read"
});
/** The same, read only, in a repository the person can only read: a key never does more than its person may. */
export const READ_PERMISSIONS = Object.freeze({
  contents: "read",
  pull_requests: "read",
  issues: "read",
  actions: "read",
  checks: "read",
  statuses: "read",
  metadata: "read"
});

/** A repository as people name it, owner/name. */
export const REPOSITORY_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;

/** How many pages of 100 repositories one search reads at most before it answers with where to go on. */
const SEARCH_PAGES = 5;
/** How many of a person's installations are read at most (100 a page). */
const INSTALLATION_PAGES = 3;

/**
 * Where something with the GitHub App went wrong, for the person or the bot: a sentence and its code.
 */
export class GithubAppError extends ConnectionError {}

/**
 * This copy's GitHub App, or null when it has none: `{ id, slug, privateKey }`. A key entered with its line breaks as
 * \n is taken as the PEM it stands for.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function githubAppSettings(env) {
  const pick = (prefix) => {
    const id = String(env[`${prefix}_APP_ID`] || "").trim();
    const slug = String(env[`${prefix}_APP_SLUG`] || "").trim();
    const key = String(env[`${prefix}_APP_PRIVATE_KEY`] || "").trim();
    if (!id || !slug || !key) return null;
    return { id, slug, privateKey: key.includes("\n") ? key : key.replace(/\\n/gu, "\n") };
  };
  return (isLocal(env) && pick("GITHUB_TEST")) || pick("GITHUB");
}

const base64url = (value) => Buffer.from(value).toString("base64url");

/**
 * The app's own short proof (a JWT, RS256), for asking GitHub about installations and making keys: issued a minute in
 * the past for clocks that differ, good for nine minutes.
 * @param {{ id: string, privateKey: string }} settings
 * @param {number} [now]
 */
export function appProof(settings, now = Date.now()) {
  let key;
  try {
    key = createPrivateKey(settings.privateKey);
  } catch {
    throw new GithubAppError(503, "This copy's GitHub App key isn't a private key (GITHUB_APP_PRIVATE_KEY, in PEM).", {
      code: "integrations_github_app_key_invalid"
    });
  }
  const issued = Math.floor(now / 1000) - 60;
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ iat: issued, exp: issued + 540, iss: /^\d+$/u.test(settings.id) ? Number(settings.id) : settings.id }));
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url");
  return `${head}.${body}.${signature}`;
}

/** An installation as Mercbot keeps it: its id, the account it's on, and whether it has all its repositories. */
const asInstallation = (entry) => ({
  id: String(entry.id),
  account: String(entry.account?.login || ""),
  accountType: entry.account?.type === "Organization" ? "organisation" : "person",
  all: entry.repository_selection === "all"
});

/** A repository as the card and the bots see it: may the person push to it (their own access, not the app's)? */
const asRepository = (entry) => ({
  id: String(entry.id),
  fullName: String(entry.full_name),
  private: Boolean(entry.private),
  write: Boolean(entry.permissions?.push || entry.permissions?.maintain || entry.permissions?.admin),
  defaultBranch: entry.default_branch ? String(entry.default_branch) : null
});

/** A search's place, to go on from: the account, its installation, the page, and the entry in it. */
const encodeAfter = (place) => base64url(JSON.stringify(place));
function decodeAfter(after) {
  if (!after) return [0, 0, 1, 0];
  try {
    const place = JSON.parse(Buffer.from(String(after), "base64url").toString("utf8"));
    if (Array.isArray(place) && place.length === 4 && place.every((part) => Number.isInteger(part) && part >= 0)) return place;
  } catch {
    // An address someone changed: start again.
  }
  return [0, 0, 1, 0];
}

/**
 * GitHub's side of the app. Requests with a person's key go through that key's own `fetch` (its Request pace, D-96);
 * the app's own requests (installations, keys, withdrawing a key) aren't paced, as making a key isn't (appRequests.js).
 * `api` and `web` are GitHub's addresses, a stand-in's in tests and a Test Preview (IntegrationsFeature standInGithub).
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env
 * @param {string} [options.api]
 * @param {string} [options.web]
 * @param {typeof fetch} [options.fetch] the app's own requests
 */
export function createGithubApp({ env, api = GITHUB_API, web = GITHUB_WEB, fetch: fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const settings = () => githubAppSettings(env);

  function ready() {
    const found = settings();
    if (!found) {
      throw new GithubAppError(409, "GitHub for bots' commands isn't set up on this copy of Mercbot (its GitHub App).", {
        code: "integrations_github_app_unset"
      });
    }
    return found;
  }

  async function call(path, { token, fetchWith = fetchImpl, method = "GET", body } = {}) {
    const response = await fetchWith(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "Mercbot",
        ...(body ? { "content-type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000)
    });
    const answer = response.status === 204 ? {} : await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body: answer };
  }

  const refused = (what, answer) =>
    new GithubAppError(502, `GitHub didn't ${what} (${answer.status}${answer.body?.message ? `: ${String(answer.body.message).slice(0, 200)}` : ""}).`, {
      code: "integrations_github_refused",
      params: { status: answer.status }
    });

  /**
   * The app's installations a person's key reaches: on their own account and the organisations they're in.
   * @param {{ token: string, fetch: typeof fetch }} key the person's key (connections.accessToken)
   */
  async function installations(key) {
    const found = [];
    for (let page = 1; page <= INSTALLATION_PAGES; page += 1) {
      const answer = await call(`/user/installations?per_page=100&page=${page}`, { token: key.token, fetchWith: key.fetch });
      if (answer.status === 401) throw signInAgain();
      if (!answer.ok) throw refused("list where Mercbot's GitHub App is installed", answer);
      const entries = answer.body.installations || [];
      found.push(...entries.map(asInstallation));
      if (entries.length < 100) break;
    }
    return found;
  }

  /**
   * A page of the repositories one or more of a person's keys reach through the app, whose owner/name holds `words`
   * (any case), in GitHub's order: `{ repositories, next }`, `next` the place to go on from (null after the last). It
   * reads at most a few pages of GitHub's lists per call, so a person with thousands of repositories gets an answer at
   * once, with `next` to look further.
   * @param {Array<{ token: string, fetch: typeof fetch }>} keys
   * @param {{ words?: string, after?: string | null, size?: number, installationsOf?: (keyIndex: number) => Promise<object[]> }} search
   */
  async function searchRepositories(keys, { words = "", after = null, size = 20, installationsOf = (index) => installations(keys[index]) }) {
    const wanted = String(words || "").trim().toLowerCase();
    let [keyIndex, installIndex, page, offset] = decodeAfter(after);
    const repositories = [];
    let read = 0;
    let installs = keyIndex < keys.length ? await installationsOf(keyIndex) : [];
    while (keyIndex < keys.length && read < SEARCH_PAGES) {
      if (installIndex >= installs.length) {
        keyIndex += 1;
        installIndex = 0;
        page = 1;
        offset = 0;
        installs = keyIndex < keys.length ? await installationsOf(keyIndex) : [];
        continue;
      }
      const answer = await call(`/user/installations/${installs[installIndex].id}/repositories?per_page=100&page=${page}`, {
        token: keys[keyIndex].token,
        fetchWith: keys[keyIndex].fetch
      });
      read += 1;
      if (answer.status === 401) throw signInAgain();
      if (!answer.ok) throw refused("list the repositories Mercbot's GitHub App reaches", answer);
      const entries = answer.body.repositories || [];
      for (let index = offset; index < entries.length; index += 1) {
        if (wanted && !String(entries[index].full_name).toLowerCase().includes(wanted)) continue;
        repositories.push(asRepository(entries[index]));
        if (repositories.length === size) {
          const more = index + 1 < entries.length;
          // The next page starts after this entry, at this list's next page, or at the next installation.
          const nextList = entries.length < 100 ? [keyIndex, installIndex + 1, 1, 0] : [keyIndex, installIndex, page + 1, 0];
          const place = more ? [keyIndex, installIndex, page, index + 1] : nextList;
          return { repositories, next: encodeAfter(place) };
        }
      }
      offset = 0;
      if (entries.length < 100) {
        installIndex += 1;
        page = 1;
      } else {
        page += 1;
      }
    }
    return { repositories, next: keyIndex < keys.length ? encodeAfter([keyIndex, installIndex, page, offset]) : null };
  }

  /**
   * One repository as a person's key sees it through the app, or null when it doesn't (no such repository, the person
   * can't see it, or the app isn't installed on it).
   * @param {{ token: string, fetch: typeof fetch }} key
   * @param {string} fullName owner/name
   */
  async function repository(key, fullName) {
    if (!REPOSITORY_NAME.test(String(fullName))) return null;
    const answer = await call(`/repos/${fullName}`, { token: key.token, fetchWith: key.fetch });
    if (answer.status === 401) throw signInAgain();
    if (answer.status === 404 || answer.status === 403 || answer.status === 301) return null;
    if (!answer.ok) throw refused(`find ${fullName}`, answer);
    return asRepository(answer.body);
  }

  /**
   * A key of the app's for one repository alone (`repository`, as `repository()` found it with the person's key), with
   * what the person may do there: WRITE_PERMISSIONS where they can push, READ_PERMISSIONS otherwise. GitHub's answer is
   * checked: a key for anything but that one repository is withdrawn and refused.
   * @param {{ id: string, fullName: string, write: boolean }} repo
   * @returns {Promise<{ token: string, expiresAt: string, permissions: Record<string, string>, repository: string }>}
   */
  async function repositoryKey(repo) {
    const app = ready();
    const proof = appProof(app);
    const installation = await call(`/repos/${repo.fullName}/installation`, { token: proof });
    if (installation.status === 404) {
      throw new GithubAppError(409, `Mercbot's GitHub App isn't installed on ${repo.fullName}'s account on GitHub.`, {
        code: "integrations_github_not_installed",
        params: { repository: repo.fullName }
      });
    }
    if (!installation.ok) throw refused(`find Mercbot's GitHub App's installation for ${repo.fullName}`, installation);
    const permissions = repo.write ? WRITE_PERMISSIONS : READ_PERMISSIONS;
    const made = await call(`/app/installations/${installation.body.id}/access_tokens`, {
      token: proof,
      method: "POST",
      body: { repository_ids: [Number(repo.id)], permissions }
    });
    if (!made.ok || !made.body.token) throw refused(`make a key for ${repo.fullName}`, made);
    const reaches = (made.body.repositories || []).map((entry) => String(entry.id));
    if (reaches.length !== 1 || reaches[0] !== String(repo.id)) {
      await revoke(made.body.token).catch(() => {});
      throw new GithubAppError(502, `GitHub made a key for more than ${repo.fullName}, so it was withdrawn.`, {
        code: "integrations_github_key_too_wide"
      });
    }
    return { token: String(made.body.token), expiresAt: String(made.body.expires_at || ""), permissions: made.body.permissions || permissions, repository: repo.fullName };
  }

  /** Withdraws a key of the app's at GitHub (DELETE /installation/token, with the key itself), once its command ends. */
  async function revoke(token) {
    const answer = await call("/installation/token", { token, method: "DELETE" });
    if (!answer.ok && answer.status !== 401) throw refused("withdraw a command's key", answer);
  }

  /** Where a person installs the app on an account of theirs, or changes which repositories it has. */
  function installUrl() {
    const app = settings();
    return app ? `${web}/apps/${encodeURIComponent(app.slug)}/installations/new` : "";
  }

  /** The app's name on GitHub as commits by its keys show, `<slug>[bot]`, or "" without one. */
  function botLogin() {
    const app = settings();
    return app ? `${app.slug}[bot]` : "";
  }

  /** Whether the copy has its GitHub App's ID, name and private key. */
  function configured() {
    return Boolean(settings());
  }

  return Object.freeze({
    configured,
    installations,
    searchRepositories,
    repository,
    repositoryKey,
    revoke,
    installUrl,
    botLogin
  });
}

/** A person's key GitHub turned down: their sign-in needs doing again. */
export function signInAgain() {
  return new GithubAppError(409, "GitHub turned the person's sign-in down: sign in to GitHub again in Connect apps.", {
    code: "integrations_github_sign_in_again"
  });
}

/**
 * Whether a connected GitHub account was signed in through the GitHub App (a user-to-server key, `ghu_`), rather than
 * the OAuth app Mercbot used before D-128 (`gho_`), which keeps working for the reading tools until it's signed in
 * again. A stand-in's keys follow GitHub's.
 * @param {{ access?: string } | null | undefined} tokens the account's opened tokens
 */
export const signedInThroughApp = (tokens) => String(tokens?.access || "").startsWith("ghu_");
