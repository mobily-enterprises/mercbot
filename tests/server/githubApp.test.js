import assert from "node:assert/strict";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { GITHUB_CARD, GITHUB_OPTIONS, githubCard, githubEnv } from "../../packages/bots/src/server/githubCommands.js";
import { secretMask } from "../../packages/files/src/server/secretMask.js";
import { READ_PERMISSIONS, WRITE_PERMISSIONS, appProof, createGithubApp, githubAppSettings, signedInThroughApp } from "../../packages/integrations/src/server/githubApp.js";

// a copy's GitHub App (D-128), against a stand-in for GitHub's API (no request leaves this process): the
// app's proof, a command's key made for one repository alone and withdrawn, the person's repositories searched a page
// at a time, a command's key hidden in its output, and the variables a command signed in to GitHub runs with.

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const ENV = Object.freeze({ APP_PUBLIC_URL: "https://mercbot.example", GITHUB_APP_ID: "1234567", GITHUB_APP_SLUG: "my-mercbot", GITHUB_APP_PRIVATE_KEY: PEM });
const API = "https://api.github.test";

/** GitHub's API as `routes` answers it, `[status, body]` by "METHOD path": every request is kept, with its proof. */
function standInGithub(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const { pathname, search } = new URL(String(url));
    const method = init.method || "GET";
    calls.push({ method, path: `${pathname}${search}`, authorization: init.headers?.authorization || "", body: init.body ? JSON.parse(init.body) : null });
    const answer = routes[`${method} ${pathname}${search}`] ?? routes[`${method} ${pathname}`];
    const [status, body] = typeof answer === "function" ? answer(calls.at(-1)) : answer || [404, { message: "Not Found" }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  return { calls, app: createGithubApp({ env: ENV, api: API, fetch }), fetch };
}

/** A JWT's parts, its signature checked with the app's public key. */
function opened(jwt) {
  const [head, body, signature] = jwt.split(".");
  const verified = createVerify("RSA-SHA256").update(`${head}.${body}`).verify(createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(signature, "base64url"));
  return { verified, head: JSON.parse(Buffer.from(head, "base64url")), body: JSON.parse(Buffer.from(body, "base64url")) };
}

test("the app comes from Env, its key in PEM or with \\n for line breaks, and the test pair while the copy is local", () => {
  assert.equal(githubAppSettings({}), null, "no app without its three settings");
  assert.equal(githubAppSettings({ GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "x" }), null);
  assert.deepEqual(githubAppSettings(ENV), { id: "1234567", slug: "my-mercbot", privateKey: PEM.trim() });
  assert.equal(githubAppSettings({ ...ENV, GITHUB_APP_PRIVATE_KEY: PEM.trim().replace(/\n/gu, "\\n") }).privateKey, PEM.trim());
  const testApp = { GITHUB_TEST_APP_ID: "9", GITHUB_TEST_APP_SLUG: "mercbot-test", GITHUB_TEST_APP_PRIVATE_KEY: PEM };
  assert.equal(githubAppSettings({ ...ENV, ...testApp, APP_PUBLIC_URL: "http://localhost:4000" }).slug, "mercbot-test");
  assert.equal(githubAppSettings({ ...ENV, ...testApp }).slug, "my-mercbot", "a copy at a public address uses its own app");
  assert.equal(signedInThroughApp({ access: "ghu_abc" }), true);
  assert.equal(signedInThroughApp({ access: "gho_abc" }), false, "a sign-in through the OAuth app before D-128");
});

test("the app's proof is a JWT signed with its key, issued by its id, good for under ten minutes", () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const proof = opened(appProof({ id: "1234567", privateKey: PEM }, now));
  assert.equal(proof.verified, true);
  assert.deepEqual(proof.head, { alg: "RS256", typ: "JWT" });
  assert.equal(proof.body.iss, 1234567);
  assert.equal(proof.body.iat, now / 1000 - 60, "a minute early, for clocks that differ");
  assert.ok(proof.body.exp - proof.body.iat <= 600, "GitHub refuses one good for more than ten minutes");
  assert.throws(() => appProof({ id: "1", privateKey: "not a key" }), { code: "integrations_github_app_key_invalid" });
});

test("a command's key is for its one repository, with no more than its person may do there, and no Workflows", async () => {
  const github = standInGithub({
    "GET /repos/pat/site/installation": [200, { id: 77 }],
    "POST /app/installations/77/access_tokens": (call) => [201, {
      token: "ghs_onlysite", expires_at: "2026-11-23T13:00:00Z", permissions: call.body.permissions,
      repositories: call.body.repository_ids.map((id) => ({ id, full_name: "pat/site" }))
    }],
    "DELETE /installation/token": [204, null]
  });
  const key = await github.app.repositoryKey({ id: "101", fullName: "pat/site", write: true });
  assert.equal(key.token, "ghs_onlysite");
  const made = github.calls.find((call) => call.method === "POST");
  assert.deepEqual(made.body.repository_ids, [101], "narrowed to the one repository");
  assert.deepEqual(made.body.permissions, WRITE_PERMISSIONS);
  assert.equal(made.body.permissions.workflows, undefined, "never Workflows");
  assert.equal(opened(made.authorization.replace(/^Bearer /u, "")).verified, true, "made with the app's own proof");
  // A person who can only read gets a key that only reads.
  await github.app.repositoryKey({ id: "101", fullName: "pat/site", write: false });
  assert.deepEqual(github.calls.filter((call) => call.method === "POST")[1].body.permissions, READ_PERMISSIONS);
  // Withdrawn with itself, once its command ends.
  await github.app.revoke(key.token);
  assert.deepEqual(github.calls.at(-1), { method: "DELETE", path: "/installation/token", authorization: "Bearer ghs_onlysite", body: null });
});

test("a key GitHub makes for more than the one repository is withdrawn and refused; an uninstalled one is refused", async () => {
  const github = standInGithub({
    "GET /repos/pat/site/installation": [200, { id: 77 }],
    "POST /app/installations/77/access_tokens": [201, { token: "ghs_toowide", repositories: [{ id: 101 }, { id: 102 }] }],
    "DELETE /installation/token": [204, null],
    "GET /repos/pat/gone/installation": [404, { message: "Not Found" }]
  });
  await assert.rejects(github.app.repositoryKey({ id: "101", fullName: "pat/site", write: true }), { code: "integrations_github_key_too_wide" });
  assert.equal(github.calls.at(-1).authorization, "Bearer ghs_toowide", "the wide key was withdrawn");
  await assert.rejects(github.app.repositoryKey({ id: "103", fullName: "pat/gone", write: true }), { code: "integrations_github_not_installed" });
  assert.equal(github.calls.filter((call) => call.method === "POST").length, 1, "no key asked for an uninstalled one");
  await assert.rejects(createGithubApp({ env: {}, api: API, fetch: github.fetch }).repositoryKey({ id: "101", fullName: "pat/site" }), { code: "integrations_github_app_unset" });
});

test("a search reads the person's repositories a few pages at a time, on the server, and goes on from where it stopped", async () => {
  const repo = (index, owner = "pat") => ({ id: index, full_name: `${owner}/repo-${index}`, private: index % 2 === 0, permissions: { push: index % 3 !== 0 } });
  const pages = { 1: Array.from({ length: 100 }, (_, index) => repo(index + 1)), 2: Array.from({ length: 30 }, (_, index) => repo(index + 101)) };
  const github = standInGithub({
    "GET /user/installations?per_page=100&page=1": [200, { installations: [{ id: 5, account: { login: "pat", type: "User" }, repository_selection: "all" }, { id: 6, account: { login: "acme", type: "Organization" }, repository_selection: "selected" }] }],
    "GET /user/installations/5/repositories?per_page=100&page=1": [200, { repositories: pages[1] }],
    "GET /user/installations/5/repositories?per_page=100&page=2": [200, { repositories: pages[2] }],
    "GET /user/installations/6/repositories?per_page=100&page=1": [200, { repositories: [repo(900, "acme")] }]
  });
  const key = { token: "ghu_pat", fetch: github.fetch };
  const first = await github.app.searchRepositories([key], { size: 20 });
  assert.deepEqual(first.repositories.map((entry) => entry.fullName), Array.from({ length: 20 }, (_, index) => `pat/repo-${index + 1}`));
  assert.deepEqual(first.repositories[2], { id: "3", fullName: "pat/repo-3", private: false, write: false, defaultBranch: null });
  assert.ok(first.next);
  const reads = github.calls.length;
  const second = await github.app.searchRepositories([key], { size: 20, after: first.next });
  assert.equal(second.repositories[0].fullName, "pat/repo-21", "the next page starts where the first stopped");
  assert.equal(github.calls.length - reads, 2, "it read its installations and the one page of GitHub's it goes on in");
  // A name searched for: GitHub has no search of an installation's repositories, so the server filters each page.
  const found = await github.app.searchRepositories([key], { words: "REPO-12" });
  assert.deepEqual(found.repositories.map((entry) => entry.fullName), ["pat/repo-12", ...Array.from({ length: 10 }, (_, index) => `pat/repo-${120 + index}`)]);
  assert.equal(found.next, null, "every installation was read");
  const acme = await github.app.searchRepositories([key], { words: "acme/" });
  assert.deepEqual(acme.repositories.map((entry) => entry.fullName), ["acme/repo-900"]);
  assert.equal(github.calls.every((call) => call.authorization === "Bearer ghu_pat"), true, "only the person's own key reads their repositories");
});

test("a command's key never shows in its output, nor git's form of it, even split across pieces", () => {
  const token = "ghs_16C7e42F292c6912E7710c838347Ae178B4a";
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const mask = secretMask([token]);
  const text = `cloning with ${token}\nAuthorization: Basic ${basic}\nkey=${token}`;
  let shown = "";
  for (let at = 0; at < text.length; at += 7) shown += mask.add(text.slice(at, at + 7));
  shown += mask.flush();
  assert.equal(shown, "cloning with ***\nAuthorization: Basic ***\nkey=***");
  assert.equal(secretMask([]).add("nothing to hide"), "nothing to hide", "without a key, output goes through as it is");
  const held = secretMask([token]);
  assert.equal(held.add("ok\n") + held.flush(), "ok\n", "what was held back comes out at the end");
});

test("a command signed in to GitHub has gh's key and git's way to it, and nothing else of the app's", () => {
  const env = githubEnv("ghs_key", { name: "Ada\n<evil>", login: "my-mercbot[bot]" });
  const value = (name) => env.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
  assert.equal(value("GH_TOKEN"), "ghs_key");
  assert.equal(value("GIT_TERMINAL_PROMPT"), "0");
  assert.equal(value("GIT_CONFIG_KEY_0"), "credential.https://github.com.helper");
  assert.match(value("GIT_CONFIG_VALUE_0"), /^!f\(\) \{ test "\$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "\$GH_TOKEN"; \}; f$/u);
  assert.equal(value("GIT_AUTHOR_NAME"), "Ada  evil", "a bot's name can't break a commit's author line");
  assert.equal(value("GIT_AUTHOR_EMAIL"), "my-mercbot[bot]@users.noreply.github.com");
  assert.ok(env.every((entry) => !entry.includes("PRIVATE KEY") && !entry.startsWith("GITHUB_APP")), "the app's own key never enters a sandbox");
  const card = githubCard("Ada", { id: "101", fullName: "pat/site", write: true, private: true });
  assert.equal(card.body.question, "Let Ada use pat/site?");
  assert.deepEqual(card.body.options, ["Just this task", "Always for this bot", "No"]);
  assert.deepEqual([card.body.purpose, GITHUB_OPTIONS.length], [GITHUB_CARD, 3]);
});
