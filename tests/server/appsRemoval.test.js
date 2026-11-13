import assert from "node:assert/strict";
import test from "node:test";
import { __testables, removeFieldFromApp } from "../../packages/apps/src/shared/removal.js";

const { withoutCondition } = __testables;

// Removing a field from an app (D-35): exact, by id, and filters only lose their own condition.
const F = "f_status0000000000";
const app = () => ({
  home: "list",
  screens: {
    list: {
      data: {
        open: { from: "t_deals", where: `=${F} != "Lost" && f_amount00000000000 > 100.0`, sort: F },
        byStatus: { from: "t_deals", groupBy: F, sum: "f_amount00000000000" },
        all: { from: "t_deals", where: `=${F} == "Won"` },
        totals: { from: "t_deals", groupBy: "f_owner000000000000", sum: F }
      },
      content: [
        { type: "table", rows: "=data.open", columns: [{ label: "Deal", value: "=row.f_title000000000000" }, { label: "Status", value: `=row.${F}` }], rowActions: [{ type: "button", label: "Win", do: [{ update: { record: "=data.x", set: { [F]: "Won", f_title000000000000: "=row.f_title000000000000" } } }, { notify: `="Won " + row.${F}` }] }] },
        { type: "totals", label: "By status", rows: "=data.byStatus" },
        { type: "chip", value: `=data.x.${F}` },
        { type: "form", record: "=data.x", fields: ["f_title000000000000", F, { field: "f_left00000000000000", showIf: `=form.${F} == "Left"` }] },
        { type: "text", value: "Untouched" }
      ]
    }
  }
});

test("a filter loses only the condition on the removed field", () => {
  assert.equal(withoutCondition(`=${F} != "Lost" && f_amount00000000000 > 100.0`, F), "=f_amount00000000000 > 100.0");
  assert.equal(withoutCondition(`=(a == 1 || ${F} == "x") && b == 2`, F), "=(a == 1 && b == 2)");
  assert.equal(withoutCondition(`=${F} == "Won"`, F), null);
  assert.equal(withoutCondition("=a == 1", F), "=a == 1");
  assert.equal(withoutCondition(`=!(${F} == "x") || a == 1`, F), "=a == 1");
});

test("every use of the field leaves the app; everything else stays", () => {
  const { definition, changes, widened } = removeFieldFromApp(app(), F);
  const screen = definition.screens.list;
  assert.equal(screen.data.open.where, "=f_amount00000000000 > 100.0");
  assert.equal(screen.data.open.sort, undefined);
  assert.equal(screen.data.byStatus, undefined, "a total grouped by it goes");
  assert.equal(screen.data.all.where, undefined, "a filter only on it goes");
  assert.equal(screen.data.totals.sum, undefined, "a measure on it goes; the count stays");
  assert.deepEqual(widened.map((entry) => entry.query), ["open", "all"]);
  const [table, ...rest] = screen.content;
  assert.deepEqual(table.columns.map((column) => column.label), ["Deal"]);
  assert.deepEqual(table.rowActions[0].do, [{ update: { record: "=data.x", set: { f_title000000000000: "=row.f_title000000000000" } } }]);
  assert.deepEqual(rest.map((node) => node.type), ["form", "text"], "the totals part and the chip go");
  assert.deepEqual(rest[0].fields, ["f_title000000000000"]);
  assert.ok(!JSON.stringify(definition).includes(F), "no trace of the field");
  assert.ok(changes.length >= 8);
});

test("a chart goes with the totals query it draws", () => {
  const definition = {
    home: "sales",
    screens: {
      sales: {
        data: { byStage: { from: "t_deals", groupBy: "f_stage" }, byOwner: { from: "t_deals", groupBy: "f_owner" } },
        content: [{ type: "chart", kind: "pie", rows: "=data.byStage" }, { type: "chart", kind: "bar", rows: "=data.byOwner" }]
      }
    }
  };
  const { definition: out, changes } = removeFieldFromApp(definition, "f_stage");
  assert.deepEqual(Object.keys(out.screens.sales.data), ["byOwner"]);
  assert.deepEqual(out.screens.sales.content.map((node) => node.rows), ["=data.byOwner"]);
  assert.deepEqual(changes.map((change) => change.kind), ["totals", "part"]);
});

test("visitor access lists lose the field; an owner or rows formula that used it stays, and reaches nothing", () => {
  const definition = {
    home: "mine",
    screens: { mine: { public: true, content: [{ type: "text", value: "Hi" }] } },
    public: {
      home: "mine",
      tables: {
        t_deals: { can: ["list", "update"], rows: "own", owner: "f_owner", read: ["f_title", "f_owner"], write: ["f_title"] },
        t_rooms: { can: ["list"], rows: "=f_owner == true", read: ["f_name"] }
      }
    }
  };
  const { definition: out } = removeFieldFromApp(definition, "f_owner");
  assert.deepEqual(out.public.tables.t_deals, { can: ["list", "update"], rows: "own", owner: "f_owner", read: ["f_title"], write: ["f_title"] });
  assert.deepEqual(out.public.tables.t_rooms, definition.public.tables.t_rooms);
});
