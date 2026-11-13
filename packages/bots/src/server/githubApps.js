import { ConnectedAppError } from "./connectedApps.js";

// Bots using the person's connected GitHub account (D-31): finding and reading issues and pull
// requests, with their comments, reviews and test results, and commenting once approved. Real
// coding work goes to a dedicated coding service, not to these tools.

const API = "https://api.github.com";

async function call(key, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "Mercbot",
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new ConnectedAppError("GitHub refused: the connection may need signing in again in Connect apps.");
  if (response.status === 403 || response.status === 404) {
    throw new ConnectedAppError(
      body.message
        ? `GitHub: ${body.message}. The repository may not exist, or this account can't see it.`
        : "GitHub couldn't find that, or this account can't see it."
    );
  }
  if (!response.ok) throw new ConnectedAppError(body.message || `GitHub answered ${response.status}.`);
  return body;
}

const repoPath = (repo) => {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(String(repo))) {
    throw new ConnectedAppError("Give the repository as owner/name, e.g. octocat/hello-world.");
  }
  return `/repos/${repo}`;
};

/** Issues and pull requests with GitHub's search words (is:pr is:open involves:name repo:owner/name…). */
export async function searchIssues(key, query) {
  const { items = [], total_count: total = 0 } = await call(
    key,
    `/search/issues?${new URLSearchParams({ q: query, sort: "updated", per_page: "15" })}`
  );
  return {
    total,
    items: items.map((item) => ({
      repo: item.repository_url.split("/repos/")[1],
      number: item.number,
      kind: item.pull_request ? "pull request" : "issue",
      title: item.title,
      state: item.state,
      author: item.user?.login,
      updated: item.updated_at,
      comments: item.comments,
      link: item.html_url
    }))
  };
}

/**
 * One issue or pull request: its text, the latest comments, and for a pull request its reviews,
 * whether it can merge, and how its checks (tests) went.
 */
export async function readIssue(key, repo, number) {
  const base = repoPath(repo);
  const issue = await call(key, `${base}/issues/${Number(number)}`);
  const comments = await call(key, `${base}/issues/${Number(number)}/comments?per_page=30`);
  const result = {
    kind: issue.pull_request ? "pull request" : "issue",
    title: issue.title,
    state: issue.state,
    author: issue.user?.login,
    text: String(issue.body || "").slice(0, 20000),
    comments: comments
      .slice(-15)
      .map((comment) => ({ author: comment.user?.login, date: comment.created_at, text: String(comment.body || "").slice(0, 4000) })),
    link: issue.html_url
  };
  if (!issue.pull_request) return result;
  const pull = await call(key, `${base}/pulls/${Number(number)}`);
  const reviews = await call(key, `${base}/pulls/${Number(number)}/reviews?per_page=30`);
  const { check_runs: checks = [] } = await call(key, `${base}/commits/${pull.head.sha}/check-runs?per_page=50`);
  return {
    ...result,
    branch: `${pull.head.ref} → ${pull.base.ref}`,
    merged: pull.merged,
    mergeable: pull.mergeable,
    changes: { files: pull.changed_files, additions: pull.additions, deletions: pull.deletions },
    reviews: reviews.map((review) => ({ author: review.user?.login, state: review.state, text: String(review.body || "").slice(0, 2000) })),
    checks: checks.map((check) => ({ name: check.name, status: check.status, result: check.conclusion }))
  };
}

export async function addComment(key, repo, number, text) {
  const comment = await call(key, `${repoPath(repo)}/issues/${Number(number)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: text })
  });
  return { link: comment.html_url };
}

/**
 * The person's week on GitHub: first what waits on them (reviews asked of them, issues
 * and pull requests assigned to them, mentions), then what they did: commits per repository,
 * releases, new repositories and pull requests, from their own activity feed.
 */
export async function activity(key, { since }) {
  const me = await call(key, "/user");
  const from = new Date(since);
  const day = from.toISOString().slice(0, 10);
  const searches = [
    `is:open review-requested:${me.login}`,
    `is:open assignee:${me.login}`,
    `is:open mentions:${me.login} updated:>=${day}`
  ];
  const attention = new Map();
  for (const query of searches) {
    for (const item of (await searchIssues(key, query)).items) {
      if (!attention.has(item.link)) attention.set(item.link, { ...item, why: query.split(" ")[1].split(":")[0].replace("-", " ") });
    }
  }
  const events = (await call(key, `/users/${encodeURIComponent(me.login)}/events?per_page=100`)).filter(
    (event) => new Date(event.created_at) >= from
  );
  const repos = new Map();
  const releases = [];
  const created = [];
  const pulls = [];
  for (const event of events) {
    const repo = event.repo?.name;
    const link = `https://github.com/${repo}`;
    if (event.type === "PushEvent") {
      const entry = repos.get(repo) || { repo, link, commits: 0, messages: [] };
      entry.commits += event.payload?.distinct_size ?? event.payload?.size ?? event.payload?.commits?.length ?? 1;
      entry.messages.push(...(event.payload?.commits || []).map((commit) => String(commit.message).split("\n")[0]).slice(0, 5));
      repos.set(repo, entry);
    } else if (event.type === "ReleaseEvent") {
      releases.push({
        repo,
        link: event.payload?.release?.html_url || link,
        version: event.payload?.release?.tag_name,
        date: event.created_at
      });
    } else if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
      created.push({ repo, link, date: event.created_at });
    } else if (event.type === "PullRequestEvent" && ["opened", "closed"].includes(event.payload?.action)) {
      const pull = event.payload.pull_request;
      pulls.push({
        repo,
        title: pull?.title,
        link: pull?.html_url,
        what: event.payload.action === "closed" && pull?.merged ? "merged" : event.payload.action,
        date: event.created_at
      });
    }
  }
  const byRepo = [...repos.values()]
    .sort((a, b) => b.commits - a.commits)
    .map((entry) => ({ ...entry, messages: entry.messages.slice(0, 8) }));
  return {
    account: me.login,
    profile: me.html_url,
    since: day,
    attention: [...attention.values()],
    commits: byRepo.reduce((sum, entry) => sum + entry.commits, 0),
    byRepo,
    releases,
    newRepositories: created,
    pullRequests: pulls
  };
}

// For the rest of GitHub (D-42, githubTools.js): the same call, GitHub's GraphQL (discussions and
// draft pull requests live only there), and text answers such as a run's log.
export { call as githubCall, repoPath };

export async function graphql(key, query, variables = {}) {
  const body = await call(key, "/graphql", { method: "POST", body: JSON.stringify({ query, variables }) });
  if (body.errors?.length) throw new ConnectedAppError(`GitHub: ${body.errors[0].message}`);
  return body.data;
}

export async function githubText(key, path) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "Mercbot"
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) await call(key, path);
  return (await response.text()).slice(-20000);
}
