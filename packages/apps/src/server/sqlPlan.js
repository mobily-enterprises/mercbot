import { evaluateFormula } from "../shared/formulas.js";

/**
 * Applies a compiled `where` plan (shared/where.js) to a Knex builder. Parts that don't mention
 * fields, such as `state.search == ""`, are evaluated first and folded through the whole plan, so an
 * always-true branch makes its OR true and an always-false one makes its AND false; only the rest
 * becomes SQL. `column` maps a field id to its SQL column (AnyAPI's slot). A plan's field may be
 * `lower` (from `lowerAscii()`) and, in plans the server makes itself, `trim`: an import matches a
 * link cell to the linked records' titles as the sheet reads them, trimmed and lowercased.
 */
export function applyPlan(builder, plan, context, column, knex) {
  const value = (source) => {
    const result = evaluateFormula(context.variables, `=${source}`, context.values);
    if (Array.isArray(result)) return result.map((item) => (typeof item === "bigint" ? Number(item) : item));
    return typeof result === "bigint" ? Number(result) : result;
  };
  const folded = fold(plan, value);
  if (folded.kind === "true") return;
  if (folded.kind === "false") {
    builder.whereRaw("false");
    return;
  }
  build(builder, folded, value, column, knex);
}

// What JavaScript's trim() removes, so `trim` matches the titles a spreadsheet cell's trim() would.
const BLANKS = " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
  "\u2028\u2029\u202f\u205f\u3000\ufeff";

const TRUE = { kind: "true" };
const FALSE = { kind: "false" };

function fold(plan, value) {
  switch (plan.kind) {
    case "value":
      return value(plan.source) ? TRUE : FALSE;
    case "and": {
      const items = plan.items.map((item) => fold(item, value)).filter((item) => item.kind !== "true");
      if (items.some((item) => item.kind === "false")) return FALSE;
      return items.length ? (items.length === 1 ? items[0] : { kind: "and", items }) : TRUE;
    }
    case "or": {
      const items = plan.items.map((item) => fold(item, value)).filter((item) => item.kind !== "false");
      if (items.some((item) => item.kind === "true")) return TRUE;
      return items.length ? (items.length === 1 ? items[0] : { kind: "or", items }) : FALSE;
    }
    case "not": {
      const item = fold(plan.item, value);
      if (item.kind === "true") return FALSE;
      if (item.kind === "false") return TRUE;
      return { kind: "not", item };
    }
    default:
      return plan;
  }
}

function build(builder, plan, value, column, knex) {
  const target = (field) => {
    if (field.trim && field.lower) return knex.raw("lower(btrim(??, ?))", [column(field.name), BLANKS]);
    if (field.trim) return knex.raw("btrim(??, ?)", [column(field.name), BLANKS]);
    return field.lower ? knex.raw("lower(??)", [column(field.name)]) : knex.ref(column(field.name));
  };
  const escapeLike = (text) => String(text ?? "").replace(/[\\%_]/gu, (char) => `\\${char}`);

  switch (plan.kind) {
    case "and":
      for (const item of plan.items) builder.where((inner) => build(inner, item, value, column, knex));
      return;
    case "or":
      builder.where((outer) => {
        for (const item of plan.items) outer.orWhere((inner) => build(inner, item, value, column, knex));
      });
      return;
    case "not":
      builder.whereNot((inner) => build(inner, plan.item, value, column, knex));
      return;
    case "compare": {
      const operand = value(plan.value);
      // In formulas an empty field reads as "" (a text, a link, a date and time, D-130), and its slot holds null, or ""
      // for a text; a date and time's, a number's and a yes/no's slot holds a timestamp, a number or a boolean, which
      // "" can't be (PostgreSQL refuses the comparison). Only a "" written in the formula asks for empty fields: an
      // empty value it reads (a signed-out visitor's email, a missing `params.id`) matches none, so
      // `owner == visitor.email` never gives someone signed out every record nobody owns.
      if (/^\s*(?:""|'')\s*$/u.test(String(plan.value)) && ["=", "<>"].includes(plan.op)) {
        const nullOnly = /(?:^|\.)(?:date|number|boolean)_\d+$/u.test(String(column(plan.field.name)));
        const slot = target(plan.field);
        if (plan.op === "=") {
          builder.where((blank) => (nullOnly ? blank.whereNull(slot) : blank.whereNull(slot).orWhere(slot, "=", "")));
        } else {
          builder.where((filled) => (nullOnly ? filled.whereNotNull(slot) : filled.whereNotNull(slot).andWhere(slot, "<>", "")));
        }
        return;
      }
      if (operand === null || operand === undefined) {
        if (plan.op === "=") {
          builder.whereNull(target(plan.field));
        } else if (plan.op === "<>") {
          builder.whereNotNull(target(plan.field));
        } else {
          builder.whereRaw("false");
        }
        return;
      }
      builder.where(target(plan.field), plan.op, operand);
      return;
    }
    case "compareExpr": {
      // Arithmetic over the record's own fields, or two of them: a record with an empty one matches neither way, as SQL
      // compares, and dividing by zero gives no value rather than an error.
      const left = exprSql(plan.left, column, knex);
      if (plan.right) {
        builder.where(left, plan.op, exprSql(plan.right, column, knex));
        return;
      }
      const operand = value(plan.value);
      if (operand === null || operand === undefined || operand === "") builder.whereRaw("false");
      else builder.where(left, plan.op, operand);
      return;
    }
    case "in": {
      const list = value(plan.value);
      if (!Array.isArray(list) || !list.length) {
        builder.whereRaw("false");
      } else {
        builder.whereIn(target(plan.field), list);
      }
      return;
    }
    case "has": {
      // A tags field holds a JSON list: whether it holds this value (PostgreSQL's jsonb ? operator, by name).
      const item = value(plan.value);
      if (item === null || item === undefined || item === "") builder.whereRaw("false");
      else builder.whereRaw("jsonb_exists(??::jsonb, ?)", [column(plan.field.name), String(item)]);
      return;
    }
    case "like": {
      const text = escapeLike(value(plan.value));
      const pattern = plan.mode === "contains" ? `%${text}%` : plan.mode === "starts" ? `${text}%` : `%${text}`;
      builder.where(target(plan.field), "like", pattern);
      return;
    }
    default:
      throw new Error(`Unknown plan part ${plan.kind}`);
  }
}

/**
 * An expression (where.js exprOf) as SQL: a field's slot, a number, arithmetic, a negation, each a fixed piece of SQL
 * with its parts bound; for a comparison, or a list's order by a calculated field.
 * @param {object} expr
 * @param {(name: string) => string} column a field's slot
 * @param {import("knex").Knex} knex
 */
export function exprSql(expr, column, knex) {
  if (expr.kind === "field") return expr.field.lower ? knex.raw("lower(??)", [column(expr.field.name)]) : knex.ref(column(expr.field.name));
  if (expr.kind === "num") return knex.raw("?::double precision", [expr.value]);
  if (expr.kind === "neg") return knex.raw("(- ?)", [exprSql(expr.item, column, knex)]);
  const left = exprSql(expr.left, column, knex);
  const right = exprSql(expr.right, column, knex);
  if (expr.op === "+") return knex.raw("(? + ?)", [left, right]);
  if (expr.op === "-") return knex.raw("(? - ?)", [left, right]);
  if (expr.op === "*") return knex.raw("(? * ?)", [left, right]);
  return knex.raw("(? / nullif(?, 0))", [left, right]);
}
