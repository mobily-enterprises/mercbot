import { VISITOR, celSchema, checkFormula, isFixedFormula, isFormula } from "./formulas.js";
import { calculatedFrom, isCalculated } from "./calculated.js";
import { closest, fieldsIn, toIds } from "./definitions.js";
import { callProblem, checkNamedFormulas, filterCallProblem, functionsForCheck, knownCalls } from "./namedFormulas.js";
import { checkVisitorAccess } from "./visitorAccess.js";
import { compileWhere } from "./where.js";

// The save check (D-35): an app is saved only when every part, setting, table, field, screen and
// formula is known and well typed, and every list filter can become SQL. Errors name the exact
// place, so the Builder can fix them. The definition here uses names, as the Builder writes it.
const CATALOG = {
  row: ["content"],
  grid: ["columns", "content"],
  text: ["value", "size"],
  chip: ["value", "tone"],
  spacer: [],
  button: ["label", "icon", "emphasis", "disabled", "do"],
  input: ["bind", "label", "icon", "inputType"],
  table: ["rows", "columns", "onRowClick", "rowActions"],
  field: ["label", "value"],
  form: ["record", "table", "fields", "buttons"],
  totals: ["label", "rows"],
  chart: ["label", "kind", "rows", "measure"],
  tabs: ["tabs"],
  dialog: ["key", "title", "content"],
  view: ["view", "copy", "screen", "params"]
};
// What a view (D-55) and an app's copy of one may hold: parts that only show things.
const READ_ONLY = {
  row: CATALOG.row,
  grid: CATALOG.grid,
  text: CATALOG.text,
  chip: CATALOG.chip,
  spacer: CATALOG.spacer,
  input: CATALOG.input,
  table: ["rows", "columns"],
  field: CATALOG.field,
  totals: CATALOG.totals,
  chart: CATALOG.chart,
  tabs: CATALOG.tabs
};
const READ_ONLY_QUERY = new Set(["record", "from", "id", "where", "sort", "limit", "groupBy", "sum", "avg", "grandTotal"]);
const VIEW_SETTINGS = new Set(["params", "state", "data", "content", "style"]);
const STEPS = ["go", "create", "update", "markObsolete", "notify", "openDialog", "closeDialog", "askBot", "runScript"];
export const ICONS = [
  "search",
  "edit",
  "back",
  "save",
  "add",
  "open",
  "check",
  "close",
  "person",
  "mail",
  "phone",
  "calendar",
  "chart",
  "star"
];
const CHOICES = {
  size: ["headline", "title", "body"],
  tone: ["success", "neutral", "warning", "danger", "primary"],
  emphasis: ["primary", "subtle"],
  icon: ICONS,
  inputType: ["text", "number"],
  kind: ["bar", "line", "pie"],
  measure: ["count", "total"]
};
const STATE_TYPES = { string: "string", double: "double", bool: "bool" };
const BOOLEAN_SETTINGS = new Set(["showIf", "disabled", "required"]);
const DATA_REFERENCE = /^=data\.(\w+)$/u;
const KEY = /^[a-z][a-z0-9_-]{0,63}$/u;
const LIMITS = { screens: 40, nodes: 400, depth: 12, queries: 12, views: 6, rows: 100 };

/**
 * `bots`, when given, are the names of the home's bots, for hand-off steps. `scripts`, when given,
 * are the app's scripts ([{ key, kind, params }]): buttons and queries must name one of the right
 * kind, and formulas may call its functions. `views`, when given, are the home's views
 * ([{ key, params }]), for view parts. `readOnly` holds every screen to the parts of a view.
 */
export function checkApp(definition, tables, { bots = null, scripts = null, views = null, readOnly = false } = {}) {
  const errors = [];
  const report = (path, message) => errors.push({ path, message });
  const live = tables.filter((table) => !table.obsolete);
  const tableNamed = (name) => live.find((table) => table.key === name);

  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    return [{ path: "", message: "An app must be an object with screens." }];
  }
  const screens = definition.screens;
  if (!screens || typeof screens !== "object" || !Object.keys(screens).length) {
    return [{ path: "screens", message: "An app needs at least one screen." }];
  }
  const screenKeys = Object.keys(screens);
  if (screenKeys.length > LIMITS.screens) report("screens", `At most ${LIMITS.screens} screens.`);
  for (const key of screenKeys) if (!KEY.test(key)) report(`screens.${key}`, "Screen names use a–z, 0–9, _ and -, starting with a letter.");
  if (!screens[definition.home]) report("home", `"${definition.home ?? ""}" must name one of the screens: ${screenKeys.join(", ")}.`);
  if (screens[definition.home]?.copiedFrom) report("home", "a copy of a view can't be the app's first screen.");
  if (definition.navigation) {
    const { style, items } = definition.navigation;
    if (!["rail", "tabs"].includes(style)) report("navigation.style", "must be rail or tabs.");
    (items || []).forEach((item, index) => {
      if (!screens[item.screen]) report(`navigation.items[${index}].screen`, `screen "${item.screen}" doesn't exist.`);
      if (screens[item.screen]?.copiedFrom) report(`navigation.items[${index}].screen`, "a copy of a view shows inside a screen, not on its own.");
      if (typeof item.label !== "string" || !item.label.trim()) report(`navigation.items[${index}].label`, "needs a label.");
      if (item.icon !== undefined && !ICONS.includes(item.icon)) {
        report(`navigation.items[${index}].icon`, `must be one of: ${ICONS.join(", ")}`);
      }
    });
  }

  // Unknown tables and fields, with suggestions. Formulas at these paths aren't type-checked again.
  const { errors: nameErrors } = toIds(definition, tables);
  const reported = new Set();
  for (const error of nameErrors) {
    if (reported.has(`${error.path}|${error.message}`)) continue;
    reported.add(`${error.path}|${error.message}`);
    report(error.path, error.message);
  }
  const named = new Set(nameErrors.map((error) => error.path));

  // Public screens: `public.home` is where visitors start, and it must be a public screen.
  const publicScreens = screenKeys.filter((key) => screens[key]?.public === true);
  if (definition.public !== undefined || publicScreens.length) {
    if (!publicScreens.length) {
      report("public", 'no screen is public; mark one with "public": true.');
    } else if (!publicScreens.includes(definition.public?.home)) {
      report("public.home", `must name a public screen: ${publicScreens.join(", ")}.`);
    }
    checkPublicRules(definition, { tables, tableNamed, report });
  }

  // The app's named formulas (D-78), callable like its script functions from every formula below.
  checkNamedFormulas(definition, { scripts, report });
  const functions = functionsForCheck(definition.formulas, scripts);
  const known = knownCalls(definition.formulas, scripts);
  for (const [screenKey, screen] of Object.entries(screens)) {
    checkScreen(`screens.${screenKey}`, screen, { screens, tableNamed, report, named, bots, scripts, views, readOnly, functions, known });
    if (screen?.public === true) checkPublicScreen(`screens.${screenKey}`, screen, { screens, report, tableNamed });
  }
  return errors;
}

// How visitors of an app that asks them to sign in may do it (owner, 2026-10-29); "code" by default.
const SIGN_IN_METHODS = ["code", "link", "google", "microsoft", "github"];
// Visitors (D-35, owner 2026-10-29): how they sign in, and what each table lets them reach (visitor
// access, D-66: shared/visitorAccess.js).
function checkPublicRules(definition, { tables, tableNamed, report }) {
  const rules = definition.public || {};
  if (rules.signIn !== undefined && !["none", "required"].includes(rules.signIn)) report("public.signIn", "must be none or required.");
  if (rules.signInWith !== undefined) {
    if (
      !Array.isArray(rules.signInWith) ||
      !rules.signInWith.length ||
      !rules.signInWith.every((method) => SIGN_IN_METHODS.includes(method))
    ) {
      report("public.signInWith", `lists one or more of: ${SIGN_IN_METHODS.join(", ")}.`);
    }
    if (rules.signIn !== "required") report("public.signInWith", "only applies when signIn is required.");
  }
  if (rules.tables !== undefined && !(rules.tables && typeof rules.tables === "object" && !Array.isArray(rules.tables))) {
    return report("public.tables", 'lists what visitors may reach, table by table, e.g. { "leads": { "can": ["create"], "write": ["name", "email"] } }.');
  }
  checkVisitorAccess(definition, tables, { tableNamed, report });
}

/**
 * A public screen never wakes a bot and never marks records obsolete; it can only go to other
 * public screens. A visitor adds through a create form and edits through an edit form, exactly the
 * fields shown. What it reaches is checked against visitor access above.
 */
function checkPublicScreen(base, screen, { screens, report, tableNamed }) {
  const steps = (path, list, form) => (list || []).forEach((step, index) => {
    const [kind] = Object.keys(step || {});
    const at = `${path}[${index}]`;
    if (kind === "go") {
      if (screens[step.go?.screen] && screens[step.go.screen].public !== true) {
        report(`${at}.go.screen`, "a public screen can only go to another public screen.");
      }
    } else if (kind === "create") {
      if (!form?.table) {
        report(at, "on a public screen, only a create form's button can add a record.");
      } else if (step.create?.table !== form.table) {
        report(`${at}.create.table`, `must be the form's table, ${form.table}.`);
      }
      if (step.create?.values !== "=form.values") {
        report(`${at}.create.values`, 'on a public screen, a form adds exactly what it shows: "=form.values".');
      }
      // Fixed values the app sets (never the visitor), and every required field must be covered.
      const preset = step.create?.preset || {};
      for (const [name, value] of Object.entries(preset)) {
        if ((isFormula(value) && !isFixedFormula(value)) || (value !== null && typeof value === "object")) {
          report(
            `${at}.create.preset.${name}`,
            'a preset is a fixed value, or "=today()" / "=now()"; it can\'t read the form or the visitor.'
          );
        }
      }
      const shown = new Set((form?.fields || []).map((entry) => (typeof entry === "string" ? entry : entry?.field)));
      for (const field of (tableNamed(form?.table)?.fields || []).filter((entry) => !entry.obsolete && entry.options?.required)) {
        if (!shown.has(field.key) && !(field.key in preset)) {
          report(
            `${at}.create`,
            `${field.key} is required: show it in the form, or give it a fixed value in preset, e.g. "preset": { "${field.key}": ` +
              `${field.type === "choice" ? JSON.stringify(field.options?.choices?.[0] ?? "") : '"…"'} }.`
          );
        }
      }
    } else if (kind === "update") {
      if (!form?.record || step.update?.record !== form.record) {
        report(at, "on a public screen, only an edit form's button can change its record.");
      }
      if (step.update?.set !== "=form.values") {
        report(`${at}.update.set`, 'on a public screen, a form saves exactly what it shows: "=form.values".');
      }
    } else if (!["notify", "openDialog", "closeDialog"].includes(kind)) {
      report(
        at,
        "on a public screen, steps can go, notify, open or close a dialog, or save a form; never ask a bot or mark records obsolete."
      );
    }
  });
  const nodes = (path, list, form = null) => (list || []).forEach((node, index) => {
    const at = `${path}[${index}]`;
    if (node?.type === "input") return;
    if (node?.type === "view") report(at, "a public screen can't show a view yet.");
    steps(`${at}.do`, node?.do, form);
    steps(`${at}.onRowClick`, node?.onRowClick, form);
    nodes(`${at}.rowActions`, node?.rowActions, form);
    nodes(`${at}.content`, node?.content, form);
    (node?.tabs || []).forEach((tab, tabIndex) => nodes(`${at}.tabs[${tabIndex}].content`, tab?.content, form));
    if (node?.type === "form") nodes(`${at}.buttons`, node.buttons, node);
  });
  nodes(`${base}.content`, screen.content);
}

/**
 * Why a query setting can't name a calculated field (D-78): filters, sorting and grouping run in the
 * database, where it isn't stored.
 */
function calculatedRefusal(table, name, doing) {
  const field = table.fields.find((entry) => !entry.obsolete && entry.key === name);
  if (!isCalculated(field)) return null;
  const from = calculatedFrom(table, field);
  return `"${name}" is a calculated field, and ${doing} runs in the database, where it isn't stored, so it can't use it yet.` +
    `${from.length ? ` Use the fields it's worked out from (${from.join(", ")}), or show it in a column.` : ""}`;
}

function checkScreen(base, screen, { screens, tableNamed, report, named, bots, scripts, views, readOnly, functions, known }) {
  const onlyShows = readOnly || Boolean(screen.copiedFrom);
  const catalog = onlyShows ? READ_ONLY : CATALOG;
  const script = (path, key, kind) => {
    if (typeof key !== "string" || !key) return report(path, `must name a ${kind} script of this app.`);
    if (scripts && !scripts.some((entry) => entry.key === key && entry.kind === kind)) {
      report(
        path,
        `this app has no ${kind} script "${key}". ${kind === "source" ? "Data" : "Button"} scripts: ${
          scripts
            .filter((entry) => entry.kind === kind)
            .map((entry) => entry.key)
            .join(", ") || "none"
        }.`
      );
    }
  };
  // Definitions come from a model: a wrong shape is reported here, and treated as absent below.
  const anObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  for (const name of ["state", "params", "data"]) {
    if (screen[name] !== undefined && !anObject(screen[name])) report(`${base}.${name}`, `must be an object of named ${name === "data" ? "queries" : "values"}.`);
  }
  const screenState = anObject(screen.state) ? screen.state : {};
  const screenParams = anObject(screen.params) ? screen.params : {};
  const screenData = anObject(screen.data) ? screen.data : {};
  const state = Object.fromEntries(Object.entries(screenState).map(([name, def]) => {
    if (!STATE_TYPES[def?.type]) report(`${base}.state.${name}`, "type must be string, double or bool.");
    return [name, STATE_TYPES[def?.type] || "string"];
  }));
  const params = Object.fromEntries(Object.keys(screenParams).map((name) => [name, "string"]));
  const queries = Object.entries(screenData).filter(([name, query]) => {
    if (!anObject(query)) report(`${base}.data.${name}`, 'must be a query, such as { "from": "<table>" }.');
    return anObject(query);
  });
  if (queries.length > LIMITS.queries) report(`${base}.data`, `At most ${LIMITS.queries} queries per screen.`);
  const data = {};
  for (const [name, query] of queries) {
    const table = tableNamed(query.record || query.from);
    data[name] = query.script ? "dyn" : query.record && table ? celSchema(table) : "list";
  }
  // Public screens can also read who the visitor is.
  const pageVariables = { state, params, data, ...(screen.public === true ? { visitor: VISITOR } : {}) };

  const formula = (path, value, variables, expected, { noFunctions = false } = {}) => {
    if (!isFormula(value) || named.has(path)) return;
    const result = checkFormula(variables, value, noFunctions ? null : functions);
    if (result.error) {
      // An unknown name or the wrong number of values, said plainly (CEL says "no matching overload").
      report(path, (noFunctions ? filterCallProblem(value, known) : callProblem(value, known)) || result.error);
    } else if (expected && result.type !== expected && result.type !== "dyn") {
      report(path, `must be ${expected}, but this formula gives ${result.type}.`);
    }
  };

  for (const [name, query] of queries) {
    const path = `${base}.data.${name}`;
    if (onlyShows) {
      if (query.script !== undefined) {
        report(`${path}.script`, "a view can't run scripts; it reads the home's tables.");
        continue;
      }
      for (const key of Object.keys(query)) if (!READ_ONLY_QUERY.has(key)) report(`${path}.${key}`, `"${key}" isn't a setting of a query.`);
    }
    // A script's data: its input formulas see the page (state, params, visitor), never records.
    if (query.script !== undefined) {
      if (query.record || query.from) report(path, "a query has one of record, from or script.");
      script(`${path}.script`, query.script, "source");
      for (const key of Object.keys(query)) {
        if (!["script", "input"].includes(key)) report(`${path}.${key}`, "a script query has only script and input.");
      }
      if (query.input !== undefined && (typeof query.input !== "object" || Array.isArray(query.input) || query.input === null)) {
        report(`${path}.input`, 'is an object of values or formulas, e.g. { "search": "=state.search" }.');
      }
      for (const [key, value] of Object.entries(query.input || {})) {
        formula(`${path}.input.${key}`, value, { state, params, ...(screen.public === true ? { visitor: VISITOR } : {}) });
      }
      continue;
    }
    if (Boolean(query.record) === Boolean(query.from)) report(path, "needs exactly one of record or from.");
    const table = tableNamed(query.record || query.from);
    if (!table) continue;
    if (query.record) {
      if (!isFormula(query.id)) report(`${path}.id`, "a single-record query needs an id formula, e.g. \"=params.id\".");
      formula(`${path}.id`, query.id, { state, params }, "string");
    }
    if (query.where && !named.has(`${path}.where`)) {
      const variables = { ...celSchema(table), state, params };
      formula(`${path}.where`, query.where, variables, "bool", { noFunctions: true });
      try {
        compileWhere(variables, query.where);
      } catch (error) {
        report(`${path}.where`, error.message);
      }
      for (const name of new Set(fieldsIn(query.where, { bareTable: table.key }).map(([, used]) => used))) {
        const refusal = calculatedRefusal(table, name, "a filter");
        if (refusal) report(`${path}.where`, refusal);
      }
    }
    if (typeof query.sort === "string") {
      const refusal = calculatedRefusal(table, query.sort.replace(/^-/u, ""), "sorting");
      if (refusal) report(`${path}.sort`, refusal);
    }
    if (typeof query.groupBy === "string") {
      const refusal = calculatedRefusal(table, query.groupBy, "grouping");
      if (refusal) report(`${path}.groupBy`, refusal);
    }
    if (query.limit !== undefined) {
      if (!query.from || query.groupBy) report(`${path}.limit`, "only a list has a limit.");
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > LIMITS.rows) {
        report(`${path}.limit`, `must be a whole number from 1 to ${LIMITS.rows}.`);
      }
    }
    if (query.grandTotal !== undefined) {
      if (typeof query.grandTotal !== "boolean") report(`${path}.grandTotal`, "must be true or false.");
      if (!query.groupBy) report(`${path}.grandTotal`, "needs groupBy.");
    }
    if (query.sum && query.avg) report(path, "use sum or avg, not both.");
    for (const key of ["sum", "avg"]) {
      const field = table.fields.find((entry) => entry.key === query[key]);
      if (query[key] && field && !["number", "money"].includes(field.type)) {
        report(`${path}.${key}`, `"${query[key]}" must be a number or money field.`);
      }
      if (query[key] && !query.groupBy) report(`${path}.${key}`, "needs groupBy.");
    }
  }

  const records = (reference, kind, path) => {
    const name = DATA_REFERENCE.exec(String(reference || ""))?.[1];
    const query = name && screenData[name];
    if (!anObject(query)) {
      report(path, "must be \"=data.<query>\" naming a query of this screen.");
      return null;
    }
    if (kind === "list" && query.script) return null; // a script's rows: fields as the script names them
    if (kind === "record" ? !query.record : !query.from) report(path, `must name a ${kind === "record" ? "single-record" : "list"} query.`);
    return tableNamed(query.record || query.from) || null;
  };

  const dialogs = new Set();
  const collectDialogs = (nodes) => (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (node?.type === "dialog" && node.key) dialogs.add(node.key);
    collectDialogs(node?.content);
    (Array.isArray(node?.tabs) ? node.tabs : []).forEach((tab) => collectDialogs(tab?.content));
  });
  collectDialogs(screen.content);

  // A calculated field (D-78) is worked out from the record's other fields; a step never sets one.
  const notSettable = (table, values, path) => {
    if (!table || !values || typeof values !== "object") return;
    for (const name of Object.keys(values)) {
      if (isCalculated(table.fields.find((field) => !field.obsolete && field.key === name))) {
        report(`${path}.${name}`, `"${name}" is a calculated field, worked out from the record's other fields, so a step can't set it.`);
      }
    }
  };

  const checkSteps = (path, steps, variables) => {
    if (steps === undefined) return;
    if (!Array.isArray(steps)) return report(path, "must be a list of steps.");
    steps.forEach((step, index) => {
      const at = `${path}[${index}]`;
      const kinds = Object.keys(step || {});
      if (kinds.length !== 1 || !STEPS.includes(kinds[0])) return report(at, `must be one of: ${STEPS.join(", ")}.`);
      const [kind] = kinds;
      const value = step[kind];
      if (kind === "go") {
        const target = screens[value?.screen];
        if (!target) return report(`${at}.go.screen`, `screen "${value?.screen}" doesn't exist.`);
        if (target.copiedFrom) return report(`${at}.go.screen`, "a copy of a view shows inside a screen, not on its own.");
        for (const [name, setting] of Object.entries(value.params || {})) {
          if (!target.params?.[name]) report(`${at}.go.params.${name}`, `screen "${value.screen}" has no parameter "${name}".`);
          formula(`${at}.go.params.${name}`, setting, variables, "string");
        }
        for (const name of Object.keys(target.params || {})) {
          if (!(name in (value.params || {}))) report(`${at}.go.params`, `screen "${value.screen}" needs "${name}".`);
        }
      }
      if (kind === "update") {
        const target = records(value?.record, "record", `${at}.update.record`);
        if (typeof value?.set === "string") {
          formula(`${at}.update.set`, value.set, variables, "map");
        } else {
          for (const [name, setting] of Object.entries(value?.set || {})) formula(`${at}.update.set.${name}`, setting, variables);
          notSettable(target, value?.set, `${at}.update.set`);
        }
      }
      if (kind === "create") {
        if (!tableNamed(value?.table) && !named.has(`${at}.create.table`)) report(`${at}.create.table`, "needs an existing table.");
        if (typeof value?.values === "string") {
          formula(`${at}.create.values`, value.values, variables, "map");
        } else {
          for (const [name, setting] of Object.entries(value?.values || {})) formula(`${at}.create.values.${name}`, setting, variables);
          notSettable(tableNamed(value?.table), value?.values, `${at}.create.values`);
        }
        notSettable(tableNamed(value?.table), value?.preset, `${at}.create.preset`);
      }
      if (kind === "markObsolete") records(value?.record, "record", `${at}.markObsolete.record`);
      if (kind === "notify") formula(`${at}.notify`, value, variables, "string");
      if (kind === "askBot") {
        if (typeof value?.bot !== "string" || !value.bot.trim()) {
          report(`${at}.askBot.bot`, "must name a bot of this home.");
        } else if (bots && !bots.includes(value.bot)) {
          report(`${at}.askBot.bot`, `there's no bot called "${value.bot}" in this home. Bots: ${bots.join(", ") || "none"}.`);
        }
        if (!isFormula(value?.task)) {
          report(`${at}.askBot.task`, 'must be a formula giving the task in words, like ="Look up " + row.name.');
        } else {
          formula(`${at}.askBot.task`, value.task, variables, "string");
        }
      }
      if (kind === "openDialog" && !dialogs.has(value)) report(`${at}.openDialog`, `there is no dialog "${value}" on this screen.`);
      if (kind === "runScript") {
        script(`${at}.runScript.script`, value?.script, "action");
        if (value?.input !== undefined && (typeof value.input !== "object" || Array.isArray(value.input) || value.input === null)) {
          report(`${at}.runScript.input`, 'is an object of values or formulas, e.g. { "id": "=row.id" }.');
        }
        for (const [key, setting] of Object.entries(value?.input || {})) formula(`${at}.runScript.input.${key}`, setting, variables);
        for (const key of Object.keys(value || {})) {
          if (!["script", "input"].includes(key)) report(`${at}.runScript.${key}`, "runScript has only script and input.");
        }
      }
    });
  };

  // A view inside this screen: a shared view by its key, or this app's own copy of one by its screen.
  let viewParts = 0;
  const checkViewPart = (path, node, variables) => {
    viewParts += 1;
    if (viewParts === LIMITS.views + 1) report(base, `At most ${LIMITS.views} views per screen.`);
    if (variables.row || variables.form) return report(path, "a view can't sit in a table row or a form.");
    if (Boolean(node.view) === Boolean(node.screen)) return report(path, "a view part names one view, or one screen copied from a view.");
    let declared = {};
    if (node.screen) {
      if (!screens[node.screen]?.copiedFrom) return report(`${path}.screen`, `"${node.screen}" isn't a screen copied from a view.`);
      declared = screens[node.screen].params || {};
    } else if (views) {
      const view = views.find((entry) => entry.key === node.view);
      if (!view) {
        const keys = views.map((entry) => entry.key);
        return report(`${path}.view`, `there is no view "${node.view}".${closest(node.view, keys)} Views: ${keys.join(", ") || "none"}.`);
      }
      declared = view.params || {};
    }
    if (node.params !== undefined && (typeof node.params !== "object" || Array.isArray(node.params) || node.params === null)) {
      return report(`${path}.params`, 'is an object of values or formulas, e.g. { "customer": "=params.id" }.');
    }
    if (node.screen || views) {
      for (const name of Object.keys(node.params || {})) {
        if (!declared[name]) report(`${path}.params.${name}`, `this view has no parameter "${name}".`);
      }
      for (const name of Object.keys(declared)) {
        if (!(name in (node.params || {}))) report(`${path}.params`, `this view needs "${name}".`);
      }
    }
    for (const [name, value] of Object.entries(node.params || {})) formula(`${path}.params.${name}`, value, variables, "string");
  };

  let count = 0;
  const checkNodes = (path, nodes, variables, depth) => {
    if (nodes === undefined) return;
    if (!Array.isArray(nodes)) return report(path, "must be a list of parts.");
    nodes.forEach((node, index) => checkNode(`${path}[${index}]`, node, variables, depth));
  };

  const checkNode = (path, node, variables, depth) => {
    count += 1;
    if (count === LIMITS.nodes + 1) report(base, `At most ${LIMITS.nodes} parts per screen.`);
    if (depth > LIMITS.depth) return report(path, `Parts nest at most ${LIMITS.depth} deep.`);
    const allowed = catalog[node?.type];
    if (!allowed) return report(path, `"${node?.type}" isn't a known part. Parts: ${Object.keys(catalog).join(", ")}.`);
    for (const [key, value] of Object.entries(node)) {
      if (key === "type") continue;
      if (key === "class") {
        // Names for the app's own CSS (its `style`): "class": "hero card" is .x-hero and .x-card.
        if (typeof value !== "string" || !/^[a-z][a-z0-9-]*(\s+[a-z][a-z0-9-]*)*$/u.test(value.trim())) {
          report(`${path}.class`, 'is one or more names for the app\'s CSS, like "hero" or "hero wide" (a–z, 0–9, -).');
        }
        continue;
      }
      if (key !== "showIf" && !allowed.includes(key)) {
        report(`${path}.${key}`, `"${key}" isn't a setting of ${node.type}.`);
        continue;
      }
      if (["label", "value", "title"].includes(key) && value !== null && typeof value === "object") {
        report(`${path}.${key}`, "must be words, a number, or a formula.");
        continue;
      }
      if (CHOICES[key] && !isFormula(value) && !CHOICES[key].includes(value)) {
        report(`${path}.${key}`, `must be one of: ${CHOICES[key].join(", ")}.`);
      }
      if (typeof value === "string") formula(`${path}.${key}`, value, variables, BOOLEAN_SETTINGS.has(key) ? "bool" : null);
    }
    if (node.type === "view") checkViewPart(path, node, variables);
    if (node.type === "input") {
      const [scope, name] = String(node.bind || "").split(".");
      if (scope !== "state" || !(name in screenState)) report(`${path}.bind`, "must be state.<name> of a declared state value.");
    }
    if (node.type === "grid" && (!Number.isInteger(node.columns) || node.columns < 1 || node.columns > 4)) {
      report(`${path}.columns`, "must be 1 to 4.");
    }
    if (node.type === "button") checkSteps(`${path}.do`, node.do, variables);
    if (node.type === "table") {
      const table = records(node.rows, "list", `${path}.rows`);
      const fromScript = Boolean(screenData[DATA_REFERENCE.exec(String(node.rows || ""))?.[1]]?.script);
      if (fromScript && (node.onRowClick || node.rowActions)) {
        report(`${path}.rows`, "rows from a script can't have onRowClick or rowActions; use buttons elsewhere on the screen.");
      }
      const rowVariables = table ? { ...variables, row: celSchema(table) } : fromScript ? { ...variables, row: "map" } : variables;
      if (node.columns !== undefined && !Array.isArray(node.columns)) report(`${path}.columns`, "must be a list of columns.");
      (Array.isArray(node.columns) ? node.columns : []).forEach((column, index) => {
        if (typeof column?.label !== "string") report(`${path}.columns[${index}].label`, "needs a label.");
        formula(`${path}.columns[${index}].value`, column?.value, rowVariables);
        if (column?.display !== undefined && column.display !== "chip") report(`${path}.columns[${index}].display`, "can only be chip.");
      });
      checkSteps(`${path}.onRowClick`, node.onRowClick, rowVariables);
      checkNodes(`${path}.rowActions`, node.rowActions, rowVariables, depth + 1);
    }
    if (node.type === "totals" || node.type === "chart") {
      const name = DATA_REFERENCE.exec(String(node.rows || ""))?.[1];
      const query = name && screenData[name];
      if (query?.script) return; // the script returns [{ label, value }]
      if (!query?.groupBy) {
        report(`${path}.rows`, "must name a query with groupBy or a script.");
      } else if (node.measure === "total" && !query.sum && !query.avg) {
        report(`${path}.measure`, "total needs a query with sum or avg; use count otherwise.");
      }
    }
    if (node.type === "form") {
      // An edit form names a single-record query; a create form names a table and starts empty.
      if (Boolean(node.record) === Boolean(node.table)) {
        report(path, "a form needs exactly one of record (to edit) or table (to add a new record).");
      }
      const table = node.table
        ? tableNamed(node.table) || (named.has(`${path}.table`) ? null : report(`${path}.table`, "needs an existing table.")) || null
        : node.record
          ? records(node.record, "record", `${path}.record`)
          : null;
      if (table) {
        const formVariables = { ...variables, form: { ...celSchema(table), valid: "bool", changed: "bool", values: "map" } };
        (node.fields || []).forEach((entry, index) => {
          const item = typeof entry === "string" ? { field: entry } : entry;
          for (const key of ["showIf", "required"]) formula(`${path}.fields[${index}].${key}`, item[key], formVariables, "bool");
        });
        checkNodes(`${path}.buttons`, node.buttons, formVariables, depth + 1);
      }
    }
    if (node.type === "dialog" && (typeof node.key !== "string" || !node.key)) {
      report(`${path}.key`, "a dialog needs a key, used by openDialog.");
    }
    if (node.type === "tabs") {
      if (!Array.isArray(node.tabs) || !node.tabs.length) report(`${path}.tabs`, "needs at least one tab.");
      (Array.isArray(node.tabs) ? node.tabs : []).forEach((tab, index) => {
        if (typeof tab?.title !== "string") report(`${path}.tabs[${index}].title`, "needs a title.");
        checkNodes(`${path}.tabs[${index}].content`, tab?.content, variables, depth + 1);
      });
    }
    if (node.content) checkNodes(`${path}.content`, node.content, variables, depth + 1);
  };

  checkNodes(`${base}.content`, screen.content, pageVariables, 1);
}

/** A view as a bot writes it (params, state, data, content, style), in the one-screen form it's stored in. */
export function viewDefinition(view) {
  const { style, ...screen } = view;
  return { home: "main", screens: { main: screen }, ...(style ? { style } : {}) };
}

/** A stored view's one screen and style, as a bot reads them. */
export function viewBody(definition) {
  return { ...definition?.screens?.main, ...(definition?.style ? { style: definition.style } : {}) };
}

/** The save check for a view (D-55): only parts that show things, and places named from the view's top. */
export function checkView(view, tables) {
  if (!view || typeof view !== "object" || Array.isArray(view)) {
    return [{ path: "", message: "A view is an object with data and content." }];
  }
  const errors = Object.keys(view)
    .filter((key) => !VIEW_SETTINGS.has(key))
    .map((key) => ({ path: key, message: `"${key}" isn't a setting of a view. A view has one screen: ${[...VIEW_SETTINGS].join(", ")}.` }));
  if (!Array.isArray(view.content) || !view.content.length) errors.push({ path: "content", message: "A view needs at least one part." });
  const checked = checkApp(viewDefinition(view), tables, { bots: [], scripts: [], readOnly: true });
  return [...errors, ...checked.map((error) => ({ ...error, path: error.path.replace(/^screens\.main\.?/u, "") }))];
}

/**
 * A definition with each `copy` part turned into this app's own read-only screen of that view's
 * current version (D-55), remembering where it came from. A part whose view is unknown stays as it
 * is, for the save check to refuse. `views` carry their `body` (by names) and `number`.
 */
export function withCopies(definition, views) {
  if (!definition?.screens) return definition;
  const out = structuredClone(definition);
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if (value.type === "view" && value.copy === true) {
      const view = views.find((entry) => entry.key === value.view);
      if (!view) return;
      const screen = `view-${view.key}`;
      out.screens[screen] ??= { ...view.body, copiedFrom: { view: view.key, version: view.number } };
      delete value.view;
      delete value.copy;
      value.screen = screen;
      return;
    }
    Object.values(value).forEach(walk);
  };
  walk(Object.values(out.screens));
  return out;
}
