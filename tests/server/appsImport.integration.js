import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { createWebAccess } from "../../packages/apps/src/server/webAccess.js";

// Spreadsheet import through the data gate (D-35): every row is checked, and one bad row means
// nothing is written; cells are converted from how a spreadsheet writes them.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("an import adds every row or none", async (context) => {
  const home = await appsHome(context, { slug: "apps-import" });
  const { knex, userId, workspaceId, options } = home;
  // The gate without scripts' rules: the values as given.
  const { registry, gate } = appsParts(home);
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "import", file: "people.csv" });

  const contacts = await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const deals = await registry.createTable(person, {
    key: "deals",
    fields: [
      { key: "title", type: "text", required: true },
      { key: "amount", type: "money" },
      { key: "closed", type: "date" },
      { key: "won", type: "yesno" },
      { key: "contact", type: "link", target: "contacts" }
    ]
  }, options);
  const id = (key) => deals.fields.find((field) => field.key === key).id;
  const ana = await gate.create(ctx, "contacts", { name: "Ana" });
  await gate.create(ctx, "contacts", { name: "Twin" });
  await gate.create(ctx, "contacts", { name: "twin" });
  const dealCount = async () => (await gate.read(ctx, "deals")).records.length;
  const row = (title, amount, closed, won, contact) => ({ [id("title")]: title, [id("amount")]: amount, [id("closed")]: closed, [id("won")]: won, [id("contact")]: contact });

  // One bad row: errors name the file's rows, and nothing is written.
  const bad = await gate.importRecords(ctx, "deals", [row("One", "1,250.50", "2026-10-01", "Yes", "ana"), row("", "3", "", "", ""), row("Three", "x", "2026-02-30", "maybe", "Nobody"), row("Four", "", "", "", "twin")], { firstRow: 2 });
  assert.equal(bad.imported, 0);
  assert.deepEqual(bad.errors.map((error) => error.row), [3, 4, 5]);
  assert.match(bad.errors[0].message, /Title is required/u);
  assert.match(bad.errors[1].message, /Amount: must be an amount like 12\.50/u);
  assert.match(bad.errors[2].message, /2 records are called "twin"/u);
  assert.equal(await dealCount(), 0, "nothing was written");

  // A dry run checks only; a clean file is written with its values converted.
  const rows = [row("One", "1,250.50", "2026-10-01T00:00:00.000Z", "Yes", "ANA"), {}, row("Two", 12, "", false, ana.id)];
  assert.deepEqual(await gate.importRecords(ctx, "deals", rows, { dryRun: true }), { imported: 0, errors: [] });
  assert.equal(await dealCount(), 0, "a dry run writes nothing");
  assert.deepEqual(await gate.importRecords(ctx, "deals", rows), { imported: 2, errors: [] }, "the empty line is skipped");
  const { records } = await gate.read(ctx, "deals", { sort: [{ field: id("title") }] });
  assert.deepEqual(records.map((record) => [record[id("title")], record[id("amount")], record[id("closed")], record[id("won")], record[id("contact")]?.id]), [
    ["One", 125050, "2026-10-01", true, ana.id],
    ["Two", 1200, null, false, ana.id]
  ]);
  const audit = await knex("audit_events").where({ workspace_id: workspaceId, table_id: deals.id, action: "create" });
  assert.equal(audit.length, 2, "each record is audited");
  assert.deepEqual(audit[0].via, { kind: "import", file: "people.csv" });
  assert.ok(contacts.id);

  // A page holds 200 records (PAGE_MAX; json-rest-api's own cap is 100), so export, which stops at
  // the first shorter page, reads every record (audit F6); an import finds a title past the first 200.
  const name = contacts.fields.find((field) => field.key === "name").id;
  assert.deepEqual(await gate.importRecords(ctx, "contacts", Array.from({ length: 230 }, (_, index) => ({ [name]: `Contact ${index + 1}` }))), { imported: 230, errors: [] });
  const pages = await Promise.all([1, 2].map((number) => gate.read(ctx, "contacts", { page: { size: 200, number } })));
  assert.deepEqual([pages[0].records.length, pages[1].records.length, pages[0].total], [200, 33, 233]);
  assert.deepEqual(await gate.importRecords(ctx, "deals", [row("Late", "", "", "", "Contact 230")]), { imported: 1, errors: [] });

  await assert.rejects(gate.importRecords(ctx, "deals", Array.from({ length: 501 }, () => ({}))), /At most 500 rows/u);
});

test("an import costs the same at 10 rows and at 200: its checks and its writes are a fixed number of statements", async (context) => {
  const home = await appsHome(context, { slug: "apps-import-cost" });
  const { knex, userId, workspaceId, options } = home;
  // Like scripts' rules, reading the table's rules is a query; an import reads them once.
  const lookUpRules = () => knex.raw("select 1");
  // Only the work's own queries are counted here: no refresh of the cached tables after their 5 s (appsRegistry checks that).
  const { registry, gate } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: async (_ctx, _table, _action, values) => (await lookUpRules(), values),
    beforeSaveEach: async () => (await lookUpRules(), { apply: async (values) => values, flush: async () => {} })
  });
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "import", file: "deals.csv" });

  await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const deals = await registry.createTable(person, {
    key: "deals",
    fields: [{ key: "title", type: "text", required: true }, { key: "amount", type: "money" }, { key: "contact", type: "link", target: "contacts" }]
  }, options);
  const id = (key) => deals.fields.find((field) => field.key === key).id;
  const contacts = [];
  for (const name of ["Ana", "Ben", "Cy", "Dee", "Eve"]) contacts.push(await gate.create(ctx, "contacts", { name }));
  // A link by title, or by id every third row.
  const sheet = (size, prefix) =>
    Array.from({ length: size }, (_, index) => ({
      [id("title")]: `${prefix} ${index}`,
      [id("amount")]: "12.50",
      [id("contact")]: index % 3 ? ["Ana", "Ben", "Cy", "Dee", "Eve"][index % 5] : contacts[index % 5].id
    }));

  // The preview writes nothing, so its cost doesn't depend on the rows at all.
  const preview = async (size) => {
    let result = null;
    const count = await queriesDuring(knex, async () => {
      result = await gate.importRecords(ctx, "deals", sheet(size, "Preview"), { dryRun: true });
    });
    assert.deepEqual(result, { imported: 0, errors: [] });
    return count;
  };
  const smallPreview = await preview(10);
  const largePreview = await preview(200);
  assert.equal(largePreview, smallPreview, `a 200-row preview took ${largePreview} queries, a 10-row one ${smallPreview}`);

  const write = async (size, prefix) => {
    let result = null;
    const count = await queriesDuring(knex, async () => {
      result = await gate.importRecords(ctx, "deals", sheet(size, prefix));
    });
    assert.deepEqual(result, { imported: size, errors: [] });
    return count;
  };
  const small = await write(10, "Small");
  const large = await write(200, "Large");
  // The rows go in as one postMany and their audit entries as one createMany.
  assert.equal(large, small, `a 200-row import took ${large} queries, a 10-row one ${small}`);

  // Every record is written with its values and its own audit entry.
  const written = await gate.read(ctx, "deals", { page: { size: 200, number: 1 }, where: null, sort: [{ field: id("title") }] });
  assert.equal(written.total, 210, "both imports");
  const large7 = written.records.find((record) => record[id("title")] === "Large 7");
  assert.equal(large7[id("amount")], 1250);
  assert.deepEqual([large7[id("contact")].id, large7[id("contact")].label], [contacts[2].id, "Cy"]);
  const audit = await knex("audit_events").where({ workspace_id: workspaceId, table_id: deals.id, action: "create" }).orderBy("id");
  assert.equal(audit.length, 210, "each imported record is audited");
  assert.deepEqual(audit[0].via, { kind: "import", file: "deals.csv" });
  assert.deepEqual(audit[0].changes[id("amount")], [null, 1250]);
  const large7Audit = audit.find((entry) => entry.record_id === large7.id);
  assert.deepEqual(large7Audit.changes[id("title")], [null, "Large 7"]);
});

test("an import reads only the linked records its sheet names, however many the linked table holds", async (context) => {
  const home = await appsHome(context, { slug: "apps-import-links" });
  const { knex, userId, options } = home;
  // Only the work's own queries are counted here: no refresh of the cached tables after their 5 s (appsRegistry checks that).
  const { registry, gate } = appsParts(home, { trustMs: Infinity });
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "import", file: "deals.csv" });
  const contacts = await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const deals = await registry.createTable(person, {
    key: "deals",
    fields: [{ key: "title", type: "text", required: true }, { key: "contact", type: "link", target: "contacts" }]
  }, options);
  const name = contacts.fields.find((field) => field.key === "name").id;
  const id = (key) => deals.fields.find((field) => field.key === key).id;
  const filler = (from, count) => Array.from({ length: count }, (_, index) => ({ [name]: `Filler ${from + index}` }));

  const ana = await gate.create(ctx, "contacts", { name: "Ana" });
  const ben = await gate.create(ctx, "contacts", { name: "Ben" });
  const cy = await gate.create(ctx, "contacts", { name: "Cy" });
  await gate.markObsolete(ctx, "contacts", cy.id);
  await gate.importRecords(ctx, "contacts", filler(1, 7));
  // Three records named: by title with spaces and in another case, by title, and by the id of an obsolete one.
  const sheet = [
    { [id("title")]: "One", [id("contact")]: " ANA " },
    { [id("title")]: "Two", [id("contact")]: "ben" },
    { [id("title")]: "Three", [id("contact")]: cy.id },
    { [id("title")]: "Four", [id("contact")]: "ana" }
  ];
  const preview = async () => {
    let result = null;
    const count = await queriesDuring(knex, async () => {
      result = await gate.importRecords(ctx, "deals", sheet, { dryRun: true });
    });
    assert.deepEqual(result, { imported: 0, errors: [] });
    return count;
  };
  const small = await preview();
  await gate.importRecords(ctx, "contacts", filler(8, 190));
  assert.equal((await gate.read(ctx, "contacts", { page: { size: 1 } })).total, 199, "Cy is obsolete");
  const large = await preview();
  assert.equal(large, small, `with 200 linked records the import took ${large} queries, with 10 ${small}`);

  // The links are the records named, and the errors are as before: an ambiguous title, and a text that names nothing.
  assert.deepEqual(await gate.importRecords(ctx, "deals", sheet), { imported: 4, errors: [] });
  const { records } = await gate.read(ctx, "deals", { sort: [{ field: id("title") }] });
  assert.deepEqual(records.map((record) => [record[id("title")], record[id("contact")].id]), [
    ["Four", ana.id],
    ["One", ana.id],
    ["Three", cy.id],
    ["Two", ben.id]
  ]);
  await gate.create(ctx, "contacts", { name: "ANA" });
  const failed = await gate.importRecords(ctx, "deals", [{ [id("title")]: "Five", [id("contact")]: "Ana" }, { [id("title")]: "Six", [id("contact")]: "Nobody" }]);
  assert.equal(failed.imported, 0);
  assert.deepEqual(failed.errors.map((error) => error.row), [2, 3]);
  assert.match(failed.errors[0].message, /2 records are called "Ana"/u);
  assert.match(failed.errors[1].message, /that .* doesn't exist/u);
});

test("an import records its rules' runs, one row per run, in one insert", async (context) => {
  const home = await appsHome(context, { slug: "apps-import-rules" });
  const { knex, userId, options, notices } = home;

  // The test's own scripts, with their own web access, as the gate's rules on saving (as the server wires them).
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext } = appsParts(home, {
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args)
  });
  const web = createWebAccess({ resources, env: { MERCBOT_VAULT_KEY: randomBytes(32).toString("base64") } });
  scripts = createScripts({ resources, repository, systemContext, notices, registry, gate, apps, env: process.env, web });
  // Registered after appsHome's, so it runs before the home and its features go.
  context.after(async () => {
    await scripts.close();
  });

  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "import", file: "deals.csv" });
  await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const deals = await registry.createTable(person, {
    key: "deals",
    fields: [{ key: "title", type: "text", required: true }, { key: "contact", type: "link", target: "contacts" }]
  }, options);
  const id = (key) => deals.fields.find((field) => field.key === key).id;
  const ana = await gate.create(ctx, "contacts", { name: "Ana" });
  await apps.createApp(person, { name: "Sales" }, options);
  const saved = await scripts.save(person, "sales", {
    key: "deal_contact",
    kind: "rule",
    summary: "Reads each deal's contact",
    settings: { table: "deals" },
    code: `async function main({ record }) {
      await records.get("contacts", record.contact);
      return {};
    }`,
    tests: [{ name: "reads", input: { action: "create", record: { title: "A", contact: "1" }, previous: null }, records: { contacts: [{ id: "1", name: "Ana" }] }, expect: {} }]
  }, options);
  assert.deepEqual(saved.errors, []);
  const runs = () => knex("app_script_runs").where({ script_id: saved.script.id }).orderBy("id");

  const sheet = (size, prefix) => Array.from({ length: size }, (_, index) => ({ [id("title")]: `${prefix} ${index}`, [id("contact")]: "Ana" }));
  const runInserts = async (size, prefix, importOptions = {}) => {
    let result = null;
    const inserts = await queriesDuring(knex, async () => {
      result = await gate.importRecords(ctx, "deals", sheet(size, prefix), importOptions);
    }, { matching: /^insert into "app_script_runs"/u });
    assert.deepEqual(result, { imported: importOptions.dryRun ? 0 : size, errors: [] });
    return inserts;
  };
  const before = (await runs()).length;
  assert.equal(await runInserts(10, "Preview", { dryRun: true }), 1, "a dry run's rule runs are recorded too, together");
  assert.equal(await runInserts(10, "Small"), 1);
  assert.equal(await runInserts(50, "Large"), 1, "50 rows' rule runs are still one insert");

  // One row per run, each as a single save records it.
  const recorded = (await runs()).slice(before);
  assert.equal(recorded.length, 70);
  for (const run of recorded) {
    assert.deepEqual([run.ok, run.calls, run.error, run.via], [true, 1, null, { kind: "rule", table: "deals", by: "import" }]);
    assert.ok(Number.isInteger(run.ms) && run.ms >= 0);
  }
  assert.equal((await gate.read(ctx, "deals", { page: { size: 1 } })).total, 60);
  assert.ok(ana.id);

  // A save on its own records its run at once.
  const single = await queriesDuring(knex, () => gate.create(ctx, "deals", { title: "Single", contact: ana.id }), { matching: /^insert into "app_script_runs"/u });
  assert.equal(single, 1);
  assert.equal((await runs()).length, before + 71);
});
