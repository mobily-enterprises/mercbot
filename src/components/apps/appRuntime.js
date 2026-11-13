import { reactive, ref, watch } from "vue";
import { FIELD_REFERENCE, celSchema, evaluateFormula, formatMoney, formulaRecord, isFormula, plainValue, refersToRemovedField, showValue } from "@local/apps/shared";
import { appsApi } from "./appsApi.js";

// The browser side of an app screen (D-35): page values, query results, formulas and buttons.
// Formulas are evaluated here only to show things; every query and button runs on the server
// from the stored app, so nothing here can change what an app is allowed to do.
export const ICON_PATHS = {
  search: "$search",
  edit: "$edit",
  back: "$arrowBack",
  save: "$save",
  add: "$add",
  open: "$openInNew",
  check: "$check",
  close: "$close",
  person: "$person",
  mail: "$mail",
  phone: "$call",
  calendar: "$calendar",
  chart: "$barChart",
  star: "$star",
  apps: "$gridView"
};

const DATA_REFERENCE = /^=data\.(\w+)$/u;

// Field references, removed fields, formula records and how values show are shared with the server,
// which shows a tried draft so (trial.js).
export { FIELD_REFERENCE, formulaRecord, refersToRemovedField, showValue };

// A totals group's name: a link group's title, else the key shown by the field's type.
export const groupLabel = (field, item) => item.label ?? (item.key === null || item.key === undefined || item.key === "" ? "(none)" : field?.type === "link" ? `#${item.key}` : showValue(field, item.key));

// The points of a chart part from a totals query's rows: a label, the plotted value (money in
// units) and its text. A line runs in key order (dates ascending); a pie keeps seven slices and
// folds the rest into "Other" so its eight colours never repeat.
export function chartData({ kind = "bar", rows = [], field = null, measureField = null, measure = "count" }) {
  const money = measure === "total" && measureField?.type === "money";
  const text = (value) => (money ? formatMoney(value) : Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
  let items = rows.map((item) => ({ key: item.key, label: groupLabel(field, item), raw: measure === "total" ? Number(item.total ?? 0) : Number(item.count ?? 0) }));
  if (kind === "line") items = [...items].sort((a, b) => (a.key === null) - (b.key === null) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
  if (kind === "pie" && items.length > 8) items = [...items.slice(0, 7), { key: "other", label: "Other", raw: items.slice(7).reduce((sum, item) => sum + item.raw, 0) }];
  return {
    points: items.map((item) => ({ label: item.label, value: money ? item.raw / 100 : item.raw, text: text(item.raw) })),
    format: (value) => (money ? formatMoney(Math.round(value * 100)) : String(value))
  };
}

// What a preview's button didn't do, for the snackbar, or "" when there's nothing to say. A draft's
// practice data (D-71) saves for real, but nothing leaves the app, so it says what the live app would
// have sent; an app without a draft to preview saves nothing at all.
export function previewNotice(result) {
  if (result.dryRun) {
    const would = [
      ...(result.wouldWrite?.length ? [`would save ${result.wouldWrite.length} change${result.wouldWrite.length === 1 ? "" : "s"}`] : []),
      ...(result.wouldSend || []).map((entry) => `would ask ${entry.bot}`)
    ];
    return `Preview: nothing was saved or sent${would.length ? ` (${would.join(", ")})` : ""}.`;
  }
  const unsent = [
    ...(result.practice?.wouldSend || []).map((entry) => `ask ${entry.bot}`),
    ...(result.practice?.simulated || []).map((entry) => `call ${entry.web?.url}`)
  ];
  return unsent.length ? `Practice data: nothing was sent. Once published, this would ${unsent.join(" and ")}.` : "";
}

// When something happened, and who did it ("Otto (bot)"), as the Apps screens show them.
export const whenText = (at) => (at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
export const actorName = (actor, fallback = "Someone") => (actor?.type === "bot" ? `${actor.name} (bot)` : actor?.name || fallback);

// An app screen's address: `<base>/<screen>/<first parameter>`, other parameters as query values.
export function screenParams(screens, key, pathParts, query) {
  const names = Object.keys(screens?.[key]?.params || {});
  return Object.fromEntries(names.map((name, index) => [name, String(index === 0 ? (pathParts[1] ?? "") : (query[name] ?? ""))]));
}
export function screenLocation(screens, base, key, params = {}) {
  const names = Object.keys(screens?.[key]?.params || {});
  const path = `${base}/${key}${names[0] && params[names[0]] ? `/${encodeURIComponent(params[names[0]])}` : ""}`;
  return { path, query: Object.fromEntries(names.slice(1).filter((name) => params[name]).map((name) => [name, params[name]])) };
}

/**
 * One app screen as it runs (D-35): its state, data, dialogs, formulas and buttons. `api` runs the
 * screen's queries and buttons: the signed-in routes, or a public app's, where formulas can also
 * read `visitor` (signedIn, email). `functions` are the app's script functions for formulas
 * (scriptFunctions.js), or null.
 * @param {object} options
 * @param {Array<Record<string, any>>} options.tables The home's tables the screen reads.
 * @param {(result: Record<string, any>) => void} options.onEffects Carries out what a button asks for after it ran.
 * @param {(error: unknown) => void} options.onError Explains a query or button that failed.
 * @param {typeof appsApi | Record<string, any>} [options.api]
 * @param {Record<string, any> | null} [options.screens] The app's screens, where a copy of a view is drawn from.
 */
export function createScreenRuntime({ slug, version, tables, screen, screens = null, screenKey, params, onEffects, onError, api = appsApi, visitor = null, functions = null }) {
  const state = reactive({});
  for (const [name, def] of Object.entries(screen.state || {})) state[name] = def.default ?? (def.type === "double" ? 0 : def.type === "bool" ? false : "");
  const data = reactive({});
  const attention = reactive({});
  const loading = reactive(new Set(Object.keys(screen.data || {})));
  const grandTotals = reactive({});
  const busy = ref(false);
  const dialogs = reactive({});

  const tableNamed = (name) => tables.find((table) => table.key === name);
  const queryTable = (name) => tableNamed(screen.data?.[name]?.record || screen.data?.[name]?.from);
  const referenced = (reference) => DATA_REFERENCE.exec(String(reference || ""))?.[1];

  const baseVariables = () => {
    const variables = {
      state: Object.fromEntries(Object.entries(screen.state || {}).map(([name, def]) => [name, def.type in { string: 1, double: 1, bool: 1 } ? def.type : "string"])),
      params: Object.fromEntries(Object.keys(screen.params || {}).map((name) => [name, "string"])),
      data: {},
      ...(visitor ? { visitor: { signedIn: "bool", email: "string" } } : {})
    };
    for (const [name, query] of Object.entries(screen.data || {})) {
      const table = queryTable(name);
      variables.data[name] = query.script ? "dyn" : query.record && table ? celSchema(table) : "list";
    }
    return variables;
  };
  const variables = baseVariables();

  function values(extra = {}) {
    const dataValues = {};
    for (const [name, query] of Object.entries(screen.data || {})) {
      const table = queryTable(name);
      // A script's data is shown as it came: a list or one object.
      if (query.script) dataValues[name] = data[name] ?? null;
      else dataValues[name] = query.record ? formulaRecord(table, data[name]) : (data[name] || []).map((record) => formulaRecord(table, record));
    }
    return { state: { ...state }, params: { ...params }, data: dataValues, ...(visitor ? { visitor } : {}), ...extra };
  }

  // scope = { variables, values } added by a table row or a form.
  function evaluate(setting, scope = {}) {
    if (!isFormula(setting)) return setting;
    if (refersToRemovedField(setting)) return undefined;
    try {
      return plainValue(evaluateFormula({ ...variables, ...scope.variables }, setting, values(scope.values), functions));
    } catch {
      return undefined;
    }
  }

  function rowScope(rowsReference, record) {
    const table = queryTable(referenced(rowsReference));
    if (!table) return { variables: { row: "map" }, values: { row: record || {} }, record, table: null };
    return { variables: { row: table ? celSchema(table) : {} }, values: { row: formulaRecord(table, record) }, record, table };
  }

  // stop() ends the screen's reads once the page no longer needs them: one still on its way is dropped, unanswered,
  // and none starts after. A draft's preview stops them before Reset or Publish clears the practice copy they read
  // (D-71), which a read caught in between would answer with an error. A view on the screen stops with `signal`.
  const reading = new AbortController();
  const stop = () => reading.abort();

  // `quiet` keeps what's shown until the new answer arrives, and through a failed try: a live update.
  async function load(name, { quiet = false } = {}) {
    if (reading.signal.aborted) return;
    if (!quiet) loading.add(name);
    try {
      const result = await api.query(slug, { version, screen: screenKey, query: name, state: { ...state }, params }, { signal: reading.signal });
      attention[name] = Boolean(result.needsAttention);
      data[name] = "record" in result ? result.record : result.totals || result.records || [];
      grandTotals[name] = result.grandTotal || null;
    } catch {
      if (!quiet && !reading.signal.aborted) {
        attention[name] = true;
        data[name] = screen.data[name]?.record ? null : [];
      }
    } finally {
      loading.delete(name);
    }
  }
  const loadAll = (options) => Promise.all(Object.keys(screen.data || {}).map((name) => load(name, options)));

  // Tables changed (by id): the queries that read them, or a table they link to, run again quietly.
  function reloadChanged(tableIds) {
    const changed = new Set(tableIds);
    const reads = (table) => table && (changed.has(table.id) || table.fields.some((field) => field.type === "link" && changed.has(field.options?.target)));
    return Promise.all(Object.keys(screen.data || {}).filter((name) => reads(queryTable(name))).map((name) => load(name, { quiet: true })));
  }

  async function run(path, { row = null, formValues = null } = {}) {
    busy.value = true;
    try {
      const result = await api.action(slug, { version, screen: screenKey, path, row, values: formValues || {}, state: { ...state }, params });
      if (!result.dryRun) await loadAll();
      onEffects(result);
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      busy.value = false;
    }
  }

  // Typing in a search box re-runs the screen's queries after a short pause. Returns stop().
  function followState() {
    let timer = null;
    let stopped = false;
    const stop = watch(state, () => {
      clearTimeout(timer);
      timer = setTimeout(() => !stopped && loadAll(), 250);
    }, { deep: true });
    return () => {
      stopped = true;
      clearTimeout(timer);
      stop();
    };
  }

  return { slug, state, data, grandTotals, attention, loading, busy, dialogs, tables, screen, screens, tableNamed, queryTable, referenced, evaluate, rowScope, load, loadAll, reloadChanged, run, followState, stop, signal: reading.signal, version };
}
