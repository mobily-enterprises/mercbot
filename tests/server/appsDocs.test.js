import assert from "node:assert/strict";
import test from "node:test";
import { fillTemplate, templatePlaces } from "../../packages/apps/src/server/scriptDocs.js";

// A record's document (D-140): a template's places, filled from the record as screens show its values, escaped, with
// its line items as a table, in a whole page.
const field = (id, key, type, options = {}) => ({ id, key, label: key[0].toUpperCase() + key.slice(1), type, options, obsolete: false });
const invoices = { id: "t_inv", key: "invoices", label: "Invoices", fields: [field("f_no", "number", "text"), field("f_total", "total", "money"), field("f_due", "due", "date"), field("f_to", "client", "text")] };
const lines = { id: "t_lines", key: "invoice_lines", label: "Lines", fields: [field("f_item", "item", "text"), field("f_price", "price", "money"), field("f_of", "invoice", "link", { target: "t_inv" })] };

test("a template's places: fields and line items; anything else is refused with the form it takes", () => {
  assert.deepEqual(templatePlaces("<h1>{{ number }}</h1>{{lines:invoice_lines:invoice:item, price}}"), [
    { kind: "field", key: "number" },
    { kind: "lines", table: "invoice_lines", link: "invoice", fields: ["item", "price"] }
  ]);
  assert.throws(() => templatePlaces("{{lines:invoice_lines}}"), /\{\{lines:table:link:field,field\}\}/u);
});

test("filled from the record as screens show it, escaped, with its lines as a table, in a whole page", () => {
  const record = { id: "1", f_no: "INV-7", f_total: 125050, f_due: "2026-12-01", f_to: "Bolt & <Sons>" };
  const rows = new Map([["lines:invoice_lines:invoice:item,price", { table: lines, records: [{ id: "9", f_item: "Desk", f_price: 120000 }, { id: "10", f_item: "Lamp", f_price: 5050 }] }]]);
  const page = fillTemplate("<h1>Invoice {{number}}</h1><p>To {{client}}, due {{due}}: {{total}}</p>{{lines:invoice_lines:invoice:item, price}}", invoices, record, rows);
  assert.match(page, /^<!doctype html><html><head><meta charset="utf-8"><style>/u);
  assert.match(page, /<h1>Invoice INV-7<\/h1>/u);
  assert.match(page, /To Bolt &#38; &#60;Sons&#62;, due 1 Dec 2026: 1,250.50/u, "escaped, a date and an amount as screens show them");
  assert.match(page, /<th>Item<\/th><th>Price<\/th><\/tr><\/thead><tbody><tr><td>Desk<\/td><td>1,200.00<\/td><\/tr><tr><td>Lamp<\/td><td>50.50<\/td><\/tr>/u);
  assert.throws(() => fillTemplate("{{nope}}", invoices, record), /invoices has no field "nope" \(its fields: number, total, due, client\)/u);
  assert.equal(fillTemplate("<html><body>{{number}}</body></html>", invoices, record), "<html><body>INV-7</body></html>", "a whole page stays as it is");
});
