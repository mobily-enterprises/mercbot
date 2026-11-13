import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Removing a field (D-35): impact first, then one save that keeps the data, gives every app a new
// version without the field, audits it once, and makes storage refuse writes to it.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("removing a field asks, then removes it everywhere in one save", async (context) => {
  const { knex, apps: capability, userId, workspaceId, options, ctx: ctxOf } = await appsHome(context, { slug: "apps-rm" });
  const { registry, gate, apps, anyapi } = capability;
  const person = { type: "person", id: String(userId), name: "Pat" };
  const ctx = ctxOf(person);

  const deals = await registry.createTable(person, { key: "deals", fields: [{ key: "title", type: "text" }, { key: "status", type: "choice", choices: ["Won", "Lost"] }, { key: "amount", type: "money" }] }, options);
  const status = deals.fields.find((field) => field.key === "status");
  const won = await gate.create(ctx, "deals", { title: "A", status: "Won", amount: 100 });
  await gate.create(ctx, "deals", { title: "B", status: "Lost", amount: 50 });
  await apps.createApp(person, { name: "Sales" }, options);
  const definition = {
    home: "list",
    screens: { list: { data: { open: { from: "deals", where: '=status != "Lost" && amount > 0.0' } }, content: [{ type: "table", rows: "=data.open", columns: [{ label: "Title", value: "=row.title" }, { label: "Status", value: "=row.status" }] }] } }
  };
  await apps.saveDraft(person, "sales", definition, "v1", options);
  await apps.publish(person, "sales", {}, options);
  await apps.saveDraft(person, "sales", definition, "draft still using status", options);

  // Impact: both the live version and the draft, with the widened filter.
  const impact = await apps.fieldImpact(status.id, options);
  assert.deepEqual(impact.uses.map((use) => use.version).sort(), ["draft", "live"]);
  assert.deepEqual(impact.uses[0].widened, [{ screen: "list", query: "open" }]);

  const result = await apps.removeField(person, status.id, options);
  assert.deepEqual(result.affected.map((entry) => entry.version).sort(), [2, "draft"].sort());
  const live = await apps.get("sales", {}, options);
  assert.equal(live.version.number, 2);
  assert.equal(live.definition.screens.list.data.open.where, "=amount > 0.0");
  assert.deepEqual(live.definition.screens.list.content[0].columns.map((column) => column.label), ["Title"]);
  assert.ok(!JSON.stringify((await apps.get("sales", { version: "draft" }, options)).definition).includes(status.id));
  assert.equal((await apps.versions("sales", {}, options)).versions[0].kind, "removal");

  // The data is kept; writes to the field are refused by the gate and by storage itself.
  const kept = await gate.get(ctx, "deals", won.id);
  assert.equal(kept[status.id], "Won");
  await assert.rejects(gate.update(ctx, "deals", won.id, { [status.id]: "Lost" }), /removed/u);
  const api = await anyapi.instanceFor(workspaceId);
  await assert.rejects(api.resources[deals.id].patch({ id: won.id, data: { [status.id]: "Lost" } }), /retired|validation/iu);
  await assert.rejects(apps.removeField(person, status.id, options), /already been removed/u);

  const audit = await knex("audit_events").where({ workspace_id: workspaceId, action: "schema" }).orderBy("id", "desc").first();
  assert.equal(audit.changes.removedField.label, "Status");
  assert.equal(audit.changes.affected.length, 2);
});
