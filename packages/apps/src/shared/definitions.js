import { Environment } from "@marcbachmann/cel-js";

// App definitions are stored by permanent table and field ids and shown by name (D-35): the Builder
// and the renderer always see current names, so renaming a field never touches an app, and
// removing one can find every use exactly. The same walk converts in both directions.
const parser = new Environment({ unlistedVariablesAreDyn: true });
const PAGE_NAMES = new Set(["state", "params", "data", "row", "form", "user", "today", "now", "visitor"]);
const FORM_EXTRAS = new Set(["valid", "changed", "values"]);
const isFormula = (value) => typeof value === "string" && value.startsWith("=");
/** A plain object: what definitions, written by a model, hold where an object belongs. */
export const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Rewrites field names inside one formula. `scope` maps row/form to a table and names data
 * queries; `bareTable` is the table whose fields appear bare (a query's `where`).
 */
function rewriteFormula(source, scope, map, report) {
  let ast;
  try {
    ast = parser.parse(source.slice(1)).ast;
  } catch {
    return source; // Not a formula we can read; the save check reports it.
  }
  const edits = [];
  const fieldAt = (table, name, start, end) => {
    if (!table || name === "id") return; // every record's own id, never a field
    const replacement = map.field(table, name);
    if (replacement === null) report(map.unknownField(table, name));
    else if (replacement !== name) edits.push({ start: start + 1, end: end + 1, text: replacement });
  };
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.op === "id") {
      if (scope.bareTable && !PAGE_NAMES.has(node.args)) fieldAt(scope.bareTable, node.args, node.start, node.end);
      return;
    }
    if (node.op === ".") {
      const [object, property] = node.args;
      const propertyStart = node.end - property.length;
      if (object.op === "id" && (object.args === "row" || object.args === "form")) {
        if (!(object.args === "form" && FORM_EXTRAS.has(property))) fieldAt(scope[object.args], property, propertyStart, node.end);
        return;
      }
      if (object.op === "." && object.args[0].op === "id" && object.args[0].args === "data") {
        fieldAt(scope.records?.[object.args[1]], property, propertyStart, node.end);
        return;
      }
      return walk(object);
    }
    walk(node.args);
  };
  walk(ast);
  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

/**
 * A formula over one table's own fields, written bare like a filter (a calculated field's, D-78), by
 * names → by ids, for storing: { formula, errors }, each error naming an unknown or removed field.
 */
export function tableFormulaToIds(source, table) {
  const errors = [];
  const live = table.fields.filter((field) => !field.obsolete);
  const formula = rewriteFormula(source, { bareTable: table.id }, {
    field: (_tableId, name) => live.find((field) => field.key === name)?.id ?? null,
    unknownField: (_tableId, name) => `${table.key} has no field "${name}".${closest(name, live.map((field) => field.key))}`
  }, (message) => errors.push(message));
  return { formula, errors };
}

/** The same formula by ids → by current names; a removed field keeps its id, so the formula shows "—". */
export function tableFormulaToNames(source, table) {
  return rewriteFormula(source, { bareTable: table.id }, {
    field: (_tableId, id) => {
      const field = table.fields.find((entry) => entry.id === id);
      return field && !field.obsolete ? field.key : id;
    },
    unknownField: () => ""
  }, () => {});
}

/** The fields one formula reads, as [table, field name] pairs; `scope` as for rewriteFormula. */
export function fieldsIn(source, scope) {
  const found = [];
  if (isFormula(source)) {
    rewriteFormula(source, scope, { field: (table, name) => (found.push([table, name]), name), unknownField: () => "" }, () => {});
  }
  return found;
}

/**
 * The names a formula calls as functions, with how many values each call passes; with `methods`, also those it calls
 * on a value, such as name.contains(x).
 */
export function callsIn(source, { methods = false } = {}) {
  const calls = [];
  let ast;
  try {
    ast = parser.parse(source.slice(1)).ast;
  } catch {
    return calls;
  }
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.op === "call") calls.push({ name: node.args[0], count: Array.isArray(node.args[1]) ? node.args[1].length : 0 });
    if (methods && node.op === "rcall") calls.push({ name: node.args[0], count: Array.isArray(node.args[2]) ? node.args[2].length : 0 });
    walk(node.args);
  };
  walk(ast);
  return calls;
}

/**
 * The first chain that leads from `start` back to it, following `next(name)` (fields a calculated field uses, named
 * formulas a formula calls), as [start, …, start], or null.
 */
export function cycleFrom(start, next) {
  const path = [];
  const seen = new Set();
  const walk = (name) => {
    if (path.length && name === start) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    path.push(name);
    for (const following of next(name)) if (walk(following)) return true;
    path.pop();
    return false;
  };
  return walk(start) ? [...path, start] : null;
}

/**
 * Walks a definition, calling map.convertTable / map.field on every table and field reference.
 * map.field(table, name) returns the other form, or null when unknown (reported with its path).
 */
function convertDefinition(definition, map) {
  const errors = [];
  const out = structuredClone(definition || {});
  // Definitions come from a model: anything of the wrong shape is walked past, and the save check reports it.
  const listOf = (value) => (Array.isArray(value) ? value : []);
  const entriesOf = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : []);
  const formula = (value, scope, path) =>
    isFormula(value) ? rewriteFormula(value, scope, map, (message) => errors.push({ path, message })) : value;
  const table = (name, path) => {
    const result = map.convertTable(name);
    if (result === null) errors.push({ path, message: map.unknownTable(name) });
    return result ?? name;
  };
  /** [converted reference, table id]: fields are always looked up by the table's id. */
  const tableRef = (name, path) => {
    const converted = table(name, path);
    return [converted, map.idOf(name, converted)];
  };
  const field = (tableId, name, path) => {
    const result = map.field(tableId, name);
    if (result === null) errors.push({ path, message: map.unknownField(tableId, name) });
    return result ?? name;
  };

  for (const [screenKey, screen] of entriesOf(out.screens)) {
    if (!screen || typeof screen !== "object") continue;
    const base = `screens.${screenKey}`;
    const records = {};
    const lists = {};
    for (const [queryName, query] of entriesOf(screen.data)) {
      const path = `${base}.data.${queryName}`;
      if (!query || typeof query !== "object") continue;
      if (query.record) [query.record, records[queryName]] = tableRef(query.record, `${path}.record`);
      if (query.from) [query.from, lists[queryName]] = tableRef(query.from, `${path}.from`);
      const own = records[queryName] || lists[queryName];
      const scope = { records };
      if (query.input && typeof query.input === "object") {
        for (const key of Object.keys(query.input)) query.input[key] = formula(query.input[key], scope, `${path}.input.${key}`);
      }
      if (query.id) query.id = formula(query.id, scope, `${path}.id`);
      if (query.where) query.where = formula(query.where, { ...scope, bareTable: own }, `${path}.where`);
      if (typeof query.sort === "string") query.sort = (query.sort.startsWith("-") ? "-" : "") + field(own, query.sort.replace(/^-/u, ""), `${path}.sort`);
      for (const key of ["groupBy", "sum", "avg"]) if (query[key]) query[key] = field(own, query[key], `${path}.${key}`);
    }
    const queryTable = (reference, kind) => {
      const name = /^=data\.(\w+)$/u.exec(String(reference || ""))?.[1];
      return name ? (kind === "record" ? records : lists)[name] : undefined;
    };

    const steps = (list, scope, path) => {
      (list || []).forEach((step, index) => {
        const at = `${path}[${index}]`;
        if (step.go?.params) {
          for (const key of Object.keys(step.go.params)) {
            step.go.params[key] = formula(step.go.params[key], scope, `${at}.go.params.${key}`);
          }
        }
        if (step.notify) step.notify = formula(step.notify, scope, `${at}.notify`);
        if (step.askBot?.task) step.askBot.task = formula(step.askBot.task, scope, `${at}.askBot.task`);
        if (step.runScript?.input && typeof step.runScript.input === "object") {
          for (const key of Object.keys(step.runScript.input)) {
            step.runScript.input[key] = formula(step.runScript.input[key], scope, `${at}.runScript.input.${key}`);
          }
        }
        if (step.create) {
          const [converted, target] = tableRef(step.create.table, `${at}.create.table`);
          step.create.table = converted;
          step.create.values = mapValues(step.create.values, target, scope, `${at}.create.values`);
          if (step.create.preset) step.create.preset = mapValues(step.create.preset, target, scope, `${at}.create.preset`);
        }
        if (step.update) step.update.set = mapValues(step.update.set, queryTable(step.update.record, "record"), scope, `${at}.update.set`);
      });
    };
    const mapValues = (values, target, scope, path) => {
      if (typeof values === "string") return formula(values, scope, path);
      if (!values || typeof values !== "object") return values;
      return Object.fromEntries(
        Object.entries(values).map(([key, value]) => [field(target, key, `${path}.${key}`), formula(value, scope, `${path}.${key}`)])
      );
    };

    const node = (item, scope, path) => {
      if (!item || typeof item !== "object") return;
      let inner = scope;
      if (item.type === "table") inner = { ...scope, row: queryTable(item.rows, "list") };
      if (item.type === "form" && item.table) {
        const [converted, target] = tableRef(item.table, `${path}.table`);
        item.table = converted;
        inner = { ...scope, form: target };
      } else if (item.type === "form") {
        inner = { ...scope, form: queryTable(item.record, "record") };
      }
      for (const [key, value] of Object.entries(item)) {
        if (["content", "rowActions", "buttons", "tabs", "columns", "fields", "do", "onRowClick"].includes(key)) continue;
        item[key] = formula(value, scope, `${path}.${key}`);
      }
      if (item.type === "view" && item.params && typeof item.params === "object") {
        for (const key of Object.keys(item.params)) item.params[key] = formula(item.params[key], scope, `${path}.params.${key}`);
      }
      // A table's columns are a list; a grid's `columns` is just a number.
      listOf(item.columns).forEach((column, index) => {
        for (const [key, value] of entriesOf(column)) column[key] = formula(value, inner, `${path}.columns[${index}].${key}`);
      });
      if (Array.isArray(item.fields)) {
        item.fields = item.fields.map((entry, index) => {
          const at = `${path}.fields[${index}]`;
          if (typeof entry === "string") return field(inner.form, entry, at);
          const next = { ...entry, field: field(inner.form, entry.field, at) };
          for (const key of ["showIf", "required", "label"]) {
            if (next[key] !== undefined) next[key] = formula(next[key], inner, `${at}.${key}`);
          }
          return next;
        });
      }
      steps(item.do, scope, `${path}.do`);
      steps(item.onRowClick, inner, `${path}.onRowClick`);
      listOf(item.rowActions).forEach((child, index) => node(child, inner, `${path}.rowActions[${index}]`));
      listOf(item.buttons).forEach((child, index) => node(child, inner, `${path}.buttons[${index}]`));
      listOf(item.content).forEach((child, index) => node(child, scope, `${path}.content[${index}]`));
      listOf(item.tabs).forEach((tab, tabIndex) =>
        listOf(tab?.content).forEach((child, index) => node(child, scope, `${path}.tabs[${tabIndex}].content[${index}]`)));
    };
    listOf(screen.content).forEach((item, index) => node(item, { records }, `${base}.content[${index}]`));
  }
  // Visitor access names tables, an owner field, a rows formula over the table's fields and lists
  // of fields; the earlier visitor rules, a read formula instead.
  if (out.public?.tables && typeof out.public.tables === "object") {
    out.public.tables = Object.fromEntries(Object.entries(out.public.tables).map(([key, rule]) => {
      const path = `public.tables.${key}`;
      const [converted, tableId] = tableRef(key, path);
      const next = { ...rule };
      if (next.owner) next.owner = field(tableId, next.owner, `${path}.owner`);
      if (isFormula(next.read)) next.read = formula(next.read, { bareTable: tableId }, `${path}.read`);
      if (isFormula(next.rows)) next.rows = formula(next.rows, { bareTable: tableId }, `${path}.rows`);
      for (const list of ["read", "write"]) {
        if (Array.isArray(next[list])) next[list] = next[list].map((name, index) => field(tableId, name, `${path}.${list}[${index}]`));
      }
      return [converted, next];
    }));
  }
  return { definition: out, errors };
}

export function closest(name, options) {
  let best = null;
  let bestDistance = 3;
  for (const option of options) {
    const distance = levenshtein(String(name), option);
    if (distance < bestDistance) [best, bestDistance] = [option, distance];
  }
  return best ? ` Did you mean "${best}"?` : "";
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Names → ids, for saving. Only live tables and fields can be named. */
export function toIds(definition, tables) {
  const live = tables.filter((table) => !table.obsolete);
  const byKey = new Map(live.map((table) => [table.key, table]));
  const byId = new Map(tables.map((table) => [table.id, table]));
  return convertDefinition(definition, {
    convertTable: (name) => byKey.get(name)?.id ?? null,
    idOf: (_name, id) => id,
    unknownTable: (name) => `there is no table "${name}".${closest(name, byKey.keys())}`,
    tableLabel: (id) => byId.get(id)?.key ?? `"${id}"`,
    unknownField: (id, name) =>
      `${byId.get(id)?.key ?? "that table"} has no field "${name}".${byId.get(id) ? suggestField(byId.get(id), name) : ""}`,
    field: (tableId, name) => {
      const table = byId.get(tableId);
      if (!table) return name;
      const fields = table.fields.filter((field) => !field.obsolete);
      const found = fields.find((field) => field.key === name);
      if (found) return found.id;
      return null;
    }
  });
}

/**
 * Ids → current names, for the Builder and the screens. Unknown ids stay as they are, so a
 * screen part pointing at a removed field is simply skipped when it runs.
 */
export function toNames(definition, tables) {
  const byId = new Map(tables.map((table) => [table.id, table]));
  return convertDefinition(definition, {
    convertTable: (id) => byId.get(id)?.key ?? id,
    idOf: (id) => id,
    unknownTable: () => "",
    unknownField: () => "",
    tableLabel: (id) => byId.get(id)?.key ?? `"${id}"`,
    field: (tableId, id) => {
      const field = byId.get(tableId)?.fields.find((entry) => entry.id === id);
      return field && !field.obsolete ? field.key : id;
    }
  }).definition;
}

function suggestField(table, name) {
  return closest(name, table.fields.filter((field) => !field.obsolete).map((field) => field.key));
}

/**
 * A hand-off step names its bot by id when stored and by name when shown, so renaming a bot never
 * touches an app. `convert` returns the other form, or null when there is no such bot.
 */
export function mapBots(definition, convert) {
  const errors = [];
  const out = structuredClone(definition || {});
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return;
    if (value.askBot && typeof value.askBot === "object") {
      const converted = convert(value.askBot.bot);
      if (converted === null) {
        errors.push({ path: `${path}.askBot.bot`, message: `There's no bot called "${value.askBot.bot}" in this home.` });
      } else {
        value.askBot.bot = converted;
      }
    }
    for (const [key, child] of Object.entries(value)) if (key !== "askBot") walk(child, path ? `${path}.${key}` : key);
  };
  walk(out.screens, "screens");
  return { definition: out, errors };
}

/**
 * A view part names its view by id when stored and by key when shown, and so does a copy's
 * `copiedFrom` (D-55), so a view's new title never touches an app. `convert` returns the other form,
 * or null when there is no such view: a shared part keeps what it had, for the save check or the
 * browser's placeholder; a copy stays, without an original.
 */
export function mapViews(definition, convert) {
  const out = structuredClone(definition || {});
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if (value.type === "view" && typeof value.view === "string") value.view = convert(value.view) ?? value.view;
    if (value.copiedFrom?.view) value.copiedFrom.view = convert(value.copiedFrom.view);
    Object.values(value).forEach(walk);
  };
  walk(out.screens);
  return out;
}
