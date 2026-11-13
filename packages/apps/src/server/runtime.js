import { VISITOR, celSchema, evaluateFormula, formulaValue, isFixedFormula, isFormula, jsonValue, plainValue } from "../shared/formulas.js";
import { calculate, dataOnly, isCalculated, storedFieldIds, withNamedFormulas } from "../shared/index.js";
import { NeedsAttention, compileWhere, planToIds } from "../shared/where.js";
import { GateError } from "./validate.js";

// Running screens (D-35). The server is in charge: the browser names a screen and a query or a
// button, and the server runs only what the stored app version says, through the data gate. A
// draft preview works on the draft's practice copy (D-71): its buttons save, change and run
// scripts there as the live app would, while anything that leaves the app (a bot's task, a web
// call that changes something) is only reported. Screens are forgiving: a query that touches a
// removed field fails closed (no records, a note) instead of showing too much.
const DATA_STEPS = new Set(["create", "update", "markObsolete"]);
const PAGE_SIZE = 100;
const STATE_DEFAULTS = { string: "", double: 0, bool: false };
const DATA_REFERENCE = /^=data\.(\w+)$/u;

const live = (table) => table.fields.filter((field) => !field.obsolete);

/** Records as formulas see them: by field name, empty values typed, links as their id. */
export function formulaRecord(table, record) {
  if (!record) return null;
  const out = { id: String(record.id) };
  for (const field of live(table)) out[field.key] = formulaValue(field, record[field.id]);
  return out;
}

/**
 * Records as screens get them: by field name, links as { id, label, obsolete }. Only the fields the
 * gate gave: a visitor's records hold only what they may read.
 */
function screenRecord(table, record) {
  const out = { id: String(record.id), obsolete: Boolean(record.obsolete) };
  for (const field of live(table)) if (Object.hasOwn(record, field.id)) out[field.key] = record[field.id] ?? null;
  return out;
}

/** A script's input: each setting (a value or a formula) worked out, as plain JSON. */
const scriptInput = (settings, evaluate) =>
  jsonValue(Object.fromEntries(Object.entries(settings || {}).map(([key, value]) => [key, evaluate(value)])));

/** What a button's script may ask for: a message, another screen of the app, a dialog. */
function scriptEffects(result, screens) {
  const effects = [];
  if (!result || typeof result !== "object") return effects;
  if (result.notify) effects.push({ notify: String(result.notify).slice(0, 500) });
  if (result.go?.screen && screens?.[result.go.screen]) {
    effects.push({
      go: {
        screen: result.go.screen,
        params: Object.fromEntries(Object.entries(result.go.params || {}).map(([key, value]) => [key, String(value ?? "")]))
      }
    });
  }
  if (typeof result.openDialog === "string") effects.push({ openDialog: result.openDialog });
  return effects;
}

/**
 * What a script run carries from its screen: a visitor's access, so the gate holds its reads and
 * writes to it, or a draft preview's practice copy, so it works there.
 */
const reachOf = (ctx) => (ctx.visitor ? { visitor: ctx.visitor, access: ctx.access } : ctx.practice ? { practice: ctx.practice } : null);

/**
 * A script's answer to a screen query: a list (with { label, value } items also usable as
 * totals), or one object.
 */
function scriptData(value) {
  if (Array.isArray(value)) {
    return {
      records: value
        .slice(0, PAGE_SIZE * 10)
        .map((item) =>
          item && typeof item === "object" && "label" in item && "value" in item
            ? { ...item, key: item.label, count: Number(item.value) || 0, total: Number(item.value) || 0 }
            : item)
    };
  }
  return { record: value && typeof value === "object" ? value : { value } };
}

/**
 * Running an app's screens: their queries and their buttons' actions (see above).
 * @param {object} dependencies
 * @param {import("./types.js").AppStore} dependencies.apps
 * @param {import("./types.js").DataGate} dependencies.gate
 * @param {import("./types.js").Scripts} dependencies.scripts
 * @param {import("./types.js").Practices} dependencies.practices
 */
export function createRuntime({ apps, gate, scripts, practices }) {
  /** A screen of the app; `given` is the app as apps.get answered it with `botNames: false`, when the caller has it. */
  async function load(slug, version, screenKey, options, given = null) {
    const loaded = given ?? (await apps.get(slug, { version: version === "draft" ? "draft" : "live", botNames: false }, options));
    const screen = loaded.definition?.screens?.[screenKey];
    if (!screen) throw new GateError(404, "That screen doesn't exist.", { code: "apps_screen_not_found" });
    const tables = loaded.tables.filter((table) => !table.obsolete);
    const tableNamed = (name) => tables.find((table) => table.key === name);
    // The app's named formulas and script functions, callable from its formulas.
    const functions = withNamedFormulas(loaded.definition?.formulas, await scripts.functionsFor(loaded.app.id, options));
    return { ...loaded, screen, tableNamed, functions };
  }

  /** Page values come from the browser; only declared ones, of the declared type, are used. */
  function pageValues(screen, state, params) {
    const types = Object.fromEntries(
      Object.entries(screen.state || {}).map(([name, def]) => [name, def.type in STATE_DEFAULTS ? def.type : "string"])
    );
    const cleanState = Object.fromEntries(Object.entries(types).map(([name, type]) => {
      const value = state?.[name];
      const ok =
        type === "string"
          ? typeof value === "string"
          : type === "double"
            ? typeof value === "number" && Number.isFinite(value)
            : typeof value === "boolean";
      return [name, ok ? value : (screen.state[name].default ?? STATE_DEFAULTS[type])];
    }));
    const cleanParams = Object.fromEntries(Object.keys(screen.params || {}).map((name) => [name, String(params?.[name] ?? "")]));
    return {
      variables: { state: types, params: Object.fromEntries(Object.keys(cleanParams).map((name) => [name, "string"])) },
      values: { state: cleanState, params: cleanParams }
    };
  }

  /**
   * A screen's query, through the data gate, which holds a visitor (`ctx.visitor`, with `ctx.access`)
   * to the app's visitor access (D-66); a data script's reads and writes are held to it too.
   */
  async function runQuery(ctx, loaded, page, name, pageNumber = 1) {
    const query = loaded.screen.data?.[name];
    if (!query) throw new GateError(404, "That query isn't part of this screen.", { code: "apps_query_not_found" });
    if (query.script) {
      const input = scriptInput(query.input, (value) =>
        isFormula(value) ? evaluateFormula(page.variables, value, page.values, loaded.functions) : value);
      return scriptData(
        await scripts.runNamed("source", loaded.app.id, query.script, input, { kind: ctx.via?.kind || "screen", screen: ctx.via?.screen }, reachOf(ctx), ctx.options)
      );
    }
    const table = loaded.tableNamed(query.record || query.from);
    if (!table) return { needsAttention: true, records: [] };
    if (query.record) {
      const id = plainValue(evaluateFormula(page.variables, query.id, page.values, loaded.functions));
      if (!id) return { record: null };
      const record = await gate.get(ctx, table.id, String(id), { includeObsolete: !ctx.visitor }).catch((error) => {
        if (error.statusCode === 404) return null;
        throw error;
      });
      return { record: record ? screenRecord(table, record) : null };
    }
    // Filters, groups and sorts run in the database, on stored fields; a sum or average may be of a calculated one (D-78).
    const keyToId = storedFieldIds(table);
    const measured = new Map(live(table).map((field) => [field.key, field.id]));
    let where = null;
    try {
      if (query.where) {
        where = {
          plan: planToIds(compileWhere({ ...celSchema(table), ...page.variables }, query.where), keyToId),
          variables: page.variables,
          values: page.values
        };
      }
      if (query.groupBy) {
        const groupBy = keyToId.get(query.groupBy);
        const measureField = query.sum || query.avg;
        if (!groupBy || (measureField && !measured.get(measureField))) throw new NeedsAttention();
        const totals = await gate.totals(ctx, table.id, {
          where,
          groupBy,
          measure: query.sum ? "sum" : query.avg ? "avg" : "count",
          field: measureField ? measured.get(measureField) : null
        });
        // Grouped by a link, each group is named by the linked record's title (at most 100 groups, read together).
        const linkField = table.fields.find((field) => field.id === groupBy && field.type === "link");
        if (linkField) {
          const keys = totals.map((item) => item.key).filter(Boolean);
          const [linked, target] = keys.length
            ? await Promise.all([
              gate.getMany(ctx, linkField.options?.target, keys),
              gate.tableFor(linkField.options?.target, ctx.options).then(({ table: found }) => found)
            ]).catch(() => [new Map(), null])
            : [new Map(), null];
          for (const item of totals) {
            const record = item.key ? linked.get(String(item.key)) : null;
            item.label = record ? String(record[target.titleFieldId] ?? `#${item.key}`) : item.key ? `#${item.key}` : null;
          }
        }
        if (!query.grandTotal) return { totals };
        const measure = query.sum ? "sum" : query.avg ? "avg" : "count";
        const field = measureField ? measured.get(measureField) : null;
        return { totals, grandTotal: await gate.grandTotal(ctx, table.id, { where, measure, field }) };
      }
    } catch (error) {
      if (error instanceof NeedsAttention) return { needsAttention: true, records: [] };
      throw error;
    }
    const sortKey = query.sort?.replace(/^-/u, "");
    const sort = sortKey && keyToId.get(sortKey) ? [{ field: keyToId.get(sortKey), desc: query.sort.startsWith("-") }] : [];
    const result = await gate.read(ctx, table.id, { where, sort, page: { size: query.limit ?? PAGE_SIZE, number: pageNumber } });
    return { records: result.records.map((record) => screenRecord(table, record)), page: result.page, total: result.total };
  }

  /**
   * The screen a query or button runs on, and how its changes are audited. A visitor
   * (`ctx.visitor`) only ever reaches the live version's public screens; the public routes hand on the
   * live version they read (`given`). A draft's preview (a member's, never a visitor's) works on the
   * draft's practice copy (`practice`).
   */
  async function screenFor(ctx, slug, version, screenKey, given = null) {
    const loaded = await load(slug, ctx.visitor ? "live" : version, screenKey, ctx.options, given);
    if (ctx.visitor && loaded.screen.public !== true) {
      throw new GateError(404, "That screen doesn't exist.", { code: "apps_screen_not_found" });
    }
    const practice = !ctx.visitor && version === "draft" && loaded.version?.draft ? await practices.of(loaded.app, loaded.version.id, ctx.options) : null;
    const via = { kind: ctx.visitor ? "public" : "screen", appId: loaded.app.id, screen: screenKey };
    return { loaded, actx: { ...ctx, via, ...(practice ? { practice } : {}) } };
  }

  async function query(ctx, { slug, version, screen: screenKey, query: name, state, params, page: pageNumber, loaded: given = null }) {
    const { loaded, actx } = await screenFor(ctx, slug, version, screenKey, given);
    return runQuery(actx, loaded, withVisitor(pageValues(loaded.screen, state, params), ctx.visitor), name, pageNumber);
  }

  const withVisitor = (page, visitor) =>
    visitor ? { variables: { ...page.variables, visitor: VISITOR }, values: { ...page.values, visitor } } : page;

  /**
   * Finds the steps a path points at ("content/1/buttons/0/do"), with the table row and form
   * around them. Only `do` and `onRowClick` lists can be run.
   */
  function stepsAt(screen, path) {
    const parts = String(path || "").split("/").filter(Boolean);
    let node = screen;
    let tableNode = null;
    let formNode = null;
    for (const part of parts) {
      if (node === null || typeof node !== "object") break;
      if (node.type === "table") tableNode = node;
      if (node.type === "form") formNode = node;
      node = Array.isArray(node) ? node[Number(part)] : Object.hasOwn(node, part) ? node[part] : undefined;
    }
    const last = parts.at(-1);
    if (!Array.isArray(node) || !["do", "onRowClick"].includes(last)) {
      throw new GateError(404, "That isn't a button of this screen.", { code: "apps_button_not_found" });
    }
    return { steps: node, tableNode, formNode };
  }

  /**
   * A visitor's action (`ctx.visitor`, D-35) runs on the live version and a public screen, and only
   * a public form's steps, whatever is stored; the gate holds what they read and write to the app's
   * visitor access (D-66). `pretend` runs it without writing anything (a caught spam bot sees what a
   * person would). A draft's action runs on its practice copy and answers `practice`: what it changed
   * there (`changes`, by field id), the bots' tasks it would send (`wouldSend`) and what its scripts
   * only pretended to send (`simulated`). With no draft to preview, it writes nothing (`dryRun`).
   */
  async function action(ctx, {
    slug, version, screen: screenKey, path, row: rowId = null, values, state, params, pretend = false, loaded: given = null
  }) {
    const publicOnly = Boolean(ctx.visitor);
    const { loaded, actx } = await screenFor(ctx, slug, version, screenKey, given);
    if (loaded.app.kind === "view") throw new GateError(403, "A view only shows things.", { code: "apps_view_read_only" });
    const { practice = null } = actx;
    const dryRun = pretend || (!publicOnly && version === "draft" && !practice);
    const { screen } = loaded;
    const page = withVisitor(pageValues(screen, state, params), ctx.visitor);
    const { steps, tableNode, formNode } = stepsAt(screen, path);
    if (publicOnly) {
      const screens = loaded.definition.screens;
      const allowed = (step) => {
        const [kind] = Object.keys(step || {});
        if (["notify", "openDialog", "closeDialog"].includes(kind)) return true;
        if (kind === "go") return screens[step.go?.screen]?.public === true;
        if (kind === "create") {
          return (
            Boolean(formNode?.table) &&
            step.create.table === formNode.table &&
            step.create.values === "=form.values" &&
            Object.values(step.create.preset || {}).every(
              (value) => (!isFormula(value) || isFixedFormula(value)) && (value === null || typeof value !== "object")
            )
          );
        }
        if (kind === "update") {
          return Boolean(formNode?.record) && step.update.record === formNode.record && step.update.set === "=form.values";
        }
        return false;
      };
      if (!steps.every(allowed)) {
        throw new GateError(403, "That isn't allowed on a public form.", { code: "apps_public_form_step_forbidden" });
      }
    }

    // What formulas can see: page values, this screen's single records, the row, the form.
    const variables = { ...page.variables, data: {} };
    const scope = { ...page.values, data: {} };
    const recordTables = {};
    for (const [name, query] of Object.entries(screen.data || {})) {
      const table = loaded.tableNamed(query.record || query.from);
      if (query.record && table) {
        const { record } = await runQuery(actx, loaded, page, name);
        variables.data[name] = celSchema(table);
        scope.data[name] = record
          ? formulaRecord(table, { ...Object.fromEntries(live(table).map((field) => [field.id, record[field.key]])), id: record.id })
          : formulaRecord(table, { id: "" });
        recordTables[name] = { table, id: record?.id ?? null };
      } else {
        variables.data[name] = "list";
      }
    }
    const referenced = (reference) => recordTables[DATA_REFERENCE.exec(String(reference || ""))?.[1]];
    if (tableNode) {
      const table =
        referenced(tableNode.rows)?.table ?? loaded.tableNamed(screen.data?.[DATA_REFERENCE.exec(String(tableNode.rows))?.[1]]?.from);
      if (!table || !rowId) throw new GateError(400, "Which row?", { code: "apps_form_row_missing" });
      const record = await gate.get(actx, table.id, String(rowId));
      variables.row = celSchema(table);
      scope.row = formulaRecord(table, record);
    }
    let formValues = {};
    if (formNode) {
      const target = formNode.table ? { table: loaded.tableNamed(formNode.table), id: null } : referenced(formNode.record);
      if (formNode.table && !target.table) {
        throw new GateError(409, "This form's table has been removed.", { code: "apps_form_table_removed" });
      }
      if (!target) throw new GateError(404, "This form's record is missing.", { code: "apps_form_record_missing" });
      // Only the fields this form shows can be written through it; a calculated one only shows (D-78).
      const shown = new Set((formNode.fields || []).map((entry) => (typeof entry === "string" ? entry : entry.field)));
      const allowed = live(target.table).filter((field) => shown.has(field.key) && !isCalculated(field));
      formValues = Object.fromEntries(
        allowed.filter((field) => Object.hasOwn(values || {}, field.key)).map((field) => [field.key, values[field.key]])
      );
      const current = formNode.table ? null : scope.data[DATA_REFERENCE.exec(formNode.record)[1]];
      variables.form = { ...celSchema(target.table), valid: "bool", changed: "bool", values: "map" };
      const merged = Object.fromEntries(
        live(target.table).map((field) => [field.id, Object.hasOwn(formValues, field.key) ? formValues[field.key] : current?.[field.key]])
      );
      // The form's calculated fields are worked out from what it holds now, as the browser shows them.
      const record = calculate(target.table, formulaRecord(target.table, { ...merged, id: current?.id ?? "" }), { asFormulas: true });
      scope.form = { ...record, valid: true, changed: true, values: formValues };
    }
    const evaluate = (setting) => (isFormula(setting) ? plainValue(evaluateFormula(variables, setting, scope, loaded.functions)) : setting);
    const valuesOf = (setting) => {
      if (typeof setting === "string") {
        const result = evaluate(setting);
        return result instanceof Map ? Object.fromEntries(result) : { ...result };
      }
      return Object.fromEntries(Object.entries(setting || {}).map(([key, value]) => [key, evaluate(value)]));
    };

    const effects = [];
    const writes = [];
    const handoffs = [];
    const scriptsRun = [];
    // A visitor's writes are held to the app's visitor access by the gate, which also sets and keeps
    // the owner of their records, and changes only their own.
    const runData = async (step, txOptions) => {
      const [kind] = Object.keys(step);
      if (kind === "create") {
        const table = loaded.tableNamed(step.create.table);
        if (!table) throw new GateError(409, "This button's table has been removed.", { code: "apps_button_table_removed" });
        // A preset is a value the app sets (fixed, or like "=today()"); it wins over anything sent.
        const input = { ...valuesOf(step.create.values), ...valuesOf(step.create.preset || {}) };
        writes.push({ create: table.key, values: input });
        if (!dryRun) await gate.create(actx, table.id, input, { txOptions });
      } else {
        const target = referenced(step[kind].record);
        if (!target?.id) throw new GateError(404, "This button's record is missing.", { code: "apps_button_record_missing" });
        if (kind === "update") {
          const input = valuesOf(step.update.set);
          writes.push({ update: target.table.key, id: target.id, values: input });
          if (!dryRun) await gate.update(actx, target.table.id, target.id, input, { txOptions });
        } else {
          writes.push({ markObsolete: target.table.key, id: target.id });
          if (!dryRun) await gate.markObsolete(actx, target.table.id, target.id, { txOptions });
        }
      }
    };

    // Neighbouring data steps run in one transaction; UI steps come back as effects, in order.
    for (let index = 0; index < steps.length; ) {
      const [kind] = Object.keys(steps[index] || {});
      if (DATA_STEPS.has(kind)) {
        const group = [];
        while (index < steps.length && DATA_STEPS.has(Object.keys(steps[index] || {})[0])) group.push(steps[index++]);
        if (dryRun) {
          for (const step of group) await runData(step, null);
        } else {
          // A group that fails changed nothing, in a practice copy too.
          const changed = practice?.changes.length;
          await gate.withTransaction(actx, async (txOptions) => {
            for (const step of group) await runData(step, txOptions);
          }).catch((error) => {
            if (practice) practice.changes.length = changed;
            throw error;
          });
        }
        continue;
      }
      const step = steps[index++];
      if (kind === "go") {
        const goParams = Object.entries(step.go.params || {}).map(([key, value]) => [key, String(evaluate(value) ?? "")]);
        effects.push({ go: { screen: step.go.screen, params: Object.fromEntries(goParams) } });
      } else if (kind === "notify") {
        effects.push({ notify: String(evaluate(step.notify) ?? "") });
      } else if (kind === "openDialog" || kind === "closeDialog") {
        effects.push({ [kind]: step[kind] });
      } else if (kind === "runScript") {
        // A button's script runs in turn (in a draft preview, on its practice copy); what it returns becomes effects.
        const input = scriptInput(step.runScript.input, evaluate);
        scriptsRun.push({ script: step.runScript.script, input });
        if (dryRun) continue;
        const result = await scripts.runNamed("action", loaded.app.id, step.runScript.script, input, {
          kind: "button",
          screen: screenKey,
          by: ctx.actor?.name || null
        }, reachOf(actx), ctx.options);
        effects.push(...scriptEffects(result, loaded.definition.screens));
      } else if (kind === "askBot") {
        const bot = await apps.botOf(step.askBot.bot, ctx.options);
        if (!bot) throw new GateError(409, "That bot no longer exists.", { code: "apps_bot_gone" });
        handoffs.push({ bot, task: String(evaluate(step.askBot.task) ?? "").slice(0, 2000) });
        if (!dryRun && !practice) effects.push({ notify: `Sent to ${bot.name}` });
      }
    }
    // Tasks go out only once every step has succeeded, and never from a draft preview.
    const record = scope.form || scope.row;
    for (const { bot, task } of dryRun || practice ? [] : handoffs) {
      const values = record
        ? Object.fromEntries(Object.entries(record).filter(([key]) => !["valid", "changed", "values"].includes(key)))
        : null;
      await apps.queueTask({
        kind: "handoff",
        botId: String(bot.id),
        userId: ctx.userId ?? null,
        title: `Task from ${loaded.app.name}`,
        prompt: [
          `Task from the app "${loaded.app.name}" (screen ${screenKey}), sent by ${ctx.actor?.name || "a person"} with a button: ${task}`,
          ...(values ? [`The record on screen:\n${dataOnly(values)}`] : [])
        ].join("\n\n")
      }, ctx.options);
    }
    const wouldSend = handoffs.map(({ bot, task }) => ({ bot: bot.name, task }));
    return {
      effects,
      ...(dryRun ? { dryRun: true, wouldWrite: writes, wouldSend, wouldRun: scriptsRun } : {}),
      ...(practice ? { practice: { changes: practice.changes, wouldSend, simulated: practice.simulated } } : {})
    };
  }

  return Object.freeze({
    query,
    action
  });
}
