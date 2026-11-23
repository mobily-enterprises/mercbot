import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import test from "node:test";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { separateHome } from "./testHome.js";
import { seal, unseal } from "../../packages/account/src/server/vaultCrypto.js";
import { auditEventResource } from "../../packages/apps/src/server/tableResources.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { createGithubApp } from "../../packages/integrations/src/server/githubApp.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { PROVIDERS, createOAuth } from "../../packages/integrations/src/server/oauth.js";

// A person's own GitHub for bots' commands (D-128), against the disposable test database with real connected
// accounts, and a stand-in for GitHub's API (no request leaves this process): only the GitHub account the call's
// person connected in the home, signed in through the GitHub App, is used, never another person's, though every
// home account is everyone's for the reading tools (D-111); one signed in before the app reads as before, needs
// signing in again to push, and says so; and where the app is installed is kept with the account's keys.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const VAULT = randomBytes(32).toString("base64");
const VAULT_KEY = Buffer.from(VAULT, "base64");
const API = "https://api.github.test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const APP_ENV = Object.freeze({
  APP_PUBLIC_URL: "https://mercbot.example",
  MERCBOT_VAULT_KEY: VAULT,
  GITHUB_CLIENT_ID: "Iv23-app-client",
  GITHUB_CLIENT_SECRET: "app-secret",
  GITHUB_APP_ID: "1234567",
  GITHUB_APP_SLUG: "my-mercbot",
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" })
});
const catalogue = [{ id: "github", name: "GitHub", oauth: { provider: "github", scopes: ["repo"] } }];

/**
 * GitHub's API for its stand-in people: each person's key sees their own repositories, and the app's own proof makes
 * keys. Every request is kept, with the key it was made with.
 */
function standInGithub(context) {
  const calls = [];
  const theirs = {
    ghu_ann: { installations: [{ id: 5, account: { login: "ann", type: "User" }, repository_selection: "selected" }], repos: { "ann/site": { id: 101, full_name: "ann/site", private: true, permissions: { push: true } } } },
    ghu_ben: { installations: [], repos: {} }
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const { origin, pathname } = new URL(String(url));
    assert.equal(origin, API, "nothing but the stand-in is asked");
    const method = init.method || "GET";
    const key = String(init.headers?.authorization || "").replace(/^Bearer /u, "");
    calls.push({ method, path: pathname, key: key.startsWith("ey") ? "app proof" : key });
    const send = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status });
    const person = theirs[key];
    if (method === "GET" && pathname === "/user/installations") return person ? send(200, { installations: person.installations }) : send(401, {});
    const listing = /^\/user\/installations\/(\d+)\/repositories$/u.exec(pathname);
    if (listing) return send(200, { repositories: person && person.installations.some((entry) => String(entry.id) === listing[1]) ? Object.values(person.repos) : [] });
    if (key.startsWith("ey") && pathname === "/repos/ann/site/installation") return send(200, { id: 5 });
    if (key.startsWith("ey") && method === "POST" && pathname === "/app/installations/5/access_tokens") {
      return send(201, { token: "ghs_command", expires_at: "2026-11-23T13:00:00Z", repositories: [{ id: 101 }] });
    }
    if (method === "DELETE" && pathname === "/installation/token") return send(204, null);
    const repo = /^\/repos\/([^/]+\/[^/]+)$/u.exec(pathname);
    if (repo && person) return person.repos[repo[1]] ? send(200, person.repos[repo[1]]) : send(404, { message: "Not Found" });
    return send(404, { message: "Not Found" });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

async function githubHome(context) {
  const knex = await connectTestDatabase();
  const stamp = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const people = (await knex("users").insert(["Ann", "Ben", "Carla"].map((name) => ({
    auth_provider: "test",
    auth_provider_user_sid: `${name}-${stamp}`,
    email: `${name.toLowerCase()}-${stamp}@example.com`,
    username: `${name.toLowerCase()}${stamp}`,
    display_name: name
  }))).returning("id")).map((row) => String(row.id));
  const [ann, ben, carla] = people;
  const homeId = await separateHome(knex, ann, [ben, carla]);
  context.after(async () => {
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").whereIn("id", people).del();
    await knex.destroy();
  });
  const calls = standInGithub(context);
  const { memberships, features } = await ownedHandles(knex, context, { "mercbot.integrations": INTEGRATIONS_OWNS, "mercbot.apps": [auditEventResource] });
  const { resources, systemContext } = features["mercbot.integrations"];
  const { auditEvents } = features["mercbot.apps"].resources;
  const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
  const connectionsOf = (env) => createConnections({
    resources,
    accounts,
    systemContext,
    isMember: async (home, memberId, options) => Boolean(await memberships.findActiveByWorkspaceIdAndUserId(home, memberId, passedOn(options))),
    recordActivity: (entry, options) => auditEvents.create(entry, { ...passedOn(options), returning: "none" }),
    catalogue,
    env,
    providers: { github: PROVIDERS.github },
    oauthClient: createOAuth({ env }),
    githubApp: createGithubApp({ env, api: API, web: "https://github.test" })
  });
  /** An account as Connect apps reads it (accounts.js): its app, status and sealed keys. */
  const asAccount = (row) => ({ id: String(row.id), pluginId: row.plugin_id, status: row.status, tokens: row.tokens });
  /** A GitHub account `userId` connected in the home, signed in with `access` (ghu_ through the app, gho_ before it). */
  const account = async (userId, access) => {
    const [row] = await knex("plugin_accounts").insert({
      user_id: userId,
      workspace_id: homeId,
      plugin_id: "github",
      name: `github-${randomBytes(4).toString("hex")}`,
      label: access.slice(4),
      status: "connected",
      connected_at: new Date(),
      tokens: seal({ access, ...(access.startsWith("ghu_") ? { refresh: `ghr_${access.slice(4)}`, expiresAt: Date.now() + 8 * 3600000, scope: "" } : { scope: "repo" }) }, VAULT_KEY)
    }).returning("*");
    return asAccount(row);
  };
  const as = (userId) => requestContextOptions({ user: { id: userId }, workspace: { id: homeId } });
  return { knex, ann, ben, carla, homeId, calls, connectionsOf, account, asAccount, as };
}

test("a bot's command uses the asker's own GitHub, never another person's in the home, and one from before the app says to sign in again", async (context) => {
  const f = await githubHome(context);
  const connections = f.connectionsOf(APP_ENV);
  const github = connections.github;
  const annsRow = await f.account(f.ann, "ghu_ann");
  const carlasRow = await f.account(f.carla, "gho_carla");

  // Ann reaches her repository with her own key, and a key is made for it alone.
  const found = await github.repository(f.as(f.ann), "ann/site");
  assert.deepEqual(found, { repository: { id: "101", fullName: "ann/site", private: true, write: true, defaultBranch: null }, accountId: annsRow.id });
  assert.deepEqual(f.calls.at(-1), { method: "GET", path: "/repos/ann/site", key: "ghu_ann" });
  const key = await github.commandKey(found.repository);
  assert.equal(key.token, "ghs_command");
  await key.revoke();
  assert.deepEqual(f.calls.at(-1), { method: "DELETE", path: "/installation/token", key: "ghs_command" });

  // Ben has no GitHub of his own here: Ann's account in the same home is never his to push with.
  const before = f.calls.length;
  await assert.rejects(github.repository(f.as(f.ben), "ann/site"), { statusCode: 409, code: "integrations_github_not_connected" });
  await assert.rejects(github.repositories(f.as(f.ben), {}), { code: "integrations_github_not_connected" });
  assert.equal(f.calls.length, before, "nothing was asked of GitHub for him, with anyone's key");
  // With his own, he reaches only what his own GitHub does.
  await f.account(f.ben, "ghu_ben");
  assert.equal(await github.repository(f.as(f.ben), "ann/site"), null);
  assert.deepEqual(f.calls.slice(before).map((call) => call.key), ["ghu_ben"]);

  // Carla signed in before the app: her account reads as before, shows as needing more access, and pushing asks her
  // to sign in again.
  await assert.rejects(github.repository(f.as(f.carla), "ann/site"), { code: "integrations_github_sign_in_again" });
  assert.equal(connections.lacksAccess(carlasRow), true, "Connect apps shows Sign in again");
  assert.equal(connections.lacksAccess(annsRow), false);
  assert.equal(f.connectionsOf({ ...APP_ENV, GITHUB_APP_PRIVATE_KEY: "" }).lacksAccess(carlasRow), false, "without the app, nothing changes for her");

  // A copy without its app offers none of it.
  const without = f.connectionsOf({ ...APP_ENV, GITHUB_APP_ID: "" }).github;
  assert.equal(without.ready(), false);
  await assert.rejects(without.repository(f.as(f.ann), "ann/site"), { code: "integrations_github_app_unset" });
});

test("a search reads the person's repositories where the app is installed, and keeps where that is for Connect apps", async (context) => {
  const f = await githubHome(context);
  const { github } = f.connectionsOf(APP_ENV);
  const row = await f.account(f.ann, "ghu_ann");
  assert.deepEqual(github.shown(row), { reaches: [], chooseUrl: "https://github.test/apps/my-mercbot/installations/new" }, "nowhere yet, as far as Mercbot knows");
  const page = await github.repositories(f.as(f.ann), { words: "SITE" });
  assert.deepEqual(page, {
    repositories: [{ id: "101", fullName: "ann/site", private: true, write: true, defaultBranch: null }],
    next: null,
    installUrl: "https://github.test/apps/my-mercbot/installations/new"
  });
  const kept = f.asAccount(await f.knex("plugin_accounts").where({ id: row.id }).first());
  assert.deepEqual(unseal(kept.tokens, VAULT_KEY).installations, [{ id: "5", account: "ann", accountType: "person", all: false }]);
  assert.equal(unseal(kept.tokens, VAULT_KEY).access, "ghu_ann", "her keys are kept as they were");
  assert.deepEqual(github.shown(kept), { reaches: [{ account: "ann", all: false }], chooseUrl: "https://github.test/apps/my-mercbot/installations/new" });
  assert.equal(github.shown({ ...kept, tokens: seal({ access: "gho_old" }, VAULT_KEY) }), null, "one from before the app shows none");
});
