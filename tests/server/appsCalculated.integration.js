import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { buildAppTools } from "../../packages/bots/src/server/appTools.js";
import { compileWhere } from "../../packages/apps/src/shared/where.js";

// Calculated fields and named formulas (D-78), as the Builder makes them and everyone reads them: a calculated field is
// never stored, so every read works it out from the record as it is now, through the data gate (lists, records,
// totals), in screens, in a draft tried on practice data, and in the bots' tools.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const definition = {
  home: "list",
  formulas: {
    with_vat: { params: ["amount"], formula: "=amount * 1.2" },
    caption: { params: ["item", "cents"], formula: '=item + ": " + string(int(with_vat(cents))) + " with VAT"' }
  },
  screens: {
    list: {
      data: {
        orders: { from: "orders", sort: "item" },
        byItem: { from: "orders", groupBy: "item", sum: "total", grandTotal: true }
      },
      content: [
        { type: "table", rows: "=data.orders", columns: [{ label: "Item", value: "=row.item" }, { label: "Total", value: "=row.total" }, { label: "Caption", value: "=caption(row.item, row.total)" }] },
        { type: "totals", label: "By item", rows: "=data.byItem" },
        { type: "form", table: "orders", fields: ["item", "price", "quantity", "total"], buttons: [{ type: "button", label: "Add", do: [{ create: { table: "orders", values: "=form.values" } }] }] }
      ]
    }
  }
};

test("calculated fields are worked out on every read, and named formulas run everywhere", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const records = botsOf(knex);
  const home = await appsHome(cleanup, { slug: "apps-calc", knex, records });
  const { apps, userId, workspaceId, options: call } = home;
  const { registry, gate, runtime } = apps;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Builder", color: "#1E86FC" }).returning("id");
  const botId = bot.id ?? bot;
  cleanup.after(() => knex("bots").where({ id: botId }).del());
  const builder = buildAppTools({ apps, directory: records.directory, call, botId, conversationId: null, userId: null, isBuilder: true, after: [], attempted: [], via: null });
  const run = (tool, input) => tool.execute(input, {});
  const person = { type: "person", id: userId, name: "Pat" };
  const data = { options: call, actor: person, via: { kind: "data" } };

  // The Builder makes a table with calculated fields; the title is the first stored text field.
  const made = await run(builder.tableCreate, {
    key: "orders",
    fields: [
      { key: "total", type: "money", formula: "=price * quantity" },
      { key: "item", type: "text", required: true },
      { key: "price", type: "money" },
      { key: "quantity", type: "number" },
      { key: "big", type: "yesno", formula: "=total > 10000.0" }
    ]
  });
  assert.equal(made.status, "created", JSON.stringify(made));
  let orders = (await registry.loadTables(call)).find((table) => table.key === "orders");
  const id = (key) => orders.fields.find((field) => field.key === key).id;
  assert.equal(orders.titleFieldId, id("item"));
  assert.equal(orders.fields.find((field) => field.key === "total").options.formula, `=${id("price")} * ${id("quantity")}`, "stored by ids");

  // Its mistakes come back precisely, and nothing is made.
  const cycle = await run(builder.tableCreate, { key: "loop", fields: [{ key: "a", type: "number", formula: "=b + 1.0" }, { key: "b", type: "number", formula: "=a * 2.0" }] });
  assert.match(cycle.error, /^a: a can't be worked out from itself: a → b → a\.$/u);
  assert.equal((await registry.loadTables(call)).some((table) => table.key === "loop"), false);
  assert.match((await run(builder.fieldAdd, { table: "orders", key: "net", type: "money", formula: "=totl / 1.2" })).error, /orders has no field "totl"\. Did you mean "total"\?/u);
  assert.match((await run(builder.fieldAdd, { table: "orders", key: "net", type: "money", formula: "=total / 1.2", required: true })).error, /can't be required/u);
  assert.match((await run(builder.fieldAdd, { table: "orders", key: "kind", type: "choice", choices: ["A"], formula: '="A"' })).error, /A choice field can't be calculated/u);
  assert.equal((await run(builder.fieldAdd, { table: "orders", key: "net", type: "money", formula: "=total / 1.2" })).status, "added");
  orders = (await registry.loadTables(call)).find((table) => table.key === "orders");

  // Records: the calculated values are worked out on every read, never set.
  const mug = await run(builder.dataCreate, { table: "orders", values: { item: "Mug", price: 1250, quantity: 4 } });
  assert.deepEqual([mug.record.total, mug.record.big, mug.record.net], [5000, false, 4167]);
  assert.match((await run(builder.dataCreate, { table: "orders", values: { item: "Desk", total: 1 } })).error, /Total is calculated from the record's other fields, so it can't be set\./u);
  await gate.create(data, "orders", { item: "Desk", price: 25000, quantity: 1 });
  const changed = await run(builder.dataUpdate, { table: "orders", id: mug.record.id, values: { quantity: 10 } });
  assert.deepEqual([changed.record.total, changed.record.big], [12500, true], "an edit changes the calculated values at once");
  const listed = await gate.read(data, "orders", { sort: [{ field: id("total"), desc: true }] });
  assert.deepEqual(listed.records.map((record) => [record[id("item")], record[id("total")]]), [["Mug", 12500], ["Desk", 25000]], "a sort by a calculated field is left out");

  // Totals of a calculated field are worked out from the records; grouping by one is refused.
  const byItem = await gate.totals(data, "orders", { groupBy: id("item"), measure: "sum", field: id("total") });
  assert.deepEqual(byItem.map((row) => [row.key, row.count, row.total]), [["Desk", 1, 25000], ["Mug", 1, 12500]]);
  assert.deepEqual(await gate.grandTotal(data, "orders", { measure: "avg", field: id("total") }), { count: 2, total: 18750 });
  await assert.rejects(gate.totals(data, "orders", { groupBy: id("big"), measure: "count" }), /Big is calculated, so records can't be grouped by it/u);

  // The bots' tools say what a calculated field is, and refuse a filter or sort on one.
  const tables = await run(builder.dataTables, {});
  const totalField = tables.tables.find((table) => table.table === "orders").fields.find((field) => field.name === "total");
  assert.deepEqual(totalField, { name: "total", label: "Total", type: "money", calculated: "=price * quantity" });
  assert.match((await run(builder.dataQuery, { table: "orders", where: "total > 100.0" })).error, /"total" is calculated, so it can't be filtered on/u);
  assert.match((await run(builder.dataQuery, { table: "orders", sort: "-total" })).error, /"total" is calculated, so records can't be sorted by it/u);

  // A changed formula shows at once; a cycle or a stored field is refused.
  assert.equal((await run(builder.fieldFormula, { table: "orders", field: "total", formula: "=price * quantity * 1.1" })).status, "changed");
  assert.equal((await gate.get(data, "orders", mug.record.id))[id("total")], 13750);
  assert.match((await run(builder.fieldFormula, { table: "orders", field: "total", formula: "=net * 1.2" })).error, /total: total can't be worked out from itself: total → net → total\./u);
  assert.match((await run(builder.fieldFormula, { table: "orders", field: "price", formula: "=1.0" })).error, /price isn't a calculated field/u);
  await run(builder.fieldFormula, { table: "orders", field: "total", formula: "=price * quantity" });
  const audit = await knex("audit_events").where({ workspace_id: workspaceId, action: "schema" }).orderBy("id", "desc").first();
  assert.deepEqual(Object.keys(audit.changes), ["changedFormula"]);

  // An app with a named formula: tried on practice data as a draft, then live; the form shows and never sends total.
  assert.equal((await run(builder.appCreate, { name: "Orders" })).slug, "orders");
  const saved = await run(builder.appSaveDraft, { slug: "orders", definition, summary: "Orders" });
  assert.equal(saved.status, "draft saved", JSON.stringify(saved));
  const tried = await run(builder.appTry, { slug: "orders" });
  const [list, totals] = tried.shown.parts;
  assert.deepEqual(list.rows.map((row) => row.cells), [["Desk", "250.00", "Desk: 30000 with VAT"], ["Mug", "125.00", "Mug: 15000 with VAT"]], JSON.stringify(tried));
  assert.deepEqual(totals.groups.map((group) => [group.label, group.value]), [["Desk", "250.00"], ["Mug", "125.00"]]);
  assert.equal(totals.grandTotal, "375.00");
  const added = await run(builder.appTry, { slug: "orders", press: "Add", values: { item: "Lamp", price: 3000, quantity: 2, total: 1 } });
  assert.equal(added.error, undefined, JSON.stringify(added));
  assert.ok(added.shown.parts[0].rows.some((row) => row.cells[0] === "Lamp" && row.cells[1] === "60.00"), JSON.stringify(added.shown.parts[0]));
  await apps.apps.publish(person, "orders", {}, call);
  const ctx = { options: call, actor: person };
  const live = await runtime.query(ctx, { slug: "orders", screen: "list", query: "orders" });
  assert.deepEqual(live.records.map((record) => [record.item, record.total, record.big]), [["Desk", 25000, true], ["Mug", 12500, true]]);
  const sums = await runtime.query(ctx, { slug: "orders", screen: "list", query: "byItem" });
  assert.equal(sums.grandTotal.total, 37500);
  await runtime.action(ctx, { slug: "orders", screen: "list", path: "content/2/buttons/0/do", values: { item: "Pen", price: 150, quantity: 3, total: 999999 } });
  const pen = (await gate.read(data, "orders")).records.find((record) => record[id("item")] === "Pen");
  assert.equal(pen[id("total")], 450, "what the form sent for total was never written");

  // An import skips a calculated column (an exported sheet has them).
  const imported = await gate.importRecords(data, "orders", [{ [id("item")]: "Cup", [id("price")]: "2.00", [id("quantity")]: "2", [id("total")]: "999" }]);
  assert.deepEqual(imported, { imported: 1, errors: [] });

  // Removing a field it's worked out from: the removal says so, and it shows nothing until its formula changes.
  const impact = await apps.apps.fieldImpact(id("price"), call);
  assert.deepEqual(impact.calculated.map((field) => field.key).sort(), ["big", "net", "total"]);
  await apps.apps.removeField(person, id("price"), call);
  const after = await gate.get(data, "orders", mug.record.id);
  assert.deepEqual([after[id("total")], after[id("big")], after[id("net")]], [null, null, null]);
  const attention = (await run(builder.dataTables, {})).tables.find((table) => table.table === "orders").fields.find((field) => field.name === "total");
  assert.match(attention.needsAttention, /uses a field that was removed/u);
});

test("a calculated sum past its bound is refused unread, and two formula changes at once can't make a loop", async (context) => {
  const home = await appsHome(context, { slug: "apps-calc-bounds" });
  const { knex, userId, options } = home;
  // A sum is worked out from at most 3 records here (5,000 on the server); only the work's own queries are counted.
  const { registry, gate } = appsParts(home, { trustMs: Infinity, calculatedTotalsMax: 3 });
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "data" });
  const lines = await registry.createTable(person, {
    key: "lines",
    fields: [
      { key: "item", type: "text" },
      { key: "price", type: "money" },
      { key: "quantity", type: "number" },
      { key: "total", type: "money", formula: "=price * quantity" },
      { key: "a", type: "number", formula: "=quantity + 1.0" },
      { key: "b", type: "number", formula: "=quantity * 2.0" }
    ]
  }, options);
  const id = (key) => lines.fields.find((field) => field.key === key).id;
  for (const [item, price] of [["A", 100], ["B", 200], ["C", 300], ["D", 400]]) await gate.create(ctx, "lines", { item, price, quantity: 2 });

  // Past the bound, the records are counted and the sum refused without reading them.
  const sum = (where = null) => gate.grandTotal(ctx, "lines", { where, measure: "sum", field: id("total") });
  const sent = await queriesDuring(knex, () => assert.rejects(sum(), (error) => error.code === "apps_calculated_totals_too_many" && /more than 3: filter them first/u.test(error.message)));
  assert.equal(sent, 1, "one count, no page of records");
  const plan = compileWhere({ [id("item")]: "string" }, `=${id("item")} != "D"`);
  assert.deepEqual(await sum({ plan, variables: {}, values: {} }), { count: 3, total: 1200 });

  // Each change checks the table's fields as the other left them, on any server (D-15): a loop is never stored.
  const changes = await Promise.allSettled([
    registry.changeFormula(person, id("a"), "=b + 1.0", options),
    registry.changeFormula(person, id("b"), "=a * 2.0", options)
  ]);
  assert.deepEqual(changes.map((change) => change.status).sort(), ["fulfilled", "rejected"], JSON.stringify(changes));
  assert.match(changes.find((change) => change.status === "rejected").reason.message, /can't be worked out from itself: (a → b → a|b → a → b)\./u);
});
