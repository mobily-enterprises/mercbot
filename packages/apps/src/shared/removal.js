import { Environment } from "@marcbachmann/cel-js";

// Removing a field from an app (D-35). Definitions are stored by ids, so every use of the field is
// found exactly. Columns, form fields and any part whose formulas use the field are removed; in a
// list's filter only the condition on that field goes (the list then shows more — reported as
// `widened`); sort, group and measure settings on it are dropped. Returns the new definition and
// what changed, by screen, in the order found.
const parser = new Environment({ unlistedVariablesAreDyn: true });

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

/** The formula without the conditions that use the field, or null when nothing is left. */
function withoutCondition(source, fieldId) {
  const expression = source.slice(1);
  if (!expression.includes(fieldId)) return source;
  let ast;
  try {
    ast = parser.parse(expression).ast;
  } catch {
    return null;
  }
  const text = (node) => balanced(expression, node.start, node.end);
  const keep = (node) => {
    if (!text(node).includes(fieldId)) return text(node);
    if (node.op === "&&" || node.op === "||") {
      const parts = node.args.map(keep).filter((part) => part !== null);
      if (!parts.length) return null;
      return parts.length === 1 ? parts[0] : `(${parts.join(` ${node.op} `)})`;
    }
    return null;
  };
  const result = keep(ast);
  return result === null ? null : `=${result}`;
}

const mentions = (value, fieldId) => typeof value === "string" && value.includes(fieldId);

export function removeFieldFromApp(definition, fieldId) {
  const out = structuredClone(definition);
  const changes = [];
  const widened = [];
  for (const [screenKey, screen] of Object.entries(out.screens || {})) {
    const note = (kind, label) => changes.push({ screen: screenKey, kind, label });
    const droppedQueries = new Set();
    for (const [name, query] of Object.entries(screen.data || {})) {
      if (query.groupBy === fieldId) {
        delete screen.data[name];
        droppedQueries.add(name);
        note("totals", name);
        continue;
      }
      if (mentions(query.where, fieldId)) {
        const next = withoutCondition(query.where, fieldId);
        if (next === null) {
          delete query.where;
        } else {
          query.where = next;
        }
        widened.push({ screen: screenKey, query: name });
        note("filter", name);
      }
      if (query.sort?.replace(/^-/u, "") === fieldId) {
        delete query.sort;
        note("sort", name);
      }
      for (const measure of ["sum", "avg"]) {
        if (query[measure] === fieldId) {
          delete query[measure];
          note("total", name);
        }
      }
    }
    const usesDropped = (value) => typeof value === "string" && [...droppedQueries].some((name) => value.includes(`data.${name}`));
    const steps = (list) => (list || [])
      .map((step) => {
        const [kind] = Object.keys(step);
        const body = step[kind];
        for (const key of ["values", "set"]) {
          if (body && typeof body[key] === "object" && body[key] && fieldId in body[key]) delete body[key][fieldId];
        }
        return JSON.stringify(step).includes(fieldId) ? null : step;
      })
      .filter(Boolean);
    const nodes = (list, path) => (list || []).filter((node, index) => {
      const own = Object.entries(node).filter(
        ([key]) => !["content", "rowActions", "buttons", "tabs", "columns", "fields", "do", "onRowClick"].includes(key)
      );
      const shown = ([key, value]) => (key === "params" ? JSON.stringify(value) : value);
      if (own.some((entry) => mentions(shown(entry), fieldId) || usesDropped(shown(entry)))) {
        note("part", `${node.type} at ${path}/${index}`);
        return false;
      }
      if (Array.isArray(node.columns)) {
        node.columns = node.columns.filter((column) => {
          if (Object.values(column).some((value) => mentions(value, fieldId))) {
            note("column", column.label || "");
            return false;
          }
          return true;
        });
      }
      if (Array.isArray(node.fields)) {
        node.fields = node.fields.filter((entry) => {
          const item = typeof entry === "string" ? { field: entry } : entry;
          if (item.field === fieldId || Object.values(item).some((value) => mentions(value, fieldId))) {
            note("form field", item.field === fieldId ? "" : item.field);
            return false;
          }
          return true;
        });
      }
      if (node.do) node.do = steps(node.do);
      if (node.onRowClick) node.onRowClick = steps(node.onRowClick);
      if (node.rowActions) node.rowActions = nodes(node.rowActions, `${path}/${index}/rowActions`);
      if (node.buttons) node.buttons = nodes(node.buttons, `${path}/${index}/buttons`);
      if (node.content) node.content = nodes(node.content, `${path}/${index}/content`);
      for (const [tabIndex, tab] of (node.tabs || []).entries()) {
        tab.content = nodes(tab.content, `${path}/${index}/tabs/${tabIndex}/content`);
      }
      return true;
    });
    screen.content = nodes(screen.content, "content");
  }
  // Visitor access lists lose the field too. A rows formula or an owner that used it is kept: it no
  // longer names a field, so visitors reach no records of that table (it fails closed).
  for (const rule of Object.values(out.public?.tables || {})) {
    for (const list of ["read", "write"]) {
      if (Array.isArray(rule?.[list])) rule[list] = rule[list].filter((id) => id !== fieldId);
    }
  }
  return { definition: out, changes, widened };
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ withoutCondition });
