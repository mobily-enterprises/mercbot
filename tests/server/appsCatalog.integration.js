import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { createTableCatalog } from "../../packages/apps/src/server/tableCatalog.js";
import { queriesDuring } from "../support/queryCount.mjs";

// A home's shared tables from the catalog (D-130), on the test database: each is made once with the tables it needs
// first, seeded only when made, and reused after; a home's own table of the same key keeps everything and gains only
// what it lacks. An extension holds one row at most per record of its base, and never takes a shared table's name.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context, slug) {
  const home = await appsHome(context, { slug });
  const { registry, gate } = appsParts(home);
  const person = { type: "person", id: String(home.userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "data" });
  const keys = async () => (await registry.loadTables(home.options)).filter((table) => !table.obsolete).map((table) => table.key).sort();
  return { home, registry, gate, ctx, person, keys, catalog: createTableCatalog({ registry, gate }) };
}

test("a shared table comes with the tables it needs, each made once, seeded once, and linked as the catalog says", async (context) => {
  const { registry, gate, ctx, keys, catalog, home } = await setup(context, "apps-catalog");
  const first = await catalog.ensureTable(ctx, "todos");
  assert.deepEqual(first.made, ["departments", "todo_lists", "organisations", "contacts", "todos"], "needs first");
  assert.deepEqual(await keys(), ["contacts", "departments", "organisations", "todo_lists", "todos"]);
  const tables = await registry.loadTables(home.options);
  const idOf = (key) => tables.find((table) => table.key === key).id;
  const field = (key) => first.table.fields.find((entry) => entry.key === key);
  assert.equal(field("parent").options.target, first.table.id, "a to-do is part of another to-do");
  assert.equal(field("todo_list").options.target, idOf("todo_lists"));
  assert.equal(field("attachment").type, "file");
  assert.equal(first.table.fields[0].key, "title");
  assert.equal(first.table.titleFieldId, field("title").id);
  const lists = await gate.read(ctx, "todo_lists");
  assert.deepEqual(lists.records.map((record) => record[tables.find((table) => table.key === "todo_lists").fields[0].id]), ["General"], "seeded");

  const again = await catalog.ensureTable(ctx, "todos");
  assert.deepEqual(again.made, []);
  assert.equal(again.table.fields.length, first.table.fields.length);
  assert.equal((await gate.read(ctx, "todo_lists")).total, 1, "seed rows only into a table it made");
  await assert.rejects(catalog.ensureTable(ctx, "plants"), { code: "apps_catalog_table_unknown" });
});

test("a home's own table of a shared table's key is reused: it keeps its fields and gains the ones it lacks", async (context) => {
  const { registry, gate, ctx, person, catalog, home } = await setup(context, "apps-catalog-reuse");
  // As the CRM template made it.
  await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }, { key: "company", type: "text" }, { key: "stage", type: "choice", choices: ["Lead", "Customer", "Lost"] }] }, home.options);
  const ann = await gate.create(ctx, "contacts", { name: "Ann", company: "Acme", stage: "Lead" });
  const { table, made } = await catalog.ensureTable(ctx, "contacts");
  assert.deepEqual(made, ["organisations"]);
  const fieldKeys = table.fields.filter((field) => !field.obsolete).map((field) => field.key);
  assert.deepEqual(fieldKeys.slice(0, 3), ["name", "company", "stage"], "nothing removed or renamed");
  assert.ok(["organisation", "owner", "tags", "photo", "notes"].every((key) => fieldKeys.includes(key)));
  const kept = await gate.get(ctx, "contacts", ann.id);
  assert.equal(kept[table.fields.find((field) => field.key === "company").id], "Acme");
});

test("an extension holds one row per record of its base, made once, and never takes a shared table's name", async (context) => {
  const { registry, gate, ctx, person, catalog, home } = await setup(context, "apps-catalog-extend");
  const vip = await catalog.ensureExtension(ctx, "contacts", { key: "vip_details", label: "VIP details", fields: [{ key: "tier", type: "choice", choices: ["Gold", "Silver"] }] });
  assert.deepEqual(vip.made, ["organisations", "contacts", "vip_details"]);
  const link = vip.table.fields.find((field) => field.key === "contact");
  assert.deepEqual([link.type, link.options.unique, link.options.required], ["link", true, true]);
  const ann = await gate.create(ctx, "contacts", { name: "Ann" });
  await gate.create(ctx, "vip_details", { contact: ann.id, tier: "Gold" });
  await assert.rejects(gate.create(ctx, "vip_details", { contact: ann.id, tier: "Silver" }), { code: "apps_link_unique_taken" });
  assert.deepEqual((await catalog.ensureExtension(ctx, "contacts", { key: "vip_details", fields: [{ key: "since", type: "date" }] })).made, []);
  assert.ok((await registry.loadTables(home.options)).find((table) => table.key === "vip_details").fields.some((field) => field.key === "since"), "a missing field added");

  await assert.rejects(catalog.ensureExtension(ctx, "contacts", { key: "tasks" }), { code: "apps_table_in_catalog" });
  await registry.createTable(person, { key: "notes_log", fields: [{ key: "text", type: "text" }] }, home.options);
  await assert.rejects(catalog.ensureExtension(ctx, "contacts", { key: "notes_log" }), { code: "apps_extension_key_taken" });
  await assert.rejects(catalog.ensureExtension(ctx, "suppliers", { key: "supplier_terms" }), { code: "apps_extension_base_missing" });
  const crm = await catalog.ensureTable(ctx, "crm_contacts");
  assert.deepEqual(crm.made, ["crm_contacts"], "the catalog's own extension, of the contacts already there");
});

test("a template's own table comes after the shared tables it links to, and a second template's shared table is reused", async (context) => {
  const { ctx, keys, catalog } = await setup(context, "apps-catalog-own");
  const bills = {
    key: "bills",
    label: "Bills",
    fields: [{ key: "title", type: "text", required: true }, { key: "provider", type: "link", target: "organisations" }, { key: "amount", type: "money" }]
  };
  // As the household bills template asks: its shared table, then its own.
  assert.deepEqual((await catalog.ensureTable(ctx, "organisations")).made, ["organisations"]);
  const own = await catalog.ensureOwnTable(ctx, bills);
  assert.deepEqual(own.made, ["bills"]);
  assert.equal(own.table.fields.find((field) => field.key === "provider").type, "link");
  assert.deepEqual((await catalog.ensureOwnTable(ctx, bills)).made, [], "made once");
  // A second template's contacts link to the organisations already there.
  assert.deepEqual((await catalog.ensureTable(ctx, "contacts")).made, ["contacts"]);
  assert.deepEqual(await keys(), ["bills", "contacts", "organisations"]);
  await assert.rejects(catalog.ensureOwnTable(ctx, { key: "customers", fields: [{ key: "name", type: "text" }] }), { code: "apps_table_in_catalog" });
  await assert.rejects(catalog.ensureOwnTable(ctx, { key: "my_people", label: "People", fields: [{ key: "name", type: "text" }] }), { code: "apps_table_in_catalog" });
});

test("a record's related records come by table and link, a page of each, in a fixed number of queries", async (context) => {
  const { home, gate, ctx, catalog } = await setup(context, "apps-catalog-related");
  await catalog.ensureTable(ctx, "todos");
  await catalog.ensureTable(ctx, "deals");
  await catalog.ensureTable(ctx, "crm_contacts");
  const ann = await gate.create(ctx, "contacts", { name: "Ann" });
  const bob = await gate.create(ctx, "contacts", { name: "Bob" });
  const add = async (count) => {
    for (let index = 0; index < count; index += 1) {
      await gate.create(ctx, "todos", { title: `Call ${index}`, contact: ann.id });
      await gate.create(ctx, "deals", { title: `Deal ${index}`, contact: ann.id });
    }
  };
  await add(3);
  await gate.create(ctx, "crm_contacts", { contact: ann.id, stage: "Lead" });
  await gate.create(ctx, "todos", { title: "Bob's", contact: bob.id });

  const groups = await gate.related(ctx, "contacts", ann.id);
  const summary = groups.map((group) => [group.table.key, group.field.key, group.total, group.extension]).sort();
  assert.deepEqual(summary, [["crm_contacts", "contact", 1, true], ["deals", "contact", 3, false], ["todos", "contact", 3, false]]);
  const todos = groups.find((group) => group.table.key === "todos");
  assert.ok(todos.records.every((record) => record[todos.field.id].id === String(ann.id)), "only Ann's");
  assert.deepEqual(await gate.related(ctx, "organisations", "999999"), []);

  const few = await queriesDuring(home.knex, () => gate.related(ctx, "contacts", ann.id));
  await add(37);
  const many = await queriesDuring(home.knex, () => gate.related(ctx, "contacts", ann.id));
  assert.equal(many, few, `40 related records each took ${many} queries, 3 took ${few}`);
  const after = await gate.related(ctx, "contacts", ann.id);
  assert.deepEqual(after.find((group) => group.table.key === "todos").records.length, 10, "the first page");
  assert.equal(after.find((group) => group.table.key === "todos").total, 40);
});

test("making a shared table, or finding it made, costs the same queries in a home of 3 tables or 40", async (context) => {
  const cost = async (slug, own) => {
    const { registry, ctx, person, catalog, home } = await setup(context, slug);
    for (let at = 0; at < own; at += 1) {
      await registry.createTable(person, { key: `own_${at}`, fields: Array.from({ length: 8 }, (_, field) => ({ key: `f${field}`, type: "text" })) }, home.options);
    }
    const made = await queriesDuring(home.knex, () => catalog.ensureTable(ctx, "deals"));
    // Found made, with its tables read afresh (another server's change) and then as this server keeps them.
    await registry.changed(home.options);
    const found = await queriesDuring(home.knex, () => catalog.ensureTable(ctx, "deals"));
    return { made, found, kept: await queriesDuring(home.knex, () => catalog.ensureTable(ctx, "deals")) };
  };
  const few = await cost("apps-catalog-cost-few", 3);
  const many = await cost("apps-catalog-cost-many", 40);
  assert.deepEqual(many, few, `40 tables: ${JSON.stringify(many)}; 3 tables: ${JSON.stringify(few)}`);
  assert.equal(few.kept, 0, "a home's tables as this server keeps them");
});
