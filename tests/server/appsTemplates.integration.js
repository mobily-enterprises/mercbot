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
  // The CRM is built on the shared tables (D-130): contacts keep their fields and gain the shared table's, deals are the
  // shared deals, and each contact's pipeline is a one-to-one extension of them.
  const contactKeys = (await tables()).contacts;
  assert.deepEqual(contactKeys.slice(0, 3), ["name", "birthday", "stage"], "kept its fields");
  assert.ok(["organisation", "email", "phone", "tags", "owner"].every((key) => contactKeys.includes(key)), "gained the shared table's");
  assert.deepEqual((await tables()).deals, ["title", "contact", "organisation", "amount", "stage", "closes", "owner"]);
  assert.deepEqual((await tables()).crm_contacts, ["contact", "stage", "source", "value", "next_step", "next_step_date"]);
  const draft = await apps.get("crm", { version: "draft" }, options);
  assert.equal(draft.version.draft, true, "a draft, not published");
  assert.equal((await apps.get("crm", {}, options)).definition, null);
  assert.equal((await gate.read(ctx, "deals")).records.length, 2, "sample records added");
  const audit = await knex("audit_events").where({ workspace_id: workspaceId, action: "create" }).first();
  assert.deepEqual(audit.via, { kind: "template", template: "crm" });

  // Installing again reuses everything and adds a second app.
  const again = await install("crm");
  assert.equal(again.app.slug, "crm-2");
  assert.deepEqual((await tables()).contacts.length, contactKeys.length, "no duplicate fields");
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

// The Contacts and To-dos mini apps (D-130) are built on the shared tables: installed into a home that already keeps
// contacts its own way, they keep everything and only add fields, and their screens find each person's to-dos, each
// list's, a task's subtasks and what's overdue.
test("Contacts and To-dos install on the shared tables, and their screens find what they should", async (context) => {
  const { knex, apps: capability, userId, workspaceId, options, ctx: ctxOf } = await appsHome(context, { slug: "apps-tpl-shared" });
  const { registry, gate, apps, runtime } = capability;
  // Pat is in the home, so to-dos and contacts can be theirs.
  await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role_sid: "member", status: "active" });
  const ctx = ctxOf({ type: "person", id: String(userId), name: "Pat" });
  await registry.createTable(ctx.actor, { key: "contacts", fields: [{ key: "name", type: "text", required: true }, { key: "company", type: "text" }, { key: "stage", type: "choice", choices: ["Lead", "Customer"] }] }, options);
  const ann = await gate.create(ctx, "contacts", { name: "Ann", company: "Acme", stage: "Lead" });
  for (const key of ["contacts", "todos"]) {
    const installed = await capability.installTemplate(ctx, key);
    assert.deepEqual(installed.errors, [], key);
    await apps.publish(ctx.actor, installed.app.slug, {}, options);
  }
  const contacts = (await registry.loadTables(options)).find((table) => table.key === "contacts");
  const keys = contacts.fields.filter((field) => !field.obsolete).map((field) => field.key);
  assert.deepEqual(keys.slice(0, 3), ["name", "company", "stage"], "kept as they were");
  assert.ok(["organisation", "photo", "tags", "owner"].every((key) => keys.includes(key)));
  const general = (await gate.read(ctx, "todo_lists")).records[0];

  await gate.update(ctx, "contacts", ann.id, { tags: ["vip"], owner: String(userId) });
  const call = await gate.create(ctx, "todos", { title: "Call Ann", assignee: String(userId), status: "To do", due: "2020-01-01T09:00:00Z", contact: ann.id, todo_list: general.id });
  await gate.create(ctx, "todos", { title: "Book a room", status: "Done", todo_list: general.id });
  await gate.create(ctx, "todos", { title: "Find her number", parent: call.id, status: "To do" });
  const query = async (slug, screen, name, extra = {}) => (await runtime.query(ctx, { slug, screen, query: name, ...extra })).records.map((record) => record.name ?? record.title);

  assert.deepEqual(await query("contacts", "people", "people", { state: { search: "", tag: "vip" } }), ["Ann"]);
  assert.deepEqual(await query("contacts", "people", "people", { state: { search: "", tag: "other" } }), []);
  assert.deepEqual(await query("contacts", "mine", "people"), ["Ann"]);
  assert.deepEqual(await query("contacts", "contact", "todos", { params: { id: ann.id } }), ["Call Ann"]);
  assert.deepEqual(await query("to-dos", "mine", "tasks"), ["Call Ann"]);
  assert.deepEqual(await query("to-dos", "overdue", "tasks"), ["Call Ann"]);
  assert.deepEqual((await query("to-dos", "todo_list", "tasks", { params: { id: general.id } })).sort(), ["Book a room", "Call Ann"], "a list's to-dos, not their subtasks");
  assert.deepEqual(await query("to-dos", "task", "subtasks", { params: { id: call.id } }), ["Find her number"]);

  // Its quick status: Done, with when.
  await runtime.action(ctx, { slug: "to-dos", screen: "task", path: "content/0/content/2/do", params: { id: call.id } });
  const done = await gate.get(ctx, "todos", call.id);
  const todos = (await registry.loadTables(options)).find((table) => table.key === "todos");
  const valueOf = (key) => done[todos.fields.find((field) => field.key === key).id];
  assert.equal(valueOf("status"), "Done");
  assert.ok(Date.now() - Date.parse(valueOf("done_on")) < 60_000);
  assert.deepEqual(await query("to-dos", "overdue", "tasks"), []);
});

// The CRM on the shared tables (D-130): a contact joins the pipeline once, from their page, and a second pipeline row
// for one contact is refused; a home that had the old CRM keeps its contacts' stage, which the new screens don't use.
test("the CRM keeps each contact's pipeline in its extension, one row per contact, over an old CRM's contacts", async (context) => {
  const { apps: capability, userId, options, ctx: ctxOf } = await appsHome(context, { slug: "apps-tpl-crm" });
  const { registry, gate, apps, runtime } = capability;
  const ctx = ctxOf({ type: "person", id: String(userId), name: "Pat" });
  // As the old CRM left them.
  await registry.createTable(ctx.actor, { key: "contacts", fields: [{ key: "name", type: "text", required: true }, { key: "company", type: "text" }, { key: "stage", type: "choice", choices: ["Lead", "Customer", "Lost"] }] }, options);
  const ana = await gate.create(ctx, "contacts", { name: "Ana", company: "Ruiz Design", stage: "Customer" });
  const installed = await capability.installTemplate(ctx, "crm");
  assert.deepEqual(installed.errors, []);
  await apps.publish(ctx.actor, installed.app.slug, {}, options);
  const kept = await gate.get(ctx, "contacts", ana.id);
  const contacts = (await registry.loadTables(options)).find((table) => table.key === "contacts");
  assert.equal(kept[contacts.fields.find((field) => field.key === "stage").id], "Customer", "nothing removed");

  // "Add to the pipeline" on Ana's page, twice: the second is refused.
  const add = { slug: installed.app.slug, screen: "contact", path: "content/1/content/2/do", params: { id: ana.id } };
  await runtime.action(ctx, add);
  await assert.rejects(runtime.action(ctx, add), { code: "apps_link_unique_taken" });
  const leads = (await runtime.query(ctx, { slug: installed.app.slug, screen: "pipeline", query: "leads" })).records;
  assert.deepEqual(leads.map((lead) => [lead.contact?.id ?? lead.contact, lead.stage]), [[String(ana.id), "Lead"]]);
  const mine = await runtime.query(ctx, { slug: installed.app.slug, screen: "contact", query: "pipeline", params: { id: ana.id } });
  assert.equal(mine.records.length, 1);
});
