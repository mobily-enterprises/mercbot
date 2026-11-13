import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { createTables, dropTables } from "./harness.mjs";
import { bootServer, serverQueriesDuring, signUp } from "./http.mjs";
import { forget, seedHome } from "./seed.mjs";

// A spreadsheet import through its route (D-35): every row is checked and one bad row means nothing is written, the
// errors name the sheet's rows, a dry run writes nothing, link columns resolve by title, at most 500 rows go at once and
// each imported record gets its own audit entry. The tables come from harness.mjs (only the Builder's tools make them).

// The import's statements today, measured by the last test on the code before the port (da/port-baseline at e442972,
// 08 Nov: "import statements today: 10 rows 70, 200 rows 1020"). The port may send fewer, never more.
const TODAY = Object.freeze({ ten: 70, twoHundred: 1020 });
// The server trusts a home's cached tables for 5 s (packages/apps/src/server/registry.js TRUST_MS); a measured import
// that comes just after that reads them again (app_tables and app_fields).
const TABLES_REREAD = 2;

let app;
let knex;
let pat;
let home;
let dealsId;
let field;
let ana;

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  home = await seedHome(knex, pat.id);
  await createTables(knex, home.id, { type: "person", id: pat.id, name: "Pat" }, [
    { key: "contacts", fields: [{ key: "name", type: "text", required: true }] },
    {
      key: "deals",
      fields: [
        { key: "title", type: "text", required: true },
        { key: "amount", type: "money" },
        { key: "contact", type: "link", target: "contacts" }
      ]
    }
  ]);
  const tables = await pat.get(`${home.url}/app-data/tables`);
  assert.equal(tables.status, 200, JSON.stringify(tables.body));
  const deals = tables.body.tables.find((table) => table.key === "deals");
  dealsId = deals.id;
  field = (key) => deals.fields.find((entry) => entry.key === key).id;
  const created = await pat.post(`${home.url}/app-data/tables/contacts/records`, { values: { name: "Ana" } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  ana = String(created.body.id);
});

after(async () => {
  await app?.close();
  if (home) await dropTables(knex, home.id);
  await forget(knex, [home], [pat]);
  await knex?.destroy();
});

/** A sheet row, keyed by field id as the page sends it. */
const row = (title, amount = "", contact = "") => ({ [field("title")]: title, [field("amount")]: amount, [field("contact")]: contact });
const importRows = (rows, options = {}) => pat.post(`${home.url}/app-data/tables/deals/import`, { rows, file: "deals.csv", ...options });

async function total() {
  const answer = await pat.get(`${home.url}/app-data/tables/deals/records?size=1`);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return answer.body.total;
}

const audited = (file) =>
  knex("audit_events").where({ workspace_id: home.id, table_id: dealsId, action: "create" }).whereRaw("via->>'file' = ?", [file]);

test("a dry run checks every row and writes nothing", async () => {
  const had = await total();
  const answer = await importRows([row("One", "12.50"), row("Two", "3")], { dryRun: true, file: "dry.csv" });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body, { imported: 0, errors: [] });
  assert.equal(await total(), had);
  assert.equal((await audited("dry.csv")).length, 0);
});

test("one bad row means nothing is written, and the errors name the sheet's rows", async () => {
  const had = await total();
  const answer = await importRows([row("Good", "1"), row("", "5"), row("Bad amount", "x")], { firstRow: 2, file: "bad.csv" });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.imported, 0);
  assert.deepEqual(answer.body.errors.map((error) => error.row), [3, 4], "the sheet's rows 3 and 4");
  assert.match(answer.body.errors[0].message, /Title is required/u);
  assert.match(answer.body.errors[1].message, /Amount: must be an amount like 12\.50/u);
  assert.equal(await total(), had, "nothing was written");
  assert.equal((await audited("bad.csv")).length, 0);
});

test("a link column resolves by its target's title, and takes a record's id too", async () => {
  const answer = await importRows([row("By title", "", " ana "), row("By id", "", ana)], { file: "links.csv" });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body, { imported: 2, errors: [] });
  const read = await pat.get(`${home.url}/app-data/tables/deals/records?size=200`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  for (const title of ["By title", "By id"]) {
    const record = read.body.records.find((entry) => entry[field("title")] === title);
    assert.ok(record, `${title} was imported`);
    assert.equal(String(record[field("contact")]?.id), ana, `${title} links to Ana`);
  }
});

test("500 rows import at once, each with its own audit entry; 501 are refused", async () => {
  const had = await total();
  const rows = Array.from({ length: 500 }, (_, index) => row(`Deal ${index + 1}`, "12.50"));
  const answer = await importRows(rows, { file: "five-hundred.csv" });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body, { imported: 500, errors: [] });
  assert.equal(await total(), had + 500);
  const audit = await audited("five-hundred.csv");
  assert.equal(audit.length, 500, "one audit entry per record");
  assert.ok(audit.every((entry) => entry.via?.kind === "import" && entry.via?.file === "five-hundred.csv"), "each one via the import");
  assert.equal(new Set(audit.map((entry) => String(entry.record_id))).size, 500, "each for its own record");

  const tooMany = await importRows([...rows, row("Deal 501", "1")], { file: "too-many.csv" });
  assert.equal(tooMany.status, 400, JSON.stringify(tooMany.body));
  assert.equal(tooMany.body.code, "apps_import_too_many");
  assert.deepEqual(tooMany.body.params, { max: 500 });
  assert.equal(await total(), had + 500, "nothing of the 501 was written");
});

test("an import's statements at 10 rows and at 200 stay within today's", async (context) => {
  const measured = async (count, file) => {
    const rows = Array.from({ length: count }, (_, index) => row(`${file} ${index + 1}`, "1", "Ana"));
    // A dry run first warms the server's caches, its cached tables among them, just before the measured import.
    assert.equal((await importRows(rows, { dryRun: true, file })).status, 200);
    let answer = null;
    const statements = await serverQueriesDuring(async () => {
      answer = await importRows(rows, { file });
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(answer.body, { imported: count, errors: [] });
    assert.ok(statements > 0, "the server's statements were counted");
    return statements;
  };
  const ten = await measured(10, "ten.csv");
  const twoHundred = await measured(200, "two-hundred.csv");
  context.diagnostic(`import statements today: 10 rows ${ten}, 200 rows ${twoHundred}`);
  if (TODAY.ten === null || TODAY.twoHundred === null) {
    context.todo("TODAY in this file needs the counts measured on the code before the port");
    return;
  }
  assert.ok(ten <= TODAY.ten + TABLES_REREAD, `10 rows took ${ten} statements; today ${TODAY.ten}`);
  assert.ok(twoHundred <= TODAY.twoHundred + TABLES_REREAD, `200 rows took ${twoHundred} statements; today ${TODAY.twoHundred}`);
});
