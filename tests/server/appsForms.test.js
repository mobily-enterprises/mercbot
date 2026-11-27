import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { toIds, toNames } from "../../packages/apps/src/shared/definitions.js";
import { limitProblem, patternProblem } from "../../packages/apps/src/shared/fieldChecks.js";

// Better forms (D-140): a field's min, max and pattern as the browser and the data gate check them, the patterns a
// field may have, and buttons that branch (`if`) or ask first (`confirm`), checked, translated and kept to on public
// screens.
const field = (id, key, type, options = {}) => ({ id, key, label: key, type, options, obsolete: false });

test("a field's min, max and pattern: what breaks them is said in words; empty is left to required", () => {
  const amount = field("f_a", "amount", "money", { min: 100, max: 50000 });
  assert.equal(limitProblem(amount, 99), "must be at least 1.00.");
  assert.equal(limitProblem(amount, 50001), "must be at most 500.00.");
  assert.equal(limitProblem(amount, 100), "");
  assert.equal(limitProblem(field("f_d", "due", "date", { min: "2026-01-01" }), "2025-12-31"), "must be at least 2026-01-01.");
  const postcode = field("f_p", "postcode", "text", { pattern: "[0-9]{4}", patternMessage: "a 4-digit postcode" });
  assert.equal(limitProblem(postcode, "600"), "should be a 4-digit postcode.");
  assert.equal(limitProblem(postcode, "6000x"), "should be a 4-digit postcode.", "the whole value");
  assert.equal(limitProblem(postcode, "6000"), "");
  assert.equal(limitProblem(field("f_q", "code", "phone", { pattern: "\\+?[0-9 ]+" }), "abc"), "isn't in the form this field takes.");
  assert.equal(limitProblem(amount, null), "");
  assert.equal(limitProblem(field("f_t", "name", "text", { min: 3 }), "a"), "", "min only on numbers, amounts and dates");
});

test("a pattern can't be one that could take very long", () => {
  for (const safe of ["[0-9]{4}", "(\\d{3})?-\\d{4}", "[A-Z]{2}[0-9]+", "(ab)+", "(a|b)"]) assert.equal(patternProblem(safe), "", safe);
  assert.match(patternProblem("(a+)+"), /repeated group can't itself repeat/u);
  assert.match(patternProblem("(a|aa)*"), /repeated group/u);
  assert.match(patternProblem("(x)\\1"), /refer back/u);
  assert.match(patternProblem("[a-"), /isn't a pattern/u);
  assert.match(patternProblem("a".repeat(201)), /1 to 200 characters/u);
});

const tables = [{
  id: "t_orders",
  key: "orders",
  label: "Orders",
  obsolete: false,
  titleFieldId: "f_item",
  fields: [field("f_item", "item", "text"), field("f_amount", "amount", "money"), field("f_owner", "owner", "email")]
}];
const branch = { if: { when: "=form.amount > 10000.0", then: [{ notify: "=\"Big order: \" + form.item" }], else: [{ notify: "Thanks" }] } };
const app = (button, extra = {}) => ({
  home: "add",
  screens: { add: { content: [{ type: "form", table: "orders", fields: ["item", "amount"], buttons: [button] }], ...extra.screen } },
  ...extra.app
});
const errors = (definition) => JSON.stringify(checkApp(definition, tables));

test("a button's branch and confirm: checked, kept to on public screens, stored by ids", () => {
  const save = { type: "button", label: "Save", confirm: "Add this order?", do: [{ create: { table: "orders", values: "=form.values" } }, branch] };
  assert.deepEqual(checkApp(app(save), tables), []);
  assert.match(errors(app({ ...save, do: [{ if: { when: "=form.item", then: [] } }] })), /if\.when/u, "when is yes or no");
  assert.match(errors(app({ ...save, do: [{ if: { when: "=true", then: [{ wobble: 1 }] } }] })), /if\.then\[0\]/u);
  assert.match(errors(app({ ...save, do: [{ if: { when: "=true", then: [], otherwise: [] } }] })), /if has only when, then and else/u);
  const open = (steps) => app({ ...save, do: steps }, { screen: { public: true }, app: { public: { home: "add", tables: { orders: { can: ["create"], read: ["item", "amount"], write: ["item", "amount"] } } } } });
  assert.deepEqual(checkApp(open([{ create: { table: "orders", values: "=form.values" } }, branch]), tables), [], "a branch of allowed steps");
  assert.match(errors(open([{ if: { when: "=true", then: [{ askBot: { bot: "Otto", task: "=\"x\"" } }] } }])), /never ask a bot/u, "not inside a branch either");
  const stored = toIds(app(save), tables).definition.screens.add.content[0].buttons[0].do[1];
  assert.deepEqual(stored.if.when, "=form.f_amount > 10000.0");
  assert.deepEqual(stored.if.then[0].notify, "=\"Big order: \" + form.f_item");
  assert.deepEqual(toNames(toIds(app(save), tables).definition, tables).screens.add.content[0].buttons[0].do[1], branch);
});
