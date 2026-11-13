import { environmentFor } from "./formulas.js";

const COMPARISONS = { "==": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };
const FLIPPED = { "=": "=", "<>": "<>", "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
const LIKE_MODES = { contains: "contains", startsWith: "starts", endsWith: "ends" };
const PAGE_NAMES = new Set(["state", "params", "visitor"]);

/**
 * Turns a `where` formula into a plan for SQL. Parts that don't mention fields stay as
 * small formulas, evaluated when the query runs (e.g. `state.search`).
 */
export function compileWhere(variables, source) {
  const expression = source.slice(1);
  const ast = environmentFor(variables).parse(expression).ast;
  const text = (node) => balanced(expression, node.start, node.end);

  const mentionsFields = (node) => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(mentionsFields);
    if (node.op === "id") return !PAGE_NAMES.has(node.args);
    if (node.op === "value") return false;
    return mentionsFields(node.args);
  };

  const fieldOf = (node) => {
    if (node.op === "id" && !PAGE_NAMES.has(node.args)) return { name: node.args, lower: false };
    if (node.op === "rcall" && node.args[0] === "lowerAscii" && node.args[2].length === 0) {
      const inner = fieldOf(node.args[1]);
      return inner && { ...inner, lower: true };
    }
    return null;
  };

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
      fail(node);
    }
    if (node.op === "in") {
      const field = fieldOf(node.args[0]);
      if (field && !mentionsFields(node.args[1])) return { kind: "in", field, value: text(node.args[1]) };
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
  if (plan.field) {
    const id = keyToId.get(plan.field.name);
    if (!id) throw new NeedsAttention();
    return { ...plan, field: { ...plan.field, name: id } };
  }
  return {
    ...plan,
    ...(plan.items ? { items: plan.items.map((item) => planToIds(item, keyToId)) } : {}),
    ...(plan.item ? { item: planToIds(plan.item, keyToId) } : {})
  };
}
