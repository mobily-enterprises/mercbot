import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { createTrial } from "../../packages/apps/src/server/trial.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";
import { createWebAccess } from "../../packages/apps/src/server/webAccess.js";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Practice data for draft previews (D-71, owner 2026-11-11): a draft's preview, and the Builder trying it, read and
// write a copy of the home's newest records. Save, Edit and scripts work there as in the live app; nothing reaches the
// live records, the audit trail or the outside world; the copy follows the tables' fields, starts again on Reset, and
// goes on publishing or after a week unused. Visitors only ever see the live app.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const { practiceTenantOf } = anyapiTestables;

test("a draft preview works on practice data, and nothing reaches the live app", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-practice" });
  const { knex, userId, workspaceId, options } = home;
  // An outside service a script calls: it records what reaches it.
  const served = [];
  const service = http.createServer((request, response) => {
    served.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    response.end("{}");
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${service.address().port}`;

  // The parts as the server wires them (appsRuntime.js), with web calls that may reach this test's service.
  let scripts = null;
  const { resources, repository, registry, gate, apps, practices, systemContext } = appsParts(home, {
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args)
  });
  const web = createWebAccess({ resources, env: { MERCBOT_VAULT_KEY: randomBytes(32).toString("base64"), SIDE_EFFECTS: "live" }, insecure: true });
  scripts = createScripts({ resources, repository, systemContext, registry, gate, apps, env: process.env, web });
  const runtime = createRuntime({ apps, gate, scripts, practices });
  const trial = createTrial({ apps, runtime, scripts });
  cleanup.after(async () => {
    await scripts.close();
    service.close();
  });

  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = { options, actor: person };
  const data = { ...ctx, via: { kind: "data" } };
  const count = async (table, where = {}) => Number((await knex(table).where(where).count("* as n").first()).n);
  const audits = () => count("audit_events", { workspace_id: workspaceId });
  const tenantRows = (copyId) => count("any_records", { tenant_id: practiceTenantOf(workspaceId, copyId) });
  const practiceRow = async () => knex("app_practices").where({ workspace_id: workspaceId }).first();

  await registry.createTable(person, { key: "companies", fields: [{ key: "name", type: "text", required: true }] }, options);
  await registry.createTable(person, {
    key: "contacts",
    fields: [
      { key: "name", type: "text", required: true },
      { key: "email", type: "email" },
      { key: "company", type: "link", target: "companies" },
      { key: "stage", type: "choice", choices: ["New", "Won"] }
    ]
  }, options);
  await registry.createTable(person, { key: "numbers", fields: [{ key: "n", type: "number" }] }, options);
  await registry.createTable(person, { key: "log", fields: [{ key: "text", type: "text", required: true }] }, options);
  const acme = await gate.create(data, "companies", { name: "Acme" });
  const ana = await gate.create(data, "contacts", { name: "Ana Ruiz", email: "ana@example.test", company: acme.id, stage: "New" });
  await gate.create(data, "contacts", { name: "Ben Okafor", stage: "New" });
  // 1,003 numbers, made in order: the copy takes the newest 1,000 (4 to 1,003).
  const nField = (await gate.tableFor("numbers", options)).table.fields[0].id;
  for (let start = 1; start <= 1003; start += 500) {
    const rows = Array.from({ length: Math.min(500, 1004 - start) }, (_, index) => ({ [nField]: String(start + index) }));
    assert.deepEqual((await gate.importRecords(data, "numbers", rows)).errors, []);
  }

  await apps.createApp(person, { name: "CRM" }, options);
  assert.deepEqual((await web.set(person, [{ origin }], options)).map((entry) => entry.origin), [origin]);
  assert.deepEqual((await scripts.save(person, "crm", {
    key: "win",
    kind: "action",
    summary: "Marks a contact won, logs it and tells the outside service",
    code: `async function main(input) {
      const contact = await records.update("contacts", input.id, { stage: "Won" });
      await records.create("log", { text: "Won " + contact.name });
      await web.fetch("${origin}/won", { method: "POST", body: { id: input.id } });
      return { notify: "Won " + contact.name };
    }`,
    tests: [{ name: "wins", input: { id: "1" }, records: { contacts: [{ id: "1", name: "Ana", stage: "New" }], log: [] }, web: { [`${origin}/won`]: {} }, expect: { notify: "Won Ana" } }]
  }, options)).errors, []);
  const definition = (extraColumns = []) => ({
    home: "people",
    public: { home: "names", tables: { contacts: { can: ["list"], rows: "all", read: ["name"] } } },
    screens: {
      people: {
        data: { all: { from: "contacts", sort: "name" }, byStage: { from: "contacts", groupBy: "stage", grandTotal: true } },
        content: [
          { type: "text", value: '="People: " + string(data.all.size())' },
          {
            type: "table",
            rows: "=data.all",
            columns: [{ label: "Name", value: "=row.name" }, { label: "Company", value: "=row.company" }, { label: "Stage", value: "=row.stage" }, ...extraColumns],
            rowActions: [{ type: "button", label: "Win", do: [{ runScript: { script: "win", input: { id: "=row.id" } } }] }]
          },
          { type: "totals", label: "By stage", rows: "=data.byStage" },
          {
            type: "form",
            table: "contacts",
            fields: ["name", "email", "company", "stage"],
            buttons: [{ type: "button", label: "Add", do: [{ create: { table: "contacts", values: "=form.values" } }, { notify: '="Added " + form.name' }] }]
          }
        ]
      },
      numbers: { data: { all: { from: "numbers", sort: "n", limit: 5 } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "N", value: "=string(row.n)" }] }] },
      names: { public: true, data: { all: { from: "contacts", sort: "name" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }] }] }
    }
  });
  assert.deepEqual((await apps.saveDraft(person, "crm", definition(), "v1", options)).errors, []);
  await apps.publish(person, "crm", {}, options);
  assert.deepEqual((await apps.saveDraft(person, "crm", definition(), "v2", options)).errors, []);
  const app = await apps.find("crm", options);
  const draft = { slug: "crm", version: "draft" };
  const names = async (version = "live") => (await runtime.query(ctx, { slug: "crm", version, screen: "people", query: "all" })).records.map((record) => record.name);
  const auditsBefore = await audits();

  // The first use makes one copy, however many ask at once, and each table is copied once.
  const [first, second] = await Promise.all([practices.of(app, app.draftVersionId, options), practices.of(app, app.draftVersionId, options)]);
  assert.equal(first.id, second.id);
  const { tables } = await gate.tableFor("numbers", options);
  const numbers = tables.find((table) => table.key === "numbers");
  await Promise.all([practices.ensure(first, tables, numbers, options), practices.ensure(second, tables, numbers, options)]);
  assert.equal(await tenantRows(first.id), 1000, "the newest 1,000 numbers, once");
  const practiceNumbers = await runtime.query(ctx, { ...draft, screen: "numbers", query: "all" });
  assert.deepEqual([practiceNumbers.total, practiceNumbers.records[0].n], [1000, 4], "capped at the newest 1,000");
  const liveNumbers = await runtime.query(ctx, { slug: "crm", screen: "numbers", query: "all" });
  assert.deepEqual([liveNumbers.total, liveNumbers.records[0].n], [1003, 1]);

  // Save adds a record in the copy: the preview's list and totals show it, with its link; the live app doesn't.
  assert.deepEqual(await names("draft"), ["Ana Ruiz", "Ben Okafor"]);
  const added = await runtime.action(ctx, { ...draft, screen: "people", path: "content/3/buttons/0/do", values: { name: "Cleo Park", email: "cleo@example.test", company: acme.id, stage: "Won" } });
  assert.deepEqual(added.effects, [{ notify: "Added Cleo Park" }]);
  assert.deepEqual(added.practice.changes.map(({ action }) => action), ["create"]);
  assert.deepEqual(await names("draft"), ["Ana Ruiz", "Ben Okafor", "Cleo Park"]);
  assert.deepEqual(await names(), ["Ana Ruiz", "Ben Okafor"]);
  const cleo = (await runtime.query(ctx, { ...draft, screen: "people", query: "all" })).records.find((record) => record.name === "Cleo Park");
  assert.equal(cleo.company.label, "Acme", "links reach the copied companies");
  const stages = await runtime.query(ctx, { ...draft, screen: "people", query: "byStage" });
  assert.deepEqual([stages.totals.map((row) => [row.key, row.count]).sort(), stages.grandTotal.count], [[["New", 2], ["Won", 1]], 3]);

  // A script runs on the copy as the live app would run it; its web call that changes something is only reported,
  // and its run isn't recorded.
  const runsBefore = await count("app_script_runs", { workspace_id: workspaceId });
  const won = await runtime.action(ctx, { ...draft, screen: "people", path: "content/1/rowActions/0/do", row: ana.id });
  assert.deepEqual(won.effects, [{ notify: "Won Ana Ruiz" }]);
  assert.deepEqual(won.practice.simulated, [{ web: { method: "POST", url: `${origin}/won` }, script: "win" }]);
  assert.deepEqual(served, [], "the outside service heard nothing");
  assert.deepEqual(won.practice.changes.map(({ action }) => action), ["update", "create"]);
  assert.equal(await count("app_script_runs", { workspace_id: workspaceId }), runsBefore);
  assert.equal((await gate.read(ctx, "log")).records.length, 0, "the log line is only in the copy");
  assert.equal((await gate.get(ctx, "contacts", ana.id))[(await gate.tableFor("contacts", options)).table.fields[3].id], "New");
  assert.equal(await audits(), auditsBefore, "practice changes never reach the audit trail");

  // Visitors only ever see the live app, whatever version they ask for.
  const visitor = { signedIn: false, email: "" };
  const visitorCtx = { options: home.job, actor: { type: "visitor", id: null, name: "CRM (public)" }, visitor, access: compile(definition(), await registry.loadTables(options), visitor) };
  const seen = await runtime.query(visitorCtx, { ...draft, screen: "names", query: "all" });
  assert.deepEqual(seen.records.map((record) => record.name), ["Ana Ruiz", "Ben Okafor"]);

  // The copy follows the tables: a new field is there at once, a new table is copied on first use, and a removed
  // field drops out.
  await registry.addField(person, "contacts", { key: "phone", type: "phone" }, options);
  await registry.createTable(person, { key: "deals", fields: [{ key: "title", type: "text", required: true }] }, options);
  await gate.create(data, "deals", { title: "Website" });
  const withDeals = definition([{ label: "Phone", value: "=row.phone" }]);
  withDeals.screens.deals = { data: { all: { from: "deals" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Title", value: "=row.title" }] }] };
  withDeals.screens.people.content[3].fields.push("phone");
  assert.deepEqual((await apps.saveDraft(person, "crm", withDeals, "v3", options)).errors, []);
  await runtime.action(ctx, { ...draft, screen: "people", path: "content/3/buttons/0/do", values: { name: "Dev Shah", phone: "+44 20 7946 0000" } });
  const dev = (await runtime.query(ctx, { ...draft, screen: "people", query: "all" })).records.find((record) => record.name === "Dev Shah");
  assert.equal(dev.phone, "+44 20 7946 0000");
  assert.deepEqual((await runtime.query(ctx, { ...draft, screen: "deals", query: "all" })).records.map((record) => record.title), ["Website"]);
  const emailId = (await gate.tableFor("contacts", options)).table.fields.find((field) => field.key === "email").id;
  await knex("app_fields").where({ id: emailId }).update({ obsolete_at: knex.fn.now() });
  await registry.changed(options);
  assert.ok(!("email" in (await runtime.query(ctx, { ...draft, screen: "people", query: "all" })).records[0]), "a removed field drops out");
  withDeals.screens.people.content[3].fields = withDeals.screens.people.content[3].fields.filter((key) => key !== "email");

  // Reset: a fresh copy of the live records; the old one is gone.
  const before = (await practiceRow()).id;
  await practices.reset(app, app.draftVersionId, options);
  const after = (await practiceRow()).id;
  assert.notEqual(after, before);
  assert.equal(await tenantRows(before), 0);
  assert.deepEqual(await names("draft"), ["Ana Ruiz", "Ben Okafor"]);
  assert.equal((await runtime.query(ctx, { ...draft, screen: "people", query: "all" })).records[0].stage, "New");

  // The Builder tries the draft: what the screen shows, a press that saves (record by record), one that is refused,
  // and formulas that fail.
  const auditsBeforeTrying = await audits();
  const shown = await trial.tryScreen(ctx, { slug: "crm" });
  assert.equal(shown.shown.screen, "people");
  assert.deepEqual(shown.shown.parts[0], { text: "People: 2" });
  assert.deepEqual(shown.shown.parts[1].columns, ["Name", "Company", "Stage", "Phone"]);
  assert.deepEqual(shown.shown.parts[1].rows[0].cells, ["Ana Ruiz", "Acme", "New", "—"]);
  assert.deepEqual(shown.shown.parts[1].rows[0].buttons, [{ button: "Win", press: "content/1/rowActions/0/do" }]);
  assert.deepEqual(shown.shown.parts[3].buttons, [{ button: "Add", press: "content/3/buttons/0/do" }]);
  const tried = await trial.tryScreen(ctx, { slug: "crm", press: "Add", values: { name: "Eve Moss", stage: "Won" } });
  assert.deepEqual(tried.pressed, { button: "Add", ok: true, saved: [{ table: "contacts", id: tried.pressed.saved[0].id, action: "create", values: { name: "Eve Moss", stage: "Won" } }], effects: [{ notify: "Added Eve Moss" }] });
  assert.equal(tried.shown.parts[0].text, "People: 3", "the screen it ended on shows the new record");
  const refused = await trial.tryScreen(ctx, { slug: "crm", press: "content/3/buttons/0/do", values: { email: "nobody@example.test" } });
  assert.equal(refused.pressed.ok, false);
  assert.match(refused.pressed.error, /Name is required/u);
  const pressedWin = await trial.tryScreen(ctx, { slug: "crm", press: "Win", row: ana.id });
  assert.deepEqual(pressedWin.pressed.simulated, [{ web: { method: "POST", url: `${origin}/won` }, script: "win" }]);
  assert.deepEqual(pressedWin.pressed.saved.map(({ table, action }) => [table, action]), [["contacts", "update"], ["log", "create"]]);
  assert.equal(await audits(), auditsBeforeTrying, "trying leaves no audit entries");
  const broken = structuredClone(withDeals);
  broken.screens.people.content[0].value = "=data.all[9].name";
  assert.deepEqual((await apps.saveDraft(person, "crm", broken, "v4", options)).errors, []);
  const failing = await trial.tryScreen(ctx, { slug: "crm" });
  assert.equal(failing.shown.formulaErrors[0].at, "content/0/value");
  await assert.rejects(trial.tryScreen(ctx, { slug: "crm", press: "Nope" }), /No button "Nope" on this screen\. Buttons: "Win"/u);
  assert.deepEqual(await names(), ["Ana Ruiz", "Ben Okafor"], "trying never reaches the live records");

  // Publishing clears the copy: the live app has none of its records.
  const published = (await practiceRow()).id;
  await apps.publish(person, "crm", {}, options);
  assert.equal(await practiceRow(), undefined);
  assert.equal(await tenantRows(published), 0);
  assert.deepEqual(await names(), ["Ana Ruiz", "Ben Okafor"]);

  // The sweep clears a copy unused for a week, and records left under a copy whose row is gone.
  assert.deepEqual((await apps.saveDraft(person, "crm", withDeals, "v5", options)).errors, []);
  await names("draft");
  const idle = await practiceRow();
  await knex("app_practices").where({ id: idle.id }).update({ used_at: new Date(Date.now() - 8 * 86400000) });
  await practices.sweep();
  assert.equal(await practiceRow(), undefined);
  assert.equal(await tenantRows(idle.id), 0);
  await names("draft");
  const left = await practiceRow();
  assert.ok(await tenantRows(left.id) > 0);
  await knex("app_practices").where({ id: left.id }).del();
  await practices.sweep();
  assert.equal(await tenantRows(left.id), 0);
  assert.equal(await count("any_resource_configs", { tenant_id: practiceTenantOf(workspaceId, left.id) }), 0);

  // A first use racing the sweep: the idle copy it read is cleared before it is marked used, so it makes a new one.
  await names("draft");
  const swept = await practiceRow();
  await knex("app_practices").where({ id: swept.id }).update({ used_at: new Date(Date.now() - 8 * 86400000) });
  const sweeping = await knex.transaction();
  await sweeping("app_practices").where({ id: swept.id }).forUpdate();
  const using = practices.of(await apps.find("crm", options), String(swept.version_id), options);
  for (let tries = 0; ; tries += 1) {
    const { rows: [{ waiting }] } = await knex.raw(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%app_practices%'"
    );
    if (waiting) break;
    assert.ok(tries < 250, "marking the copy used waits on the sweep's lock");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await sweeping("app_practices").where({ id: swept.id }).del();
  await sweeping.commit();
  const fresh = await using;
  assert.notEqual(fresh.id, swept.id);
  assert.equal((await practiceRow()).id, fresh.id);
});
