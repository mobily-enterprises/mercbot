import assert from "node:assert/strict";
import test from "node:test";
import { createAppConnected } from "../../packages/bots/src/server/appConnected.js";
import { accessOf } from "../support/appKey.mjs";
import { startFakeSedna } from "../support/fakeSedna.mjs";
import gmail from "../../plugins/gmail/plugin.json" with { type: "json" };
import googleDrive from "../../plugins/google-drive/plugin.json" with { type: "json" };
import onedrive from "../../plugins/onedrive/plugin.json" with { type: "json" };
import outlook from "../../plugins/outlook/plugin.json" with { type: "json" };
import sedna from "../../plugins/sedna/plugin.json" with { type: "json" };

// Connected apps for apps' scripts (D-136): the bots' own tools, for one person, kept to the one app the script names,
// changing anything only when the person pressed a button. Stand-ins for integrations and for Gmail's and Graph's APIs.

const ACCOUNTS = [
  { id: "1", pluginId: "gmail", name: "", label: "pat@example.com", status: "connected", userId: "7" },
  { id: "2", pluginId: "outlook", name: "", label: "pat@work.example", status: "connected", userId: "7" },
  { id: "3", pluginId: "google-drive", name: "", label: "pat@example.com", status: "connected", userId: "7" }
];

function fakeIntegrations({ connected = ["gmail", "outlook", "google-drive"] } = {}) {
  const catalogue = [gmail, outlook, googleDrive, onedrive, sedna];
  return {
    app: (id) => catalogue.find((entry) => entry.id === id) || null,
    appName: (id) => catalogue.find((entry) => entry.id === id)?.name || id,
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [], connected }),
    reachableAccounts: async (_call, { pluginIds = [] } = {}) =>
      ACCOUNTS.filter((account) => connected.includes(account.pluginId) && pluginIds.includes(account.pluginId)),
    connections: { accessToken: async (id) => accessOf(`key-${id}`) },
    connectors: { apps: () => [] }
  };
}

function fakeApi(context) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${url}`);
    const body = String(url).includes("/drive/")
      ? { files: [{ id: "f1", name: "Plan", mimeType: "text/plain", modifiedTime: "2026-11-20T10:00:00Z" }] }
      : String(url).includes("/drafts")
      ? { id: "d1" }
      : String(url).includes("/messages/m1")
        ? { id: "m1", snippet: "Server down", payload: { headers: [{ name: "Subject", value: "Urgent" }] } }
        : String(url).includes("gmail")
          ? { messages: [{ id: "m1" }] }
          : { value: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

const call = { context: { actor: { id: "7" } } };
const profiles = { findById: async () => ({ email: "pat@acme.example" }) };
const connectedApps = (integrations = fakeIntegrations()) =>
  createAppConnected({ integrations, profiles, env: { APP_ENV: "test" }, records: { work: null, bots: null, turns: null }, apps: null });

test("a read reaches only the app the script names, though another app offers the same tool", async (context) => {
  const calls = fakeApi(context);
  const answer = await connectedApps().run(call, { app: "gmail", action: "search_email", input: { query: "urgent" } }, "read");
  assert.equal(answer.mailboxes.length, 1);
  assert.equal(answer.mailboxes[0].emails[0].subject, "Urgent");
  assert.ok(calls.length && calls.every((line) => line.includes("gmail.googleapis.com")), "Outlook is never asked");
});

test("a change runs only from a pressed button, in the named app's account", async (context) => {
  const calls = fakeApi(context);
  const draft = { app: "gmail", action: "mail_drafts.create", input: { to: ["sam@example.com"], subject: "Hi", text: "Hello" } };
  await assert.rejects(connectedApps().run(call, draft, "read"), { code: "apps_connected_write_refused" });
  assert.deepEqual(calls.filter((line) => line.startsWith("POST")), [], "a job or a screen changes nothing");

  assert.equal((await connectedApps().run(call, draft, "button")).status, "done");
  const posts = calls.filter((line) => line.startsWith("POST"));
  assert.equal(posts.length, 1);
  assert.match(posts[0], /gmail\.googleapis\.com.*\/drafts$/u);
});

test("refusals: an app that isn't one, an action it lacks or that lives in a chat, an app not connected", async () => {
  const apps = connectedApps(fakeIntegrations({ connected: ["outlook"] }));
  await assert.rejects(apps.run(call, { app: "nope", action: "search_email" }, "read"), { code: "apps_connected_unknown" });
  await assert.rejects(apps.run(call, { app: "outlook", action: "show_draft" }, "button"), { code: "apps_connected_no_action" });
  await assert.rejects(apps.run(call, { app: "outlook", action: "github_issues" }, "read"), { code: "apps_connected_no_action" });
  await assert.rejects(apps.run(call, { app: "gmail", action: "search_email" }, "read"), { code: "apps_connected_not_connected" });
});

test("the actions a script may call: the allowed, connected apps' own, never the chat's", async () => {
  const listed = await connectedApps(fakeIntegrations({ connected: ["gmail"] })).actions(call, ["gmail", "outlook"]);
  assert.ok(listed.length > 10);
  assert.ok(listed.every((entry) => entry.app === "gmail"), "Outlook isn't connected");
  assert.ok(!listed.some((entry) => ["show_draft", "send_draft"].includes(entry.action)));
  assert.deepEqual(await connectedApps().actions(call, []), [], "nothing allowed, nothing listed");
});

test("a job or a screen reads drives too: a read the tools record as tried is no change", async (context) => {
  fakeApi(context);
  const answer = await connectedApps().run(call, { app: "google-drive", action: "list_drive_files" }, "read");
  assert.deepEqual(answer.files.map((file) => file.name), ["Plan"]);
});

test("actions for a chat or a bot's files aren't for apps, and aren't listed", async () => {
  const apps = connectedApps(fakeIntegrations({ connected: ["google-drive", "onedrive", "sedna"] }));
  for (const [app, action] of [
    ["google-drive", "drive_read.download"],
    ["google-drive", "save_to_drive"],
    ["onedrive", "create_drive_document"],
    ["sedna", "sedna_draft"],
    ["sedna", "sedna_inbox.new"],
    ["sedna", "sedna_attachments.save"]
  ]) await assert.rejects(apps.run(call, { app, action }, "button"), { code: "apps_connected_no_action" }, `${app} ${action}`);
  const listed = (await apps.actions(call, ["google-drive", "onedrive", "sedna"])).map((entry) => `${entry.app} ${entry.action}`);
  assert.ok(listed.includes("google-drive create_drive_document") && listed.includes("google-drive drive_read.read"));
  for (const left of ["onedrive create_drive_document", "google-drive save_to_drive", "sedna sedna_draft", "sedna sedna_mail.attach"]) {
    assert.ok(!listed.includes(left), left);
  }
});

test("Sedna sends only as the Sedna user of the person who pressed, whatever the script asks", async (context) => {
  const fake = await startFakeSedna();
  context.after(() => fake.close());
  const api = `${fake.url}/acme/platform/2019-01-01`;
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: fake.clientId, client_secret: fake.clientSecret });
  const key = (await (await fetch(`${fake.url}/acme/platform/oauth/token`, { method: "POST", body: form })).json()).access_token;
  const asked = [];
  const pat = { id: "201", name: "Pat Doe", email: "pat@acme.example", teams: [{ id: "11", name: "Chartering" }] };
  const integrations = (who) => ({
    ...fakeIntegrations({ connected: ["sedna"] }),
    reachableAccounts: async () => [{ id: "9", pluginId: "sedna", name: "", label: "Acme Shipping", status: "connected", home: true }],
    connections: {
      accessToken: async () => ({ ...accessOf(key), api }),
      appPerson: async (_id, options) => {
        asked.push(options);
        return who;
      }
    }
  });
  const send = { app: "sedna", action: "sedna_mail.send", input: { to: "kim@brokers.example", subject: "Hello", text: "Hi", fromUser: "203" } };
  const live = (who) => createAppConnected({
    integrations: integrations(who), profiles, env: { APP_ENV: "production" }, records: { work: null, bots: null, turns: null }, apps: null
  });

  await assert.rejects(live({ person: pat, via: "email" }).run(call, send, "read"), { code: "apps_connected_write_refused" });
  assert.equal(fake.sent.length, 0);
  assert.equal((await live({ person: pat, via: "email" }).run(call, send, "button")).status, "done");
  assert.deepEqual(fake.sent.map((entry) => [entry.from, entry.team]), [["201", "11"]], "Pat's own user, never the one named");
  assert.ok(asked.length && asked.every((options) => options === call), "who they are in Sedna is asked for the pressing person's call");

  await assert.rejects(live({ person: null, asked: null }).run(call, send, "button"), /isn't matched to a Sedna user/u);
  assert.equal(fake.sent.length, 1, "someone who is no one in Sedna sends nothing");
});
