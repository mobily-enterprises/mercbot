import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Running screens (D-35): only stored queries and buttons run, through the data gate; drafts never
// write; a filter on a removed field fails closed; other homes can't be reached.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const definition = {
  home: "list",
  screens: {
    list: {
      state: { search: { type: "string", default: "" } },
      data: { people: { from: "contacts", where: '=state.search == "" || name.startsWith(state.search)', sort: "name" }, byStatus: { from: "contacts", groupBy: "status" } },
      content: [
        { type: "input", bind: "state.search", label: "Search" },
        {
          type: "table",
          rows: "=data.people",
          columns: [{ label: "Name", value: "=row.name" }],
          onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }],
          rowActions: [{ type: "button", label: "Archive", do: [{ create: { table: "notes", values: { text: '="Archived " + row.name' } } }, { notify: '="Archived " + row.name' }] }]
        },
        { type: "totals", label: "By status", rows: "=data.byStatus" }
      ]
    },
    edit: {
      params: { id: { type: "string" } },
      data: { person: { record: "contacts", id: "=params.id" } },
      content: [
        {
          type: "form",
          record: "=data.person",
          fields: ["name", "status"],
          buttons: [
            { type: "button", label: "Save", do: [{ update: { record: "=data.person", set: "=form.values" } }, { notify: '="Saved " + form.name' }, { go: { screen: "list" } }] },
            { type: "button", label: "Bad save", do: [{ update: { record: "=data.person", set: "=form.values" } }, { create: { table: "notes", values: { text: '=""' } } }] }
          ]
        }
      ]
    }
  }
};

test("screens run only what the app stores", async (context) => {
  const knex = await connectTestDatabase();
  // Newest first: both homes' cleanup, then the connection they share.
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const home = await appsHome(cleanup, { slug: "apps-rt-one", knex });
  const other = await appsHome(cleanup, { slug: "apps-rt-two", knex });
  // The registry, the gate (no scripts' rules) and apps on the home's handles; a runtime with no scripts.
  const { registry, gate, apps, practices } = appsParts(home);
  const runtime = createRuntime({ apps, gate, practices, scripts: { functionsFor: async () => null } });
  const { options, workspaceId } = home;
  const person = { type: "person", id: home.userId, name: "Pat" };
  const ctx = { options, actor: person };

  await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }, { key: "status", type: "choice", choices: ["Active", "Left"] }, { key: "secret", type: "text" }] }, options);
  await registry.createTable(person, { key: "notes", fields: [{ key: "text", type: "text", required: true }] }, options);
  await apps.createApp(person, { name: "CRM" }, options);
  assert.deepEqual((await apps.saveDraft(person, "crm", definition, "v1", options)).errors, []);
  await apps.publish(person, "crm", {}, options);
  const ana = await gate.create({ ...ctx, via: {} }, "contacts", { name: "Ana", status: "Active", secret: "s1" });
  await gate.create({ ...ctx, via: {} }, "contacts", { name: "Ben", status: "Left" });

  // Declared queries, with filters from page values, by field name.
  const all = await runtime.query(ctx, { slug: "crm", screen: "list", query: "people", state: { search: "" } });
  assert.deepEqual(all.records.map((record) => record.name), ["Ana", "Ben"]);
  const filtered = await runtime.query(ctx, { slug: "crm", screen: "list", query: "people", state: { search: "B", injected: "x" } });
  assert.deepEqual(filtered.records.map((record) => record.name), ["Ben"]);
  const wrongType = await runtime.query(ctx, { slug: "crm", screen: "list", query: "people", state: { search: 42 } });
  assert.equal(wrongType.records.length, 2, "a page value of the wrong type falls back to its default");
  assert.deepEqual((await runtime.query(ctx, { slug: "crm", screen: "list", query: "byStatus" })).totals.map((row) => [row.key, row.count]).sort(), [["Active", 1], ["Left", 1]]);
  const one = await runtime.query(ctx, { slug: "crm", screen: "edit", query: "person", params: { id: ana.id } });
  assert.equal(one.record.name, "Ana");
  await assert.rejects(runtime.query(ctx, { slug: "crm", screen: "list", query: "everything" }), /isn't part of this screen/u);
  await assert.rejects(runtime.query(ctx, { slug: "crm", screen: "admin", query: "people" }), /screen doesn't exist/u);

  // Another home can't reach this app or its records.
  await assert.rejects(runtime.query({ ...ctx, options: other.options }, { slug: "crm", screen: "list", query: "people" }), /No app "crm"/u);

  // A row button: its data steps run on the server, its UI steps come back as effects.
  const archive = await runtime.action(ctx, { slug: "crm", screen: "list", path: "content/1/rowActions/0/do", row: ana.id });
  assert.deepEqual(archive.effects, [{ notify: "Archived Ana" }]);
  assert.deepEqual((await gate.read(ctx, "notes")).records.map((record) => Object.values(record).find((value) => value === "Archived Ana")), ["Archived Ana"]);
  await assert.rejects(runtime.action(ctx, { slug: "crm", screen: "list", path: "content/1/columns" }), /isn't a button/u);
  await assert.rejects(runtime.action(ctx, { slug: "crm", screen: "list", path: "content/1/rowActions/0/do" }), /Which row/u);

  // A form writes only the fields it shows.
  const saved = await runtime.action(ctx, { slug: "crm", screen: "edit", path: "content/0/buttons/0/do", params: { id: ana.id }, values: { name: "Ana Ruiz", status: "Left", secret: "stolen" } });
  assert.deepEqual(saved.effects, [{ notify: "Saved Ana Ruiz" }, { go: { screen: "list", params: {} } }]);
  const after = await runtime.query(ctx, { slug: "crm", screen: "edit", query: "person", params: { id: ana.id } });
  assert.deepEqual([after.record.name, after.record.status], ["Ana Ruiz", "Left"]);
  assert.equal((await gate.get(ctx, "contacts", ana.id))[(await registry.loadTables(options))[0].fields[2].id], "s1", "hidden field untouched");
  const lastAudit = await knex("audit_events").where({ workspace_id: workspaceId, action: "update" }).orderBy("id", "desc").first();
  assert.deepEqual([lastAudit.via.kind, lastAudit.via.screen, lastAudit.actor.name], ["screen", "edit", "Pat"]);

  // Neighbouring data steps succeed or fail together.
  // The update succeeds, then the note is refused: the update is rolled back with it.
  const updatesBefore = Number((await knex("audit_events").where({ workspace_id: workspaceId, action: "update" }).count("* as n").first()).n);
  await assert.rejects(runtime.action(ctx, { slug: "crm", screen: "edit", path: "content/0/buttons/1/do", params: { id: ana.id }, values: { name: "Ana Changed", status: "Active" } }), /Text is required/u);
  assert.equal(Number((await knex("audit_events").where({ workspace_id: workspaceId, action: "update" }).count("* as n").first()).n), updatesBefore, "no audit for the rolled-back update");
  assert.equal((await runtime.query(ctx, { slug: "crm", screen: "edit", query: "person", params: { id: ana.id } })).record.name, "Ana Ruiz");

  // A draft preview runs the same steps on the draft's practice copy (D-71): the preview shows the change, the live
  // records and the audit trail never see it.
  await apps.saveDraft(person, "crm", definition, "v2", options);
  const notesBefore = (await gate.read(ctx, "notes")).records.length;
  const auditsBefore = Number((await knex("audit_events").where({ workspace_id: workspaceId }).count("* as n").first()).n);
  const preview = await runtime.action(ctx, { slug: "crm", version: "draft", screen: "edit", path: "content/0/buttons/0/do", params: { id: ana.id }, values: { name: "Draft Name" } });
  assert.equal(preview.dryRun, undefined);
  assert.deepEqual(preview.practice.changes.map(({ action, id }) => [action, id]), [["update", ana.id]]);
  assert.equal((await runtime.query(ctx, { slug: "crm", version: "draft", screen: "edit", query: "person", params: { id: ana.id } })).record.name, "Draft Name");
  assert.equal((await runtime.query(ctx, { slug: "crm", screen: "edit", query: "person", params: { id: ana.id } })).record.name, "Ana Ruiz");
  assert.equal((await gate.read(ctx, "notes")).records.length, notesBefore);
  assert.equal(Number((await knex("audit_events").where({ workspace_id: workspaceId }).count("* as n").first()).n), auditsBefore);

  // A filter on a field that's gone fails closed instead of showing everything.
  const stored = await knex("app_versions").where({ app_id: (await apps.find("crm", options)).id }).whereNotNull("published_at").orderBy("id", "desc").first();
  const statusId = (await registry.loadTables(options))[0].fields[1].id;
  stored.definition.screens.list.data.people.where = `=${statusId} == "Active"`;
  await knex("app_versions").where({ id: stored.id }).update({ definition: JSON.stringify(stored.definition) });
  await knex("app_fields").where({ id: statusId }).update({ obsolete_at: knex.fn.now() });
  // Written underneath the registry, so it's announced as the registry announces its own changes.
  await registry.changed(options);
  assert.deepEqual(await runtime.query(ctx, { slug: "crm", screen: "list", query: "people" }), { needsAttention: true, records: [] });
});
