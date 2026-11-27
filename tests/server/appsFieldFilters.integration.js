import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Filters that compare two of a record's fields, and calculated numbers filtered and sorted in the database (D-140):
// stock at or below its reorder level, items worth over $100, the list ordered by its worth (an empty worth last),
// paging with the right total, and the person's own sort by it. A visitor's reach is appsWhere.test.js's (planFields).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("stock below its reorder level, worth over $100, ordered by worth, through a screen", async (context) => {
  const home = await appsHome(context, { slug: "apps-field-filters" });
  const { userId, options } = home;
  const { registry, gate, apps, runtime } = home.apps;
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(person);
  await registry.createTable(person, {
    key: "stock",
    fields: [
      { key: "item", type: "text", required: true },
      { key: "quantity", type: "number" },
      { key: "reorder", type: "number" },
      { key: "price", type: "money" },
      { key: "worth", type: "money", formula: "=price * quantity" }
    ]
  }, options);
  const rows = [
    ["Pens", 3, 10, 150], ["Paper", 40, 20, 900], ["Ink", 5, 5, 3000], ["Staples", 0, 2, 50], ["Folders", 12, 0, 1200], ["Tape", null, 4, 300]
  ];
  for (const [item, quantity, reorder, price] of rows) await gate.create(ctx, "stock", { item, quantity, reorder, price });
  await apps.createApp(person, { name: "Stock" }, options);
  const definition = {
    home: "s",
    screens: {
      s: {
        data: {
          low: { from: "stock", where: "=quantity <= reorder", sort: "item" },
          valuable: { from: "stock", where: "=worth > 10000.0", sort: "-worth" },
          byWorth: { from: "stock", sort: "-worth", limit: 2 }
        },
        content: [
          { type: "table", rows: "=data.low", columns: [{ label: "Item", value: "=row.item" }] },
          { type: "table", rows: "=data.valuable", columns: [{ label: "Item", value: "=row.item" }] },
          { type: "table", rows: "=data.byWorth", columns: [{ label: "Item", value: "=row.item" }, { label: "Worth", value: "=row.worth" }] }
        ]
      }
    }
  };
  assert.deepEqual((await apps.saveDraft(person, "stock", definition, "v1", options)).errors, []);
  await apps.publish(person, "stock", {}, options);
  const appId = (await apps.find("stock", options)).id;
  const items = async (query, extra = {}) => (await runtime.query(ctx, { slug: appId, version: "live", screen: "s", query, ...extra }));

  assert.deepEqual((await items("low")).records.map((row) => row.item), ["Ink", "Pens", "Staples"], "at or below its own reorder level; an empty one is neither");
  assert.deepEqual((await items("valuable")).records.map((row) => row.item), ["Paper", "Ink", "Folders"], "worth over $100, the most first");
  const first = await items("byWorth");
  assert.deepEqual([first.total, first.records.map((row) => row.item)], [6, ["Paper", "Ink"]], "sorted by a calculated number, counted right");
  assert.deepEqual((await items("byWorth", { page: 3 })).records.map((row) => row.item), ["Staples", "Tape"], "an empty worth comes last");
  assert.deepEqual((await items("byWorth", { sort: "worth" })).records.map((row) => row.item), ["Staples", "Pens"], "the person can sort by it too");
});
