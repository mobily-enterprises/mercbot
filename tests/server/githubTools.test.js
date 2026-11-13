import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { GITHUB_ACTIONS, buildGithubTools } from "../../packages/bots/src/server/githubTools.js";

// The rest of the person's GitHub (D-42), against a stand-in for GitHub's API.
function fakeGithub(context, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: decodeURIComponent(String(url)), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    const match = Object.entries(routes).find(([pattern]) => {
      const [method, part] = /^(GET|POST|PUT|PATCH|DELETE) /u.test(pattern) ? [pattern.split(" ")[0], pattern.slice(pattern.indexOf(" ") + 1)] : ["", pattern];
      return (!method || method === (options.method || "GET")) && decodeURIComponent(String(url)).includes(part);
    });
    const [status, body] = match ? match[1] : [404, { message: "Not Found" }];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

const integrations = {
  reachableAccounts: async () => [{ id: "4", pluginId: "github", name: "", label: "pat", status: "connected" }],
  connections: { accessToken: async () => ({ accessToken: "gh-key" }) }
};
const shared = {
  appFor: () => ({ integrations, reach: { userId: 7 } }),
  failed: (error) => ({ error: error.message }),
  statusLine: z.string().optional(),
  personAsked: z.boolean().optional(),
  inTime: (work) => work,
  untrusted: (text) => `<<${text}>>`
};

test("reads: a file's text, a failed run's log, a pull request's changes, guarded as information", async (context) => {
  const calls = fakeGithub(context, {
    "/repos/pat/app/contents/src/main.js?ref=dev": [200, { path: "src/main.js", size: 9, content: Buffer.from("run();").toString("base64"), html_url: "https://github.com/pat/app/blob/dev/src/main.js" }],
    "/actions/runs/77/jobs": [200, { jobs: [{ id: 5, name: "test", conclusion: "failure", steps: [{ name: "npm test", conclusion: "failure" }] }] }],
    "/actions/jobs/5/logs": [200, "1 failing"],
    "/pulls/12/files": [200, [{ filename: "a.js", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1 @@" }]]
  });
  const attempted = [];
  const tools = buildGithubTools({ ...shared, attempt: async () => ({}), attempted, removed: [] });
  const file = await tools.githubCode.execute({ action: "file", repo: "pat/app", path: "src/main.js", branch: "dev" });
  assert.equal(file.result.text, "<<run();>>");
  const logs = await tools.githubCode.execute({ action: "run_logs", repo: "pat/app", runId: 77 });
  assert.deepEqual(logs.result.jobs, [{ name: "test", result: "failure", failedSteps: ["npm test"] }]);
  assert.equal(logs.result.logOfFailedJob, "<<1 failing>>");
  const diff = await tools.githubPulls.execute({ action: "diff", repo: "pat/app", number: 12 });
  assert.equal(diff.result[0].patch, "<<@@ -1 +1 @@>>");
  assert.deepEqual(attempted, ["github_code", "github_code", "github_pulls"]);
  assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/")));
  assert.match((await tools.githubCode.execute({ action: "branches" })).error, /owner\/name/u);
});

test("changes go through approvals, ask unless the person asked, and say what changed", async (context) => {
  const calls = fakeGithub(context, {
    "GET /repos/pat/app/git/ref/heads/main": [200, { object: { sha: "abc123" } }],
    "GET /repos/pat/app": [200, { default_branch: "main" }],
    "POST /repos/pat/app/git/refs": [201, { ref: "refs/heads/fix" }],
    "PUT /repos/pat/app/pulls/12/merge": [200, { merged: true, message: "Pull Request successfully merged" }]
  });
  const asked = [];
  const tools = buildGithubTools({ ...shared, attempt: async (id, args) => { asked.push([id, args.personAsked]); return { status: "done" }; }, attempted: [], removed: [] });
  await tools.githubChange.execute({ action: "pr_merge", repo: "pat/app", number: 12, personAsked: true });
  assert.match((await tools.githubChange.execute({ action: "issue_create", repo: "pat/app" })).error, /Give title/u);
  assert.deepEqual(asked, [["github_change.pr_merge", true]]);
  assert.equal(GITHUB_ACTIONS["github_change.pr_merge"].reversible({ personAsked: false }), false, "a change the bot thought of asks first");

  // The live copy's changes (a test copy's merge is only logged, D-69: testCopySends.test.js).
  const context2 = { integrations, reach: { userId: 7 }, env: { SIDE_EFFECTS: "live" } };
  const branch = await GITHUB_ACTIONS["github_change.branch_create"].run(context2, { repo: "pat/app", name: "fix" });
  assert.equal(branch.body.text, "Made the branch fix in pat/app from main");
  assert.deepEqual(calls.find((call) => call.method === "POST").body, { ref: "refs/heads/fix", sha: "abc123" });
  const merged = await GITHUB_ACTIONS["github_change.pr_merge"].run(context2, { repo: "pat/app", number: 12, method: "squash" });
  assert.equal(merged.body.text, "Merged pull request pat/app#12");
  assert.deepEqual(calls.at(-1).body, { merge_method: "squash" });
});

test("each GitHub action is its own switch", () => {
  const tools = buildGithubTools({ ...shared, attempt: async () => ({}), attempted: [], removed: ["github_change.pr_merge", "github_find.code", "github_find.repos", "github_find.commits", "github_find.users", "github_find.orgs"] });
  assert.equal(tools.githubFind, undefined, "every search action off: no search tool");
  assert.equal(tools.githubChange.inputSchema.shape.action.options.includes("pr_merge"), false);
  assert.equal(tools.githubChange.inputSchema.shape.action.options.length, 17);
  assert.deepEqual(Object.keys(tools), ["githubCode", "githubPulls", "githubIssues", "githubDiscussions", "githubChange"]);
});
