import assert from "node:assert/strict";
import test from "node:test";
import { checkApp, checkView, withCopies } from "../../packages/apps/src/shared/check.js";
import { mapViews, toIds, toNames } from "../../packages/apps/src/shared/definitions.js";
import { removeFieldFromApp } from "../../packages/apps/src/shared/removal.js";

// Views (D-55): what the save check lets a view and a view part be.
const deals = {
  id: "t_0000000000000001",
  key: "deals",
  label: "Deals",
  fields: [
    { id: "f_0000000000000001", key: "name", label: "Name", type: "text" },
    { id: "f_0000000000000002", key: "stage", label: "Stage", type: "text" },
    { id: "f_0000000000000003", key: "value", label: "Value", type: "money" }
  ]
};
const tables = [deals];
const view = (extra = {}) => ({
  data: {
    byStage: { from: "deals", groupBy: "stage", sum: "value", grandTotal: true },
    biggest: { from: "deals", sort: "-value", limit: 10 }
  },
  content: [
    { type: "chart", kind: "pie", rows: "=data.byStage", measure: "total" },
    { type: "table", rows: "=data.biggest", columns: [{ label: "Deal", value: "=row.name" }] }
  ],
  ...extra
});
const paths = (errors) => errors.map((error) => error.path);

test("a view may show things, with a limit and a grand total", () => {
  assert.deepEqual(checkView(view(), tables), []);
});

test("a view refuses anything that does something, naming each place", () => {
  const refused = (part) => paths(checkView({ data: {}, content: [part] }, tables));
  assert.deepEqual(refused({ type: "button", label: "Go", do: [{ notify: "hi" }] }), ["content[0]"]);
  assert.deepEqual(refused({ type: "form", table: "deals", fields: ["name"] }), ["content[0]"]);
  assert.deepEqual(refused({ type: "dialog", key: "d", content: [] }), ["content[0]"]);
  assert.deepEqual(refused({ type: "view", view: "other" }), ["content[0]"], "no view inside a view");
  const rows = { data: { all: { from: "deals" } }, content: [{ type: "table", rows: "=data.all", columns: [], onRowClick: [{ notify: "hi" }] }] };
  assert.ok(paths(checkView(rows, tables)).includes("content[0].onRowClick"));
  assert.ok(paths(checkView(view({ navigation: { style: "rail", items: [] } }), tables)).includes("navigation"));
  assert.deepEqual(paths(checkView({ data: { s: { script: "ranks" } }, content: [{ type: "spacer" }] }, tables)), ["data.s.script"]);
  assert.deepEqual(paths(checkView({ data: {}, content: [] }, tables)), ["content"]);
});

test("limit and grandTotal are checked", () => {
  const data = (query) => paths(checkView({ data: { q: query }, content: [{ type: "spacer" }] }, tables));
  assert.deepEqual(data({ from: "deals", limit: 0 }), ["data.q.limit"]);
  assert.deepEqual(data({ from: "deals", limit: 101 }), ["data.q.limit"]);
  assert.deepEqual(data({ from: "deals", groupBy: "stage", limit: 5 }), ["data.q.limit"]);
  assert.deepEqual(data({ from: "deals", grandTotal: true }), ["data.q.grandTotal"]);
  assert.deepEqual(data({ from: "deals", top: 5 }), ["data.q.top"], "a view's queries refuse settings they don't have");
});

const shared = { key: "deals-by-stage", id: "a_view", number: 3, params: { customer: {} }, body: { params: { customer: {} }, data: {}, content: [{ type: "spacer" }] } };
const plain = { key: "plain", id: "a_plain", number: 1, params: {}, body: { data: {}, content: [{ type: "spacer" }] } };
const views = [shared, plain];
const app = (part, screen = {}) => ({ home: "main", screens: { main: { params: { id: {} }, content: [part], ...screen } } });
const checked = (definition) => checkApp(definition, tables, { views });

test("a view part is checked: known, the right params", () => {
  const part = (extra) => ({ type: "view", view: "deals-by-stage", params: { customer: "=params.id" }, ...extra });
  assert.deepEqual(checked(app(part())), []);
  const unknown = checked(app(part({ view: "deals-by-stag" })));
  assert.deepEqual(paths(unknown), ["screens.main.content[0].view"]);
  assert.match(unknown[0].message, /Did you mean "deals-by-stage"/u);
  assert.match(unknown[0].message, /Views: deals-by-stage, plain\./u, "every view of the home is offered");
  assert.deepEqual(checked(app(part({ view: "plain", params: {} }))), [], "every view of the home can be shown (D-66)");
  assert.deepEqual(paths(checked(app(part({ params: {} })))), ["screens.main.content[0].params"]);
  assert.deepEqual(paths(checked(app(part({ params: { customer: "=params.id", other: "x" } })))), ["screens.main.content[0].params.other"]);
  assert.deepEqual(paths(checked(app(part({ params: { customer: "=params.nope" } })))), ["screens.main.content[0].params.customer"]);
  const seven = app({ type: "row", content: Array.from({ length: 7 }, () => part()) });
  assert.deepEqual(paths(checked(seven)), ["screens.main"]);
});

test("a view part stays out of table rows and public screens", () => {
  const part = { type: "view", view: "deals-by-stage", params: { customer: "=row.id" } };
  const inRow = { home: "main", screens: { main: { data: { all: { from: "deals" } }, content: [{ type: "table", rows: "=data.all", columns: [], rowActions: [part] }] } } };
  assert.ok(paths(checked(inRow)).includes("screens.main.content[0].rowActions[0]"));
  const open = { type: "view", view: "deals-by-stage", params: { customer: "x" } };
  const onPublic = { home: "main", public: { home: "main" }, screens: { main: { public: true, content: [open] } } };
  assert.ok(paths(checked(onPublic)).includes("screens.main.content[0]"));
});

test("a copy becomes the app's own read-only screen, remembering its original", () => {
  const copy = withCopies(app({ type: "view", view: "deals-by-stage", copy: true, params: { customer: "=params.id" } }), views);
  assert.deepEqual(copy.screens.main.content[0], { type: "view", params: { customer: "=params.id" }, screen: "view-deals-by-stage" });
  assert.deepEqual(copy.screens["view-deals-by-stage"].copiedFrom, { view: "deals-by-stage", version: 3 });
  assert.deepEqual(checked(copy), []);
  // A copy of an unknown view is left for the check to refuse.
  assert.match(checked(withCopies(app({ type: "view", view: "gone", copy: true }), views))[0].message, /there is no view "gone"/u);
  // It only shows things, and shows only inside a screen.
  const edited = structuredClone(copy);
  edited.screens["view-deals-by-stage"].content = [{ type: "button", label: "Go", do: [] }];
  assert.deepEqual(paths(checked(edited)), ["screens.view-deals-by-stage.content[0]"]);
  assert.deepEqual(paths(checked({ ...copy, home: "view-deals-by-stage" })), ["home"]);
  const go = structuredClone(copy);
  go.screens.main.content.push({ type: "button", label: "Go", do: [{ go: { screen: "view-deals-by-stage", params: { customer: "x" } } }] });
  assert.deepEqual(paths(checked(go)), ["screens.main.content[1].do[0].go.screen"]);
});

test("a view part is stored by id, shown by key, and goes when a field its params use goes", () => {
  const definition = app({ type: "view", view: "deals-by-stage", params: { customer: "=data.one.name" } }, { data: { one: { record: "deals", id: "=params.id" } } });
  const stored = mapViews(toIds(definition, tables).definition, (key) => (key === "deals-by-stage" ? "a_view" : null));
  const part = stored.screens.main.content[0];
  assert.equal(part.view, "a_view");
  assert.equal(part.params.customer, "=data.one.f_0000000000000001", "a param's formula holds the field's id");
  assert.equal(mapViews(toNames(stored, tables), () => "deals-by-stage").screens.main.content[0].view, "deals-by-stage");
  assert.deepEqual(removeFieldFromApp(stored, "f_0000000000000001").definition.screens.main.content, []);
  const copy = { screens: { c: { copiedFrom: { view: "a_gone", version: 1 } } } };
  assert.equal(mapViews(copy, () => null).screens.c.copiedFrom.view, null, "a copy outlives its original");
});
