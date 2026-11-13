import assert from "node:assert/strict";
import test from "node:test";
import { accountTitle, connectedKey, connectedKeys, zoned } from "../../packages/bots/src/server/connectedApps.js";
import * as google from "../../packages/bots/src/server/googleApps.js";
import { addCalendarEvent, bodyText, calendarEvents, readEmail, searchEmail, sendEmail } from "../../packages/bots/src/server/googleApps.js";
import * as microsoft from "../../packages/bots/src/server/microsoftApps.js";
import * as github from "../../packages/bots/src/server/githubApps.js";

// Bots' Google Calendar and Gmail calls (D-31), against a stand-in for Google's APIs.
function fakeGoogle(context, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.authorization });
    const match = Object.entries(routes).find(([pattern]) => String(url).includes(pattern));
    const [status, body] = match ? match[1] : [404, { error: { message: "not found" } }];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

test("local times become moments in the person's time zone", () => {
  assert.equal(zoned("2026-07-01T13:00", "Europe/London"), "2026-07-01T13:00:00+01:00");
  assert.equal(zoned("2026-12-01T13:00", "Europe/London"), "2026-12-01T13:00:00+00:00");
  assert.equal(zoned("2026-10-28", "Australia/Sydney"), "2026-10-28T00:00:00+11:00");
  assert.equal(zoned("2026-10-28T09:30:00Z", "Australia/Sydney"), "2026-10-28T09:30:00Z");
});

test("calendar events come from every visible calendar, in time order, in the calendar's own zone", async (context) => {
  const calls = fakeGoogle(context, {
    "/calendarList": [200, { items: [{ id: "primary", primary: true, timeZone: "Australia/Sydney", summary: "Pat" }, { id: "family@group", summary: "Family" }, { id: "hidden", summary: "Hidden", selected: false }] }],
    "/calendars/primary/events": [200, { items: [{ id: "e1", summary: "Dentist", start: { dateTime: "2026-10-28T15:00:00+11:00" }, end: { dateTime: "2026-10-28T16:00:00+11:00" } }] }],
    "/calendars/family%40group/events": [200, { items: [{ id: "e2", summary: "School run", start: { dateTime: "2026-10-28T08:30:00+11:00" }, end: { dateTime: "2026-10-28T09:00:00+11:00" }, organizer: { email: "sam@example.com" }, attendees: [{ email: "pat@example.com", self: true, responseStatus: "needsAction" }] }] }]
  });
  const { timeZone, events } = await calendarEvents("key-1", { from: "2026-10-28T00:00", to: "2026-10-29T00:00", timeZone: "UTC" });
  assert.equal(timeZone, "Australia/Sydney");
  assert.deepEqual(events.map((event) => `${event.calendar}: ${event.title}`), ["Family: School run", "Pat: Dentist"]);
  assert.deepEqual([events[0].calendarId, events[0].id, events[0].organiser, events[0].myAnswer], ["family@group", "e2", "sam@example.com", "needsAction"]);
  assert.ok(calls.every((call) => call.auth === "Bearer key-1"));
  assert.ok(!calls.some((call) => call.url.includes("/calendars/hidden/")));
  assert.match(calls[1].url, /timeMin=2026-10-28T00%3A00%3A00%2B11%3A00/u);
});

test("an event is added to the main calendar, and only invitations send updates", async (context) => {
  const calls = fakeGoogle(context, { "/calendars/primary/events": [200, { summary: "Lunch with Ana", start: { dateTime: "2026-11-03T13:00:00+11:00" }, htmlLink: "https://calendar.google.com/e" }] });
  await addCalendarEvent("key", { title: "Lunch with Ana", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timeZone: "Australia/Sydney" });
  await addCalendarEvent("key", { title: "Lunch with Ana", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timeZone: "Australia/Sydney", attendees: ["ana@example.com"] });
  const posts = calls.filter((call) => call.method === "POST");
  assert.match(posts[0].url, /sendUpdates=none/u);
  assert.equal(posts[0].body.start.dateTime, "2026-11-03T13:00:00+11:00");
  assert.equal(posts[0].body.attendees, undefined);
  assert.match(posts[1].url, /sendUpdates=all/u);
  assert.deepEqual(posts[1].body.attendees, [{ email: "ana@example.com" }]);
});

test("a Google event is booked in the calendar's zone, changed, removed and answered", async (context) => {
  const calls = fakeGoogle(context, {
    "/calendarList/primary": [200, { timeZone: "Europe/Rome" }],
    "/calendars/primary/events?": [200, { summary: "Lunch" }],
    "/calendars/primary/events/e1": [200, { summary: "Lunch", start: { dateTime: "2026-11-03T13:00:00+01:00", timeZone: "Europe/Rome" }, attendees: [{ email: "me@example.com", self: true }] }]
  });
  await addCalendarEvent("key", { title: "Lunch", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timeZone: "UTC" });
  assert.equal(calls.find((call) => call.method === "POST").body.start.dateTime, "2026-11-03T13:00:00+01:00");
  await google.changeCalendarEvent("key", { eventId: "e1", start: "2026-11-03T14:00", attendees: ["ana@example.com"], timeZone: "UTC" });
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch.body.start.dateTime, "2026-11-03T14:00:00+01:00");
  assert.deepEqual(patch.body.attendees.map((person) => person.email), ["me@example.com", "ana@example.com"]);
  assert.match(patch.url, /sendUpdates=all/u);
  await google.deleteCalendarEvent("key", { eventId: "e1", guests: 0 });
  assert.match(calls.find((call) => call.method === "DELETE").url, /events\/e1\?sendUpdates=none/u);
  await google.answerInvitation("key", { eventId: "e1", answer: "maybe" });
  assert.equal(calls.filter((call) => call.method === "PATCH")[1].body.attendees[0].responseStatus, "tentative");
});

test("email search and reading give sender, subject and the plain text", async (context) => {
  const b64 = (text) => Buffer.from(text).toString("base64url");
  fakeGoogle(context, {
    "/messages?": [200, { messages: [{ id: "m1" }] }],
    "/messages/m1?format=metadata": [200, { snippet: "Your flight", labelIds: ["UNREAD"], payload: { headers: [{ name: "From", value: "Air <a@air.example>" }, { name: "Subject", value: "Booking" }] } }],
    "/messages/m1?format=full": [200, { payload: { headers: [{ name: "Subject", value: "Booking" }], mimeType: "multipart/alternative", parts: [
      { mimeType: "text/html", body: { data: b64("<p>Ignored</p>") } },
      { mimeType: "text/plain", body: { data: b64("Flight QF1 on 3 Nov") } }
    ] } }]
  });
  const [found] = await searchEmail("key", "from:air");
  assert.equal(found.subject, "Booking");
  assert.equal(found.unread, true);
  const email = await readEmail("key", "m1");
  assert.equal(email.text, "Flight QF1 on 3 Nov");
  assert.equal(bodyText({ mimeType: "text/html", body: { data: b64("<style>x{}</style><p>Hello&nbsp;there</p>") } }), "Hello there");
});

test("a refused key says to sign in again", async (context) => {
  fakeGoogle(context, { "/calendarList": [401, { error: { message: "Invalid Credentials" } }] });
  await assert.rejects(calendarEvents("old", { from: "2026-10-28", to: "2026-10-29", timeZone: "UTC" }), /signing in again/u);
});

// Several accounts of one app: all of them unless one is named, by address or label.
test("tools use every connected account unless one is named", async () => {
  const rows = [
    { id: 1, name: "", label: "pat@example.com" },
    { id: 2, name: "work", label: "pat@work.example" }
  ];
  const reachableAccounts = async () => rows.map((row) => ({ ...row, pluginId: "gmail", status: "connected" }));
  const app = { integrations: { reachableAccounts, connections: { accessToken: async (_reach, id) => ({ accessToken: `key-${id}` }) } }, reach: { userId: 7 } };
  assert.deepEqual((await connectedKeys(app, "gmail", "Gmail")).map((entry) => `${entry.account}=${entry.key}`), ["pat@example.com=key-1", "work · pat@work.example=key-2"]);
  assert.equal((await connectedKeys(app, "gmail", "Gmail", "WORK"))[0].key, "key-2");
  assert.equal((await connectedKey(app, "gmail", "Gmail", "pat@example.com")).key, "key-1");
  await assert.rejects(connectedKey(app, "gmail", "Gmail"), /Several Gmail accounts are connected \(pat@example.com; work · pat@work.example\)/u);
  await assert.rejects(connectedKeys(app, "gmail", "Gmail", "home"), /no connected Gmail account called home/u);
  assert.equal(accountTitle({ name: "", label: null }), "");
});

test("a Gmail send is a plain-text message to the approved addresses", async (context) => {
  const calls = fakeGoogle(context, { "/messages/send": [200, { id: "s1" }] });
  await sendEmail("key", { to: ["ana@example.com"], subject: "Lunch è", text: "See you at 1." });
  const raw = Buffer.from(calls[0].body.raw, "base64url").toString("utf8");
  assert.match(raw, /^To: ana@example\.com\r\n/u);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/u);
  assert.equal(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString("utf8"), "See you at 1.");
});

test("Outlook: Gmail-style search words become filters, and events are added in UTC", async (context) => {
  const calls = fakeGoogle(context, {
    "/mailFolders/inbox/messages": [200, { value: [{ id: "o1", subject: "Hi", from: { emailAddress: { name: "Ana", address: "ana@example.com" } }, receivedDateTime: new Date().toISOString(), bodyPreview: "Hello", isRead: false }] }],
    "/messages?$search": [200, { value: [] }],
    "/me/events": [200, { subject: "Lunch", start: { dateTime: "2026-11-03T02:00:00" }, webLink: "https://outlook/e" }]
  });
  const found = await microsoft.searchEmail("key", "in:inbox newer_than:7d is:unread");
  assert.equal(found[0].from, "Ana <ana@example.com>");
  assert.match(decodeURIComponent(calls[0].url), /receivedDateTime ge .* and isRead eq false/u);
  await microsoft.searchEmail("key", "from:airline newer_than:30d");
  assert.match(decodeURIComponent(calls[1].url), /\$search="from:airline"/u);
  await microsoft.addCalendarEvent("key", { title: "Lunch", start: "2026-11-03T13:00", end: "2026-11-03T14:00", timeZone: "Australia/Sydney", attendees: ["ana@example.com"] });
  assert.deepEqual(calls[2].body.start, { dateTime: "2026-11-03T02:00:00.000", timeZone: "UTC" });
  assert.deepEqual(calls[2].body.attendees, [{ emailAddress: { address: "ana@example.com" }, type: "required" }]);
});

test("Outlook: events read in the person's zone, and invitations answered", async (context) => {
  const calls = fakeGoogle(context, {
    "/calendars?": [200, { value: [{ id: "c1", name: "Calendar" }] }],
    "/calendarView": [200, { value: [{ id: "o1", subject: "Lunch", start: { dateTime: "2026-11-03T02:00:00.0000000" }, end: { dateTime: "2026-11-03T03:00:00.0000000" }, isOrganizer: false, responseStatus: { response: "notResponded" } }] }],
    "/events/o1/tentativelyAccept": [202, {}]
  });
  const { events } = await microsoft.calendarEvents("key", { from: "2026-11-03", to: "2026-11-04", timeZone: "Australia/Sydney" });
  assert.deepEqual([events[0].id, events[0].start, events[0].myAnswer], ["o1", "2026-11-03T13:00+11:00", "notResponded"]);
  await microsoft.answerInvitation("key", { eventId: "o1", answer: "maybe" });
  assert.deepEqual(calls.at(-1).body, { sendResponse: true });
});

test("GitHub: a pull request comes with its reviews and test results", async (context) => {
  fakeGoogle(context, {
    "/repos/o/r/issues/7/comments": [200, [{ user: { login: "sam" }, created_at: "2026-10-27", body: "Looks good" }]],
    "/repos/o/r/issues/7": [200, { title: "Fix login", state: "open", user: { login: "pat" }, body: "Fixes #3", pull_request: {}, html_url: "https://github.com/o/r/pull/7" }],
    "/repos/o/r/pulls/7/reviews": [200, [{ user: { login: "sam" }, state: "APPROVED", body: "" }]],
    "/repos/o/r/pulls/7": [200, { head: { ref: "fix", sha: "abc" }, base: { ref: "main" }, merged: false, mergeable: true, changed_files: 2, additions: 10, deletions: 3 }],
    "/repos/o/r/commits/abc/check-runs": [200, { check_runs: [{ name: "test", status: "completed", conclusion: "failure" }] }]
  });
  const pull = await github.readIssue("key", "o/r", 7);
  assert.equal(pull.kind, "pull request");
  assert.deepEqual(pull.checks, [{ name: "test", status: "completed", result: "failure" }]);
  assert.equal(pull.reviews[0].state, "APPROVED");
  await assert.rejects(github.readIssue("key", "not a repo", 1), /owner\/name/u);
});

test("GitHub: the week's summary puts what waits on the person first, then commits by repository", async (context) => {
  const calls = fakeGoogle(context, {
    "/user/": [404, {}],
    "/search/issues": [200, { total_count: 1, items: [{ repository_url: "https://api.github.com/repos/o/r", number: 4, title: "Review me", state: "open", user: { login: "sam" }, pull_request: {}, html_url: "https://github.com/o/r/pull/4", comments: 0 }] }],
    "/users/pat/events": [200, [
      { type: "PushEvent", repo: { name: "pat/site" }, created_at: "2026-10-26T10:00:00Z", payload: { size: 3, commits: [{ message: "Fix menu\n\nlong" }] } },
      { type: "PushEvent", repo: { name: "pat/notes" }, created_at: "2026-10-25T10:00:00Z", payload: { size: 1 } },
      { type: "ReleaseEvent", repo: { name: "pat/site" }, created_at: "2026-10-26T12:00:00Z", payload: { release: { tag_name: "v1.2", html_url: "https://github.com/pat/site/releases/v1.2" } } },
      { type: "PushEvent", repo: { name: "pat/old" }, created_at: "2026-10-01T10:00:00Z", payload: { size: 9 } }
    ]],
    "/user": [200, { login: "pat", html_url: "https://github.com/pat" }]
  });
  const week = await github.activity("key", { since: "2026-10-20" });
  assert.equal(week.attention.length, 1, "the same pull request found by several searches is listed once");
  assert.equal(week.attention[0].why, "review requested");
  assert.equal(week.commits, 4);
  assert.deepEqual(week.byRepo.map((repo) => `${repo.repo}:${repo.commits}`), ["pat/site:3", "pat/notes:1"]);
  assert.deepEqual(week.byRepo[0].messages, ["Fix menu"]);
  assert.equal(week.releases[0].version, "v1.2");
  assert.ok(calls.some((call) => call.url.includes("mentions%3Apat+updated%3A%3E%3D2026-10-20")));
});

test("one address in two apps: named by app, listed with the app's name", async () => {
  const rows = [
    { id: 3, pluginId: "google-calendar", name: "", label: "pat@example.com", status: "connected" },
    { id: 9, pluginId: "outlook", name: "", label: "pat@example.com", status: "connected" }
  ];
  const reachableAccounts = async () => rows;
  const app = { integrations: { reachableAccounts, connections: { accessToken: async (_reach, id) => ({ accessToken: `key-${id}` }) } }, reach: { userId: 7 } };
  const both = await connectedKeys(app, ["google-calendar", "outlook"], "calendar");
  assert.deepEqual(both.map((entry) => entry.account), ["Google Calendar: pat@example.com", "Outlook: pat@example.com"], "Google first, each named with its app");
  assert.equal((await connectedKey(app, ["google-calendar", "outlook"], "calendar", "the Google one")).key, "key-3");
  assert.equal((await connectedKey(app, ["google-calendar", "outlook"], "calendar", "Outlook pat@example.com")).key, "key-9");
  assert.equal((await connectedKeys(app, ["google-calendar", "outlook"], "calendar", "pat@example.com")).length, 2);
  await assert.rejects(connectedKey(app, ["google-calendar", "outlook"], "calendar", "work"), /ask_with_options/u);
});

// An action switched off for one app says so, never that the account is unknown.
test("an action switched off for the named account's app is reported as switched off", async () => {
  const rows = [
    { id: 8, pluginId: "gmail", name: "work", label: "pat@gmail.com", status: "connected" },
    { id: 13, pluginId: "outlook", name: "", label: "pat@outlook.com", status: "connected" }
  ];
  const reachableAccounts = async () => rows;
  const app = (skip) => ({ integrations: { reachableAccounts, connections: { accessToken: async (_reach, id) => ({ accessToken: `key-${id}` }) } }, reach: { userId: 7 }, skip });
  await assert.rejects(connectedKey(app(["gmail"]), ["gmail", "outlook"], "email", "Gmail: work · pat@gmail.com"), /switched this action off for Gmail in Connect apps.*Don't blame the account/u);
  assert.equal((await connectedKey(app(["gmail"]), ["gmail", "outlook"], "email", "pat@outlook.com")).key, "key-13", "the other app still works");
  await assert.rejects(connectedKey(app(["gmail", "outlook"]), ["gmail", "outlook"], "email"), /switched this action off for Gmail and Outlook/u);
  await assert.rejects(connectedKey(app(["outlook"]), ["outlook"], "email"), /switched this action off for Outlook/u);
  await assert.rejects(connectedKey(app([]), ["gmail", "outlook"], "email", "nope"), /no connected email account called nope/u);
});

// "Outlook: pat@gmail.com" is the Outlook one: the address's own domain doesn't name Gmail (D-42).
test("an app named in an address's domain isn't taken as naming that app", async () => {
  const rows = [
    { id: 8, pluginId: "gmail", name: "", label: "pat@gmail.com", status: "connected" },
    { id: 13, pluginId: "outlook", name: "", label: "pat@gmail.com", status: "connected" }
  ];
  const reachableAccounts = async () => rows;
  const app = { integrations: { reachableAccounts, connections: { accessToken: async (_reach, id) => ({ accessToken: `key-${id}` }) } }, reach: { userId: 7 } };
  assert.equal((await connectedKey(app, ["gmail", "outlook"], "email", "Outlook: pat@gmail.com")).key, "key-13");
  assert.equal((await connectedKey(app, ["gmail", "outlook"], "email", "Gmail: pat@gmail.com")).key, "key-8");
  assert.equal((await connectedKeys(app, ["gmail", "outlook"], "email", "pat@gmail.com")).length, 2);
});
