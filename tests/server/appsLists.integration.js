import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// An app's list pages past its first 100 records, sorts by a column the person picks and searches its text fields,
// on top of the screen's own filter, in the database: page 3 costs what page 1 does.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("app lists: pages, the person's sort, search within the screen's filter, the same reads on any page", async (context) => {
  const home = await appsHome(context, { slug: "apps-lists" });
  const { knex, userId, options } = home;
  const { registry, gate, apps, runtime } = home.apps;
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(person);
  await registry.createTable(person, { key: "deals", fields: [{ key: "name", type: "text", required: true }, { key: "amount", type: "money" }, { key: "stage", type: "choice", choices: ["Open", "Won"] }] }, options);
  const rows = Array.from({ length: 250 }, (_, index) => ({ name: `${index % 10 === 1 ? "Acme" : "Deal"} ${String(index).padStart(3, "0")}`, amount: index * 100, stage: index % 2 ? "Open" : "Won" }));
  // An import takes rows by field id, in one transaction.
  const deals = (await registry.loadTables(options)).find((table) => table.key === "deals");
  const idOf = Object.fromEntries(deals.fields.map((field) => [field.key, field.id]));
  const imported = await gate.importRecords(ctx, "deals", rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [idOf[key], value]))));
  assert.deepEqual(imported.errors ?? [], []);
  await apps.createApp(person, { name: "Sales" }, options);
  const definition = {
    home: "list",
    screens: {
      list: {
        data: { open: { from: "deals", where: '=stage == "Open"', sort: "name" } },
        content: [{ type: "table", rows: "=data.open", search: "Find a deal", columns: [{ label: "Name", value: "=row.name" }, { label: "Amount", value: "=row.amount" }] }]
      }
    }
  };
  assert.deepEqual((await apps.saveDraft(person, "sales", definition, "v1", options)).errors, []);
  await apps.publish(person, "sales", {}, options);
  const appId = (await apps.find("sales", options)).id;
  const read = (extra = {}) => runtime.query(ctx, { slug: appId, version: "live", screen: "list", query: "open", ...extra });

  const first = await read();
  assert.equal(first.total, 125, "the screen's filter: the open ones");
  assert.equal(first.records.length, 100);
  assert.equal(first.records[0].name, "Acme 001", "the screen's own sort, by name");
  const second = await read({ page: 2 });
  assert.equal(second.records.length, 25, "page 2 holds the rest");
  assert.ok(!second.records.some((record) => first.records.some((seen) => seen.id === record.id)), "no record twice");

  const byAmount = await read({ sort: "-amount" });
  assert.deepEqual(byAmount.records.slice(0, 2).map((record) => record.amount), [2490000, 2470000], "the person's sort wins (amounts in cents, imported as dollars)");
  assert.equal((await read({ sort: "nope" })).records[0].name, first.records[0].name, "an unknown sort keeps the screen's");

  const searched = await read({ search: "ACME" });
  assert.ok(searched.total > 0 && searched.records.every((record) => record.name.startsWith("Acme") && record.stage === "Open"), "within the screen's filter");

  const count = async (extra) => (await queriesDuring(knex, () => read(extra))).length;
  assert.equal(await count({ page: 2 }), await count({ page: 1 }), "page 2 costs what page 1 does");
});
