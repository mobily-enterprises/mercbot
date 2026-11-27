import { environmentFor } from "./formulas.js";

const COMPARISONS = { "==": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };
const FLIPPED = { "=": "=", "<>": "<>", "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
const LIKE_MODES = { contains: "contains", startsWith: "starts", endsWith: "ends" };
const PAGE_NAMES = new Set(["state", "params", "visitor", "me"]);

const ARITHMETIC = new Set(["+", "-", "*", "/"]);
const NUMERIC = new Set(["double", "int"]);

/**
 * Turns a `where` formula into a plan for SQL. Parts that don't mention fields stay as
 * small formulas, evaluated when the query runs (e.g. `state.search`). A comparison may also be between two of the
 * record's fields ("quantity <= reorder_level"), or of arithmetic over its number fields ("price * quantity > 100.0");
 * `calculated` maps a calculated field's key to its formula by names (D-78), which stands in for it when it is such
 * arithmetic, so a simple calculated field can be filtered on (D-140).
 * @param {Record<string, any>} variables
 * @param {string} source
 * @param {{ calculated?: Record<string, string> }} [options]
 */
export function compileWhere(variables, source, { calculated = {} } = {}) {
  const expression = source.slice(1);
  const environment = environmentFor(variables);
  const ast = environment.parse(expression).ast;
  const text = (node) => balanced(expression, node.start, node.end);

  const mentionsFields = (node) => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(mentionsFields);
    if (node.op === "id") return !PAGE_NAMES.has(node.args);
    if (node.op === "value") return false;
    return mentionsFields(node.args);
  };

  const fieldOf = (node) => {
    if (node.op === "id" && Object.hasOwn(calculated, node.args)) return null;
    if (node.op === "id" && !PAGE_NAMES.has(node.args)) return { name: node.args, lower: false };
    if (node.op === "rcall" && node.args[0] === "lowerAscii" && node.args[2].length === 0) {
      const inner = fieldOf(node.args[1]);
      return inner && { ...inner, lower: true };
    }
    return null;
  };

  /**
   * An expression over the record's fields the database can work out: a field, a number, arithmetic over number fields,
   * or a calculated field made of those; null otherwise. `depth` stops a calculated field leading back to itself.
   */
  const exprOf = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 5) return null;
    if (node.op === "id" && Object.hasOwn(calculated, node.args) && NUMERIC.has(String(variables[node.args]))) {
      return exprOf(environment.parse(calculated[node.args].replace(/^=/u, "")).ast, depth + 1);
    }
    const field = fieldOf(node);
    if (field) return { kind: "field", field, numeric: NUMERIC.has(String(variables[field.name])) };
    if (node.op === "value" && (typeof node.args === "number" || typeof node.args === "bigint")) return { kind: "num", value: Number(node.args) };
    if (node.op === "-_") {
      const item = exprOf(node.args, depth);
      return item && numeric(item) ? { kind: "neg", item } : null;
    }
    if (ARITHMETIC.has(node.op) && Array.isArray(node.args) && node.args.length === 2) {
      const [left, right] = node.args.map((arg) => exprOf(arg, depth));
      return left && right && numeric(left) && numeric(right) ? { kind: "arith", op: node.op, left, right } : null;
    }
    return null;
  };
  const numeric = (expr) => expr.kind !== "field" || expr.numeric;

  const fail = (node) => {
    throw new Error(`"${text(node)}" can't be turned into a database query`);
  };

  const compile = (node) => {
    if (!mentionsFields(node)) return { kind: "value", source: text(node) };
    if (node.op === "||" || node.op === "&&") {
      return { kind: node.op === "||" ? "or" : "and", items: node.args.map(compile) };
    }
    if (node.op === "!_") return { kind: "not", item: compile(node.args) };
    if (COMPARISONS[node.op]) {
      const [left, right] = node.args;
      const leftField = fieldOf(left);
      if (leftField && !mentionsFields(right)) return { kind: "compare", op: COMPARISONS[node.op], field: leftField, value: text(right) };
      const rightField = fieldOf(right);
      if (rightField && !mentionsFields(left)) {
        return { kind: "compare", op: FLIPPED[COMPARISONS[node.op]], field: rightField, value: text(left) };
      }
      // Arithmetic, a calculated field, or two of the record's fields, worked out in the database.
      const leftExpr = exprOf(left);
      const rightExpr = exprOf(right);
      if (leftExpr && !mentionsFields(right)) return { kind: "compareExpr", op: COMPARISONS[node.op], left: leftExpr, value: text(right) };
      if (rightExpr && !mentionsFields(left)) return { kind: "compareExpr", op: FLIPPED[COMPARISONS[node.op]], left: rightExpr, value: text(left) };
      if (leftExpr && rightExpr) return { kind: "compareExpr", op: COMPARISONS[node.op], left: leftExpr, right: rightExpr };
      fail(node);
    }
    if (node.op === "in") {
      const field = fieldOf(node.args[0]);
      if (field && !mentionsFields(node.args[1])) return { kind: "in", field, value: text(node.args[1]) };
      // `"urgent" in tags`: a list field holding a value (tags), with `||` and `&&` for any or all of several. Only a
      // list field: the database would read any other field's value as a list, and refuse it.
      const list = fieldOf(node.args[1]);
      const isList = list && String(variables[list.name] ?? "").startsWith("list<");
      if (isList && !list.lower && !mentionsFields(node.args[0])) return { kind: "has", field: list, value: text(node.args[0]) };
      fail(node);
    }
    if (node.op === "rcall" && LIKE_MODES[node.args[0]]) {
      const field = fieldOf(node.args[1]);
      const argument = node.args[2][0];
      if (field && argument && !mentionsFields(argument)) {
        return { kind: "like", mode: LIKE_MODES[node.args[0]], field, value: text(argument) };
      }
    }
    fail(node);
  };

  return compile(ast);
}

/**
 * The parser's end positions can stop before a closing bracket (e.g. after `!(a == b`), so extend
 * a slice until its brackets balance, skipping brackets inside quoted strings.
 */
function balanced(expression, start, end) {
  let depth = 0;
  let quote = null;
  let index = start;
  const step = (char, previous) => {
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    }
  };
  for (; index < end; index += 1) step(expression[index], expression[index - 1]);
  while (depth > 0 && index < expression.length) {
    step(expression[index], expression[index - 1]);
    index += 1;
  }
  return expression.slice(start, index);
}

// A plan's field names (keys) → field ids. A field that no longer exists throws "needs attention",
// so callers can fail closed instead of dropping the condition.
export class NeedsAttention extends Error {
  constructor() {
    super("needs attention");
  }
}

export function planToIds(plan, keyToId) {
  const idOf = (field) => {
    const id = keyToId.get(field.name);
    if (!id) throw new NeedsAttention();
    return { ...field, name: id };
  };
  if (plan.kind === "compareExpr") return { ...plan, left: exprToIds(plan.left, idOf), ...(plan.right ? { right: exprToIds(plan.right, idOf) } : {}) };
  if (plan.field) return { ...plan, field: idOf(plan.field) };
  return {
    ...plan,
    ...(plan.items ? { items: plan.items.map((item) => planToIds(item, keyToId)) } : {}),
    ...(plan.item ? { item: planToIds(plan.item, keyToId) } : {})
  };
}

/**
 * A calculated number or money field as an expression the database works out (D-140), by field ids, for a list's
 * order; null when its formula is anything but arithmetic over the record's number fields.
 * @param {object} field the calculated field
 * @param {Record<string, any>} variables the table's formula schema (celSchema)
 * @param {Record<string, string>} calculated its calculated formulas by names (calculatedFormulas)
 * @param {Map<string, string>} keyToId its stored fields' ids by key (storedFieldIds)
 */
export function calculatedOrder(field, variables, calculated, keyToId) {
  try {
    const plan = compileWhere(variables, `=${field.key} > 0.0`, { calculated });
    return plan.kind === "compareExpr" && !plan.right ? planToIds(plan, keyToId).left : null;
  } catch {
    return null;
  }
}

/** An expression's fields mapped by `idOf` (planToIds). */
function exprToIds(expr, idOf) {
  if (expr.kind === "field") return { ...expr, field: idOf(expr.field) };
  if (expr.kind === "neg") return { ...expr, item: exprToIds(expr.item, idOf) };
  if (expr.kind === "arith") return { ...expr, left: exprToIds(expr.left, idOf), right: exprToIds(expr.right, idOf) };
  return expr;
}

/** The field names (or ids) an expression of a compareExpr plan reads. */
export function exprFields(expr) {
  if (!expr) return [];
  if (expr.kind === "field") return [expr.field.name];
  if (expr.kind === "neg") return exprFields(expr.item);
  if (expr.kind === "arith") return [...exprFields(expr.left), ...exprFields(expr.right)];
  return [];
}
