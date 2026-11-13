import assert from "node:assert/strict";
import test from "node:test";
import * as google from "../../packages/bots/src/server/googleApps.js";
import * as microsoft from "../../packages/bots/src/server/microsoftApps.js";
import { MAIL_ACTIONS, buildMailTools } from "../../packages/bots/src/server/mailTools.js";

// The rest of the mailbox (D-42), against stand-ins for Gmail's and Graph's APIs.
function fakeApi(context, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    const match = Object.entries(routes).find(([pattern]) => {
      const [method, part] = pattern.includes(" ") ? pattern.split(" ") : ["", pattern];
      return (!method || method === (options.method || "GET")) && String(url).includes(part);
    });
    const [status, body] = match ? match[1] : [404, { error: { message: "not found" } }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}
const decoded = (raw) => Buffer.from(raw, "base64url").toString("utf8");

test("Gmail: sorting mail uses labels and the bin, and undo reverses each", async (context) => {
  const calls = fakeApi(context, {
    "/labels": [200, { labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_7", name: "Receipts", type: "user" }] }],
    "/modify": [200, {}],
    "/trash": [200, {}],
    "/untrash": [200, {}]
  });
  await google.organiseEmail("k", "m1", { action: "archive" });
  await google.organiseEmail("k", "m1", { action: "spam", undo: true });
  await google.organiseEmail("k", "m1", { action: "bin" });
  await google.organiseEmail("k", "m1", { action: "bin", undo: true });
  await google.organiseEmail("k", "m1", { action: "move", label: "receipts" });
  const changes = calls.filter((call) => call.method === "POST").map((call) => `${call.url.split("/m1/")[1]} ${JSON.stringify(call.body)}`);
  assert.deepEqual(changes, [
    'modify {"addLabelIds":[],"removeLabelIds":["INBOX"]}',
    'modify {"addLabelIds":["INBOX"],"removeLabelIds":["SPAM"]}',
    "trash null",
    "untrash null",
    'modify {"addLabelIds":["Label_7"],"removeLabelIds":["INBOX"]}'
  ]);
  await assert.rejects(google.organiseEmail("k", "m1", { action: "label", label: "Nope" }), /no label called Nope/u);
});

test("Gmail: a saved draft keeps what wasn't changed, and a forward carries the original below a note", async (context) => {
  const draftBody = Buffer.from("Hi Kim,\nSee you Friday.").toString("base64url");
  const calls = fakeApi(context, {
    "GET /drafts/d1": [200, { id: "d1", message: { payload: { mimeType: "text/plain", headers: [{ name: "To", value: "kim@example.com" }, { name: "Subject", value: "Friday" }], body: { data: draftBody } } } }],
    "PUT /drafts/d1": [200, { id: "d1" }],
    "POST /drafts": [200, { id: "d2" }],
    "GET /messages/m9": [200, { threadId: "t9", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Ana <ana@example.com>" }, { name: "Subject", value: "Tickets" }, { name: "To", value: "pat@example.com" }], body: { data: Buffer.from("Two tickets attached.").toString("base64url") } } }],
    "/messages/send": [200, { id: "s1" }]
  });
  await google.updateDraft("k", "d1", { subject: "Friday dinner" });
  const update = calls.find((call) => call.method === "PUT");
  const raw = decoded(update.body.message.raw);
  assert.match(raw, /^To: kim@example\.com/mu);
  assert.match(raw, /^Subject: Friday dinner/mu);
  assert.equal(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString(), "Hi Kim,\nSee you Friday.");

  assert.deepEqual(await google.createDraft("k", { to: ["sam@example.com"], subject: "Hello", text: "Hi Sam" }), { id: "d2" });

  const sent = await google.forwardEmail("k", "m9", { to: ["sam@example.com"], note: "FYI" });
  assert.deepEqual([sent.subject, sent.attachmentsLeftOut], ["Fwd: Tickets", true]);
  const forward = decoded(calls.find((call) => call.url.endsWith("/messages/send")).body.raw);
  const text = Buffer.from(forward.split("\r\n\r\n")[1], "base64").toString();
  assert.match(text, /^FYI\n\n---------- Forwarded message ----------\nFrom: Ana <ana@example\.com>/u);
  assert.match(text, /Two tickets attached\.$/u);
});

test("Outlook: sorting moves to Outlook's own folders, labels are categories, a forward is Outlook's own", async (context) => {
  const calls = fakeApi(context, {
    "/move": [200, { id: "m1-moved" }],
    "GET /messages/m1?$select=categories": [200, { categories: ["Red"] }],
    "PATCH /messages/m1": [200, {}],
    "GET /messages/m2?$select=subject": [200, { subject: "Tickets" }],
    "/forward": [202, {}]
  });
  assert.deepEqual(await microsoft.organiseEmail("k", "m1", { action: "spam" }), { id: "m1-moved" });
  await microsoft.organiseEmail("k", "m1", { action: "bin", undo: true });
  await microsoft.organiseEmail("k", "m1", { action: "label", label: "Receipts" });
  await microsoft.organiseEmail("k", "m1", { action: "star" });
  assert.deepEqual(calls.filter((call) => call.method !== "GET").map((call) => JSON.stringify(call.body)), [
    '{"destinationId":"junkemail"}',
    '{"destinationId":"inbox"}',
    '{"categories":["Red","Receipts"]}',
    '{"flag":{"flagStatus":"flagged"}}'
  ]);
  const sent = await microsoft.forwardEmail("k", "m2", { to: ["sam@example.com"], note: "FYI" });
  assert.equal(sent.subject, "FW: Tickets");
  assert.deepEqual(calls.at(-1).body, { comment: "FYI", toRecipients: [{ emailAddress: { address: "sam@example.com" } }] });
  await assert.rejects(microsoft.mailFilters("k"), /this is for Gmail/u);
});

test("Outlook: Gmail's in: words search Outlook's own folders, or one of the person's by name", async (context) => {
  const calls = fakeApi(context, {
    "/mailFolders/junkemail/messages": [200, { value: [{ id: "j1", subject: "Win", from: { emailAddress: { address: "x@example.com" } }, receivedDateTime: new Date().toISOString(), isRead: false }] }],
    "GET /mailFolders?$top": [200, { value: [{ id: "F42", displayName: "Receipts" }] }],
    "/mailFolders/F42/messages": [200, { value: [] }]
  });
  assert.equal((await microsoft.searchEmail("k", "in:spam"))[0].id, "j1");
  await microsoft.searchEmail("k", "in:receipts from:shop");
  assert.match(decodeURIComponent(calls.at(-1).url), /\/mailFolders\/F42\/messages\?\$search="from:shop"/u);
});

test("each mail action is its own switch: one switched off everywhere leaves the tool, all off removes it", () => {
  const shared = { appFor: () => ({}), attempt: async () => ({}), failed: (error) => ({ error: error.message }), account: () => undefined, statusLine: undefined, personAsked: undefined };
  const all = buildMailTools({ ...shared, removed: [] });
  assert.deepEqual(Object.keys(all).sort(), ["forwardEmail", "mailAccount", "mailDrafts", "mailLabels", "organiseEmail"]);
  assert.deepEqual(all.mailDrafts.inputSchema.shape.action.options, ["list", "read", "create", "update", "delete", "send"]);

  const fewer = buildMailTools({ ...shared, removed: ["mail_drafts.send", "mail_drafts.delete", "mail_labels.create", "mail_labels.rename", "mail_labels.delete"] });
  assert.deepEqual(fewer.mailDrafts.inputSchema.shape.action.options, ["list", "read", "create", "update"]);
  assert.equal(fewer.mailLabels, undefined, "every label action off: no label tool");

  // Every change goes through approvals; sending and deleting only go ahead unasked when the person asked for exactly that.
  assert.equal(MAIL_ACTIONS["mail_drafts.send"].reversible({ personAsked: false }), false);
  assert.equal(MAIL_ACTIONS["mail_drafts.send"].reversible({ personAsked: true }), true);
  assert.equal(MAIL_ACTIONS["organise_email.bin"].reversible({}), true);
  assert.equal(MAIL_ACTIONS.forward_email.reversible({ personAsked: false }), false);
});
