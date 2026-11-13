import assert from "node:assert/strict";
import test from "node:test";
import { ACTIONS } from "../../packages/bots/src/server/botActions.js";

// Mercbot's own sends follow SIDE_EFFECTS (D-69): the live copy (`live`) sends them; any other copy, a
// test copy, logs each one and answers as if it went out. Reads, and changes that reach nobody, run in both.
const LIVE = { SIDE_EFFECTS: "live" };
const TEST_COPY = {};

/** A stand-in for Google's and GitHub's APIs: each call kept as "METHOD url" and answered with `answer`. */
function fakeApis(context, answer) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${decodeURIComponent(String(url))}`);
    return new Response(JSON.stringify(answer(String(url))), { status: 200 });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}
const writes = (calls) => calls.filter((call) => !call.startsWith("GET ")).map((call) => call.split("?")[0]);

/** What `work` answers, and the side-effect lines it logs. */
async function logged(context, work) {
  const info = context.mock.method(console, "info", () => {});
  try {
    const result = await work();
    return { result, lines: info.mock.calls.map((call) => call.arguments).filter(([fields]) => fields?.sideEffects) };
  } finally {
    info.mock.restore();
  }
}

/** An action's context with one connected account, as botTools.attempt and an approval card give it. */
const contextOf = (pluginId, label, env) => ({
  integrations: {
    reachableAccounts: async () => [{ id: "4", pluginId, name: "", label, status: "connected" }],
    connections: { accessToken: async () => ({ accessToken: "key" }) },
    app: () => null
  },
  reach: { userId: 7 },
  call: null,
  env
});

const EVENT = {
  id: "e1",
  summary: "Lunch",
  start: { dateTime: "2026-11-03T13:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2026-11-03T14:00:00Z" },
  htmlLink: "https://calendar.google.com/e1",
  attendees: [{ email: "pat@example.com", self: true, responseStatus: "needsAction" }, { email: "ana@example.com", responseStatus: "needsAction" }]
};
const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

test("calendar changes that reach guests or an organiser go out only from the live copy", async (context) => {
  const calls = fakeApis(context, () => EVENT);
  const reaching = [
    ["add_calendar_event", { title: "Lunch", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timeZone: "UTC", attendees: ["ana@example.com"] }, `POST ${CALENDAR_API}`, "calendar invitation", "Added to your calendar: Lunch"],
    ["change_calendar_event", { eventId: "e1", title: "Lunch", start: "2026-11-03T15:00", timeZone: "UTC", guests: 1, attendees: [] }, `PATCH ${CALENDAR_API}/e1`, "calendar update", "Changed on your calendar: Lunch"],
    ["delete_calendar_event", { eventId: "e1", title: "Lunch", guests: 1 }, `DELETE ${CALENDAR_API}/e1`, "calendar cancellation", "Removed from your calendar: Lunch"],
    ["answer_invitation", { eventId: "e1", title: "Lunch", answer: "accept" }, `PATCH ${CALENDAR_API}/e1`, "invitation answer", "Accepted the invitation: Lunch"]
  ];
  for (const [id, args, write, kind, text] of reaching) {
    calls.length = 0;
    const live = await logged(context, () => ACTIONS[id].run(contextOf("google-calendar", "pat@example.com", LIVE), args));
    assert.deepEqual(writes(calls), [write], `${id} sends from the live copy`);
    assert.deepEqual(live.lines, []);
    calls.length = 0;
    const copy = await logged(context, () => ACTIONS[id].run(contextOf("google-calendar", "pat@example.com", TEST_COPY), args));
    assert.deepEqual(writes(calls), [], `${id} sends nothing from a test copy`);
    assert.equal(copy.lines.length, 1);
    assert.deepEqual([copy.lines[0][0].sideEffects, copy.lines[0][0].kind, copy.lines[0][0].calendar], ["simulate", kind, "Google Calendar: pat@example.com"]);
    assert.match(copy.lines[0][1], /^Test copy: .* was simulated, not sent \(SIDE_EFFECTS is not live\)\.$/u);
    assert.equal(copy.result.body.text, live.result.body.text, `${id} says what the live copy says`);
    assert.match(copy.result.body.text, new RegExp(`^${text}`, "u"));
  }

  // As the change would leave it: an invitation names its guests, and a change keeps the event's own.
  const invited = await logged(context, () => ACTIONS.add_calendar_event.run(contextOf("google-calendar", "pat@example.com", TEST_COPY), reaching[0][1]));
  assert.deepEqual([invited.result.result.guests, invited.result.result.simulated], [[{ email: "ana@example.com" }], true]);
  const moved = await logged(context, () => ACTIONS.change_calendar_event.run(contextOf("google-calendar", "pat@example.com", TEST_COPY), reaching[1][1]));
  assert.deepEqual([moved.result.result.start, moved.result.result.guests], ["2026-11-03T15:00", [{ email: "ana@example.com" }]]);
});

test("calendar changes that reach nobody run in a test copy too", async (context) => {
  const calls = fakeApis(context, () => ({ ...EVENT, attendees: undefined }));
  const testCopy = contextOf("google-calendar", "pat@example.com", TEST_COPY);
  const { lines } = await logged(context, async () => {
    await ACTIONS.add_calendar_event.run(testCopy, { title: "Lunch", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timeZone: "UTC" });
    await ACTIONS.change_calendar_event.run(testCopy, { eventId: "e1", title: "Lunch", start: "2026-11-03T15:00", timeZone: "UTC", guests: 0, attendees: [] });
    await ACTIONS.delete_calendar_event.run(testCopy, { eventId: "e1", title: "Lunch", guests: 0 });
  });
  assert.deepEqual(writes(calls), [`POST ${CALENDAR_API}`, `PATCH ${CALENDAR_API}/e1`, `DELETE ${CALENDAR_API}/e1`]);
  assert.deepEqual(lines, []);
});

test("sending a saved draft and forwarding go out only from the live copy", async (context) => {
  const message = { threadId: "t1", payload: { headers: [{ name: "Subject", value: "Sports day" }, { name: "From", value: "reed@school.example" }], mimeType: "text/plain", body: { data: "" } } };
  const calls = fakeApis(context, (url) => (url.includes("/messages/m9") ? message : { id: "s1" }));
  const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
  const draft = { id: "d1", subject: "Lunch", to: ["ana@example.com"] };
  const forward = { id: "m9", to: ["sam@example.com"] };

  const sent = await logged(context, () => ACTIONS["mail_drafts.send"].run(contextOf("gmail", "pat@example.com", LIVE), draft));
  const forwarded = await logged(context, () => ACTIONS.forward_email.run(contextOf("gmail", "pat@example.com", LIVE), forward));
  assert.deepEqual(writes(calls), [`POST ${GMAIL}/drafts/send`, `POST ${GMAIL}/messages/send`]);
  assert.deepEqual([...sent.lines, ...forwarded.lines], []);
  assert.equal(sent.result.body.text, "Sent the draft: Lunch");

  calls.length = 0;
  const simulated = await logged(context, () => ACTIONS["mail_drafts.send"].run(contextOf("gmail", "pat@example.com", TEST_COPY), draft));
  const simulatedForward = await logged(context, () => ACTIONS.forward_email.run(contextOf("gmail", "pat@example.com", TEST_COPY), forward));
  assert.deepEqual(writes(calls), [], "nothing is sent; the email to forward is only read");
  assert.equal(simulated.result.body.text, "Sent the draft: Lunch");
  assert.equal(simulatedForward.result.body.text, "Forwarded: Sports day");
  assert.deepEqual(simulated.lines, [[
    { sideEffects: "simulate", kind: "email", from: "Gmail: pat@example.com", draft: "d1", to: ["ana@example.com"] },
    'Test copy: the draft "Lunch" from Gmail: pat@example.com to ana@example.com was simulated, not sent (SIDE_EFFECTS is not live).'
  ]]);
  assert.deepEqual(simulatedForward.lines.map(([fields]) => [fields.kind, fields.email, fields.to]), [["email", "m9", ["sam@example.com"]]]);
});

test("comments and reviews on GitHub go out only from the live copy, and an unsent review is still started", async (context) => {
  const calls = fakeApis(context, () => ({
    id: 9,
    html_url: "https://github.com/pat/app/pull/12#review",
    data: { repository: { discussion: { id: "D1" } }, addDiscussionComment: { comment: { url: "https://github.com/pat/app/discussions/3#c1" } } }
  }));
  const API = "https://api.github.com";
  const sends = [
    ["github_comment", { repo: "pat/app", number: 12, text: "Thanks" }, [`POST ${API}/repos/pat/app/issues/12/comments`], "Commented on pat/app#12"],
    ["github_discussions.comment", { repo: "pat/app", number: 3, text: "Thanks" }, [`POST ${API}/graphql`, `POST ${API}/graphql`], "Commented on discussion pat/app#3"],
    ["github_change.review_create", { repo: "pat/app", number: 12, event: "approve" }, [`POST ${API}/repos/pat/app/pulls/12/reviews`], "Approved pat/app#12"],
    ["github_change.review_submit", { repo: "pat/app", number: 12, reviewId: 9, event: "comment" }, [`POST ${API}/repos/pat/app/pulls/12/reviews/9/events`], "Sent the review of pat/app#12"]
  ];
  for (const [id, args, written, text] of sends) {
    calls.length = 0;
    const live = await logged(context, () => ACTIONS[id].run(contextOf("github", "pat", LIVE), args));
    assert.deepEqual(writes(calls), written, `${id} sends from the live copy`);
    assert.equal(live.result.body.text, text);
    calls.length = 0;
    const copy = await logged(context, () => ACTIONS[id].run(contextOf("github", "pat", TEST_COPY), args));
    assert.deepEqual(calls, [], `${id} sends nothing from a test copy`);
    assert.equal(copy.result.body.text, text, `${id} says what the live copy says`);
    assert.deepEqual(copy.lines.map(([fields]) => [fields.account, fields.repo, fields.number]), [["pat", "pat/app", args.number]]);
  }

  // A review without an event waits unsent on GitHub, so a test copy starts it as the live copy does.
  calls.length = 0;
  const started = await logged(context, () => ACTIONS["github_change.review_create"].run(contextOf("github", "pat", TEST_COPY), { repo: "pat/app", number: 12 }));
  assert.deepEqual(writes(calls), [`POST ${API}/repos/pat/app/pulls/12/reviews`]);
  assert.match(started.result.body.text, /^Started a review of pat\/app#12 \(not sent yet/u);
  assert.deepEqual(started.lines, []);
});

test("issues, pull requests, merges, releases, discussions and automation reruns on GitHub change only from the live copy", async (context) => {
  const calls = fakeApis(context, () => ({
    id: 120,
    number: 31,
    title: "Fix crash",
    node_id: "PR1",
    tag_name: "v1.2",
    draft: false,
    message: "Pull Request successfully merged",
    html_url: "https://github.com/pat/app/issues/12",
    default_branch: "main",
    object: { sha: "abc123" },
    data: {}
  }));
  const API = "https://api.github.com/repos/pat/app";
  const GRAPHQL = "POST https://api.github.com/graphql";
  // Each change: its input, what the live copy writes and says, the kind a test copy logs, and what a test copy says if it differs.
  const changes = [
    ["github_change.issue_create", { title: "Fix crash", body: "It crashes on start" }, [`POST ${API}/issues`], "Opened issue #31 in pat/app: Fix crash", "GitHub issue", "Opened issue #simulated in pat/app: Fix crash"],
    ["github_change.issue_update", { number: 12, state: "closed" }, [`PATCH ${API}/issues/12`], "Closed pat/app#12: Fix crash", "GitHub issue"],
    ["github_change.issue_update", { number: 12, state: "open" }, [`PATCH ${API}/issues/12`], "Reopened pat/app#12: Fix crash", "GitHub issue"],
    ["github_change.issue_update", { number: 12, title: "Fix crash", body: "Now with steps" }, [`PATCH ${API}/issues/12`], "Changed pat/app#12: Fix crash", "GitHub issue"],
    ["github_change.issue_labels", { number: 12, labels: ["bug"] }, [`POST ${API}/issues/12/labels`], "Added the labels bug on pat/app#12", "GitHub labels"],
    ["github_change.issue_labels", { number: 12, labels: ["bug", "ui"], remove: true }, [`DELETE ${API}/issues/12/labels/bug`, `DELETE ${API}/issues/12/labels/ui`], "Took off the labels bug, ui on pat/app#12", "GitHub labels"],
    ["github_change.sub_issue_add", { number: 12, subIssue: 5 }, [`POST ${API}/issues/12/sub_issues`], "Made #5 a sub-issue of pat/app#12", "GitHub issue"],
    ["github_change.pr_create", { title: "Fix crash", head: "fix", base: "main" }, [`POST ${API}/pulls`], "Opened pull request #31 in pat/app: Fix crash", "GitHub pull request", "Opened pull request #simulated in pat/app: Fix crash"],
    ["github_change.pr_update", { number: 12, state: "closed" }, [`PATCH ${API}/pulls/12`], "Closed pull request pat/app#12: Fix crash", "GitHub pull request"],
    ["github_change.pr_draft", { number: 12, undo: true }, [GRAPHQL], "Marked pat/app#12 ready for review", "GitHub pull request"],
    ["github_change.pr_draft", { number: 12 }, [GRAPHQL], "Turned pat/app#12 into a draft", "GitHub pull request"],
    ["github_change.pr_update_branch", { number: 12 }, [`PUT ${API}/pulls/12/update-branch`], "Started bringing pat/app#12's branch up to date with its base", "GitHub merge"],
    ["github_change.pr_merge", { number: 12, method: "squash" }, [`PUT ${API}/pulls/12/merge`], "Merged pull request pat/app#12", "GitHub merge"],
    ["github_change.release_create", { tag: "v1.2", body: "Notes" }, [`POST ${API}/releases`], "Published release v1.2 of pat/app", "GitHub release"],
    ["github_discussions.edit", { number: 3, commentId: "C1", text: "Better words" }, [GRAPHQL], "Changed a comment in discussion pat/app#3", "GitHub comment"],
    ["github_discussions.delete", { number: 3, commentId: "C1" }, [GRAPHQL], "Deleted a comment in discussion pat/app#3", "GitHub comment"],
    ["github_discussions.answer", { number: 3, commentId: "C1" }, [GRAPHQL], "Marked the answer in discussion pat/app#3", "GitHub discussion"],
    ["github_change.run_rerun", { runId: 7 }, [`POST ${API}/actions/runs/7/rerun`], "Started run 7 in pat/app again", "GitHub automation run"],
    ["github_change.run_rerun", { runId: 7, failedOnly: true }, [`POST ${API}/actions/runs/7/rerun-failed-jobs`], "Started run 7 in pat/app again", "GitHub automation run"]
  ];
  const copies = {};
  for (const [id, given, written, said, kind, simulated = said] of changes) {
    const args = { repo: "pat/app", ...given };
    calls.length = 0;
    const live = await logged(context, () => ACTIONS[id].run(contextOf("github", "pat", LIVE), args));
    assert.deepEqual(writes(calls), written, `${id} changes GitHub from the live copy`);
    assert.deepEqual([live.result.body.text, live.lines], [said, []]);
    calls.length = 0;
    const copy = await logged(context, () => ACTIONS[id].run(contextOf("github", "pat", TEST_COPY), args));
    assert.deepEqual(writes(calls), [], `${id} changes nothing from a test copy; it may only read`);
    assert.equal(copy.result.body.text, simulated, `${id} answers as if done`);
    assert.equal(copy.result.result.simulated, true);
    assert.deepEqual(copy.lines.map(([fields]) => [fields.sideEffects, fields.kind, fields.account, fields.repo, fields.number]), [["simulate", kind, "pat", "pat/app", given.number]]);
    assert.doesNotMatch(copy.lines[0][1], /crashes on start|Now with steps|Notes|Better words/u, "never a body");
    copies[id] = copy;
  }

  // What only GitHub could give, a new issue's or pull request's number and a release's page, says it's simulated.
  assert.equal(copies["github_change.issue_create"].result.result.link, "https://github.com/pat/app/issues/simulated");
  assert.equal(copies["github_change.pr_create"].result.result.link, "https://github.com/pat/app/pull/simulated");
  assert.equal(copies["github_change.release_create"].result.result.link, "https://github.com/pat/app/releases/tag/v1.2#simulated");
  assert.equal(
    copies["github_change.issue_create"].lines[0][1],
    'Test copy: opening the issue "Fix crash" in pat/app was simulated, not sent (SIDE_EFFECTS is not live).'
  );
  // A change to an existing issue answers with its own page, read as it is.
  assert.equal(copies["github_change.issue_update"].result.result.link, "https://github.com/pat/app/issues/12");
});

test("GitHub changes not in the conversation others follow run in a test copy too", async (context) => {
  const calls = fakeApis(context, () => ({ id: 9, default_branch: "main", object: { sha: "abc123" } }));
  const API = "https://api.github.com/repos/pat/app";
  const testCopy = contextOf("github", "pat", TEST_COPY);
  const { lines } = await logged(context, async () => {
    await ACTIONS["github_change.branch_create"].run(testCopy, { repo: "pat/app", name: "try" });
    await ACTIONS["github_change.label_create"].run(testCopy, { repo: "pat/app", name: "later" });
    await ACTIONS["github_change.review_delete"].run(testCopy, { repo: "pat/app", number: 12, reviewId: 9 });
  });
  assert.deepEqual(writes(calls), [`POST ${API}/git/refs`, `POST ${API}/labels`, `DELETE ${API}/pulls/12/reviews/9`]);
  assert.deepEqual(lines, []);
});

test("sharing a drive file and commenting on one go out only from the live copy", async (context) => {
  const calls = fakeApis(context, () => ({
    id: "f1",
    name: "Plan",
    mimeType: "application/vnd.google-apps.document",
    webViewLink: "https://docs.google.com/document/d/f1",
    permissions: [{ role: "owner", emailAddress: "pat@example.com" }]
  }));
  const DRIVE = "https://www.googleapis.com/drive/v3/files/f1";
  const ONEDRIVE = "https://graph.microsoft.com/v1.0/me/drive/items/f1";
  const sends = [
    ["google-drive", "drive_change.share", { fileId: "f1", file: "Plan", email: "ana@example.com", role: "comment" }, [`POST ${DRIVE}/permissions`], "Shared Plan with ana@example.com", "drive sharing"],
    ["onedrive", "drive_change.share", { fileId: "f1", file: "Plan", email: "ana@example.com", notify: false }, [`POST ${ONEDRIVE}/invite`], "Shared Plan with ana@example.com", "drive sharing"],
    ["google-drive", "drive_comments.add", { fileId: "f1", file: "Plan", text: "Looks good to me" }, [`POST ${DRIVE}/comments`], "Commented on Plan", "drive comment"],
    ["google-drive", "drive_comments.reply", { fileId: "f1", file: "Plan", commentId: "c0", text: "Looks good to me" }, [`POST ${DRIVE}/comments/c0/replies`], "Replied to a comment on Plan", "drive comment"]
  ];
  const copies = [];
  for (const [pluginId, id, args, written, text, kind] of sends) {
    calls.length = 0;
    const live = await logged(context, () => ACTIONS[id].run(contextOf(pluginId, "pat@example.com", LIVE), args));
    assert.deepEqual(writes(calls), written, `${id} goes out from the live copy`);
    assert.deepEqual([live.result.body.text, live.lines], [text, []]);
    calls.length = 0;
    const copy = await logged(context, () => ACTIONS[id].run(contextOf(pluginId, "pat@example.com", TEST_COPY), args));
    assert.deepEqual(writes(calls), [], `${id} sends nothing from a test copy; it may only read`);
    assert.deepEqual([copy.result.body.text, copy.result.result.simulated], [text, true], `${id} answers as if done`);
    assert.deepEqual(copy.lines.map(([fields]) => [fields.kind, fields.file]), [[kind, "Plan"]]);
    assert.doesNotMatch(copy.lines[0][1], /Looks good/u, "never a comment's words");
    copies.push(copy);
  }

  // A share answers with the file as sharing would leave it, its real link included.
  const [shared, sharedOnOneDrive] = copies;
  assert.deepEqual(shared.lines[0], [
    { sideEffects: "simulate", kind: "drive sharing", account: "Google Drive: pat@example.com", file: "Plan", with: "ana@example.com", role: "comment", emailed: true },
    'Test copy: sharing "Plan" with ana@example.com (comment) was simulated, not sent (SIDE_EFFECTS is not live).'
  ]);
  assert.deepEqual(shared.result.result.sharedWith, [{ who: "ana@example.com", role: "comment" }]);
  assert.match(shared.result.body.detail, /Link: https:\/\/docs\.google\.com\/document\/d\/f1/u);
  assert.deepEqual([sharedOnOneDrive.lines[0][0].account, sharedOnOneDrive.lines[0][0].emailed], ["OneDrive: pat@example.com", false]);

  // OneDrive takes no comments, so a test copy refuses one just as the live copy does.
  await assert.rejects(
    ACTIONS["drive_comments.add"].run(contextOf("onedrive", "pat@example.com", TEST_COPY), sends[2][2]),
    /OneDrive's comments can't be reached/u
  );

  // Making, changing, moving and copying files send nothing to anyone, so a test copy makes them too.
  calls.length = 0;
  const made = await logged(context, () => ACTIONS["drive_change.create_folder"].run(contextOf("google-drive", "pat@example.com", TEST_COPY), { name: "Trips" }));
  assert.deepEqual([writes(calls), made.lines], [["POST https://www.googleapis.com/drive/v3/files"], []]);
});
