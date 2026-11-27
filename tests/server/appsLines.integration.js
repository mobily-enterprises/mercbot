import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Line items through a screen (D-140): an invoice's screen lists its own lines, adds one already linked to it, edits
// one in the dialog its Edit opens, and removes one, never touching or showing another invoice's lines.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("an invoice's lines: listed, added linked, edited in a dialog, removed, and only its own", async (context) => {
  const home = await appsHome(context, { slug: "apps-lines" });
  const { userId, options } = home;
  const { registry, gate, apps, runtime } = home.apps;
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(person);
  await registry.createTable(person, { key: "invoices", fields: [{ key: "number", type: "text", required: true }] }, options);
  await registry.createTable(person, {
    key: "invoice_lines",
    fields: [{ key: "item", type: "text", required: true }, { key: "quantity", type: "number" }, { key: "price", type: "money" }, { key: "invoice", type: "link", target: "invoices" }]
  }, options);
  const first = await gate.create(ctx, "invoices", { number: "INV-1" });
  const second = await gate.create(ctx, "invoices", { number: "INV-2" });
  await gate.create(ctx, "invoice_lines", { item: "Chair", quantity: 1, price: 5000, invoice: second.id });
  await apps.createApp(person, { name: "Invoices" }, options);
  const definition = {
    home: "invoice",
    screens: {
      invoice: {
        params: { id: { type: "string" } },
        data: { invoice: { record: "invoices", id: "=params.id" } },
        content: [
          { type: "text", value: "=data.invoice.number" },
          {
            type: "lines",
            label: "Lines",
            record: "=data.invoice",
            table: "invoice_lines",
            link: "invoice",
            columns: [{ label: "Item", value: "=row.item" }, { label: "Qty", value: "=string(row.quantity)" }],
            fields: ["item", "quantity", "price"]
          }
        ]
      }
    }
  };
  assert.deepEqual((await apps.saveDraft(person, "invoices", definition, "v1", options)).errors, []);
  await apps.publish(person, "invoices", {}, options);
  const appId = (await apps.find("invoices", options)).id;
  const params = { id: first.id };
  const call = { slug: appId, version: "live", screen: "invoice", params };
  const lines = async (on = params) => (await runtime.query(ctx, { ...call, params: on, query: "lines_1" })).records;
  const press = (path, extra = {}) => runtime.action(ctx, { ...call, path, ...extra });

  assert.deepEqual(await lines(), [], "INV-1 has none yet; INV-2's chair isn't its");
  await press("content/1/content/2/buttons/0/do", { values: { item: "Desk", quantity: 2, price: 15000 } });
  const [desk] = await lines();
  assert.deepEqual([desk.item, desk.quantity, desk.invoice?.id ?? desk.invoice], ["Desk", 2, first.id], "added, linked to INV-1 by itself");

  const opened = await press("content/1/content/1/rowActions/0/do", { row: desk.id });
  assert.deepEqual(opened.effects, [{ set: { state: "line_1", value: desk.id } }, { openDialog: "line_1" }], "Edit sets the line and opens the dialog");
  const edited = await runtime.query(ctx, { ...call, query: "line_1", state: { line_1: desk.id } });
  assert.equal(edited.record.item, "Desk", "the dialog's form reads the line");
  await press("content/1/content/3/content/0/buttons/0/do", { values: { quantity: 3 }, state: { line_1: desk.id } });
  assert.equal((await lines())[0].quantity, 3, "saved from the dialog");

  await press("content/1/content/1/rowActions/1/do", { row: desk.id });
  assert.deepEqual(await lines(), [], "removed");
  assert.deepEqual((await lines({ id: second.id })).map((row) => row.item), ["Chair"], "INV-2's line untouched");
});
