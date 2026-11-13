import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { checkFormula, evaluateFormula } from "../../packages/apps/src/shared/formulas.js";
import { compileWhere } from "../../packages/apps/src/shared/where.js";
import { applyPlan } from "../../packages/apps/src/server/sqlPlan.js";

// Apps formulas (D-35): CEL `where` formulas become a plan, and the plan becomes SQL. Fields are
// plain variables; `state` and `params` are worked out before the query runs.
const knex = knexLib({ client: "pg" });
const fields = { name: "string", email: "string", status: "string", amount: "double" };
const variables = { ...fields, state: { search: "string", min: "double" }, params: {} };
const pageVariables = { state: variables.state, params: {} };

function sql(where, state = {}) {
  const plan = compileWhere(variables, where);
  const query = knex("records").where((builder) => applyPlan(builder, plan, { variables: pageVariables, values: { state, params: {} } }, (field) => `records.${field}`, knex));
  const { sql: text, bindings } = query.toSQL().toNative();
  // The helper's own where() adds one outer group; drop it.
  const condition = text.replace(/^select \* from "records" where /u, "").replace(/^\((.*)\)$/su, "$1");
  return { text: condition, bindings };
}

test("a search box that is empty matches everything, and a filled one becomes LIKE", () => {
  const where = '=state.search == "" || name.lowerAscii().contains(state.search.lowerAscii()) || email.contains(state.search)';
  assert.deepEqual(sql(where, { search: "" }).bindings, []);
  const filled = sql(where, { search: "AN" });
  assert.equal(filled.text, '((lower("records"."name") like $1) or ("records"."email" like $2))');
  assert.deepEqual(filled.bindings, ["%an%", "%AN%"]);
});

test("LIKE patterns escape the person's own % and _", () => {
  assert.deepEqual(sql("=name.startsWith(state.search)", { search: "50%_off" }).bindings, ["50\\%\\_off%"]);
});

test("comparisons, lists, not, and literals on either side", () => {
  assert.equal(sql('=status in ["New", "Proposal"] && amount >= state.min', { min: 100 }).text, '("records"."status" in ($1, $2)) and ("records"."amount" >= $3)');
  assert.equal(sql("=1000.0 < amount", {}).text, '"records"."amount" > $1');
  assert.equal(sql('=!(status == "Lost")', {}).text, 'not ("records"."status" = $1)');
});

test("field-free parts fold through the whole formula", () => {
  assert.equal(sql('=state.search == "x" || state.search == "y"', { search: "z" }).text, "false");
  assert.equal(sql('=(state.search == "" || name == "a") && status == "Won"', { search: "" }).text, '"records"."status" = $1');
  assert.equal(sql('=state.search == "x" && name == "a"', { search: "z" }).text, "false");
  assert.equal(sql('=!(state.search == "") || name == "a"', { search: "" }).text, '"records"."name" = $1');
  // Brackets inside quoted text don't confuse the slicing.
  const quoted = sql('=!(state.search == "a)(b") && name == "x"', { search: "z" });
  assert.equal(quoted.text, '"records"."name" = $1');
});

test("comparing with an empty value uses IS NULL", () => {
  const nullVariables = { ...variables, state: { ...variables.state, maybe: "dyn" } };
  const plan = compileWhere(nullVariables, "=status == state.maybe");
  const query = knex("records").where((builder) => applyPlan(builder, plan, { variables: { state: nullVariables.state, params: {} }, values: { state: { maybe: null }, params: {} } }, (field) => field, knex));
  assert.match(query.toSQL().sql, /"status" is null/u);
});

test("a field the server marks `trim` is compared trimmed as JavaScript trims, and lowercased with `lower`", () => {
  const plan = { kind: "in", field: { name: "name", lower: true, trim: true }, value: "texts" };
  const query = knex("records").where((builder) => applyPlan(builder, plan, { variables: { texts: "dyn" }, values: { texts: ["ana", "ben"] } }, (field) => `records.${field}`, knex));
  const { sql: text, bindings } = query.toSQL().toNative();
  assert.equal(text, 'select * from "records" where (lower(btrim("records"."name", $1)) in ($2, $3))');
  const blanks = " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  assert.equal(bindings[0], blanks);
  assert.equal(bindings[0].trim(), "", "only what trim() removes");
  assert.deepEqual(bindings.slice(1), ["ana", "ben"]);
});

test("formulas that can't become SQL are refused with the offending part", () => {
  assert.throws(() => compileWhere(variables, "=name.size() > 3"), /"name.size\(\) > 3" can't be turned into a database query/u);
  assert.throws(() => compileWhere(variables, "=name == email"), /can't be turned into a database query/u);
});

test("the type checker catches unknown fields and wrong types", () => {
  assert.match(checkFormula(variables, '=stauts == "Won"').error, /stauts/u);
  assert.match(checkFormula(variables, "=name + 1").error, /no such overload/u);
  assert.equal(checkFormula(variables, '=amount >= 10000.0 ? "Large" : "Small"').type, "string");
});

test("our date functions", () => {
  const dates = { started: "string" };
  assert.equal(evaluateFormula(dates, '=formatDate(started, "d MMM yyyy")', { started: "2021-03-03" }), "3 Mar 2021");
  assert.equal(evaluateFormula(dates, '=formatDate(started, "d MMM yyyy")', { started: "" }), "");
  assert.equal(typeof evaluateFormula(dates, "=yearsSince(started)", { started: "2021-03-03" }), "bigint");
});
