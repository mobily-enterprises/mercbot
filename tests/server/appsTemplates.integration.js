import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Installing ready-made apps (D-35, stage 3): tables reused or added, never removed; the app is a
// draft; sample records go through the data gate; a clash is reported for the Builder to fix.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("templates install as drafts on reused or new tables", async (context) => {
  const { knex, apps: capability, userId, workspaceId, options, ctx: ctxOf } = await appsHome(context, { slug: "apps-tpl" });
  const { registry, gate, apps } = capability;
  const ctx = ctxOf({ type: "person", id: String(userId), name: "Pat" });
  const install = (key, settings) => capability.installTemplate(ctx, key, settings);

  // The home already has contacts with its own extra field: it's reused and only gains fields.
  await registry.createTable(ctx.actor, { key: "contacts", fields: [{ key: "name", type: "text", required: true }, { key: "birthday", type: "date" }, { key: "stage", type: "choice", choices: ["Lead", "Customer"] }] }, options);
  const crm = await install("crm", { sample: true });
  assert.deepEqual([crm.app.slug, crm.errors, crm.skipped], ["crm", [], 0]);
  const tables = async () => Object.fromEntries((await registry.loadTables(options)).filter((table) => !table.obsolete).map((table) => [table.key, table.fields.filter((field) => !field.obsolete).map((field) => field.key)]));
  assert.deepEqual((await tables()).contacts, ["name", "birthday", "stage", "email", "phone", "company"], "kept its fields, gained the template's");
  assert.deepEqual((await tables()).deals, ["title", "contact", "amount", "stage", "closes"]);
  const draft = await apps.get("crm", { version: "draft" }, options);
  assert.equal(draft.version.draft, true, "a draft, not published");
  assert.equal((await apps.get("crm", {}, options)).definition, null);
  assert.equal((await gate.read(ctx, "deals")).records.length, 2, "sample records added");
  const audit = await knex("audit_events").where({ workspace_id: workspaceId, action: "create" }).first();
  assert.deepEqual(audit.via, { kind: "template", template: "crm" });

  // Installing again reuses everything and adds a second app.
  const again = await install("crm");
  assert.equal(again.app.slug, "crm-2");
  assert.deepEqual((await tables()).contacts.length, 6, "no duplicate fields");
  assert.equal((await gate.read(ctx, "deals")).records.length, 2, "no sample unless asked");

  // Sample records that don't fit an existing table are skipped, not fatal.
  await registry.createTable(ctx.actor, { key: "candidates", fields: [{ key: "name", type: "text", required: true }, { key: "stage", type: "choice", choices: ["Open", "Closed"] }] }, options);
  const hiring = await install("hiring", { sample: true });
  assert.deepEqual([hiring.errors.length, hiring.skipped], [0, 2], "both sample candidates have a stage this table doesn't offer");

  // A clash (an existing field of another type) is reported, not forced.
  await registry.createTable(ctx.actor, { key: "items", fields: [{ key: "name", type: "text", required: true }, { key: "quantity", type: "text" }] }, options);
  const stock = await install("stock");
  assert.ok(stock.errors.length > 0, "the draft didn't pass");
  assert.match(JSON.stringify(stock.errors), /quantity/u);
  await assert.rejects(install("nope"), /no template "nope"/u);
});
