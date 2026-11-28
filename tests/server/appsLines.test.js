import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { toIds, toNames } from "../../packages/apps/src/shared/definitions.js";
import { expandLines } from "../../packages/apps/src/shared/lines.js";

// Line items (D-140): one part stands for a list of the shown record's child records with Edit and Remove, an add form
// linked to the record and an edit dialog; the save check names what a lines part needs, and names and ids translate.
const field = (id, key, type, options = {}) => ({ id, key, label: key, type, options, obsolete: false });
const tables = [
  { id: "t_inv", key: "invoices", label: "Invoices", obsolete: false, titleFieldId: "f_no", fields: [field("f_no", "number", "text"), field("f_client", "client", "text")] },
  {
    id: "t_lines",
    key: "invoice_lines",
    label: "Invoice lines",
    obsolete: false,
    titleFieldId: "f_item",
    fields: [field("f_item", "item", "text"), field("f_qty", "quantity", "number"), field("f_price", "price", "money"), field("f_of", "invoice", "link", { target: "t_inv" })]
  }
];
const lines = (extra = {}) => ({
  type: "lines",
  label: "Lines",
  record: "=data.invoice",
  table: "invoice_lines",
  link: "invoice",
  columns: [{ label: "Item", value: "=row.item" }, { label: "Qty", value: "=string(row.quantity)" }],
  fields: ["item", "quantity", "price"],
  ...extra
});
const app = (part = lines(), extra = {}) => ({
  home: "invoice",
  screens: {
    invoice: {
      params: { id: { type: "string" } },
      data: { invoice: { record: "invoices", id: "=params.id" } },
      content: [{ type: "text", value: "=data.invoice.number" }, part],
      ...extra
    }
  }
});

test("a lines part stands for a linked list with Edit and Remove, an add form and an edit dialog", () => {
  const screen = expandLines(app().screens.invoice);
  assert.deepEqual(screen.data.lines_1, { from: "invoice_lines", where: "=invoice == params.id" });
  assert.deepEqual(screen.data.line_1, { record: "invoice_lines", id: "=state.line_1" });
  assert.deepEqual(screen.state.line_1, { type: "string", default: "" });
  const [label, list, add, dialog] = screen.content[1].content;
  assert.equal(label.value, "Lines");
  assert.equal(list.rows, "=data.lines_1");
  assert.deepEqual(list.rowActions.map((action) => action.do), [
    [{ set: { state: "line_1", value: "=row.id" } }, { openDialog: "line_1" }],
    [{ markObsolete: { record: "=row" } }]
  ]);
  assert.deepEqual(add.buttons[0].do, [{ create: { table: "invoice_lines", values: "=form.values", preset: { invoice: "=params.id" } } }]);
  assert.equal(dialog.content[0].record, "=data.line_1");
  assert.equal(expandLines(app(lines({ add: false })).screens.invoice).content[1].content.some((part) => part.type === "form"), false);
  // A preset (a shared list's kind) is given to every new line, besides its link, which always wins.
  const preset = expandLines(app(lines({ preset: { kind: "shopping", invoice: "=1" } })).screens.invoice).content[1].content[2];
  assert.deepEqual(preset.buttons[0].do[0].create.preset, { kind: "shopping", invoice: "=params.id" });
  const plain = app().screens.invoice;
  delete plain.content[1];
  assert.equal(expandLines(plain), plain, "a screen without lines comes back as it is");
});

test("the save check: a valid lines part passes; what it needs is named; never on a public screen", () => {
  assert.deepEqual(checkApp(app(), tables), []);
  const errors = (definition) => JSON.stringify(checkApp(definition, tables));
  assert.match(errors(app(lines({ record: "=data.nope" }))), /single-record queries/u);
  assert.match(errors(app(lines({ link: "item" }))), /link field of invoice_lines pointing at invoices/u);
  assert.match(errors(app(lines({ fields: ["item", "invoice"] }))), /links each line to the record: it's set by itself/u);
  assert.match(errors(app(lines({ table: "nope" }))), /needs an existing table/u);
  assert.match(errors(app(lines(), { public: true })), /a public screen can't have them/u);
});

test("a lines part's table, link and fields are stored by ids and come back by names", () => {
  const { definition, errors } = toIds(app(), tables);
  assert.deepEqual(errors, []);
  const part = definition.screens.invoice.content[1];
  assert.deepEqual([part.table, part.link, part.fields, part.columns[0].value], ["t_lines", "f_of", ["f_item", "f_qty", "f_price"], "=row.f_item"]);
  const back = toNames(definition, tables).screens.invoice.content[1];
  assert.deepEqual([back.table, back.link, back.fields, back.columns[0].value], ["invoice_lines", "invoice", ["item", "quantity", "price"], "=row.item"]);
});
