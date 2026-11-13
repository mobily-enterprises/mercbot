import { FIELD_REFERENCE, celSchema, evaluateFormula, formulaRecord, isFormula, plainValue, refersToRemovedField, showValue } from "../shared/formulas.js";
import { withNamedFormulas } from "../shared/index.js";
import { GateError } from "./validate.js";

// Trying a draft (D-71). The Builder can't see a screen, so it runs one as a person's preview runs
// it, on the draft's practice copy: every query of the screen, then each part as a person would see
// it (texts, tables' first rows, forms, totals, buttons), with any formula that fails. It can press
// a button or submit a form with values first, and reads back what that saved or changed there,
// what would have left the app, and the screen it ended on. The person's preview shows the same
// practice copy; Reset there clears what was tried.
const ROWS_SHOWN = 5;
const GROUPS_SHOWN = 8;
const DATA_REFERENCE = /^=data\.(\w+)$/u;
const STATE_TYPES = new Set(["string", "double", "bool"]);

/**
 * Trying drafts (see above).
 * @param {object} dependencies
 * @param {import("./types.js").AppStore} dependencies.apps
 * @param {import("./types.js").AppRuntime} dependencies.runtime
 * @param {import("./types.js").Scripts} dependencies.scripts the app's formula functions
 */
export function createTrial({ apps, runtime, scripts }) {
  /**
   * Every button of a screen a person can press, with where it sits (the runtime's path), whether
   * it needs a row, and its label as written.
   */
  function buttonsOf(screen) {
    const found = [];
    const walk = (nodes, at, inRow = false) => {
      (Array.isArray(nodes) ? nodes : []).forEach((node, index) => {
        if (!node || typeof node !== "object") return;
        const path = `${at}/${index}`;
        if (node.type === "button") found.push({ label: node.label, press: `${path}/do`, row: inRow });
        if (node.type === "form") (node.buttons || []).forEach((button, place) => found.push({ label: button?.label, press: `${path}/buttons/${place}/do`, form: true }));
        if (node.type === "table") {
          if (node.onRowClick) found.push({ label: "(row click)", press: `${path}/onRowClick`, row: true });
          walk(node.rowActions, `${path}/rowActions`, true);
        }
        if (node.type === "tabs") (node.tabs || []).forEach((tab, place) => walk(tab?.content, `${path}/tabs/${place}/content`, inRow));
        walk(node.content, `${path}/content`, inRow);
      });
    };
    walk(screen.content, "content");
    return found;
  }

  /** The button `press` names: its path, or its label (one button with it on the screen). */
  function buttonNamed(screen, press) {
    const buttons = buttonsOf(screen);
    const byPath = buttons.find((button) => button.press === press);
    if (byPath) return byPath;
    const named = buttons.filter((button) => String(button.label ?? "").trim().toLowerCase() === String(press).trim().toLowerCase());
    if (named.length === 1) return named[0];
    const list = buttons.map((button) => `"${button.label}" (${button.press})`).join(", ") || "none";
    throw new GateError(404, named.length
      ? `More than one button is labelled "${press}"; give its press path instead. Buttons: ${list}.`
      : `No button "${press}" on this screen. Buttons: ${list}.`, { code: "apps_button_not_found" });
  }

  /** What a press saved or changed in the practice copy, by table and field names. */
  function savedByName(tables, changes) {
    const tableOf = (id) => tables.find((table) => table.id === id);
    return changes.map(({ table: tableId, id, action, changes: values }) => {
      const table = tableOf(tableId);
      const named = Object.fromEntries(Object.entries(values || {}).map(([fieldId, change]) => {
        const field = table?.fields.find((entry) => entry.id === fieldId);
        return [field?.key ?? fieldId, action === "create" ? change[1] : change];
      }));
      const entry = { table: table?.key ?? tableId, id, action: action === "obsolete" ? "markObsolete" : action };
      if (action === "create") entry.values = named;
      if (action === "update") entry.changed = named;
      return entry;
    });
  }

  /**
   * A screen as a person would see it (see above): its parts, with the first rows of each table
   * and group of each total, and the queries and formulas that failed.
   */
  async function outline(ctx, slug, loaded, screenKey, params, state) {
    const screen = loaded.definition.screens[screenKey];
    const tables = loaded.tables.filter((table) => !table.obsolete);
    const tableNamed = (name) => tables.find((table) => table.key === name);
    const queryTable = (name) => tableNamed(screen.data?.[name]?.record || screen.data?.[name]?.from);
    const functions = withNamedFormulas(loaded.definition.formulas, await scripts.functionsFor(loaded.app.id, ctx.options));
    const stateTypes = Object.fromEntries(Object.entries(screen.state || {}).map(([name, def]) => [name, STATE_TYPES.has(def.type) ? def.type : "string"]));
    const stateValues = Object.fromEntries(Object.entries(stateTypes).map(([name, type]) => [
      name,
      state?.[name] ?? screen.state[name].default ?? (type === "double" ? 0 : type === "bool" ? false : "")
    ]));
    const paramValues = Object.fromEntries(Object.keys(screen.params || {}).map((name) => [name, String(params?.[name] ?? "")]));

    const data = {};
    const queryErrors = [];
    for (const name of Object.keys(screen.data || {})) {
      try {
        const result = await runtime.query(ctx, { slug, version: "draft", screen: screenKey, query: name, state: stateValues, params: paramValues, loaded });
        if (result.needsAttention) queryErrors.push({ query: name, error: "A table or field it uses doesn't exist." });
        data[name] = result;
      } catch (error) {
        if (!(error?.statusCode < 500)) throw error;
        queryErrors.push({ query: name, error: error.message });
        data[name] = {};
      }
    }

    const variables = { state: stateTypes, params: Object.fromEntries(Object.keys(paramValues).map((name) => [name, "string"])), data: {} };
    const values = { state: stateValues, params: paramValues, data: {} };
    for (const [name, query] of Object.entries(screen.data || {})) {
      const table = queryTable(name);
      variables.data[name] = query.script ? "dyn" : query.record && table ? celSchema(table) : "list";
      const result = data[name];
      values.data[name] = query.script
        ? (result.records ?? result.record ?? null)
        : query.record
          ? formulaRecord(table, result.record)
          : (result.records || []).map((record) => formulaRecord(table, record));
    }

    const formulaErrors = [];
    const evaluate = (setting, at, scope = {}) => {
      if (!isFormula(setting)) return setting;
      if (refersToRemovedField(setting)) return undefined;
      try {
        return plainValue(evaluateFormula({ ...variables, ...scope.variables }, setting, { ...values, ...scope.values }, functions));
      } catch (error) {
        if (!formulaErrors.some((entry) => entry.at === at)) formulaErrors.push({ at, formula: setting, error: String(error?.message || error).split("\n")[0] });
        return undefined;
      }
    };
    // A plain field reference is shown by the field's type (dates, money, links, yes/no), as screens show it.
    const shown = (setting, at, scope = {}, record = null, table = null) => {
      const match = FIELD_REFERENCE.exec(String(setting || ""));
      const field = match && record && table ? table.fields.find((entry) => entry.key === match[1]) : null;
      if (field) return showValue(field, record[field.key]);
      const result = evaluate(setting, at, scope);
      return result === undefined || result === null || result === "" ? "—" : typeof result === "object" ? JSON.stringify(result) : String(result);
    };
    const rowScope = (table, record) => (table
      ? { variables: { row: celSchema(table) }, values: { row: formulaRecord(table, record) } }
      : { variables: { row: "map" }, values: { row: record || {} } });
    const queryOf = (reference) => DATA_REFERENCE.exec(String(reference || ""))?.[1];

    const describe = (nodes, at, scope = {}) => {
      const parts = [];
      (Array.isArray(nodes) ? nodes : []).forEach((node, index) => {
        if (!node || typeof node !== "object") return;
        const path = `${at}/${index}`;
        const part = describePart(node, path, scope);
        if (!part) return;
        if (node.showIf !== undefined && evaluate(node.showIf, `${path}/showIf`, scope) !== true) part.hidden = true;
        parts.push(...(Array.isArray(part) ? part : [part]));
      });
      return parts;
    };

    const describePart = (node, path, scope) => {
      switch (node.type) {
        case "row":
        case "grid":
          return describe(node.content, `${path}/content`, scope);
        case "text": {
          const source = /^=data\.(\w+)\.\w+$/u.exec(String(node.value || ""));
          const record = source ? data[source[1]]?.record : null;
          return { text: shown(node.value, `${path}/value`, scope, record, source ? queryTable(source[1]) : null) };
        }
        case "chip":
          return { chip: shown(node.value, `${path}/value`, scope) };
        case "field":
          return { field: shown(node.label, `${path}/label`, scope), value: shown(node.value, `${path}/value`, scope) };
        case "button":
          return {
            button: shown(node.label, `${path}/label`, scope),
            press: `${path}/do`,
            ...(evaluate(node.disabled, `${path}/disabled`, scope) === true ? { disabled: true } : {})
          };
        case "input":
          return { input: shown(node.label, `${path}/label`, scope), bind: node.bind };
        case "table": {
          const name = queryOf(node.rows);
          const table = queryTable(name);
          const result = data[name] || {};
          const records = Array.isArray(result.records) ? result.records : [];
          const columns = (node.columns || []).filter((column) => !refersToRemovedField(column?.value));
          const rows = records.slice(0, ROWS_SHOWN).map((record, place) => ({
            id: record?.id ?? null,
            cells: columns.map((column, columnIndex) => shown(column.value, `${path}/columns/${columnIndex}/value`, rowScope(table, record), record, table)),
            ...(place === 0 && node.rowActions ? { buttons: describe(node.rowActions, `${path}/rowActions`, rowScope(table, record)) } : {})
          }));
          return {
            table: name,
            columns: columns.map((column) => column.label),
            rows,
            total: result.total ?? records.length,
            ...(node.onRowClick ? { rowClick: `${path}/onRowClick` } : {})
          };
        }
        case "form": {
          const table = node.table ? tableNamed(node.table) : queryTable(queryOf(node.record));
          const record = node.record ? data[queryOf(node.record)]?.record ?? null : null;
          const fields = (node.fields || []).map((entry) => (typeof entry === "string" ? entry : entry?.field)).filter(Boolean);
          const formScope = {
            variables: { form: { ...(table ? celSchema(table) : {}), valid: "bool", changed: "bool", values: "map" } },
            values: { form: { ...formulaRecord(table, record), valid: true, changed: false, values: {} } }
          };
          const shownValues = record && table
            ? Object.fromEntries(fields.map((key) => [key, showValue(table.fields.find((field) => field.key === key), record[key])]))
            : null;
          return {
            form: node.table ? `new ${node.table}` : `edit ${table?.key ?? "?"}${record ? ` ${record.id}` : " (no record)"}`,
            fields,
            ...(shownValues ? { values: shownValues } : {}),
            buttons: describe(node.buttons, `${path}/buttons`, { ...scope, ...formScope })
          };
        }
        case "totals":
        case "chart": {
          const name = queryOf(node.rows);
          const query = screen.data?.[name] || {};
          const table = queryTable(name);
          const result = data[name] || {};
          const groupField = table?.fields.find((field) => field.key === query.groupBy);
          const measureField = table?.fields.find((field) => field.key === (query.sum || query.avg));
          const groups = Array.isArray(result.totals) ? result.totals : Array.isArray(result.records) ? result.records : [];
          const text = (item) => (measureField && node.measure !== "count" ? showValue(measureField, item.total) : String(item.count ?? item.value ?? ""));
          return {
            [node.type]: shown(node.label, `${path}/label`, scope),
            groups: groups.slice(0, GROUPS_SHOWN).map((item) => ({
              label: item.label ?? (item.key === null || item.key === undefined || item.key === "" ? "(none)" : showValue(groupField, item.key)),
              value: text(item)
            })),
            ...(groups.length > GROUPS_SHOWN ? { moreGroups: groups.length - GROUPS_SHOWN } : {}),
            ...(result.grandTotal ? { grandTotal: text(result.grandTotal) } : {})
          };
        }
        case "tabs":
          return { tabs: (node.tabs || []).map((tab, place) => ({ title: tab?.title, parts: describe(tab?.content, `${path}/tabs/${place}/content`, scope) })) };
        case "dialog":
          return { dialog: node.key, title: shown(node.title, `${path}/title`, scope), parts: describe(node.content, `${path}/content`, scope) };
        case "view":
          return { view: node.view ?? node.screen ?? null };
        default:
          return null;
      }
    };

    return {
      screen: screenKey,
      ...(Object.keys(paramValues).length ? { params: paramValues } : {}),
      parts: describe(screen.content, "content"),
      ...(queryErrors.length ? { queryErrors } : {}),
      ...(formulaErrors.length ? { formulaErrors } : {})
    };
  }

  /**
   * Tries a screen of an app's draft on its practice copy: presses `press` (a button's label or
   * path) first when given, with the form's `values` (by field name) or the table `row` it needs,
   * then shows the screen it ended on.
   * @param {object} ctx the data gate's ctx of whoever tries it (the Builder)
   */
  async function tryScreen(ctx, { slug, screen: screenKey, params = {}, state = {}, press = null, values = {}, row = null }) {
    const loaded = await apps.get(slug, { version: "draft", botNames: false }, ctx.options);
    if (!loaded.version?.draft) {
      throw new GateError(409, "This app has no draft to try: save one with app_save_draft first.", { code: "apps_draft_missing" });
    }
    const screens = loaded.definition?.screens || {};
    let key = screenKey || loaded.definition?.home;
    if (!screens[key]) {
      throw new GateError(404, `No screen "${key}". Screens: ${Object.keys(screens).join(", ")}.`, { code: "apps_screen_not_found" });
    }
    let shownParams = params;
    let shownState = state;
    let pressed = null;
    if (press) {
      const button = buttonNamed(screens[key], press);
      try {
        const result = await runtime.action(ctx, { slug, version: "draft", screen: key, path: button.press, row, values, state, params, loaded });
        const practice = result.practice || { changes: [], wouldSend: [], simulated: [] };
        pressed = {
          button: button.label ?? button.press,
          ok: true,
          saved: savedByName(loaded.tables, practice.changes),
          ...(result.effects.length ? { effects: result.effects } : {}),
          ...(practice.wouldSend.length ? { wouldSend: practice.wouldSend } : {}),
          ...(practice.simulated.length ? { simulated: practice.simulated } : {})
        };
        const go = result.effects.findLast((effect) => effect.go)?.go;
        if (go && screens[go.screen]) {
          key = go.screen;
          shownParams = go.params || {};
          shownState = {};
        }
      } catch (error) {
        if (!(error?.statusCode < 500)) throw error;
        pressed = { button: button.label ?? button.press, ok: false, error: error.message };
      }
    }
    return { ...(pressed ? { pressed } : {}), shown: await outline(ctx, slug, loaded, key, shownParams, shownState) };
  }

  return Object.freeze({
    tryScreen
  });
}
