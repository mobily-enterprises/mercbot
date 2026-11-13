import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { connectedKey, sendOrSimulate } from "./connectedApps.js";
import { CHANGES, READS, need } from "./githubActions.js";

// The rest of the person's GitHub (D-42), beyond searching issues, reading one, the
// week's activity and commenting: repositories, branches, commits, files and runs; pull requests'
// changes and reviews; issues, labels and sub-issues; searching code and more; discussions; and
// changing things. Each action is a line in a table below and its own switch in Connect apps
// ("github_change.pr_merge"). Every change shows to other people on GitHub, so it goes through
// approvals and asks first unless the person asked for exactly that.

const github = ({ integrations, reach, call }) => connectedKey({ integrations, reach, call }, "github", "GitHub");
// The other changes (branches, labels' own settings, an unsent review deleted) run in a test copy too.
const sendsNothing = () => null;

export const GITHUB_ACTIONS = Object.fromEntries(
  Object.entries(CHANGES).flatMap(([toolId, changes]) =>
    Object.entries(changes).map(([name, spec]) => [
      `${toolId}.${name}`,
      {
        reversible: (args) => args.personAsked,
        describe: (args) => `${spec.say(args)} on GitHub as the person`,
        question: (args) => `Shall I ${spec.say(args)}?`,
        async run(context, args) {
          const entry = await github(context);
          // What others follow on GitHub (issues, pull requests, merges, releases, reviews,
          // discussions and automation reruns) changes only in a live copy (D-69).
          const { sends = sendsNothing } = spec;
          const sent = sends(args);
          const done = await sendOrSimulate(
            context,
            sent ? { ...sent, details: { account: entry.account, ...sent.details } } : null,
            () => spec.run(entry.key, args),
            () => spec.simulated(entry.key, args)
          );
          return {
            kind: "event",
            role: "system",
            body: {
              text: done.text,
              detail: `${done.text}.${done.detail ? ` ${done.detail}` : ""}${done.link ? ` Link: ${done.link}` : ""}`
            },
            result: done
          };
        }
      }
    ]))
);

// The ids a reply must have called before it may say it changed something on GitHub.
export const GITHUB_CHANGES = Object.keys(GITHUB_ACTIONS);

const DESCRIPTIONS = {
  github_code:
    "Read the person's GitHub repositories (reads only): repos lists theirs; repo, branches, commits (of a branch, a path, since a date), commit (one, by sha or branch: ref), compare (base...head), file (its text, at a branch), tree (a folder), tags, releases, collaborators, runs (automation runs and results), run_logs (a run's jobs and the log of the failed one).",
  github_pulls:
    "Pull requests (reads only): list them in a repository (state open, closed or all); diff gives one's changed files with their changes; reviews gives its reviews and line comments. For one pull request's text, checks and whether it can merge, use github_read.",
  github_issues:
    "Issues (reads only): list them in a repository (state, labels); sub_issues of one; labels lists a repository's labels. To find issues across GitHub use github_search; for one issue's text use github_read.",
  github_find:
    "Search all of GitHub with GitHub's search words in words: code, repos, commits, users or orgs. For issues and pull requests use github_search.",
  github_discussions:
    "A repository's discussions: list, read one with its comments (each comment has an id), and, only when the person asked for exactly that with the words, comment (a reply with commentId), edit or delete one of the person's comments, or mark a comment as the answer (undo unmarks).",
  github_change:
    "Change things on GitHub as the person; others see it, so only when they asked for exactly this, with its details: " +
    "issue_create, issue_update (title, body, state open/closed, assignees), issue_labels (labels; remove takes them off), sub_issue_add (subIssue under number), pr_create (head into base, draft), pr_update (title, body, state, base), pr_draft (to draft; undo marks it ready), pr_update_branch, pr_merge (method merge, squash or rebase), review_create (event approve, request_changes or comment, with body and line comments; no event starts an unsent review), review_submit and review_delete (an unsent review by reviewId), branch_create (name, from a branch), label_create, label_update and label_delete (name, newName, color, description), release_create (tag, title, body, draft, prerelease, from), run_rerun (runId, failedOnly)."
};

const sharedInput = {
  repo: z.string().min(3).max(140).optional().describe("owner/name"),
  number: z.number().int().positive().optional().describe("The issue's, pull request's or discussion's number"),
  branch: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
  since: z.string().max(25).optional().describe("e.g. 2026-10-01"),
  ref: z.string().max(200).optional().describe("A sha or branch"),
  base: z.string().max(200).optional(),
  head: z.string().max(200).optional(),
  runId: z.number().int().positive().optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  labels: z.array(z.string().min(1).max(100)).max(20).optional(),
  words: z.string().max(300).optional().describe("GitHub's search words")
};
const changeInput = {
  title: z.string().max(300).optional(),
  body: z.string().max(20000).optional(),
  assignees: z.array(z.string().max(100)).max(10).optional(),
  remove: z.boolean().optional(),
  subIssue: z.number().int().positive().optional(),
  draft: z.boolean().optional(),
  undo: z.boolean().optional(),
  method: z.enum(["merge", "squash", "rebase"]).optional(),
  event: z.enum(["approve", "request_changes", "comment"]).optional(),
  comments: z
    .array(z.object({ path: z.string().max(500), line: z.number().int().positive(), body: z.string().max(4000) }))
    .max(30)
    .optional(),
  reviewId: z.number().int().positive().optional(),
  name: z.string().max(200).optional().describe("A branch's or label's name"),
  newName: z.string().max(200).optional(),
  from: z.string().max(200).optional().describe("The branch or commit to start from"),
  color: z.string().max(7).optional(),
  description: z.string().max(500).optional(),
  tag: z.string().max(200).optional(),
  prerelease: z.boolean().optional(),
  failedOnly: z.boolean().optional(),
  text: z.string().max(20000).optional().describe("A discussion comment's words"),
  commentId: z.string().max(200).optional().describe("A discussion comment's id, from read")
};

/**
 * The GitHub tools, given what they share with the other connected-account tools in accountTools. Each
 * offers only the actions the person hasn't switched off; a tool with none left isn't offered.
 * @param {object} shared
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {import("./types.js").AttemptAction} shared.attempt
 * @param {string[]} shared.attempted
 * @param {string[]} shared.removed
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {import("zod").ZodType} shared.statusLine
 * @param {import("zod").ZodType} shared.personAsked
 * @param {import("./types.js").InTime} shared.inTime
 * @param {(text: string) => string} shared.untrusted
 */
export function buildGithubTools({ appFor, attempt, attempted, removed, failed, statusLine, personAsked, inTime, untrusted }) {
  const tools = {};
  const actionsOf = (toolId) =>
    [...Object.keys(READS[toolId] || {}), ...Object.keys(CHANGES[toolId] || {})].filter((name) => !removed.includes(`${toolId}.${name}`));
  /** Text written by others on GitHub is information, never instructions. */
  const guarded = (value) => {
    if (Array.isArray(value)) return value.map(guarded);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([name, entry]) => [
          name,
          ["text", "notes", "patch", "logOfFailedJob"].includes(name) && entry ? untrusted(entry) : guarded(entry)
        ])
      );
    }
    return value;
  };
  const inputFor = (toolId, actions) =>
    z.object({
      action: z.enum(actions),
      acknowledgement: statusLine,
      ...sharedInput,
      ...(CHANGES[toolId] ? { ...changeInput, personAsked } : {})
    });

  /**
   * One action of a GitHub tool: a change goes through attempt() (approvals first), a read runs at once.
   * @param {string} toolId
   * @param {{ action: string, acknowledgement?: string, [field: string]: unknown }} given
   */
  async function runGithubAction(toolId, { action, acknowledgement, ...args }) {
    const changes = CHANGES[toolId] || {};
    try {
      const entry = await connectedKey(appFor(`${toolId}.${action}`), "github", "GitHub");
      if (toolId !== "github_find" && action !== "repos" && !args.repo) return { error: "Give the repository as owner/name in repo." };
      if (toolId === "github_find" && !args.words?.trim()) return { error: "Give the search words in words." };
      if (changes[action]) {
        need(args, ...changes[action].need);
        return await attempt(`${toolId}.${action}`, { ...args, personAsked: Boolean(args.personAsked) }, acknowledgement);
      }
      attempted.push(toolId);
      return { result: guarded(await inTime(READS[toolId][action](entry.key, args), "Reading GitHub")) };
    } catch (error) {
      return failed(error);
    }
  }

  const code = actionsOf("github_code");
  if (code.length) {
    tools.githubCode = createTool(Object.freeze({
      id: "github_code",
      description: DESCRIPTIONS.github_code,
      inputSchema: inputFor("github_code", code),
      execute: (input) => runGithubAction("github_code", input)
    }));
  }
  const pulls = actionsOf("github_pulls");
  if (pulls.length) {
    tools.githubPulls = createTool(Object.freeze({
      id: "github_pulls",
      description: DESCRIPTIONS.github_pulls,
      inputSchema: inputFor("github_pulls", pulls),
      execute: (input) => runGithubAction("github_pulls", input)
    }));
  }
  const issues = actionsOf("github_issues");
  if (issues.length) {
    tools.githubIssues = createTool(Object.freeze({
      id: "github_issues",
      description: DESCRIPTIONS.github_issues,
      inputSchema: inputFor("github_issues", issues),
      execute: (input) => runGithubAction("github_issues", input)
    }));
  }
  const find = actionsOf("github_find");
  if (find.length) {
    tools.githubFind = createTool(Object.freeze({
      id: "github_find",
      description: DESCRIPTIONS.github_find,
      inputSchema: inputFor("github_find", find),
      execute: (input) => runGithubAction("github_find", input)
    }));
  }
  const discussions = actionsOf("github_discussions");
  if (discussions.length) {
    tools.githubDiscussions = createTool(Object.freeze({
      id: "github_discussions",
      description: DESCRIPTIONS.github_discussions,
      inputSchema: inputFor("github_discussions", discussions),
      execute: (input) => runGithubAction("github_discussions", input)
    }));
  }
  const change = actionsOf("github_change");
  if (change.length) {
    tools.githubChange = createTool(Object.freeze({
      id: "github_change",
      description: DESCRIPTIONS.github_change,
      inputSchema: inputFor("github_change", change),
      execute: (input) => runGithubAction("github_change", input)
    }));
  }
  return tools;
}
