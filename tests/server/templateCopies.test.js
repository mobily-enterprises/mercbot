import assert from "node:assert/strict";
import test from "node:test";
import { canShare, canStartFresh, ownCopy } from "../../packages/apps/src/server/templateCopies.js";
import { __testables } from "../../packages/apps/src/server/templates.js";

// A copy of a template that starts fresh (D-141): the template's own tables get the copy's name wherever a table is
// named; the shared tables stay shared; screens, queries, fields and a test's own data keep their words.
const named = (key) => __testables.TEMPLATES.find((template) => template.key === key);

test("a fresh copy names its own tables apart where a table is named, and nothing else", () => {
  const invoices = named("invoices");
  const copy = ownCopy(invoices, 2);
  assert.deepEqual(copy.tables.map((table) => table.key), ["invoices_copy_2", "invoice_lines_copy_2"]);
  const fields = Object.fromEntries(copy.tables.flatMap((table) => table.fields.map((field) => [`${table.key}.${field.key}`, field])));
  assert.equal(fields["invoices_copy_2.total"].rollup.from, "invoice_lines_copy_2", "a roll-up");
  assert.equal(fields["invoice_lines_copy_2.invoice"].target, "invoices_copy_2", "a link to its own table");
  assert.equal(fields["invoices_copy_2.contact"].target, "contacts", "a link to a shared table stays");
  assert.deepEqual(Object.keys(copy.definition.screens), Object.keys(invoices.definition.screens), "screens keep their names");
  assert.match(JSON.stringify(copy.definition), /"from":"invoices_copy_2"/u);
  assert.doesNotMatch(JSON.stringify(copy.definition), /"(from|table)":"invoices"/u);
  assert.equal(copy.key, invoices.key);
  assert.equal(ownCopy(invoices, null), invoices, "the first app is the template itself");
});

test("a fresh copy's scripts name its own tables in their code, settings and tests, and keep everything else", () => {
  const study = named("study");
  const copy = ownCopy(study, 3);
  const code = copy.scripts.map((script) => script.code).join("\n");
  assert.match(code, /records\.get\("study_courses_copy_3"/u);
  assert.doesNotMatch(code, /records\.\w+\("study_courses"/u);
  const tests = copy.scripts.flatMap((script) => script.tests || []);
  assert.ok(tests.some((entry) => entry.records?.study_courses_copy_3), "a test's records, by table");
  const canary = ownCopy(named("canary"), 2);
  assert.match(JSON.stringify(canary.scripts[0].tests), /"emails":\[/u, "a test's own data named like a table keeps its name");
  assert.match(canary.scripts[0].code, /records\.list\("emails_copy_2"/u);
});

test("a copy can start fresh only when the template has things of its own, none of them linked from a shared table", () => {
  assert.equal(canStartFresh(named("invoices")), true);
  assert.equal(canStartFresh(named("crm")), false, "everything it keeps is shared");
  assert.equal(canStartFresh(named("meal_planner")), false, "the shared list links to its meals");
});

test("a copy can share the first app's things only when the template has no work of its own running in the background", () => {
  assert.equal(canShare(named("invoices")), true, "its rules give the same answer however often they run");
  assert.equal(canShare(named("study")), false, "its jobs would read every book and write every lesson twice");
  assert.equal(canShare(named("canary")), false, "its hourly check would keep every email twice");
});
