import { callsIn, cycleFrom, fieldsIn, tableFormulaToIds, tableFormulaToNames } from "./definitions.js";
import { BUILT_IN_FUNCTIONS, TEXT_MAX, celSchema, checkFormula, environmentFor, formulaValue, isFormula, plainValue } from "./formulas.js";

// Calculated fields (D-78): a field of a table whose value is a formula over the same record's other
// fields, written with their names bare, like a filter ("=price * quantity"). Its type (number,
// money, text, date or yes/no) says how the value shows. It is never stored: whoever reads a record
// gets it worked out (the data gate on the server; a form in the browser while someone types), so it
// is always up to date. Filters, sorting and grouping run in the database, so they can't use one.
// It is stored by field ids, like apps, so renaming a field never touches it; a field it uses that is
// removed leaves it showing "—". It sees only its own record and the built-in functions, never an
// app's named formulas or script functions: a table belongs to every app of the home.

export const CALCULATED_TYPES = ["text", "number", "money", "date", "yesno"];
// The formula's own type for each field type; "dyn" (a value only known when it runs) always passes.
const RESULTS = { text: ["string"], date: ["string"], number: ["double", "int"], money: ["double", "int"], yesno: ["bool"] };
const RESULT_WORDS = { text: "text", date: "a date as text (YYYY-MM-DD)", number: "a number", money: "a number of cents", yesno: "true or false" };
// What a calculated field can't use: every read works it out for each record it shows (up to 5,000 for a sum), and
// on one record's long text these can take seconds or build a huge text, holding up the server for every home. The
// comprehensions loop over a list (nested, they multiply) and matches runs a regular expression, which can backtrack
// for minutes.
const SLOW = new Set(["map", "filter", "all", "exists", "exists_one", "matches"]);
const DATE = /^\d{4}-\d{2}-\d{2}/u;

/** Whether a field is calculated: it has a formula instead of stored values. */
export const isCalculated = (field) => typeof field?.options?.formula === "string";

/** The fields of a table that a filter, sort or group can use, by key: live stored fields. */
export const storedFieldIds = (table) =>
  new Map(table.fields.filter((field) => !field.obsolete && !isCalculated(field)).map((field) => [field.key, field.id]));

/** A calculated field's formula by current names. */
export const formulaByNames = (table, field) => (isCalculated(field) ? tableFormulaToNames(field.options.formula, table) : null);

/** A field as a browser or a bot gets it: a calculated field's formula by names, as it was written. */
export const fieldByNames = (table, field) =>
  isCalculated(field) ? { ...field, options: { ...field.options, formula: formulaByNames(table, field) } } : field;

/** The ids of the fields a stored (by ids) formula uses. */
const idsUsed = (formula) => fieldsIn(formula, { bareTable: "_" }).map(([, id]) => id);

const plans = new WeakMap();

/**
 * A table's live calculated fields, each after the ones it uses, with its formula by names and the
 * CEL program that works it out (null when it can't, such as a formula using a removed field). It
 * goes by field names, so it works on the server's tables (formulas by ids) and on a browser's
 * (fields without ids, formulas by names) alike. Kept for each table object: the server's are frozen
 * and cached by the registry, a screen's are its own.
 */
function planOf(table) {
  if (plans.has(table)) return plans.get(table);
  const calculated = table.fields.filter((field) => !field.obsolete && isCalculated(field));
  const byKey = new Map(calculated.map((field) => [field.key, { field, source: tableFormulaToNames(field.options.formula, table) }]));
  const usesOf = (key) => fieldsIn(byKey.get(key)?.source ?? "", { bareTable: "_" }).map(([, name]) => name).filter((name) => byKey.has(name));
  const ordered = [];
  const placed = new Set();
  const place = (key, visiting = new Set()) => {
    if (placed.has(key) || visiting.has(key)) return; // a cycle never saves (checkCalculated)
    visiting.add(key);
    for (const used of usesOf(key)) place(used, visiting);
    placed.add(key);
    ordered.push(byKey.get(key));
  };
  byKey.forEach((_entry, key) => place(key));
  const schema = celSchema(table);
  const plan = ordered.map(({ field, source }) => {
    let run = null;
    try {
      if (!cycleFrom(field.key, usesOf)) run = environmentFor(schema).parse(source.slice(1));
    } catch {
      run = null;
    }
    return { field, source, run };
  });
  plans.set(table, plan);
  return plan;
}

/**
 * A worked-out value as its field's type keeps it, or null when the formula gave something else: a date that isn't
 * one, or a text longer than a text field holds.
 */
function typed(field, value) {
  const plain = plainValue(value);
  if (["number", "money"].includes(field.type)) {
    if (typeof plain !== "number" || !Number.isFinite(plain)) return null;
    return field.type === "money" ? Math.round(plain) + 0 : plain; // money is kept in whole cents (+ 0: never -0)
  }
  if (field.type === "yesno") return typeof plain === "boolean" ? plain : null;
  if (typeof plain !== "string") return null;
  if (field.type === "date") return DATE.test(plain) ? plain : null;
  return plain.length <= TEXT_MAX ? plain : null;
}

/**
 * Works out a table's calculated fields for one record as formulas see it (by field name, as
 * formulaRecord gives it), adding each value by name; a formula that fails gives null ("—"), and so
 * do the fields worked out from it. With `asFormulas`, for a formula's own record, such a value is
 * its type's empty value instead, as formulaRecord gives an empty field. Returns the same object.
 */
export function calculate(table, values, { asFormulas = false } = {}) {
  const plan = planOf(table);
  for (const { field, run } of plan) {
    try {
      values[field.key] = run ? typed(field, run(values)) : null;
    } catch {
      values[field.key] = null;
    }
  }
  if (asFormulas) for (const { field } of plan) values[field.key] = formulaValue(field, values[field.key]);
  return values;
}

/** A record by field id (as the data gate holds it) with its calculated values worked out, by id. */
export function withCalculated(table, record) {
  const plan = planOf(table);
  if (!plan.length) return record;
  const values = { id: String(record.id) };
  for (const field of table.fields) if (!field.obsolete && !isCalculated(field)) values[field.key] = formulaValue(field, record[field.id]);
  calculate(table, values);
  for (const { field } of plan) record[field.id] = values[field.key];
  return record;
}

/**
 * The fields a calculated field is worked out from, by name, through other calculated fields too:
 * what a visitor must be able to read to read it (D-66).
 */
export function calculatedFrom(table, field) {
  const out = new Set();
  const visit = (current, seen = new Set()) => {
    if (seen.has(current.id)) return;
    seen.add(current.id);
    for (const id of idsUsed(current.options.formula)) {
      const used = table.fields.find((entry) => entry.id === id && !entry.obsolete);
      if (!used) continue;
      if (isCalculated(used)) visit(used, seen);
      else out.add(used.key);
    }
  };
  if (isCalculated(field)) visit(field);
  return [...out];
}

/** The live calculated fields of `table` that use `fieldId`, directly or through other calculated fields. */
export function calculatedUsing(table, fieldId) {
  const byId = new Map(table.fields.map((field) => [field.id, field]));
  const reaches = (field, seen) => {
    if (seen.has(field.id)) return false;
    seen.add(field.id);
    return idsUsed(field.options.formula).some((id) => id === fieldId || (isCalculated(byId.get(id)) && reaches(byId.get(id), seen)));
  };
  return table.fields.filter((field) => !field.obsolete && isCalculated(field) && field.id !== fieldId && reaches(field, new Set()));
}

/**
 * The check of a calculated field before it's saved: `table` holds every field the table will have,
 * this one included, its formula by names. Returns { formula } by ids to store, or { error } naming
 * what is wrong: an unknown or removed field, a function a table can't use, a result of the wrong
 * type, or a chain of fields that comes back to this one.
 */
export function checkCalculated(table, field) {
  const source = field.options?.formula;
  if (!CALCULATED_TYPES.includes(field.type)) {
    return { error: `a calculated field is ${CALCULATED_TYPES.join(", ")}, never ${field.type}: its type says how the value shows.` };
  }
  if (!isFormula(source) || source.trim() === "=") {
    return { error: 'its formula starts with "=" and uses the record\'s other fields by name, e.g. "=price * quantity".' };
  }
  const slow = callsIn(source, { methods: true }).find(({ name }) => SLOW.has(name));
  if (slow) {
    return { error: `a calculated field can't use ${slow.name}: it is worked out for every record shown, and ${slow.name} can take very long on a long text.` };
  }
  const { formula, errors } = tableFormulaToIds(source, table);
  if (errors.length) return { error: errors[0] };
  const result = checkFormula(celSchema(table), source);
  if (result.error) {
    const called = /^found no matching overload for '(\w+)\(/u.exec(result.error)?.[1];
    if (called && !BUILT_IN_FUNCTIONS.has(called)) {
      return { error: `a calculated field can use only the record's fields and the built-in functions, not "${called}": it belongs to every app of the home.` };
    }
    return { error: result.error };
  }
  if (result.type !== "dyn" && !RESULTS[field.type].includes(result.type)) {
    return { error: `a ${field.type} field's formula gives ${RESULT_WORDS[field.type]}, but this one gives ${result.type}.` };
  }
  const stored = table.fields.map((entry) => (entry.id === field.id ? { ...entry, options: { ...entry.options, formula } } : entry));
  const usesOf = (id) => {
    const current = stored.find((entry) => entry.id === id);
    return isCalculated(current) && !current.obsolete ? idsUsed(current.options.formula) : [];
  };
  const cycle = cycleFrom(field.id, usesOf);
  if (cycle) {
    const keyOf = (id) => stored.find((entry) => entry.id === id)?.key ?? id;
    return { error: `${field.key} can't be worked out from itself: ${cycle.map(keyOf).join(" → ")}.` };
  }
  return { formula };
}
