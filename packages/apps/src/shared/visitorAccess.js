import { calculatedFrom, isCalculated } from "./calculated.js";
import { fieldsIn, isObject } from "./definitions.js";
import { VISITOR, celSchema, checkFormula, isFormula } from "./formulas.js";
import { compileWhere } from "./where.js";

// Visitor access (D-66): what a public app lets its visitors reach, table by table, in the app
// definition's `public.tables`. Anything not listed is refused, and the default is nothing.
//
//   "bookings": { "can": ["list", "get", "create", "update"], "rows": "own", "owner": "email",
//                 "read": ["what", "date", "status"], "write": ["what", "date"] }
//
// can: list (lists and totals), get (one record), create, update, delete (mark obsolete). rows:
// all, own (records whose `owner` email field is the signed-in visitor's) or a formula over the
// table's fields and `visitor`: the records visitors reach, link labels included. read: the fields
// visitors may receive, and filter, sort, group or sum by. write: every field a visitor's request
// writes, presets included; the server sets the owner, so it is never in write. The save check
// holds public screens to it (checkVisitorAccess below), and the data gate enforces it on every
// call (server/visitorAccess.js).
export const OPERATIONS = ["list", "get", "create", "update", "delete"];
export const SETTINGS = ["can", "rows", "owner", "read", "write"];
const DATA_REFERENCE = /^=data\.(\w+)$/u;
// Settings of a part that hold other parts, steps or columns, walked on their own below.
const STRUCTURE = new Set(["content", "rowActions", "buttons", "tabs", "columns", "fields", "do", "onRowClick"]);

const listOf = (value) => (Array.isArray(value) ? value : []);

/** Whether an app's `public` uses this shape; the earlier visitor rules ({ read, owner, create, update }) have no `can`. */
export const isListed = (settings) => Object.values(isObject(settings?.tables) ? settings.tables : {}).some((rule) => isObject(rule) && "can" in rule);

/**
 * What an app's public screens use, by names: table key → { can, read, write }, each a Map of an
 * operation or field name to the first place that uses it. Data scripts aren't counted: the gate
 * holds what they read to the same list.
 */
export function screenUses(definition, tables) {
  const known = new Set(tables.filter((table) => !table.obsolete).map((table) => table.key));
  const uses = new Map();
  const note = (kind, key, name, path) => {
    if (!known.has(key) || typeof name !== "string" || name === "id") return;
    if (!uses.has(key)) uses.set(key, { can: new Map(), read: new Map(), write: new Map() });
    if (!uses.get(key)[kind].has(name)) uses.get(key)[kind].set(name, path);
  };
  const reads = (value, scope, path) => {
    for (const [key, name] of fieldsIn(value, scope)) note("read", key, name, path);
  };

  for (const [screenKey, screen] of Object.entries(isObject(definition?.screens) ? definition.screens : {})) {
    if (screen?.public !== true) continue;
    const base = `screens.${screenKey}`;
    const queries = Object.entries(isObject(screen.data) ? screen.data : {}).filter(
      ([, query]) => isObject(query) && query.script === undefined && typeof (query.record || query.from) === "string"
    );
    const records = Object.fromEntries(queries.filter(([, query]) => query.record).map(([name, query]) => [name, query.record]));
    const lists = Object.fromEntries(queries.filter(([, query]) => !query.record).map(([name, query]) => [name, query.from]));
    for (const [name, query] of queries) {
      const path = `${base}.data.${name}`;
      const key = query.record || query.from;
      note("can", key, query.record ? "get" : "list", path);
      reads(query.id, { records }, `${path}.id`);
      reads(query.where, { records, bareTable: key }, `${path}.where`);
      for (const setting of ["sort", "groupBy", "sum", "avg"]) {
        if (typeof query[setting] === "string") note("read", key, query[setting].replace(/^-/u, ""), `${path}.${setting}`);
      }
    }
    const queryTable = (reference, kind) => {
      const name = DATA_REFERENCE.exec(String(reference || ""))?.[1];
      return name ? (kind === "record" ? records : lists)[name] : undefined;
    };
    /** A step's settings: names it writes (an object of values) or formulas it reads (any other value). */
    const values = (setting, table, scope, path) => {
      if (!isObject(setting)) return reads(setting, scope, path);
      for (const [name, value] of Object.entries(setting)) {
        note("write", table, name, `${path}.${name}`);
        reads(value, scope, `${path}.${name}`);
      }
    };
    const steps = (list, scope, path) => listOf(list).forEach((step, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(step)) return;
      if (isObject(step.go?.params)) for (const [name, value] of Object.entries(step.go.params)) reads(value, scope, `${at}.go.params.${name}`);
      reads(step.notify, scope, `${at}.notify`);
      reads(step.askBot?.task, scope, `${at}.askBot.task`);
      if (isObject(step.runScript?.input)) for (const [name, value] of Object.entries(step.runScript.input)) reads(value, scope, `${at}.runScript.input.${name}`);
      if (isObject(step.create)) {
        note("can", step.create.table, "create", at);
        values(step.create.values, step.create.table, scope, `${at}.create.values`);
        values(step.create.preset, step.create.table, scope, `${at}.create.preset`);
      }
      if (isObject(step.update)) {
        const table = queryTable(step.update.record, "record");
        note("can", table, "update", at);
        values(step.update.set, table, scope, `${at}.update.set`);
      }
      if (isObject(step.markObsolete)) note("can", queryTable(step.markObsolete.record, "record"), "delete", at);
    });
    const node = (item, scope, path) => {
      if (!isObject(item)) return;
      let inner = scope;
      let form = null;
      if (item.type === "table") {
        inner = { ...scope, row: queryTable(item.rows, "list") };
        // A row's click and its buttons load the row's record.
        if (item.onRowClick || item.rowActions) note("can", inner.row, "get", path);
      }
      if (item.type === "form" && typeof item.table === "string") {
        // A new record's form holds what the visitor types, never a stored record.
        form = { table: item.table, creating: true };
        inner = { ...scope, form: undefined };
      } else if (item.type === "form") {
        form = { table: queryTable(item.record, "record"), creating: false };
        inner = { ...scope, form: form.table };
      }
      for (const [key, value] of Object.entries(item)) {
        if (STRUCTURE.has(key)) continue;
        if (isObject(value)) for (const [name, inside] of Object.entries(value)) reads(inside, scope, `${path}.${key}.${name}`);
        else reads(value, scope, `${path}.${key}`);
      }
      listOf(item.columns).forEach((column, index) => {
        for (const [key, value] of Object.entries(isObject(column) ? column : {})) reads(value, inner, `${path}.columns[${index}].${key}`);
      });
      if (form) {
        const formTable = tables.find((table) => !table.obsolete && table.key === form.table);
        listOf(item.fields).forEach((entry, index) => {
          const at = `${path}.fields[${index}]`;
          const name = typeof entry === "string" ? entry : entry?.field;
          // A calculated field (D-78) only shows: worked out from what the visitor types, or read with the record.
          if (!isCalculated(formTable?.fields.find((field) => !field.obsolete && field.key === name))) note("write", form.table, name, at);
          if (!form.creating) note("read", form.table, name, at);
          for (const key of ["showIf", "required", "label"]) reads(entry?.[key], inner, `${at}.${key}`);
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
  return uses;
}

/** The fields a calculated field (D-78) that `read` names is worked out from, as its formula is now, that `read` leaves out. */
const unlistedSources = (table, read, name) =>
  calculatedFrom(table, table.fields.find((field) => !field.obsolete && field.key === name)).filter((used) => !read.includes(used));

/**
 * What visitors really read of a table's `read` (by names): a calculated field only while every field it's worked
 * out from is listed too. The save check refuses one listed without them, but its formula can change after the app
 * is published, and an owner's narrowing isn't checked, so the fence, the visitor's page and the Overview go by this.
 */
export function visitorReads(table, read) {
  const names = listOf(read);
  return table ? names.filter((name) => !unlistedSources(table, names, name).length) : names;
}

/**
 * An app's visitor access in this shape, by names. An app still on the earlier visitor rules gets
 * what its public screens use, until the upgrade rewrites stored apps (design 3.4): `can` from its
 * rules, `rows` from its read rule, `read` the fields its public screens show, filter, sort, group
 * or sum by, plus the owner and the title, `write` its public forms' fields and presets; a table
 * they link to that isn't listed is added for its records' titles alone (`can: []`, `rows: all`),
 * so link labels keep showing and forms can still link to it, as they did.
 */
export function listedAccess(definition, tables) {
  const declared = isObject(definition?.public?.tables) ? definition.public.tables : {};
  if (isListed(definition?.public)) return declared;
  const live = tables.filter((table) => !table.obsolete);
  const titleOf = (table) => table.fields.find((field) => field.id === table.titleFieldId && !field.obsolete)?.key;
  const uses = screenUses(definition, tables);
  const out = {};
  for (const [key, rule] of Object.entries(declared)) {
    const table = live.find((entry) => entry.key === key);
    if (!table || !isObject(rule)) continue;
    const fields = (names) => [...new Set(names)].filter((name) => table.fields.some((field) => !field.obsolete && field.key === name));
    const owner = typeof rule.owner === "string" ? rule.owner : null;
    const rows = rule.read ?? (rule.update === "own" ? "own" : undefined);
    out[key] = {
      can: [...(rule.read !== undefined ? ["list", "get"] : []), ...(rule.create === true ? ["create"] : []), ...(rule.update === "own" ? ["update"] : [])],
      ...(rows !== undefined ? { rows } : {}),
      ...(owner ? { owner } : {}),
      read: fields([...(uses.get(key)?.read.keys() || []), owner, titleOf(table)]),
      write: fields([...(uses.get(key)?.write.keys() || [])]).filter((name) => name !== owner)
    };
  }
  for (const [key, entry] of Object.entries({ ...out })) {
    const table = live.find((item) => item.key === key);
    const linked = (item) => !item.obsolete && item.type === "link" && (entry.read.includes(item.key) || entry.write.includes(item.key));
    for (const field of table.fields.filter(linked)) {
      const target = live.find((item) => item.id === field.options?.target);
      if (target && !out[target.key] && titleOf(target)) out[target.key] = { can: [], rows: "all", read: [titleOf(target)], write: [] };
    }
  }
  return out;
}

/**
 * A stored definition (by ids) whose earlier visitor rules are written as visitor access, by ids;
 * one already listed, or with no visitor tables, comes back as it is. Tables are read with their
 * ids as names, so the derivation above works on the stored form unchanged.
 */
export function listedStored(definition, tables) {
  const declared = definition?.public?.tables;
  if (!isObject(declared) || !Object.keys(declared).length || isListed(definition.public)) return definition;
  const byIds = tables.map((table) => ({ ...table, key: table.id, fields: table.fields.map((field) => ({ ...field, key: field.id })) }));
  return { ...definition, public: { ...definition.public, tables: listedAccess(definition, byIds) } };
}

/**
 * What `after` lets visitors reach that `before` doesn't: [{ table, what, name }], what being
 * "table" (newly listed), "can", "read", "write", "rows" or "owner". Empty when it reaches the same
 * or less. Both are visitor access by the same names (or both by ids).
 */
export function widening(before, after) {
  const out = [];
  for (const [table, rule] of Object.entries(isObject(after) ? after : {})) {
    if (!isObject(rule)) continue;
    const was = isObject(before?.[table]) ? before[table] : null;
    if (!was) {
      out.push({ table, what: "table" });
      continue;
    }
    for (const what of ["can", "read", "write"]) {
      for (const name of listOf(rule[what])) if (!listOf(was[what]).includes(name)) out.push({ table, what, name });
    }
    // Every record is as wide as rows get; any other change reaches records it didn't.
    if (rule.rows !== undefined && rule.rows !== was.rows && was.rows !== "all") out.push({ table, what: "rows" });
    if (rule.owner !== undefined && rule.owner !== was.owner) out.push({ table, what: "owner" });
  }
  return out;
}

/**
 * Visitor access narrowed to what `keep` still lists ({ table: { can, read, write } }): a table
 * left out of keep is no longer listed; rows and owner stay as they were, so it can only shrink.
 */
export function narrowed(listed, keep) {
  const out = {};
  for (const [table, rule] of Object.entries(isObject(listed) ? listed : {})) {
    const kept = keep?.[table];
    if (!isObject(rule) || !isObject(kept)) continue;
    const next = { ...rule };
    for (const what of ["can", "read", "write"]) {
      if (Array.isArray(rule[what])) next[what] = rule[what].filter((name) => listOf(kept[what]).includes(name));
    }
    out[table] = next;
  }
  return out;
}

/** `listed` without what `before` reached and `after` no longer does (all by the same names or ids). */
export function withoutRemoved(listed, before, after) {
  const out = {};
  for (const [table, rule] of Object.entries(isObject(listed) ? listed : {})) {
    if (isObject(before?.[table]) && !isObject(after?.[table])) continue;
    if (!isObject(rule) || !isObject(before?.[table])) {
      out[table] = rule;
      continue;
    }
    const next = { ...rule };
    for (const what of ["can", "read", "write"]) {
      const gone = listOf(before[table][what]).filter((name) => !listOf(after[table][what]).includes(name));
      if (Array.isArray(rule[what])) next[what] = rule[what].filter((name) => !gone.includes(name));
    }
    out[table] = next;
  }
  return out;
}

/**
 * The queries of a definition's public screens that a data script works out, [{ screen, query,
 * script }]: what they read is up to the script's code, so no derivation can list it.
 */
export const publicScripts = (definition) =>
  Object.entries(isObject(definition?.screens) ? definition.screens : {})
    .filter(([, body]) => body?.public === true)
    .flatMap(([screen, body]) =>
      Object.entries(isObject(body.data) ? body.data : {})
        .filter(([, query]) => isObject(query) && query.script !== undefined)
        .map(([query, { script }]) => ({ screen, query, script })));

// A table entry on the earlier visitor rules ({ read, owner, create, update }), which saves no longer
// take (D-66): no `can`, and a create or update rule or a read rule naming its records.
const isEarlierRule = (rule) => !("can" in rule) && ("create" in rule || "update" in rule || typeof rule.read === "string");
const EARLIER_REFUSAL =
  "uses the earlier visitor rules (read, owner, create, update). List what visitors may reach instead: can (any of " +
  `${OPERATIONS.join(", ")}), rows (all, own or a formula), owner, and the fields they read and write, e.g. ` +
  '{ "can": ["list", "get", "update"], "rows": "own", "owner": "email", "read": ["name", "status"], "write": ["name"] }.';

// What each operation lets visitors do, for the save check's refusals.
const DOING = { list: "list", get: "open records of", create: "add to", update: "change", delete: "mark records obsolete in" };

/** The save check of one listed table's settings (the shape above). */
function checkRule(definition, tables, table, rule, at, report) {
  for (const name of Object.keys(rule)) {
    if (!SETTINGS.includes(name)) report(`${at}.${name}`, `isn't a visitor setting; settings are ${SETTINGS.join(", ")}.`);
  }
  const can = Array.isArray(rule.can) ? rule.can : [];
  if (!Array.isArray(rule.can) || !can.every((operation) => OPERATIONS.includes(operation))) {
    report(`${at}.can`, `lists what visitors may do: any of ${OPERATIONS.join(", ")}.`);
  }
  const fieldNamed = (name) => table.fields.find((field) => !field.obsolete && field.key === name);
  if (rule.owner !== undefined && fieldNamed(rule.owner)?.type !== "email") report(`${at}.owner`, "must name an email field of this table.");
  if (rule.rows === undefined) {
    // Listing, opening or changing records says whose; so does a table listed for its link labels alone.
    if (can.some((operation) => operation !== "create") || (!can.length && listOf(rule.read).length)) {
      report(`${at}.rows`, 'says which records visitors reach: all, own, or a formula like "=listed == true".');
    }
  } else if (rule.rows === "own") {
    if (!rule.owner) report(`${at}.owner`, "\"own\" needs owner: the email field that says whose record it is.");
    if (definition.public.signIn !== "required") report("public.signIn", "\"own\" records need visitors to sign in: set signIn to required.");
  } else if (rule.rows !== "all") {
    const variables = { ...celSchema(table), visitor: VISITOR };
    const result = isFormula(rule.rows) ? checkFormula(variables, rule.rows) : { error: 'must be all, own, or a formula like "=listed == true".' };
    if (result.error) {
      report(`${at}.rows`, result.error);
    } else if (result.type && !["bool", "dyn"].includes(result.type)) {
      report(`${at}.rows`, "must be true or false.");
    } else {
      try {
        compileWhere(variables, rule.rows);
      } catch (error) {
        report(`${at}.rows`, error.message);
      }
    }
  }
  for (const operation of ["update", "delete"]) {
    if (can.includes(operation) && rule.rows !== "own") {
      const doing = operation === "delete" ? "mark obsolete" : "change";
      report(`${at}.can`, `visitors may only ${doing} their own records: ${operation} needs rows: own.`);
    }
  }
  for (const list of ["read", "write"]) {
    if (rule[list] !== undefined && !(Array.isArray(rule[list]) && rule[list].every((name) => typeof name === "string"))) {
      report(`${at}.${list}`, 'lists field names, like ["name", "email"].');
    }
  }
  if (typeof rule.rows === "string" && isFormula(rule.rows)) {
    for (const [, name] of fieldsIn(rule.rows, { bareTable: table.key })) {
      if (isCalculated(fieldNamed(name))) report(`${at}.rows`, `rows run in the database, where the calculated field "${name}" isn't stored: use the fields it's worked out from.`);
    }
  }
  // A calculated field (D-78) is worked out from others: a visitor reads it only with them, and never writes it.
  for (const name of listOf(rule.read)) {
    const missing = unlistedSources(table, listOf(rule.read), name);
    if (missing.length) report(`${at}.read`, `${name} is worked out from ${missing.join(", ")}: list ${missing.length === 1 ? "it" : "them"} in read too, or leave ${name} out.`);
  }
  for (const name of listOf(rule.write)) {
    if (isCalculated(fieldNamed(name))) report(`${at}.write`, `${name} is a calculated field, worked out from the record's other fields: leave it out of write.`);
    if (name === rule.owner) report(`${at}.write`, `${name} is the owner, which the server fills in with the visitor's email: leave it out of write.`);
    const field = fieldNamed(name);
    const target = field?.type === "link" && tables.find((entry) => entry.id === field.options?.target && !entry.obsolete);
    if (target && !definition.public.tables[target.key]) report(`${at}.write`, `${name} links to ${target.key}: list ${target.key} in public.tables too.`);
  }
}

/**
 * The save check of visitor access: each listed table's settings, then every public screen against
 * the list, each refusal naming the missing entry. `report(path, message)` collects them.
 */
export function checkVisitorAccess(definition, tables, { tableNamed, report }) {
  const declared = isObject(definition.public?.tables) ? definition.public.tables : {};
  for (const [key, rule] of Object.entries(declared)) {
    const at = `public.tables.${key}`;
    const table = tableNamed(key);
    if (!table) report(at, "needs an existing table.");
    else if (!isObject(rule)) report(at, `says what visitors may reach: ${SETTINGS.join(", ")}.`);
    else if (isEarlierRule(rule)) report(at, EARLIER_REFUSAL);
    else checkRule(definition, tables, table, rule, at, report);
  }
  const listed = (list, name) => Array.isArray(list) && list.includes(name);
  for (const [key, used] of screenUses(definition, tables)) {
    const rule = isObject(declared[key]) ? declared[key] : {};
    for (const [operation, path] of used.can) {
      if (!listed(rule.can, operation)) report(path, `visitors can't ${DOING[operation]} ${key}: add "${operation}" to public.tables.${key}.can.`);
    }
    for (const [name, path] of used.read) {
      if (!listed(rule.read, name)) report(path, `visitors can't read ${key}.${name}: add "${name}" to public.tables.${key}.read.`);
    }
    for (const [name, path] of used.write) {
      // A form may show the owner: the server fills it in, whatever is sent.
      if (name !== rule.owner && !listed(rule.write, name)) {
        report(path, `visitors can't write ${key}.${name}: add "${name}" to public.tables.${key}.write.`);
      }
    }
  }
}
