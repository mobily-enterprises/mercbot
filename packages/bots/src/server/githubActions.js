// What each GitHub action does (D-42), for githubTools: the reads, which give what the
// bot reads, and the changes, with what the card asks, what's done and the event line's words.

import { ConnectedAppError } from "./connectedApps.js";
import { githubCall as call, githubText, graphql, repoPath } from "./githubApps.js";

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body) => ({ method: "PATCH", body: JSON.stringify(body) });
const put = (body = {}) => ({ method: "PUT", body: JSON.stringify(body) });
const query = (values) => {
  const kept = Object.entries(values).filter(([, value]) => value !== undefined && value !== "");
  return kept.length ? `?${new URLSearchParams(kept)}` : "";
};
const short = (text, size = 4000) => String(text || "").slice(0, size);
const firstLine = (text) => String(text || "").split("\n")[0];
export const need = (args, ...names) => {
  const missing = names.filter((name) => args[name] === undefined || args[name] === "");
  if (missing.length) throw new ConnectedAppError(`Give ${missing.join(" and ")}.`);
};
const issueOf = (item) => ({
  number: item.number,
  title: item.title,
  state: item.state,
  author: item.user?.login,
  labels: (item.labels || []).map((label) => label.name),
  updated: item.updated_at,
  link: item.html_url
});

// Reads, by tool. Each takes the key and the tool's input, and gives what the bot reads.
export const READS = {
  github_code: {
    repos: async (key) =>
      (await call(key, "/user/repos?sort=updated&per_page=30")).map((repo) => ({
        repo: repo.full_name,
        private: repo.private,
        description: repo.description,
        pushed: repo.pushed_at,
        link: repo.html_url
      })),
    repo: async (key, { repo }) => {
      const found = await call(key, repoPath(repo));
      return {
        repo: found.full_name,
        description: found.description,
        private: found.private,
        defaultBranch: found.default_branch,
        language: found.language,
        topics: found.topics,
        stars: found.stargazers_count,
        forks: found.forks_count,
        openIssues: found.open_issues_count,
        link: found.html_url
      };
    },
    branches: async (key, { repo }) =>
      (await call(key, `${repoPath(repo)}/branches?per_page=50`)).map((branch) => ({
        name: branch.name,
        protected: branch.protected,
        sha: branch.commit?.sha?.slice(0, 7)
      })),
    commits: async (key, { repo, branch, path, since }) =>
      (await call(key, `${repoPath(repo)}/commits${query({ sha: branch, path, since, per_page: "20" })}`)).map((commit) => ({
        sha: commit.sha.slice(0, 7),
        message: firstLine(commit.commit?.message),
        author: commit.author?.login || commit.commit?.author?.name,
        date: commit.commit?.author?.date,
        link: commit.html_url
      })),
    commit: async (key, args) => {
      need(args, "ref");
      const commit = await call(key, `${repoPath(args.repo)}/commits/${encodeURIComponent(args.ref)}`);
      return {
        sha: commit.sha.slice(0, 7),
        message: short(commit.commit?.message),
        author: commit.author?.login,
        date: commit.commit?.author?.date,
        files: (commit.files || [])
          .slice(0, 50)
          .map((file) => ({ file: file.filename, status: file.status, added: file.additions, removed: file.deletions })),
        link: commit.html_url
      };
    },
    compare: async (key, args) => {
      need(args, "base", "head");
      const found = await call(key, `${repoPath(args.repo)}/compare/${encodeURIComponent(args.base)}...${encodeURIComponent(args.head)}`);
      return {
        status: found.status,
        ahead: found.ahead_by,
        behind: found.behind_by,
        commits: (found.commits || [])
          .slice(-30)
          .map((commit) => ({ sha: commit.sha.slice(0, 7), message: firstLine(commit.commit?.message) })),
        files: (found.files || [])
          .slice(0, 50)
          .map((file) => ({ file: file.filename, status: file.status, added: file.additions, removed: file.deletions })),
        link: found.html_url
      };
    },
    file: async (key, args) => {
      need(args, "path");
      const found = await call(
        key,
        `${repoPath(args.repo)}/contents/${args.path.split("/").map(encodeURIComponent).join("/")}${query({ ref: args.branch })}`
      );
      if (Array.isArray(found)) throw new ConnectedAppError(`${args.path} is a folder; use tree.`);
      return {
        path: found.path,
        size: found.size,
        text: Buffer.from(found.content || "", "base64")
          .toString("utf8")
          .slice(0, 40000),
        link: found.html_url
      };
    },
    tree: async (key, { repo, path = "", branch }) => {
      const found = await call(
        key,
        `${repoPath(repo)}/contents/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}${query({ ref: branch })}`
      );
      if (!Array.isArray(found)) throw new ConnectedAppError(`${path} is a file; use file.`);
      return found.map((entry) => ({ name: entry.name, kind: entry.type === "dir" ? "folder" : "file", path: entry.path }));
    },
    tags: async (key, { repo }) =>
      (await call(key, `${repoPath(repo)}/tags?per_page=30`)).map((tag) => ({ tag: tag.name, sha: tag.commit?.sha?.slice(0, 7) })),
    releases: async (key, { repo }) =>
      (await call(key, `${repoPath(repo)}/releases?per_page=10`)).map((release) => ({
        tag: release.tag_name,
        name: release.name,
        date: release.published_at,
        draft: release.draft,
        prerelease: release.prerelease,
        notes: short(release.body, 1500),
        link: release.html_url
      })),
    collaborators: async (key, { repo }) =>
      (await call(key, `${repoPath(repo)}/collaborators?per_page=50`)).map((person) => ({ login: person.login, role: person.role_name })),
    runs: async (key, { repo, branch }) =>
      (await call(key, `${repoPath(repo)}/actions/runs${query({ branch, per_page: "10" })}`)).workflow_runs.map((run) => ({
        id: run.id,
        workflow: run.name,
        branch: run.head_branch,
        event: run.event,
        status: run.status,
        result: run.conclusion,
        date: run.created_at,
        commit: firstLine(run.head_commit?.message),
        link: run.html_url
      })),
    run_logs: async (key, args) => {
      need(args, "runId");
      const { jobs = [] } = await call(key, `${repoPath(args.repo)}/actions/runs/${Number(args.runId)}/jobs`);
      const failedJob = jobs.find((job) => job.conclusion === "failure");
      return {
        jobs: jobs.map((job) => ({
          name: job.name,
          result: job.conclusion,
          failedSteps: (job.steps || []).filter((step) => step.conclusion === "failure").map((step) => step.name)
        })),
        ...(failedJob ? { logOfFailedJob: await githubText(key, `${repoPath(args.repo)}/actions/jobs/${failedJob.id}/logs`) } : {})
      };
    }
  },
  github_pulls: {
    list: async (key, { repo, state }) =>
      (await call(key, `${repoPath(repo)}/pulls${query({ state: state || "open", per_page: "20" })}`)).map((pull) => ({
        number: pull.number,
        title: pull.title,
        author: pull.user?.login,
        branch: `${pull.head?.ref} → ${pull.base?.ref}`,
        draft: pull.draft,
        updated: pull.updated_at,
        link: pull.html_url
      })),
    diff: async (key, args) => {
      need(args, "number");
      return (await call(key, `${repoPath(args.repo)}/pulls/${Number(args.number)}/files?per_page=50`)).map((file) => ({
        file: file.filename,
        status: file.status,
        added: file.additions,
        removed: file.deletions,
        patch: short(file.patch, 3000)
      }));
    },
    reviews: async (key, args) => {
      need(args, "number");
      const base = `${repoPath(args.repo)}/pulls/${Number(args.number)}`;
      const [reviews, comments] = await Promise.all([call(key, `${base}/reviews?per_page=50`), call(key, `${base}/comments?per_page=50`)]);
      return {
        reviews: reviews.map((review) => ({
          id: review.id,
          author: review.user?.login,
          state: review.state,
          text: short(review.body, 2000)
        })),
        lineComments: comments.map((comment) => ({
          id: comment.id,
          author: comment.user?.login,
          file: comment.path,
          line: comment.line,
          text: short(comment.body, 1500)
        }))
      };
    }
  },
  github_issues: {
    list: async (key, { repo, state, labels }) =>
      (await call(key, `${repoPath(repo)}/issues${query({ state: state || "open", labels: labels?.join(","), per_page: "30" })}`))
        .filter((item) => !item.pull_request)
        .map(issueOf),
    sub_issues: async (key, args) => {
      need(args, "number");
      return (await call(key, `${repoPath(args.repo)}/issues/${Number(args.number)}/sub_issues?per_page=50`)).map(issueOf);
    },
    labels: async (key, { repo }) =>
      (await call(key, `${repoPath(repo)}/labels?per_page=100`)).map((label) => ({
        name: label.name,
        color: label.color,
        description: label.description
      }))
  },
  github_find: {
    code: async (key, { words }) => {
      const { items = [], total_count: total } = await call(key, `/search/code${query({ q: words, per_page: "15" })}`);
      return { total, items: items.map((item) => ({ repo: item.repository?.full_name, path: item.path, link: item.html_url })) };
    },
    repos: async (key, { words }) => {
      const { items = [], total_count: total } = await call(key, `/search/repositories${query({ q: words, per_page: "15" })}`);
      return {
        total,
        items: items.map((repo) => ({
          repo: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          link: repo.html_url
        }))
      };
    },
    commits: async (key, { words }) => {
      const { items = [], total_count: total } = await call(key, `/search/commits${query({ q: words, per_page: "15" })}`);
      return {
        total,
        items: items.map((item) => ({
          repo: item.repository?.full_name,
          sha: item.sha.slice(0, 7),
          message: firstLine(item.commit?.message),
          date: item.commit?.author?.date,
          link: item.html_url
        }))
      };
    },
    users: async (key, { words }) => {
      const { items = [], total_count: total } = await call(key, `/search/users${query({ q: words, per_page: "15" })}`);
      return { total, items: items.map((user) => ({ login: user.login, kind: user.type, link: user.html_url })) };
    },
    orgs: async (key, { words }) => {
      const { items = [], total_count: total } = await call(key, `/search/users${query({ q: `${words} type:org`, per_page: "15" })}`);
      return { total, items: items.map((org) => ({ login: org.login, link: org.html_url })) };
    }
  },
  github_discussions: {
    list: async (key, { repo }) => {
      const [owner, name] = repo.split("/");
      const data = await graphql(
        key,
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
          "discussions(first:20,orderBy:{field:UPDATED_AT,direction:DESC}){" +
          "nodes{number title author{login} category{name} isAnswered updatedAt url}}}}",
        { owner, name }
      );
      return data.repository.discussions.nodes.map((item) => ({
        number: item.number,
        title: item.title,
        author: item.author?.login,
        category: item.category?.name,
        answered: item.isAnswered,
        updated: item.updatedAt,
        link: item.url
      }));
    },
    read: async (key, args) => {
      need(args, "number");
      const [owner, name] = args.repo.split("/");
      const data = await graphql(
        key,
        "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){title body author{login} url answer{id} comments(last:30){nodes{id body author{login} createdAt isAnswer}}}}}",
        { owner, name, number: Number(args.number) }
      );
      const found = data.repository.discussion;
      return {
        title: found.title,
        author: found.author?.login,
        text: short(found.body, 20000),
        link: found.url,
        comments: found.comments.nodes.map((comment) => ({
          id: comment.id,
          author: comment.author?.login,
          date: comment.createdAt,
          text: short(comment.body),
          ...(comment.isAnswer ? { answer: true } : {})
        }))
      };
    }
  }
};

/** Node ids GraphQL needs for a pull request or a discussion. */
const pullNode = async (key, repo, number) => (await call(key, `${repoPath(repo)}/pulls/${Number(number)}`)).node_id;
const discussionNode = async (key, repo, number) => {
  const [owner, name] = repo.split("/");
  return (
    await graphql(
      key,
      "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){id}}}",
      { owner, name, number: Number(number) }
    )
  ).repository.discussion.id;
};
const where = (args) => `${args.repo}${args.number ? `#${args.number}` : ""}`;

// The event line's words for each kind of review sent.
const REVIEWED = { approve: "Approved", request_changes: "Asked for changes on", comment: "Reviewed" };
// What a test copy's answers say where only GitHub could answer: a new issue's or pull request's
// number, and on a release's page (D-69).
const SIMULATED = "simulated";
/**
 * A change other people follow on GitHub: an issue, pull request or release made or changed, a
 * merge, a review, a discussion's comments or answer, or an automation run started again. A test
 * copy doesn't make it (D-69); this is what it logs instead: its kind, one phrase naming it (never a
 * body) and where.
 * @param {string} kind
 * @param {(args: Record<string, any>) => string} summary
 */
const seen = (kind, summary) => (args) => ({
  kind: `GitHub ${kind}`,
  summary: summary(args),
  details: { repo: args.repo, ...(args.number ? { number: args.number } : {}) }
});
const reviewSent = seen("review", (args) => `the review of ${where(args)}`);
/** An issue's or pull request's title and page as they are (a read), for a change a test copy only simulates. */
const current = (key, args, kind) => call(key, `${repoPath(args.repo)}/${kind}/${Number(args.number)}`);

// Changes, by tool: what the card asks, what's done, and the event line's words; and for those other
// people see, what a test copy logs instead (`sends`) and the answer it gives as if done (`simulated`).
export const CHANGES = {
  github_change: {
    issue_create: {
      need: ["title"],
      say: (args) => `open an issue in ${args.repo}: "${args.title}"`,
      sends: seen("issue", (args) => `opening the issue "${args.title}" in ${args.repo}`),
      simulated: (key, args) => ({
        text: `Opened issue #${SIMULATED} in ${args.repo}: ${args.title}`,
        link: `https://github.com/${args.repo}/issues/${SIMULATED}`
      }),
      run: async (key, args) => {
        const made = await call(
          key,
          `${repoPath(args.repo)}/issues`,
          post({ title: args.title, body: args.body || "", labels: args.labels || [], assignees: args.assignees || [] })
        );
        return { text: `Opened issue #${made.number} in ${args.repo}: ${made.title}`, link: made.html_url };
      }
    },
    issue_update: {
      need: ["number"],
      say: (args) => `${args.state === "closed" ? "close" : args.state === "open" ? "reopen" : "change"} ${where(args)}`,
      sends: seen("issue", (args) => `${args.state === "closed" ? "closing" : args.state === "open" ? "reopening" : "changing"} ${where(args)}`),
      simulated: async (key, args) => {
        const issue = await current(key, args, "issues");
        return {
          text: `${args.state === "closed" ? "Closed" : args.state === "open" ? "Reopened" : "Changed"} ${where(args)}: ${args.title ?? issue.title}`,
          link: issue.html_url
        };
      },
      run: async (key, args) => {
        const change = Object.fromEntries(
          Object.entries({ title: args.title, body: args.body, state: args.state, assignees: args.assignees }).filter(
            ([, value]) => value !== undefined
          )
        );
        const done = await call(key, `${repoPath(args.repo)}/issues/${Number(args.number)}`, patch(change));
        return {
          text: `${args.state === "closed" ? "Closed" : args.state === "open" ? "Reopened" : "Changed"} ${where(args)}: ${done.title}`,
          link: done.html_url
        };
      }
    },
    issue_labels: {
      need: ["number", "labels"],
      say: (args) =>
        `${args.remove ? "take the labels" : "add the labels"} ${args.labels?.join(", ")} ${args.remove ? "off" : "to"} ${where(args)}`,
      sends: seen("labels", (args) =>
        `${args.remove ? "taking the labels" : "adding the labels"} ${args.labels?.join(", ")} ${args.remove ? "off" : "to"} ${where(args)}`),
      simulated: (key, args) => ({ text: `${args.remove ? "Took off" : "Added"} the labels ${args.labels.join(", ")} on ${where(args)}` }),
      run: async (key, args) => {
        const base = `${repoPath(args.repo)}/issues/${Number(args.number)}/labels`;
        if (args.remove) {
          for (const label of args.labels) await call(key, `${base}/${encodeURIComponent(label)}`, { method: "DELETE" });
        } else {
          await call(key, base, post({ labels: args.labels }));
        }
        return { text: `${args.remove ? "Took off" : "Added"} the labels ${args.labels.join(", ")} on ${where(args)}` };
      }
    },
    sub_issue_add: {
      need: ["number", "subIssue"],
      say: (args) => `make #${args.subIssue} a sub-issue of ${where(args)}`,
      sends: seen("issue", (args) => `making #${args.subIssue} a sub-issue of ${where(args)}`),
      simulated: (key, args) => ({ text: `Made #${args.subIssue} a sub-issue of ${where(args)}` }),
      run: async (key, args) => {
        const child = await call(key, `${repoPath(args.repo)}/issues/${Number(args.subIssue)}`);
        await call(key, `${repoPath(args.repo)}/issues/${Number(args.number)}/sub_issues`, post({ sub_issue_id: child.id }));
        return { text: `Made #${args.subIssue} a sub-issue of ${where(args)}` };
      }
    },
    pr_create: {
      need: ["title", "head", "base"],
      say: (args) =>
        `open a${args.draft ? " draft" : ""} pull request in ${args.repo} from ${args.head} into ${args.base}: "${args.title}"`,
      sends: seen("pull request", (args) => `opening the pull request "${args.title}" in ${args.repo} from ${args.head} into ${args.base}`),
      simulated: (key, args) => ({
        text: `Opened pull request #${SIMULATED} in ${args.repo}: ${args.title}`,
        link: `https://github.com/${args.repo}/pull/${SIMULATED}`
      }),
      run: async (key, args) => {
        const made = await call(
          key,
          `${repoPath(args.repo)}/pulls`,
          post({ title: args.title, body: args.body || "", head: args.head, base: args.base, draft: Boolean(args.draft) })
        );
        return { text: `Opened pull request #${made.number} in ${args.repo}: ${made.title}`, link: made.html_url };
      }
    },
    pr_update: {
      need: ["number"],
      say: (args) => `${args.state === "closed" ? "close" : "change"} pull request ${where(args)}`,
      sends: seen("pull request", (args) => `${args.state === "closed" ? "closing" : "changing"} pull request ${where(args)}`),
      simulated: async (key, args) => {
        const pull = await current(key, args, "pulls");
        return {
          text: `${args.state === "closed" ? "Closed" : "Changed"} pull request ${where(args)}: ${args.title ?? pull.title}`,
          link: pull.html_url
        };
      },
      run: async (key, args) => {
        const change = Object.fromEntries(
          Object.entries({ title: args.title, body: args.body, state: args.state, base: args.base }).filter(
            ([, value]) => value !== undefined
          )
        );
        const done = await call(key, `${repoPath(args.repo)}/pulls/${Number(args.number)}`, patch(change));
        return {
          text: `${args.state === "closed" ? "Closed" : "Changed"} pull request ${where(args)}: ${done.title}`,
          link: done.html_url
        };
      }
    },
    pr_draft: {
      need: ["number"],
      say: (args) =>
        args.undo ? `mark pull request ${where(args)} ready for review` : `turn pull request ${where(args)} back into a draft`,
      // Ready for review asks its reviewers; back to a draft shows on it too.
      sends: seen("pull request", (args) =>
        args.undo ? `marking pull request ${where(args)} ready for review` : `turning pull request ${where(args)} into a draft`),
      simulated: (key, args) => ({ text: args.undo ? `Marked ${where(args)} ready for review` : `Turned ${where(args)} into a draft` }),
      run: async (key, args) => {
        const id = await pullNode(key, args.repo, args.number);
        await graphql(
          key,
          args.undo
            ? "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}"
            : "mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){clientMutationId}}",
          { id }
        );
        return { text: args.undo ? `Marked ${where(args)} ready for review` : `Turned ${where(args)} into a draft` };
      }
    },
    pr_update_branch: {
      need: ["number"],
      say: (args) => `bring pull request ${where(args)}'s branch up to date with its base`,
      // A merge of its base into its branch, which shows on the pull request.
      sends: seen("merge", (args) => `bringing pull request ${where(args)}'s branch up to date with its base`),
      simulated: (key, args) => ({ text: `Started bringing ${where(args)}'s branch up to date with its base` }),
      run: async (key, args) => {
        await call(key, `${repoPath(args.repo)}/pulls/${Number(args.number)}/update-branch`, put());
        return { text: `Started bringing ${where(args)}'s branch up to date with its base` };
      }
    },
    pr_merge: {
      need: ["number"],
      say: (args) => `merge pull request ${where(args)}${args.method ? ` (${args.method})` : ""}`,
      sends: seen("merge", (args) => `merging pull request ${where(args)}${args.method ? ` (${args.method})` : ""}`),
      simulated: (key, args) => ({ text: `Merged pull request ${where(args)}` }),
      run: async (key, args) => {
        const done = await call(
          key,
          `${repoPath(args.repo)}/pulls/${Number(args.number)}/merge`,
          put({ merge_method: args.method || "merge" })
        );
        return { text: `Merged pull request ${where(args)}`, detail: done.message };
      }
    },
    review_create: {
      need: ["number"],
      say: (args) =>
        `${{ approve: "approve", request_changes: "ask for changes on", comment: "review" }[args.event] || "start a review of"} ` +
        `pull request ${where(args)}${args.body ? `: "${short(args.body, 200)}"` : ""}`,
      // Without an event the review waits unsent, so only one with an event goes out.
      sends: (args) => (REVIEWED[args.event] ? reviewSent(args) : null),
      simulated: (key, args) => ({ text: `${REVIEWED[args.event]} ${where(args)}` }),
      run: async (key, args) => {
        const event = { approve: "APPROVE", request_changes: "REQUEST_CHANGES", comment: "COMMENT" }[args.event];
        const review = await call(
          key,
          `${repoPath(args.repo)}/pulls/${Number(args.number)}/reviews`,
          post({
            ...(event ? { event } : {}),
            body: args.body || "",
            comments: (args.comments || []).map((comment) => ({ path: comment.path, line: comment.line, body: comment.body }))
          })
        );
        return {
          text: event ? `${REVIEWED[args.event]} ${where(args)}` : `Started a review of ${where(args)} (not sent yet; review id ${review.id})`,
          link: review.html_url
        };
      }
    },
    review_submit: {
      need: ["number", "reviewId", "event"],
      say: (args) => `send your waiting review of ${where(args)} as ${args.event?.replace("_", " ")}`,
      sends: reviewSent,
      simulated: (key, args) => ({ text: `Sent the review of ${where(args)}` }),
      run: async (key, args) => {
        const event = { approve: "APPROVE", request_changes: "REQUEST_CHANGES", comment: "COMMENT" }[args.event];
        await call(
          key,
          `${repoPath(args.repo)}/pulls/${Number(args.number)}/reviews/${Number(args.reviewId)}/events`,
          post({ event, body: args.body || "" })
        );
        return { text: `Sent the review of ${where(args)}` };
      }
    },
    review_delete: {
      need: ["number", "reviewId"],
      say: (args) => `delete your unsent review of ${where(args)}`,
      run: async (key, args) => {
        await call(key, `${repoPath(args.repo)}/pulls/${Number(args.number)}/reviews/${Number(args.reviewId)}`, { method: "DELETE" });
        return { text: `Deleted the unsent review of ${where(args)}` };
      }
    },
    branch_create: {
      need: ["name"],
      say: (args) => `make the branch ${args.name} in ${args.repo} from ${args.from || "the default branch"}`,
      run: async (key, args) => {
        const from = args.from || (await call(key, repoPath(args.repo))).default_branch;
        const { object } = await call(key, `${repoPath(args.repo)}/git/ref/heads/${encodeURIComponent(from)}`);
        await call(key, `${repoPath(args.repo)}/git/refs`, post({ ref: `refs/heads/${args.name}`, sha: object.sha }));
        return {
          text: `Made the branch ${args.name} in ${args.repo} from ${from}`,
          link: `https://github.com/${args.repo}/tree/${args.name}`
        };
      }
    },
    label_create: {
      need: ["name"],
      say: (args) => `make the label "${args.name}" in ${args.repo}`,
      run: async (key, args) => {
        await call(
          key,
          `${repoPath(args.repo)}/labels`,
          post({ name: args.name, color: (args.color || "ededed").replace("#", ""), description: args.description || "" })
        );
        return { text: `Made the label ${args.name} in ${args.repo}` };
      }
    },
    label_update: {
      need: ["name"],
      say: (args) => `change the label "${args.name}" in ${args.repo}${args.newName ? ` to "${args.newName}"` : ""}`,
      run: async (key, args) => {
        await call(
          key,
          `${repoPath(args.repo)}/labels/${encodeURIComponent(args.name)}`,
          patch(
            Object.fromEntries(
              Object.entries({ new_name: args.newName, color: args.color?.replace("#", ""), description: args.description }).filter(
                ([, value]) => value !== undefined
              )
            )
          )
        );
        return { text: `Changed the label ${args.name} in ${args.repo}${args.newName ? ` to ${args.newName}` : ""}` };
      }
    },
    label_delete: {
      need: ["name"],
      say: (args) => `delete the label "${args.name}" from ${args.repo}`,
      run: async (key, args) => {
        await call(key, `${repoPath(args.repo)}/labels/${encodeURIComponent(args.name)}`, { method: "DELETE" });
        return { text: `Deleted the label ${args.name} from ${args.repo}` };
      }
    },
    release_create: {
      need: ["tag"],
      say: (args) => `publish the ${args.draft ? "draft " : ""}release ${args.tag} of ${args.repo}`,
      sends: seen("release", (args) => `${args.draft ? "drafting" : "publishing"} the release ${args.tag} of ${args.repo}`),
      simulated: (key, args) => ({
        text: `${args.draft ? "Drafted" : "Published"} release ${args.tag} of ${args.repo}`,
        link: `https://github.com/${args.repo}/releases/tag/${encodeURIComponent(args.tag)}#${SIMULATED}`
      }),
      run: async (key, args) => {
        const made = await call(
          key,
          `${repoPath(args.repo)}/releases`,
          post({
            tag_name: args.tag,
            name: args.title || args.tag,
            body: args.body || "",
            draft: Boolean(args.draft),
            prerelease: Boolean(args.prerelease),
            ...(args.from ? { target_commitish: args.from } : {})
          })
        );
        return { text: `${made.draft ? "Drafted" : "Published"} release ${made.tag_name} of ${args.repo}`, link: made.html_url };
      }
    },
    run_rerun: {
      need: ["runId"],
      say: (args) => `run ${args.failedOnly ? "the failed jobs of " : ""}automation run ${args.runId} in ${args.repo} again`,
      // A run started again can deploy or publish, as its workflow does.
      sends: seen("automation run", (args) =>
        `running ${args.failedOnly ? "the failed jobs of " : ""}automation run ${args.runId} in ${args.repo} again`),
      // The run as it is (a read), so one that isn't there fails as the live copy's would.
      simulated: async (key, args) => {
        const found = await call(key, `${repoPath(args.repo)}/actions/runs/${Number(args.runId)}`);
        return { text: `Started run ${args.runId} in ${args.repo} again`, link: found.html_url };
      },
      run: async (key, args) => {
        await call(
          key,
          `${repoPath(args.repo)}/actions/runs/${Number(args.runId)}/${args.failedOnly ? "rerun-failed-jobs" : "rerun"}`,
          post({})
        );
        return { text: `Started run ${args.runId} in ${args.repo} again` };
      }
    }
  },
  github_discussions: {
    comment: {
      need: ["number", "text"],
      say: (args) => `${args.commentId ? "reply in" : "comment on"} discussion ${where(args)}: "${short(args.text, 200)}"`,
      sends: seen("comment", (args) => `the ${args.commentId ? "reply" : "comment"} on discussion ${where(args)}`),
      simulated: (key, args) => ({
        text: `Commented on discussion ${where(args)}`,
        link: `https://github.com/${args.repo}/discussions/${args.number}`
      }),
      run: async (key, args) => {
        const id = await discussionNode(key, args.repo, args.number);
        const data = await graphql(
          key,
          "mutation($id:ID!,$body:String!,$reply:ID){" +
            "addDiscussionComment(input:{discussionId:$id,body:$body,replyToId:$reply}){comment{url}}}",
          { id, body: args.text, reply: args.commentId || null }
        );
        return { text: `Commented on discussion ${where(args)}`, link: data.addDiscussionComment.comment.url };
      }
    },
    edit: {
      need: ["commentId", "text"],
      say: (args) => `change your comment in discussion ${where(args)} to: "${short(args.text, 200)}"`,
      sends: seen("comment", (args) => `changing a comment in discussion ${where(args)}`),
      simulated: (key, args) => ({ text: `Changed a comment in discussion ${where(args)}` }),
      run: async (key, args) => {
        await graphql(key, "mutation($id:ID!,$body:String!){updateDiscussionComment(input:{commentId:$id,body:$body}){comment{id}}}", {
          id: args.commentId,
          body: args.text
        });
        return { text: `Changed a comment in discussion ${where(args)}` };
      }
    },
    delete: {
      need: ["commentId"],
      say: (args) => `delete a comment in discussion ${where(args)}`,
      sends: seen("comment", (args) => `deleting a comment in discussion ${where(args)}`),
      simulated: (key, args) => ({ text: `Deleted a comment in discussion ${where(args)}` }),
      run: async (key, args) => {
        await graphql(key, "mutation($id:ID!){deleteDiscussionComment(input:{id:$id}){comment{id}}}", { id: args.commentId });
        return { text: `Deleted a comment in discussion ${where(args)}` };
      }
    },
    answer: {
      need: ["commentId"],
      say: (args) => `${args.undo ? "unmark" : "mark"} a comment as the answer in discussion ${where(args)}`,
      sends: seen("discussion", (args) => `${args.undo ? "unmarking" : "marking"} the answer in discussion ${where(args)}`),
      simulated: (key, args) => ({ text: `${args.undo ? "Unmarked" : "Marked"} the answer in discussion ${where(args)}` }),
      run: async (key, args) => {
        await graphql(
          key,
          args.undo
            ? "mutation($id:ID!){unmarkDiscussionCommentAsAnswer(input:{id:$id}){clientMutationId}}"
            : "mutation($id:ID!){markDiscussionCommentAsAnswer(input:{id:$id}){clientMutationId}}",
          { id: args.commentId }
        );
        return { text: `${args.undo ? "Unmarked" : "Marked"} the answer in discussion ${where(args)}` };
      }
    }
  }
};
