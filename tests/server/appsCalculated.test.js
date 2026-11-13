import assert from "node:assert/strict";
import test from "node:test";
import { calculate, calculatedFrom, calculatedUsing, checkCalculated, storedFieldIds, withCalculated } from "../../packages/apps/src/shared/calculated.js";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { TEXT_MAX, evaluateFormula, formulaRecord } from "../../packages/apps/src/shared/formulas.js";
import { withNamedFormulas } from "../../packages/apps/src/shared/namedFormulas.js";
import { visitorReads } from "../../packages/apps/src/shared/visitorAccess.js";
import { compile, project } from "../../packages/apps/src/server/visitorAccess.js";

// Calculated fields and named formulas (D-78): the save checks, their errors, and the values worked out.
const field = (id, key, type, options = {}) => ({ id, key, label: key[0].toUpperCase() + key.slice(1), type, options, obsolete: false });
const orders = () => ({
  id: "t_orders",
  key: "orders",
  label: "Orders",
  obsolete: false,
  fields: [
    field("f_item", "item", "text"),
    field("f_price", "price", "money"),
    field("f_quantity", "quantity", "number"),
    field("f_paid", "paid", "yesno"),
    field("f_subtotal", "subtotal", "money", { formula: "=f_price * f_quantity" }),
    field("f_total", "total", "money", { formula: "=f_subtotal * 1.2" }),
    field("f_label", "label", "text", { formula: '=f_item + " × " + string(int(f_quantity))' }),
    field("f_big", "big", "yesno", { formula: "=f_total > 10000.0" })
  ]
});
// A field as the person or the Builder writes it: its formula by names.
const written = (key, type, formula, id = `f_${key}`) => field(id, key, type, { formula });
const withField = (table, entry) => ({ ...table, fields: [...table.fields.filter((each) => each.id !== entry.id), entry] });

test("a calculated field's formula is checked and stored by ids", () => {
  const table = orders();
  const discount = written("discounted", "money", "=total - price");
  assert.deepEqual(checkCalculated(withField(table, discount), discount), { formula: "=f_total - f_price" });
});

test("a calculated field's mistakes are said precisely", () => {
  const table = orders();
  const error = (key, type, formula) => {
    const entry = written(key, type, formula);
    return checkCalculated(withField(table, entry), entry).error;
  };
  assert.match(error("x", "money", "=prise * quantity"), /orders has no field "prise"\. Did you mean "price"\?/u);
  assert.match(error("x", "number", '=item + "!"'), /a number field's formula gives a number, but this one gives string/u);
  assert.match(error("x", "yesno", "=price"), /a yesno field's formula gives true or false, but this one gives double/u);
  assert.match(error("x", "money", "=with_vat(price)"), /only the record's fields and the built-in functions, not "with_vat"/u);
  assert.match(error("x", "choice", '="New"'), /a calculated field is text, number, money, date, yesno, never choice/u);
  assert.match(error("x", "money", "price"), /starts with "="/u);
});

test("a calculated field that comes back to itself is refused, naming the chain", () => {
  const table = orders();
  // subtotal is worked out from total, which is worked out from subtotal.
  const subtotal = written("subtotal", "money", "=total - 100.0", "f_subtotal");
  assert.equal(checkCalculated(withField(table, subtotal), subtotal).error, "subtotal can't be worked out from itself: subtotal → total → subtotal.");
  const itself = written("total", "money", "=total + 1.0", "f_total");
  assert.equal(checkCalculated(withField(table, itself), itself).error, "total can't be worked out from itself: total → total.");
});

test("values are worked out in order, through other calculated fields, and typed", () => {
  const table = orders();
  const record = withCalculated(table, { id: "1", f_item: "Mug", f_price: 1250, f_quantity: 3, f_paid: true });
  assert.equal(record.f_subtotal, 3750);
  assert.equal(record.f_total, 4500);
  assert.equal(record.f_label, "Mug × 3");
  assert.equal(record.f_big, false);
  // Money stays in whole cents; an empty number counts as 0, as in every formula.
  assert.equal(withCalculated(table, { id: "2", f_item: "Pen", f_price: 199, f_quantity: 0.5 }).f_subtotal, 100);
  assert.equal(withCalculated(table, { id: "3", f_item: "Pen", f_price: 199 }).f_total, 0);
});

test("a calculated field can't loop over lists or match patterns: it is worked out for every record shown", () => {
  const tried = (formula) => {
    const entry = written("check", "yesno", formula);
    return checkCalculated(withField(orders(), entry), entry).error;
  };
  for (const [formula, name] of [
    ['=item.matches("^(a+)+$")', "matches"],
    ['=matches(item, "a")', "matches"],
    ["=[price, quantity].exists(x, x > 10.0)", "exists"],
    ['=item.split(",").exists(item, item == "vip")', "exists"],
    ['=size(item.split("").map(c, item)) > 0', "map"],
    ['=size(item.split("").filter(c, c == "a")) > 2', "filter"],
    ["=[price].all(x, x > 0.0)", "all"],
    ["=[price].exists_one(x, x > 0.0)", "exists_one"]
  ]) {
    assert.equal(tried(formula), `a calculated field can't use ${name}: it is worked out for every record shown, and ${name} can take very long on a long text.`, formula);
  }
  assert.equal(tried('=item.contains("vip") && size(item) > 3'), undefined);
});

test("what a calculated field works out is kept as its field holds it: a date, a text up to a field's length, cents never -0", () => {
  const table = orders();
  table.fields.push(
    field("f_due", "due", "date", { formula: "=f_item" }),
    field("f_twice", "twice", "text", { formula: "=f_item + f_item" }),
    field("f_refund", "refund", "money", { formula: "=f_price * -1.0" })
  );
  const long = withCalculated(table, { id: "1", f_item: "x".repeat(TEXT_MAX / 2 + 1), f_price: 0 });
  assert.deepEqual([long.f_due, long.f_twice], [null, null], "not a date, and longer than a text field holds");
  assert.ok(Object.is(long.f_refund, 0));
  const fits = withCalculated(table, { id: "2", f_item: "2026-11-12", f_price: 250 });
  assert.deepEqual([fits.f_due, fits.f_twice, fits.f_refund], ["2026-11-12", "2026-11-122026-11-12", -250]);
});

test("a formula that fails shows nothing, and so do the fields worked out from it", () => {
  const table = orders();
  // The price was removed: the formula keeps its id, and can't be worked out.
  table.fields[1].obsolete = true;
  const record = withCalculated(table, { id: "1", f_item: "Mug", f_quantity: 3 });
  assert.deepEqual([record.f_subtotal, record.f_total, record.f_big], [null, null, null]);
  assert.equal(record.f_label, "Mug × 3", "a field that doesn't use it still works");
  // Inside a formula, such a value is its type's empty value, as an empty field is.
  const values = calculate(table, formulaRecord(table, { id: "1", item: "Mug", quantity: 3 }), { asFormulas: true });
  assert.deepEqual([values.subtotal, values.big], [0, false]);
});

test("a browser's table works too: fields without ids, formulas by names", () => {
  const table = { key: "orders", fields: orders().fields.map(({ key, label, type, options }) => ({ key, label, type, options })) };
  table.fields[4].options = { formula: "=price * quantity" };
  table.fields[5].options = { formula: "=subtotal * 1.2" };
  table.fields[6].options = { formula: '=item + " × " + string(int(quantity))' };
  table.fields[7].options = { formula: "=total > 10000.0" };
  const values = calculate(table, formulaRecord(table, { item: "Desk", price: 25000, quantity: 2 }));
  assert.deepEqual([values.subtotal, values.total, values.label, values.big], [50000, 60000, "Desk × 2", true]);
});

test("what a calculated field is worked out from, and what is worked out from a field", () => {
  const table = orders();
  assert.deepEqual(calculatedFrom(table, table.fields[7]).sort(), ["price", "quantity"]);
  assert.deepEqual(calculatedUsing(table, "f_price").map((entry) => entry.key), ["subtotal", "total", "big"]);
  assert.deepEqual([...storedFieldIds(table).keys()], ["item", "price", "quantity", "paid"]);
});

const app = (extra = {}) => ({
  home: "list",
  formulas: {
    with_vat: { params: ["amount"], formula: "=amount * 1.2" },
    price_text: { params: ["cents"], formula: '="$" + string(with_vat(cents) / 100.0)' }
  },
  screens: {
    list: {
      data: { orders: { from: "orders", sort: "item" }, byItem: { from: "orders", groupBy: "item", sum: "total", grandTotal: true } },
      content: [
        { type: "table", rows: "=data.orders", columns: [{ label: "Item", value: "=row.label" }, { label: "Total", value: "=price_text(row.total)" }, { label: "Big", value: "=row.big" }] },
        { type: "totals", label: "By item", rows: "=data.byItem" },
        { type: "form", table: "orders", fields: ["item", "price", "quantity", "total"], buttons: [{ type: "button", label: "Add", do: [{ create: { table: "orders", values: "=form.values" } }] }] }
      ]
    }
  },
  ...extra
});
const messages = (definition, options) => checkApp(definition, [orders()], options).map((error) => `${error.path}: ${error.message}`);

test("an app with calculated fields and named formulas passes the save check", () => {
  assert.deepEqual(messages(app()), []);
});

test("filters, sorting and grouping can't use a calculated field, and no step sets one", () => {
  const broken = app();
  broken.screens.list.data.orders.where = "=total > 100.0";
  broken.screens.list.data.orders.sort = "-total";
  broken.screens.list.data.byItem.groupBy = "big";
  broken.screens.list.content[2].buttons[0].do = [{ create: { table: "orders", values: { item: "=form.item", total: "=1.0" }, preset: { label: '="x"' } } }];
  const found = messages(broken).join("\n");
  assert.match(found, /orders\.where: "total" is a calculated field, and a filter runs in the database, where it isn't stored, so it can't use it yet\. Use the fields it's worked out from \(price, quantity\)/u);
  assert.match(found, /orders\.sort: "total" is a calculated field, and sorting runs in the database/u);
  assert.match(found, /byItem\.groupBy: "big" is a calculated field, and grouping runs in the database/u);
  assert.match(found, /create\.values\.total: "total" is a calculated field, worked out from the record's other fields, so a step can't set it\./u);
  assert.match(found, /create\.preset\.label: "label" is a calculated field/u);
});

test("named formulas: unknown names, wrong counts, cycles and their own mistakes are said precisely", () => {
  const found = (formulas, change = () => {}) => {
    const definition = app({ formulas });
    change(definition);
    return messages(definition).join("\n");
  };
  assert.match(
    found({ with_vat: { params: ["amount"], formula: "=amount * 1.2" } }, (definition) => {
      definition.screens.list.content[0].columns[1].value = "=with_vatt(row.total)";
    }),
    /columns\[1\]\.value: there is no formula or function "with_vatt"\. Did you mean "with_vat"\? This app's: with_vat\./u
  );
  assert.match(
    found({ with_vat: { params: ["amount"], formula: "=amount * 1.2" } }, (definition) => {
      definition.screens.list.content[0].columns[1].value = "=with_vat(row.total, 2.0)";
    }),
    /"with_vat" takes 1 value \(amount\), not 2\./u
  );
  assert.match(
    found({ a: { params: ["x"], formula: "=b(x) + 1.0" }, b: { params: ["x"], formula: "=c(x)" }, c: { params: ["x"], formula: "=a(x)" } }),
    /formulas\.a\.formula: a calls itself: a → b → c → a\. A formula can't call itself, even through others\./u
  );
  assert.match(found({ twice: { params: ["x"], formula: "=twice(x)" } }), /twice calls itself: twice → twice\./u);
  assert.match(found({ with_vat: { params: ["amount"], formula: "=price * 1.2" } }), /a formula sees only its parameters \(amount\), so "price" isn't known here: pass it in, e.g\. with_vat\(row\.price\)\./u);
  assert.match(found({ today: { params: [], formula: "=1.0" } }), /formulas\.today: "today" already means something in formulas/u);
  assert.match(found({ "With VAT": { formula: "=1.0" } }), /formulas\.With VAT: A formula's name uses a–z, 0–9 and _/u);
  assert.match(found({ total: { params: ["row"], formula: "=1.0" } }), /formulas\.total\.params: lists up to 8 parameter names/u);
  assert.match(found({ with_vat: { params: ["amount"], formula: "amount * 1.2" } }), /formulas\.with_vat\.formula: is a formula over its parameters, starting with "="/u);
  assert.match(
    found({ with_vat: { params: ["amount"], formula: "=amount * 1.2" } }, (definition) => {
      definition.screens.list.data.orders.where = "=with_vat(price) > 100.0";
    }),
    /orders\.where: a filter runs in the database, so it can't call "with_vat": filter on the fields themselves\./u
  );
  assert.match(
    messages(app({ formulas: { score: { params: ["x"], formula: "=x" } } }), { scripts: [{ key: "score", kind: "function", params: ["x"] }] }).join("\n"),
    /formulas\.score: this app has a script function called "score"; choose another name\./u
  );
});

test("one use of a named formula sets off at most 1,000: formulas that each call the next twice stop there", () => {
  // f0 calls f1 twice, f1 calls f2 twice, ... f11 gives x: 4,095 calls from f0, 511 from f3.
  const formulas = Object.fromEntries(Array.from({ length: 12 }, (_, level) => [`f${level}`, { params: ["x"], formula: level === 11 ? "=x" : `=f${level + 1}(x) + f${level + 1}(x)` }]));
  const functions = withNamedFormulas(formulas, null);
  assert.throws(() => evaluateFormula({}, "=f0(1.0)", {}, functions), /sets off more than 1000 named formulas/u);
  assert.equal(evaluateFormula({}, "=f3(1.0)", {}, functions), 256, "the next use counts from nothing again");
});

test("named formulas are called from any formula, call each other, and see only their parameters", () => {
  const functions = withNamedFormulas(app().formulas, null);
  const value = evaluateFormula({ row: { total: "double" } }, "=price_text(row.total)", { row: { total: 1000 } }, functions);
  assert.match(value, /^\$12(\.0)?$/u);
  // Alongside an app's script functions, which keep their own names.
  const scripts = { id: "s1", list: [{ name: "double_it", arity: 1, call: (x) => x * 2 }] };
  const both = withNamedFormulas({ quad: { params: ["x"], formula: "=double_it(double_it(x))" } }, scripts);
  assert.equal(evaluateFormula({}, "=quad(2.5)", {}, both), 10);
  assert.equal(withNamedFormulas(undefined, scripts), scripts, "no named formulas: the script functions as they were");
});

test("a visitor reads a calculated field only with what it's worked out from, and never writes or filters on one", () => {
  const definition = app({
    public: {
      home: "list",
      tables: { orders: { can: ["list", "create"], rows: "=big", read: ["item", "total"], write: ["item", "total"] } }
    }
  });
  definition.screens.list.public = true;
  const found = messages(definition).join("\n");
  assert.match(found, /rows: rows run in the database, where the calculated field "big" isn't stored/u);
  assert.match(found, /read: total is worked out from (price, quantity|quantity, price): list them in read too, or leave total out\./u);
  assert.match(found, /write: total is a calculated field, worked out from the record's other fields: leave it out of write\./u);
});

test("a visitor reads a calculated field only while what its formula now uses is listed too", () => {
  const table = orders();
  table.fields.push(field("f_cost", "cost", "money"));
  const read = ["item", "price", "quantity", "subtotal", "total"];
  assert.deepEqual(visitorReads(table, read), read);
  // The formula changed after the app was published, or the owner narrowed what visitors read: the fence goes by now.
  const changed = { ...table, fields: table.fields.map((entry) => (entry.id === "f_total" ? { ...entry, options: { formula: "=f_subtotal - f_cost" } } : entry)) };
  assert.deepEqual(visitorReads(changed, read), ["item", "price", "quantity", "subtotal"]);
  assert.deepEqual(visitorReads(table, ["item", "quantity", "subtotal", "total"]), ["item", "quantity"]);
  const access = compile({ public: { tables: { orders: { can: ["list", "get"], rows: "all", read } } } }, [changed], null).tables.get("t_orders");
  const record = withCalculated(changed, { id: "1", f_item: "Mug", f_price: 1000, f_quantity: 2, f_cost: 1500 });
  assert.deepEqual(project(access, record), { id: "1", obsolete: undefined, f_item: "Mug", f_price: 1000, f_quantity: 2, f_subtotal: 2000 });
});
