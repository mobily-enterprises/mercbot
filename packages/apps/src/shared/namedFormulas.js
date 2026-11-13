import { callsIn, closest, cycleFrom, isObject } from "./definitions.js";
import { BUILT_IN_FUNCTIONS, checkFormula, evaluateFormula, isFormula, jsonValue } from "./formulas.js";

// Named formulas (D-78): an app's own small formulas with parameters, in its definition's `formulas`,
// callable by name from any formula of the app, as its script functions are:
//
//   "formulas": { "with_vat": { "params": ["amount"], "formula": "=amount * 1.2" } }   →   "=with_vat(row.price)"
//
// A named formula sees only its parameters (and the built-in functions, the app's other named formulas
// and its script functions). It never calls itself, even through others: the save check refuses a
// cycle, so every formula still finishes. Values go in and come out as script functions' do: numbers
// as doubles.
const NAME = /^[a-z][a-z0-9_]{0,63}$/u;
const LIMITS = { formulas: 30, params: 8 };
// A stored definition is checked before it's saved; this only stops one that got past the check.
const MAX_DEPTH = 32;
// The most named formulas one call sets off, itself included. None calls itself, but formulas that each call the next
// a few times multiply: twice a level for 20 levels is a million calls, seconds of the server's time on every use.
const MAX_CALLS = 1000;
// Names a formula or parameter can't take: what formulas already mean by them, and CEL's own words.
const TAKEN = new Set(["state", "params", "data", "row", "form", "user", "visitor", "today", "now", "id", "true", "false", "null",
  "in", "as", "break", "const", "continue", "else", "for", "function", "if", "import", "let", "loop", "package", "namespace",
  "return", "var", "void", "while"]);

/** The well-formed entries of an app's `formulas`, as [name, { params, formula }]. */
function entriesOf(formulas) {
  const named = (name) => NAME.test(name) && !TAKEN.has(name) && !BUILT_IN_FUNCTIONS.has(name);
  return Object.entries(isObject(formulas) ? formulas : {})
    .filter(([name, entry]) => named(name) && isObject(entry) && isFormula(entry.formula))
    .map(([name, entry]) => [name, { params: Array.isArray(entry.params) ? entry.params.map(String) : [], formula: entry.formula }]);
}

/** A short, stable fingerprint of a text, for the formula environments' cache keys. */
function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(36);
}

/**
 * An app's formula functions with its named formulas added: `base` are its script functions
 * ({ id, list: [{ name, arity, call }] }, or null), and the answer has the same shape, so formulas
 * everywhere (screens, a draft being tried, the browser) call both alike. A named formula a script
 * function or a built-in already names is left out.
 */
export function withNamedFormulas(formulas, base = null) {
  const taken = new Set((base?.list ?? []).map((fn) => fn.name));
  const entries = entriesOf(formulas).filter(([name]) => !taken.has(name));
  if (!entries.length) return base;
  const functions = { id: `${base?.id ?? ""}|formulas:${fingerprint(JSON.stringify(entries))}`, list: [...(base?.list ?? [])] };
  // Formulas run one at a time (CEL and script functions are synchronous), so one count serves every call.
  let depth = 0;
  let calls = 0;
  for (const [name, { params, formula }] of entries) {
    const variables = Object.fromEntries(params.map((param) => [param, "dyn"]));
    functions.list.push({
      name,
      arity: params.length,
      call: (...args) => {
        if (depth >= MAX_DEPTH) throw new Error(`${name}: formulas call each other more than ${MAX_DEPTH} deep.`);
        calls = depth === 0 ? 1 : calls + 1;
        if (calls > MAX_CALLS) throw new Error(`${name}: one use of a formula sets off more than ${MAX_CALLS} named formulas.`);
        depth += 1;
        try {
          const values = Object.fromEntries(params.map((param, index) => [param, args[index] ?? null]));
          return jsonValue(evaluateFormula(variables, formula, values, functions));
        } finally {
          depth -= 1;
        }
      }
    });
  }
  return functions;
}

/**
 * The functions a save check gives formulas: the app's named formulas and its script functions
 * (`scripts`, [{ key, kind, params }]) by name and number of values, standing in for the real ones.
 */
export function functionsForCheck(formulas, scripts) {
  const scriptList = (scripts || [])
    .filter((script) => script.kind === "function")
    .map((script) => ({ name: script.key, arity: script.params?.length || 0, call: () => null }));
  const taken = new Set(scriptList.map((fn) => fn.name));
  const named = entriesOf(formulas)
    .filter(([name]) => !taken.has(name))
    .map(([name, { params }]) => ({ name, arity: params.length, call: () => null }));
  const list = [...scriptList, ...named];
  return list.length ? { id: `check:${list.map((fn) => `${fn.name}/${fn.arity}`).join(",")}`, list } : null;
}

/**
 * What's wrong with a formula's calls, in words, or null: a name that is no function or formula, or
 * the wrong number of values. `known` maps each formula or function the formula may call to its
 * parameters' names (built-ins aside). The save check says this instead of CEL's "no matching overload".
 */
export function callProblem(source, known) {
  for (const { name, count } of callsIn(source)) {
    if (BUILT_IN_FUNCTIONS.has(name)) continue;
    if (!known.has(name)) {
      const names = [...known.keys()];
      return `there is no formula or function "${name}".${closest(name, names)} This app's: ${names.join(", ") || "none"}.`;
    }
    const params = known.get(name);
    if (params.length !== count) {
      return `"${name}" takes ${params.length} value${params.length === 1 ? "" : "s"}${params.length ? ` (${params.join(", ")})` : ""}, not ${count}.`;
    }
  }
  return null;
}

/**
 * What's wrong with a filter's calls, or null: a filter runs in the database, so it calls only the
 * built-in functions, never the app's formulas or script functions (`known`).
 */
export function filterCallProblem(source, known) {
  const called = callsIn(source).find(({ name }) => known.has(name));
  if (called) return `a filter runs in the database, so it can't call "${called.name}": filter on the fields themselves.`;
  return callProblem(source, new Map());
}

/** An app's formulas and script functions by name, with their parameters' names, for callProblem. */
export function knownCalls(formulas, scripts) {
  const known = new Map((scripts || []).filter((script) => script.kind === "function").map((script) => [script.key, (script.params || []).map(String)]));
  for (const [name, { params }] of entriesOf(formulas)) if (!known.has(name)) known.set(name, params);
  return known;
}

/**
 * The save check of an app's `formulas` (definition by names): their names and parameters, each
 * formula's calls and types, and no formula that calls itself, even through others. `report(path,
 * message)` collects refusals; `scripts` as for checkApp, or null when unknown.
 */
export function checkNamedFormulas(definition, { scripts, report }) {
  const formulas = definition.formulas;
  if (formulas === undefined) return;
  if (!isObject(formulas)) return report("formulas", 'is an object of named formulas, e.g. { "with_vat": { "params": ["amount"], "formula": "=amount * 1.2" } }.');
  const names = Object.keys(formulas);
  if (names.length > LIMITS.formulas) report("formulas", `At most ${LIMITS.formulas} named formulas.`);
  const scriptNames = new Set((scripts || []).filter((script) => script.kind === "function").map((script) => script.key));
  for (const [name, entry] of Object.entries(formulas)) {
    const at = `formulas.${name}`;
    if (!NAME.test(name)) report(at, "A formula's name uses a–z, 0–9 and _, starting with a letter.");
    else if (TAKEN.has(name) || BUILT_IN_FUNCTIONS.has(name)) report(at, `"${name}" already means something in formulas; choose another name.`);
    else if (scriptNames.has(name)) report(at, `this app has a script function called "${name}"; choose another name.`);
    if (!isObject(entry)) {
      report(at, 'is { "params": [<names>], "formula": "=<formula over them>" }.');
      continue;
    }
    for (const key of Object.keys(entry)) if (!["params", "formula"].includes(key)) report(`${at}.${key}`, `"${key}" isn't a setting of a formula; it has params and formula.`);
    const params = entry.params ?? [];
    if (!Array.isArray(params) || params.length > LIMITS.params || params.some((param) => typeof param !== "string" || !NAME.test(param) || TAKEN.has(param))) {
      report(`${at}.params`, `lists up to ${LIMITS.params} parameter names (a–z, 0–9 and _, starting with a letter; not row, form, data, state, params or visitor).`);
    } else if (new Set(params).size !== params.length) {
      report(`${at}.params`, "names each parameter once.");
    }
    if (!isFormula(entry.formula)) report(`${at}.formula`, 'is a formula over its parameters, starting with "=", e.g. "=amount * 1.2".');
  }
  const entries = entriesOf(formulas).filter(([name]) => !scriptNames.has(name));
  const known = knownCalls(formulas, scripts);
  const functions = functionsForCheck(formulas, scripts);
  for (const [name, { params, formula }] of entries) {
    const at = `formulas.${name}.formula`;
    const problem = callProblem(formula, known);
    if (problem) {
      report(at, problem);
      continue;
    }
    const result = checkFormula(Object.fromEntries(params.map((param) => [param, "dyn"])), formula, functions);
    if (result.error) {
      const unknown = /^Unknown variable: (\w+)/u.exec(result.error)?.[1];
      report(at, unknown
        ? `a formula sees only its parameters (${params.join(", ") || "none"}), so "${unknown}" isn't known here: pass it in, e.g. ${name}(row.${unknown}).`
        : result.error);
    }
  }
  const named = new Set(entries.map(([name]) => name));
  const callsOf = (name) => callsIn(formulas[name].formula).map((call) => call.name).filter((called) => named.has(called));
  const reported = new Set();
  for (const name of named) {
    const cycle = cycleFrom(name, callsOf);
    if (!cycle || cycle.some((step) => reported.has(step))) continue;
    cycle.forEach((step) => reported.add(step));
    report(`formulas.${name}.formula`, `${name} calls itself: ${cycle.join(" → ")}. A formula can't call itself, even through others.`);
  }
}
