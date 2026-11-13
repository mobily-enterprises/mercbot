import { describe, expect, it } from "vitest";
import { calculate, withNamedFormulas } from "@local/apps/shared";
import { chartData, createScreenRuntime, formulaRecord, previewNotice, refersToRemovedField, showValue } from "../../src/components/apps/appRuntime.js";
import { matchColumns } from "../../src/components/apps/sheets.js";
import { toYaml } from "../../src/components/apps/yaml.js";

// App screens are forgiving (D-35): missing values show "—", removed fields are skipped, links show
// their label, and formulas always get typed values.
describe("apps screen helpers", () => {
  it("shows values by field type", () => {
    expect(showValue({ type: "money" }, 123456)).toBe("1,234.56");
    expect(showValue({ type: "date" }, "2021-03-03")).toBe("3 Mar 2021");
    expect(showValue({ type: "yesno" }, false)).toBe("No");
    expect(showValue({ type: "link" }, { id: "3", label: "Carla", obsolete: true })).toBe("Carla (obsolete)");
    expect(showValue({ type: "link" }, "3")).toBe("#3");
    expect(showValue({ type: "text" }, null)).toBe("—");
    expect(showValue(undefined, "x")).toBe("x");
  });

  it("skips parts that point at a removed field", () => {
    expect(refersToRemovedField("=row.f_0123456789abcdef")).toBe(true);
    expect(refersToRemovedField("=row.name")).toBe(false);
    expect(refersToRemovedField(42)).toBe(false);
  });

  it("gives formulas typed values, links as their id", () => {
    const table = { fields: [{ key: "name", type: "text" }, { key: "amount", type: "money" }, { key: "active", type: "yesno" }, { key: "contact", type: "link" }] };
    expect(formulaRecord(table, { id: 7, contact: { id: "3", label: "Carla" } })).toEqual({ id: "7", name: "", amount: 0, active: false, contact: "3" });
  });

  it("shows app source as readable YAML", () => {
    expect(toYaml({ home: "list", screens: { list: { content: [{ type: "text", value: "=row.name" }] } }, flags: [] })).toBe(
      'home: list\nscreens:\n  list:\n    content:\n      - type: text\n        value: "=row.name"\nflags: []'
    );
  });
});

// A draft's preview works on practice data (D-71): it saves there, and says what the live app would have
// sent instead of sending it.
describe("a preview's notices", () => {
  it("says what practice data didn't send, and nothing when it sent nothing", () => {
    expect(previewNotice({ effects: [], practice: { changes: [{ table: "t_1", id: "4", action: "create" }], wouldSend: [], simulated: [] } })).toBe("");
    expect(previewNotice({
      effects: [],
      practice: { changes: [], wouldSend: [{ bot: "Otto", task: "Call Ana" }], simulated: [{ web: { method: "POST", url: "https://hooks.example.test/won" }, script: "win" }] }
    })).toBe("Practice data: nothing was sent. Once published, this would ask Otto and call https://hooks.example.test/won.");
  });

  it("says an app without a draft saved nothing", () => {
    expect(previewNotice({ effects: [], dryRun: true, wouldWrite: [{}, {}], wouldSend: [{ bot: "Otto" }] })).toBe("Preview: nothing was saved or sent (would save 2 changes, would ask Otto).");
    expect(previewNotice({ effects: [] })).toBe("");
  });
});

// Spreadsheet import: headings match a field's label or key, ignoring case.
describe("apps sheet columns", () => {
  it("matches headings to fields and reports the rest", () => {
    const table = {
      fields: [
        { id: "f1", key: "name", label: "Name", options: { required: true } },
        { id: "f2", key: "email", label: "Work email" },
        { id: "f3", key: "phone", label: "Phone", obsolete: true },
        { id: "f4", key: "stage", label: "Stage", options: { required: true } }
      ]
    };
    const { columns, ignored, missing } = matchColumns(table, [" name ", "WORK EMAIL", "Phone", "Notes", ""]);
    expect(columns.map((field) => field?.id ?? null)).toEqual(["f1", "f2", null, null, null]);
    expect(ignored).toEqual(["Phone", "Notes"]);
    expect(missing.map((field) => field.id)).toEqual(["f4"]);
  });

  it("never fills a calculated field: its column is worked out again (D-78)", () => {
    const table = { fields: [{ id: "f1", key: "price", label: "Price" }, { id: "f2", key: "total", label: "Total", options: { formula: "=price * 2.0" } }] };
    const { columns, ignored, calculated } = matchColumns(table, ["Price", "Total", "Notes"]);
    expect(columns.map((field) => field?.id ?? null)).toEqual(["f1", null, null]);
    expect(calculated).toEqual(["Total"]);
    expect(ignored).toEqual(["Notes"]);
  });
});

// Calculated fields and named formulas in the browser (D-78): a form works calculated fields out from what is typed,
// with the table as screens get it (fields by name, formulas by names), and every formula calls the app's named ones.
describe("calculated fields and named formulas in the browser", () => {
  const orders = {
    id: "t_orders",
    key: "orders",
    fields: [
      { key: "item", label: "Item", type: "text", options: {} },
      { key: "price", label: "Price", type: "money", options: {} },
      { key: "quantity", label: "Quantity", type: "number", options: {} },
      { key: "total", label: "Total", type: "money", options: { formula: "=price * quantity" } },
      { key: "big", label: "Big", type: "yesno", options: { formula: "=total > 10000.0" } }
    ]
  };

  it("works a form's calculated fields out from what is typed, and shows them by type", () => {
    const typed = calculate(orders, formulaRecord(orders, { item: "Desk", price: 25000, quantity: 2 }));
    expect([typed.total, typed.big]).toEqual([50000, true]);
    expect(showValue(orders.fields[3], typed.total)).toBe("500.00");
    // Nothing to divide by: the value can't be worked out, so it shows "—", and so does what is worked out from it.
    const perUnit = { ...orders, fields: orders.fields.map((field) => (field.key === "total" ? { ...field, options: { formula: "=price / quantity" } } : field)) };
    const failing = calculate(perUnit, formulaRecord(perUnit, { price: 100 }));
    expect([failing.total, failing.big]).toEqual([null, null]);
    expect(showValue(perUnit.fields[3], failing.total)).toBe("—");
  });

  it("lets every formula of a screen call the app's named formulas", () => {
    const functions = withNamedFormulas({ with_vat: { params: ["amount"], formula: "=amount * 1.2" }, label: { params: ["item", "cents"], formula: '=item + " " + formatMoney(with_vat(cents))' } }, null);
    const runtime = createScreenRuntime({
      slug: "orders",
      version: "live",
      tables: [orders],
      screen: { data: { all: { from: "orders" } }, content: [] },
      screenKey: "list",
      params: {},
      onEffects: () => {},
      onError: () => {},
      api: { query: async () => ({ records: [] }) },
      functions
    });
    const row = runtime.rowScope("=data.all", { id: "1", item: "Mug", price: 1250, quantity: 4, total: 5000, big: false });
    expect(runtime.evaluate("=label(row.item, row.total)", row)).toBe("Mug 60.00");
    expect(runtime.evaluate("=with_vat(row.total) > 5000.0 && !row.big", row)).toBe(true);
  });
});

// Charts: groups named by field type, money plotted in units, lines in key order, pies of at most
// eight slices.
describe("apps chart data", () => {
  it("maps totals to points", () => {
    const money = chartData({ kind: "bar", rows: [{ key: "Won", count: 2, total: 125050 }, { key: null, count: 1, total: 100 }], field: { type: "choice" }, measureField: { type: "money" }, measure: "total" });
    expect(money.points).toEqual([{ label: "Won", value: 1250.5, text: "1,250.50" }, { label: "(none)", value: 1, text: "1.00" }]);
    expect(money.format(1250.5)).toBe("1,250.50");
    const line = chartData({ kind: "line", rows: [{ key: "2026-10-03", count: 1 }, { key: "2026-10-01", count: 4 }], field: { type: "date" } });
    expect(line.points.map((point) => [point.label, point.value])).toEqual([["1 Oct 2026", 4], ["3 Oct 2026", 1]]);
    const linked = chartData({ rows: [{ key: "7", label: "Ana Ruiz", count: 3 }, { key: "9", count: 1 }], field: { type: "link" } });
    expect(linked.points.map((point) => point.label)).toEqual(["Ana Ruiz", "#9"]);
    const pie = chartData({ kind: "pie", rows: Array.from({ length: 10 }, (_, index) => ({ key: `k${index}`, count: 10 - index })), field: { type: "text" } });
    expect(pie.points.length).toBe(8);
    expect(pie.points.at(-1)).toEqual({ label: "Other", value: 6, text: "6" });
  });
});

// A view's screen stays live (D-55): tables that changed run their queries again, without skeletons.
describe("a view's running screen", () => {
  const deals = { id: "t_deals", key: "deals", fields: [{ key: "owner", type: "link", options: { target: "t_people" } }] };
  const notes = { id: "t_notes", key: "notes", fields: [] };
  const screen = {
    data: {
      deals: { from: "deals", groupBy: "owner", grandTotal: true },
      notes: { from: "notes" }
    },
    content: []
  };
  function running(answer) {
    const asked = [];
    const runtime = createScreenRuntime({
      slug: "v",
      version: "live",
      tables: [deals, notes],
      screen,
      screenKey: "main",
      params: {},
      onEffects: () => {},
      onError: () => {},
      api: { query: async (_slug, { query }) => (asked.push(query), answer(query)) }
    });
    return { asked, runtime };
  }

  it("keeps the grand total a query answers with", async () => {
    const { runtime } = running((query) => (query === "deals" ? { totals: [{ key: "a", count: 2 }], grandTotal: { count: 2 } } : { records: [] }));
    await runtime.loadAll();
    expect(runtime.grandTotals.deals).toEqual({ count: 2 });
    expect(runtime.grandTotals.notes).toBeNull();
  });

  it("runs only the queries on changed tables and what they link to", async () => {
    const { asked, runtime } = running(() => ({ records: [] }));
    await runtime.reloadChanged(["t_notes"]);
    expect(asked).toEqual(["notes"]);
    asked.length = 0;
    await runtime.reloadChanged(["t_people"]);
    expect(asked).toEqual(["deals"]);
    asked.length = 0;
    await runtime.reloadChanged(["t_other"]);
    expect(asked).toEqual([]);
  });

  it("keeps what's shown when a live update fails, with no skeleton", async () => {
    let failing = false;
    const { runtime } = running(() => {
      if (failing) throw new Error("gone");
      return { records: [{ id: "1" }] };
    });
    await runtime.loadAll();
    failing = true;
    const update = runtime.reloadChanged(["t_notes"]);
    expect(runtime.loading.has("notes")).toBe(false);
    await update;
    expect(runtime.data.notes).toEqual([{ id: "1" }]);
    expect(runtime.attention.notes).toBe(false);
  });
});
