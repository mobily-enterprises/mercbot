import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Apps and versions (D-35): drafts are checked and stored by ids, published by a person, kept and
// restorable; a renamed field shows its new name in every version without touching the app.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("drafts, publishing, versions, restore and pins", async (context) => {
  const { knex, apps: capability, userId, workspaceId, options } = await appsHome(context, { slug: "apps-ver" });
  const { registry, apps } = capability;
  const builder = { type: "bot", id: "1", name: "Builder" };
  const person = { type: "person", id: String(userId), name: "Owner" };

  const contacts = await registry.createTable(builder, { key: "contacts", fields: [{ key: "name", type: "text" }, { key: "phone", type: "phone" }] }, options);
  const crm = await apps.createApp(builder, { name: "Our CRM!", icon: "person" }, options);
  assert.equal(crm.slug, "our-crm");
  assert.equal((await apps.createApp(builder, { name: "Our CRM" }, options)).slug, "our-crm-2");

  const definition = (column) => ({
    home: "list",
    screens: { list: { data: { all: { from: "contacts", sort: "name" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }, { label: "Phone", value: `=row.${column}` }] }] } }
  });

  // A broken draft is refused and nothing is stored.
  const refused = await apps.saveDraft(builder, "our-crm", definition("fone"), "First try", options);
  assert.match(refused.errors[0].message, /no field "fone"\. Did you mean "phone"\?/u);
  assert.equal((await apps.get("our-crm", {}, options)).version, null);

  // A good draft is stored by ids; the live app is still empty until a person publishes.
  const saved = await apps.saveDraft(builder, "our-crm", definition("phone"), "Contacts list", options);
  assert.deepEqual(saved.errors, []);
  const stored = await knex("app_versions").where({ id: saved.draftVersionId }).first();
  assert.equal(stored.definition.screens.list.content[0].columns[1].value, `=row.${contacts.fields[1].id}`);
  assert.equal((await apps.get("our-crm", {}, options)).definition, null);
  assert.equal((await apps.get("our-crm", { version: "draft" }, options)).version.draft, true);
  const first = await apps.publish(person, "our-crm", {}, options);
  assert.equal(first.number, 1);
  await assert.rejects(apps.publish(person, "our-crm", {}, options), /no draft/u);

  // Renaming a field changes what every version shows, without a new version.
  await registry.renameField(person, contacts.fields[1].id, { key: "mobile" }, options);
  const live = await apps.get("our-crm", {}, options);
  assert.equal(live.definition.screens.list.content[0].columns[1].value, "=row.mobile");
  assert.equal(live.version.number, 1);

  // A second version, then restoring the first as version 3.
  await apps.saveDraft(builder, "our-crm", { ...definition("mobile"), screens: { list: { ...definition("mobile").screens.list, content: [{ type: "text", value: "Empty" }] } } }, "Simpler", options);
  await apps.publish(person, "our-crm", {}, options);
  const restored = await apps.restore(person, "our-crm", first.versionId, {}, options);
  assert.equal(restored.number, 3);
  const { versions: history } = await apps.versions("our-crm", {}, options);
  assert.deepEqual(history.map((version) => [version.number, version.kind, version.live]), [[3, "restore", true], [2, "builder", false], [1, "builder", false]]);
  assert.equal((await apps.get("our-crm", {}, options)).definition.screens.list.content[0].type, "table");

  // Pins are each person's, at most 8, and only real apps of this home.
  assert.deepEqual(await apps.setPins([crm.id, "a_nope", crm.id], options), [crm.id]);
  assert.deepEqual((await apps.list({}, options)).pins, [crm.id]);

  const appEvents = await knex("audit_events").where({ workspace_id: workspaceId, action: "app" }).orderBy("id");
  assert.equal(appEvents.length, 2 + 3, "two apps created, three versions published");
});
