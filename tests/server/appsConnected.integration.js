import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { appsHome, appsParts, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { createWatches } from "../../packages/apps/src/server/watches.js";

// Apps' scripts using connected apps (D-136), on the test database, with a stand-in for the bots' shared layer (its own
// rules are tests/server/appConnected.test.js's): who a call acts as, which apps an app may use and who chooses them,
// only a button changes anything, a public app's visitors and public apps never use them, limits, a draft's preview,
// the activity trail, and a job's person until they leave.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/**
 * The shared layer's stand-in: Gmail and Sedna exist; a draft is a change, a search a read, and sending is a change the
 * person's approval rules ask about. Each call is kept.
 */
function fakeConnected() {
  const calls = [];
  return {
    calls,
    async runConfirmed(call, appId, { actionId, args }) {
      calls.push({ person: String(resolveAuditActorId(call.context) ?? ""), app: appId, action: actionId, args, mode: "confirmed" });
      return "Sent.";
    },
    usable: (id) => ["gmail", "sedna"].includes(id),
    choices: async () => [{ id: "gmail", name: "Gmail" }],
    actions: async (_call, allowed) => allowed.map((app) => ({ app, action: "search_email", name: "Search email" })),
    async run(call, request, mode, outcome) {
      calls.push({ person: String(resolveAuditActorId(call.context) ?? ""), app: request.app, action: request.action, mode });
      if (!request.action.startsWith("mail_drafts.")) return { mailboxes: [{ emails: [{ subject: "Server down" }] }] };
      if (mode !== "button") throw Object.assign(new Error("Only a button can change anything."), { code: "apps_connected_write_refused" });
      if (request.action === "mail_drafts.send") {
        outcome.waiting.push({ actionId: request.action, args: { id: request.input.id, personAsked: true }, question: `Shall I send the draft ${request.input.id}?` });
        return { status: "waiting_for_approval" };
      }
      outcome.made.push(request.action);
      return { status: "done" };
    }
  };
}

test("connected apps for scripts: who, which, only buttons change, never public, limits, previews, activity, leaving", async (context) => {
  const testKnex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => testKnex.destroy());
  const connected = fakeConnected();
  // The Logic tab's list reads app_jobs, whose row rule is the bots' records' (botsOf's stand-in).
  const home = await appsHome(cleanup, {
    slug: "apps-connected",
    knex: testKnex,
    records: botsOf(testKnex),
    extras: { inputs: { "mercbot.app-connected": connected } }
  });
  const { knex, userId, workspaceId, options, workspace } = home;
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args)
  });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, connected: () => connected });
  const watches = createWatches({ resources, repository, systemContext, registry, gate, apps });
  cleanup.after(() => scripts.close());
  const actor = { type: "person", id: userId, name: "Pat" };
  await registry.createTable(actor, { key: "notes", fields: [{ key: "text", type: "text" }] }, options);
  await apps.createApp(actor, { name: "Canary" }, options);
  const appId = (await apps.find("canary", options)).id;
  // A saved script is the draft's until it's published (D-139).
  const save = async (input) => {
    const result = await scripts.save(actor, "canary", input, options);
    if (!result.errors.length) await apps.publish(actor, "canary", {}, options);
    return result;
  };
  const press = (key, input = {}, reach = null) => scripts.runNamed("action", appId, key, input, { kind: "button" }, reach, options);
  const show = (key, reach = null) => scripts.runNamed("source", appId, key, {}, { kind: "screen" }, reach, options);

  // ---- Who chooses: owners and admins, by the route, before anything else is looked at ----
  const owner = home.browser({ member: { userId, workspace } });
  const member = home.browser({ member: { userId, workspace, role: "member", permissions: [] } });
  const route = `/api/w/${workspace.slug}/apps/canary/connected-access`;
  const refusedMember = await member("PUT", route, { apps: ["nope"] });
  assert.equal(refusedMember.status, 403);
  assert.equal(refusedMember.body.code, "apps_connected_manage_forbidden", "refused for who they are, not for what they sent");
  assert.equal((await owner("PUT", route, { apps: ["nope"] })).body.code, "apps_connected_unknown");
  assert.deepEqual((await owner("PUT", route, { apps: ["gmail", "gmail"] })).body, { allowed: ["gmail"] });
  const tab = await member("GET", `/api/w/${workspace.slug}/apps/canary/scripts`);
  assert.deepEqual(tab.body.connected, { allowed: ["gmail"], choices: [{ id: "gmail", name: "Gmail" }], isPublic: false });
  const trail = await knex("audit_events").where({ workspace_id: workspaceId, action: "schema" }).orderBy("id", "desc").first();
  assert.deepEqual(trail.changes, { connectedAccess: ["gmail"] });

  // ---- Saving: a test answers connected calls by app and action; a call it doesn't answer fails the test ----
  const draft = {
    key: "draft_reply",
    kind: "action",
    summary: "Drafts a reply in Gmail",
    code: `async function main() { return await connected.run("gmail", "mail_drafts.create", { to: ["sam@example.com"], subject: "Hi" }) }`,
    tests: [{ name: "drafts", input: {}, connected: { "gmail.mail_drafts.create": { status: "done" } }, expect: { status: "done" } }]
  };
  const unanswered = await save({ ...draft, tests: [{ name: "no answer", input: {}, expect: { status: "done" } }] });
  assert.match(JSON.stringify(unanswered.results), /no connected answer for gmail\.mail_drafts\.create/u);
  assert.deepEqual((await save(draft)).errors, []);

  // ---- A button changes, as the member who pressed it, and the change is in the app's activity naming them ----
  assert.deepEqual(await press("draft_reply"), { status: "done" });
  assert.deepEqual(connected.calls.at(-1), { person: userId, app: "gmail", action: "mail_drafts.create", mode: "button" });
  const change = await knex("audit_events").where({ workspace_id: workspaceId, action: "connected" }).first();
  assert.deepEqual(change.changes.connected, { app: "gmail", action: "mail_drafts.create", made: ["mail_drafts.create"], person: userId });
  assert.equal(change.via.script, "draft_reply");

  // ---- A change the person's approval rules ask about waits for them: the button asks, and it is made once confirmed ----
  assert.deepEqual((await save({
    key: "send_draft", kind: "action", summary: "Sends the draft",
    code: `async function main(input) { return await connected.run("gmail", "mail_drafts.send", { id: input.id }) }`,
    tests: [{ name: "asks", input: { id: "d1" }, connected: { "gmail.mail_drafts.send": { status: "waiting_for_approval" } }, expect: { status: "waiting_for_approval" } }]
  })).errors, []);
  const out = { confirms: [] };
  assert.deepEqual(await scripts.runNamed("action", appId, "send_draft", { id: "d1" }, { kind: "button" }, null, options, out), { status: "waiting_for_approval" });
  assert.deepEqual(out.confirms.map((confirm) => confirm.question), ["Shall I send the draft d1?"]);
  const kept = await knex("app_connected_confirms").where({ id: out.confirms[0].id }).first();
  assert.deepEqual([String(kept.user_id), kept.plugin_id, kept.action_id, kept.script_key, kept.used_at], [userId, "gmail", "mail_drafts.send", "send_draft", null]);
  const changesSoFar = async () => Number((await knex("audit_events").where({ workspace_id: workspaceId, action: "connected" }).count("* as n").first()).n);
  const before = await changesSoFar();
  await assert.rejects(press("send_draft", { id: "d1" }), /only a button on a screen can ask/u, "a run that can't ask doesn't keep it");
  const someoneElse = home.memberOptions("999999", workspace);
  await assert.rejects(scripts.confirmConnected(appId, out.confirms[0].id, someoneElse), { code: "apps_connected_confirm_gone" }, "theirs alone");
  const confirmed = await owner("POST", `/api/w/${workspace.slug}/apps/canary/connected-confirm/${out.confirms[0].id}`);
  assert.deepEqual([confirmed.status, confirmed.body], [200, { done: "Sent." }]);
  assert.deepEqual(connected.calls.at(-1), { person: userId, app: "gmail", action: "mail_drafts.send", args: { id: "d1", personAsked: true }, mode: "confirmed" });
  assert.equal(await changesSoFar(), before + 1, "the confirmed change is in the app's activity");
  await assert.rejects(scripts.confirmConnected(appId, out.confirms[0].id, options), { code: "apps_connected_confirm_gone" }, "made once");
  const stale = { confirms: [] };
  await scripts.runNamed("action", appId, "send_draft", { id: "d2" }, { kind: "button" }, null, options, stale);
  await knex("app_connected_confirms").where({ id: stale.confirms[0].id }).update({ created_at: new Date(Date.now() - 20 * 60 * 1000) });
  await assert.rejects(scripts.confirmConnected(appId, stale.confirms[0].id, options), { code: "apps_connected_confirm_gone" }, "too late");
  await scripts.prune();
  assert.equal(await knex("app_connected_confirms").where({ id: stale.confirms[0].id }).first(), undefined, "cleared once stale");

  // ---- A screen's data only reads: a change from it is refused, with a reason ----
  const sources = [
    { key: "urgent", code: `async function main() { return (await connected.run("gmail", "search_email", { query: "is:unread" })).mailboxes[0].emails }` },
    { key: "sneaky", code: `async function main() { return await connected.run("gmail", "mail_drafts.create", { subject: "x" }) }` },
    { key: "sedna_read", code: `async function main() { return await connected.run("sedna", "sedna_messages.recent", {}) }` },
    { key: "chatty", code: `async function main() { for (let i = 0; i < 6; i += 1) await connected.actions(); return 1 }` }
  ];
  for (const source of sources) {
    const answers = { "gmail.search_email": { mailboxes: [{ emails: [] }] }, "gmail.mail_drafts.create": {}, "sedna.sedna_messages.recent": [], actions: [] };
    const saved = await save({ ...source, kind: "source", summary: source.key, tests: [{ name: "runs", input: {}, connected: answers, expect: source.key === "chatty" ? 1 : source.key === "urgent" ? [] : source.key === "sedna_read" ? [] : {} }] });
    assert.deepEqual(saved.errors, [], source.key);
  }
  assert.deepEqual(await show("urgent"), [{ subject: "Server down" }]);
  assert.equal(connected.calls.at(-1).mode, "read");
  await assert.rejects(show("sneaky"), /Only a button can change anything/u);
  // ---- Only the apps its owners allowed, at most 5 calls a run ----
  await assert.rejects(show("sedna_read"), /this app may not use sedna/u);
  await assert.rejects(show("chatty"), /at most 5 connected-app calls per run/u);

  // ---- Rules on saving and formula functions have no connected apps at all ----
  const rule = await scripts.save(actor, "canary", {
    key: "peek_rule", kind: "rule", summary: "peek", settings: { table: "notes", on: ["create"] },
    code: `async function main() { await connected.actions(); return {} }`,
    tests: [{ name: "t", input: { action: "create", record: {} }, expect: {} }]
  }, options);
  assert.match(JSON.stringify(rule.results), /'connected' is not defined/u, "a rule runs on every save, by anyone");
  const formula = await scripts.save(actor, "canary", {
    key: "peek_fn", kind: "function", summary: "peek", settings: { params: [] },
    code: "function main() { return typeof connected }",
    tests: [{ name: "t", input: [], expect: "undefined" }]
  }, options);
  assert.deepEqual(formula.errors, [], "a formula function sees no connected at all");

  // ---- A public app's visitors never reach connected apps, and an app that uses them is never public ----
  await assert.rejects(show("urgent", { visitor: { signedIn: false, email: "" }, access: {} }), /a public app's visitors can't use them/u);
  await assert.rejects(apps.setPublic(actor, "canary", true, options), { code: "apps_connected_public" });
  await assert.rejects(
    knex("apps").where({ id: appId }).update({ public_at: new Date() }),
    /ck_apps_connected_internal/u,
    "the database keeps it too, whichever is set first"
  );
  await knex("apps").where({ id: appId }).update({ connected_access: JSON.stringify([]), public_at: new Date() });
  assert.equal((await owner("PUT", route, { apps: ["gmail"] })).body.code, "apps_connected_public");
  await knex("apps").where({ id: appId }).update({ public_at: null, connected_access: JSON.stringify(["gmail"]) });

  // ---- A draft's preview pretends a button's change, naming what it would do ----
  const practice = { simulated: [] };
  assert.deepEqual(await press("draft_reply", {}, { practice }), { simulated: true });
  assert.deepEqual(practice.simulated, [{ connected: { app: "gmail", action: "mail_drafts.create" }, script: "draft_reply" }]);
  assert.equal(connected.calls.at(-1).mode, "read", "the preview's call couldn't change anything");

  // ---- The access check reads the app once a run, however many calls it makes ----
  await save({ key: "once", kind: "source", summary: "once", code: `async function main() { await connected.actions(); return 1 }`, tests: [{ name: "t", input: {}, connected: { actions: [] }, expect: 1 }] });
  await save({ key: "five", kind: "source", summary: "five", code: `async function main() { for (let i = 0; i < 5; i += 1) await connected.actions(); return 1 }`, tests: [{ name: "t", input: {}, connected: { actions: [] }, expect: 1 }] });
  const appReads = (key) => queriesDuring(knex, () => show(key), { matching: /from "apps"/u });
  assert.equal(await appReads("once"), 1, "the app's allowed list, read once");
  assert.equal(await appReads("five"), await appReads("once"));
  const allQueries = (key) => queriesDuring(knex, () => show(key));
  const withOne = await allQueries("once");
  const fifty = ["gmail", ...Array.from({ length: 49 }, (_, index) => `app${index}`)];
  await knex("apps").where({ id: appId }).update({ connected_access: JSON.stringify(fifty) });
  assert.equal(await allQueries("once"), withOne, "a run reads the same whether 1 or 50 apps are allowed");
  await knex("apps").where({ id: appId }).update({ connected_access: JSON.stringify(["gmail"]) });

  // ---- A job reads as the person who saved it or switched it on; once they leave, it uses none until switched on again ----
  assert.deepEqual((await save({
    key: "morning", kind: "job", summary: "Reads the inbox", settings: { every: "day", at: "07:00", timeZone: "Europe/Rome" },
    code: `async function main() { return (await connected.run("gmail", "search_email", {})).mailboxes.length }`,
    tests: [{ name: "reads", input: {}, connected: { "gmail.search_email": { mailboxes: [] } }, expect: 0 }]
  })).errors, []);
  const job = await knex("app_scripts").where({ workspace_id: workspaceId, key: "morning" }).first();
  assert.equal(String(job.runs_as_user_id), userId);
  const runJob = async () => {
    await knex("app_scripts").where({ id: job.id }).update({ next_run_at: new Date(Date.now() - 1000) });
    await scripts.runDue({ matchChanges: watches.matchChanges });
    return knex("app_script_runs").where({ script_id: job.id }).orderBy("id", "desc").first();
  };
  assert.equal((await runJob()).ok, true);
  assert.deepEqual(connected.calls.at(-1), { person: userId, app: "gmail", action: "search_email", mode: "read" });
  await scripts.forgetPerson(userId, home.job);
  assert.equal((await knex("app_scripts").where({ id: job.id }).first()).runs_as_user_id, null);
  assert.match((await runJob()).error, /no person to use connected apps as/u);
  await scripts.setEnabled(actor, "canary", "morning", true, options);
  assert.equal(String((await knex("app_scripts").where({ id: job.id }).first()).runs_as_user_id), userId);
  assert.equal((await runJob()).ok, true);
});
