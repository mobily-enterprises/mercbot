import variant from "@jitl/quickjs-wasmfile-release-sync";
import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { isCalculated } from "../shared/calculated.js";
import { ScriptError, runFunction } from "../shared/sandbox.js";
import { newId } from "./registry.js";
import { LIMITS, PAGE, createScriptChecks, hostFor, whereFor } from "./scriptChecks.js";
import { createScriptAi } from "./scriptAi.js";
import { createScriptConnected } from "./scriptConnected.js";
import { createScriptPeople } from "./scriptPeople.js";
import { createScriptPool } from "./scriptPool.js";
import { nextSlot } from "./scriptSchedule.js";
import { GateError } from "./validate.js";
import { createWebAccess } from "./webAccess.js";

// Scripts (D-35, owner 2026-10-29: "make it powerful"). The Builder writes them with tests; people
// read them. Five kinds: `action` (a button runs it), `source` (data for a screen), `rule` (runs
// before a table's records are saved), `function` (called by name in the app's formulas) and `job`
// (on a timetable, or when a table's records change). They run sealed off in QuickJS; everything
// they read or write goes through the data gate, audited as the script.
const RUNS_KEPT = 200;
// What a claimed job's run reads of its script, with the home it runs in.
const SCRIPT_FIELDS = [
  "id",
  "workspaceId",
  "appId",
  "key",
  "kind",
  "summary",
  "code",
  "settings",
  "enabled",
  "version",
  "nextRunAt",
  "cursor",
  "runsAsUserId"
];
// Run rows written per statement: 7 values each, well under PostgreSQL's 65,535 parameters.
const RUNS_PER_INSERT = 1000;

/**
 * A record as scripts see it: id and fields by name; links and people as their id, tags as the list, a file or
 * picture as { name, size, type } (never where it's stored), money in whole cents, empty values null.
 */
function scriptRecord(table, record) {
  if (!record) return null;
  const out = { id: String(record.id) };
  for (const field of table.fields.filter((entry) => !entry.obsolete)) {
    out[field.key] = scriptValue(field, record[field.id] ?? null);
  }
  return out;
}

/** One field's value as scripts see it (scriptRecord). */
function scriptValue(field, value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value;
  if (field.type === "file" || field.type === "image") return { name: value.name ?? null, size: value.size ?? null, type: value.type ?? null };
  return value.id ?? null;
}




/**
 * A home's scripts: rules on saving, buttons' and screens' scripts, formula functions and
 * timetabled or watching jobs, each run in the script pool (see above). Every method takes the
 * call's options last; the jobs run in each home's system context.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the apps
 *   feature's handles
 * @param {import("./types.js").AppsRepository} dependencies.repository
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext AppsFeature's
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {import("./types.js").DataGate} dependencies.gate
 * @param {import("./types.js").AppStore} dependencies.apps
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").ScriptPool} [dependencies.pool]
 * @param {import("./types.js").WebAccess} [dependencies.web] The addresses scripts may call (tests pass their own).
 */
export function createScripts({
  resources,
  repository,
  systemContext,
  registry,
  gate,
  apps,
  env,
  connected,
  homeBots,
  roleOf,
  pool = createScriptPool(),
  web = createWebAccess({ resources, env })
}) {
  const { apps: appRows, appScripts, appScriptRuns, appScriptRounds, auditEvents } = resources;
  const connectedApps = createScriptConnected({ resources, systemContext, connected });
  const { whoActed, personOfRun } = createScriptPeople({ roleOf });
  const aiWork = createScriptAi({ resources, systemContext, registry, homeBots });
  // The person a job saved or switched on runs as for connected apps (D-136): the call's, never anything sent.
  const personOf = (options) => resolveAuditActorId(options?.context) ?? null;
  let quickjs = null;
  const ready = async () => (quickjs ||= await newQuickJSWASMModuleFromVariant(variant));

  /** A rule's or watching job's table by name (as the Builder writes it), with its label for people. */
  const withTableNames = (settings, tables) => {
    const named = (id) => tables.find((table) => table.id === id);
    if (settings.table) {
      return {
        ...settings,
        table: named(settings.table)?.key ?? settings.table,
        tableLabel: named(settings.table)?.label ?? settings.table
      };
    }
    if (settings.watch?.table) {
      return {
        ...settings,
        watch: {
          ...settings.watch,
          table: named(settings.watch.table)?.key ?? settings.watch.table,
          tableLabel: named(settings.watch.table)?.label ?? settings.watch.table
        }
      };
    }
    return settings;
  };
  const show = (row, tables = []) => ({
    id: row.id,
    key: row.key,
    kind: row.kind,
    summary: row.summary,
    code: row.code,
    tests: row.tests,
    settings: withTableNames(row.settings, tables),
    enabled: row.enabled,
    version: row.version,
    nextRunAt: row.nextRunAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy
  });

  const { checkScript, runTests } = createScriptChecks({ pool, ready });

  const audit = (entry, txOptions) => auditEvents.create(entry, { ...txOptions, returning: "none" });

  /** An app's script by key, or the 404 a person sees. */
  async function scriptOf(app, key, options) {
    const { records: [row] } = await appScripts.query(
      { filters: { appId: app.id, key: String(key) }, page: { size: 1 } },
      passedOn(options)
    );
    if (!row) throw new GateError(404, `No script "${key}".`, { code: "apps_script_not_found", params: { key } });
    return row;
  }

  /** Checks and tests a script without saving it (the coding loop's rounds). */
  async function test(input, options) {
    const tables = await registry.loadTables(options);
    const { errors } = checkScript(input, tables);
    if (errors.length) return { errors, results: [] };
    return { errors: [], results: await runTests(input, tables) };
  }

  /** Saves a script only when it's well formed and every test passes. Audited; version + 1. */
  async function save(actor, appSlug, input, options) {
    const app = await apps.find(appSlug, options);
    apps.notAView(app, "have scripts");
    const tables = await registry.loadTables(options);
    const { errors, settings } = checkScript(input, tables);
    if (errors.length) return { errors, results: [] };
    const results = await runTests(input, tables);
    if (results.some((result) => !result.passed)) {
      return {
        errors: [
          {
            path: "tests",
            message: `${results.filter((result) => !result.passed).length} of ${results.length} tests failed; nothing was saved.`
          }
        ],
        results
      };
    }
    const row = await appScripts.withTransaction(options, async (txOptions) => {
      const [existing] = await appScripts.lockWhere({ appId: app.id, key: input.key }, { ...txOptions, fields: ["id", "version"] });
      const fields = {
        kind: input.kind,
        summary: String(input.summary).trim().slice(0, 300),
        code: input.code,
        tests: input.tests,
        settings,
        enabled: true,
        createdBy: actor,
        runsAsUserId: input.kind === "job" ? personOf(options) : null,
        nextRunAt: input.kind === "job" && settings.every ? nextSlot(settings).toISOString() : null,
        // A watching job starts at the change horizon, read in this transaction.
        cursor: input.kind === "job" && settings.watch ? await appScripts.changeHorizon(txOptions) : null
      };
      const saved = existing
        ? await appScripts.patch(existing.id, { ...fields, version: existing.version + 1 }, txOptions)
        : await appScripts.create({ id: newId("s"), appId: app.id, key: input.key, ...fields }, txOptions);
      await audit({
        actor,
        via: { kind: "app", appId: app.id },
        action: "script",
        changes: { script: { key: saved.key, kind: saved.kind, version: saved.version, summary: saved.summary } }
      }, txOptions);
      return saved;
    });
    return { errors: [], results, script: show(row, tables) };
  }

  async function remove(actor, appSlug, key, options) {
    const app = await apps.find(appSlug, options);
    const row = await scriptOf(app, key, options);
    await appScripts.withTransaction(options, async (txOptions) => {
      await appScripts.delete(row.id, txOptions);
      await audit({ actor, via: { kind: "app", appId: app.id }, action: "script", changes: { script: { key, removed: true } } }, txOptions);
    });
    return { removed: key };
  }

  /** Owners and admins can switch a script off (a misbehaving rule stops blocking saves) and on. */
  async function setEnabled(actor, appSlug, key, enabled, options) {
    const app = await apps.find(appSlug, options);
    const row = await scriptOf(app, key, options);
    await appScripts.withTransaction(options, async (txOptions) => {
      await appScripts.patch(row.id, {
        enabled,
        ...(row.kind === "job" && enabled ? { runsAsUserId: personOf(options) } : {}),
        ...(row.kind === "job" && row.settings.every && enabled ? { nextRunAt: nextSlot(row.settings).toISOString() } : {}),
        // A watching job switched on starts again at the snapshot horizon.
        ...(row.kind === "job" && row.settings.watch && enabled ? { cursor: await appScripts.changeHorizon(txOptions) } : {})
      }, { ...txOptions, returning: "none" });
      await audit({ actor, via: { kind: "app", appId: app.id }, action: "script", changes: { script: { key, enabled } } }, txOptions);
    });
    return { key, enabled };
  }

  /**
   * What the Builder may have an app's scripts call in connected apps (D-136): the apps its owners and admins allowed
   * ("ai" among them for bots and pictures), and those connected for the call's person with each action's inputs.
   */
  async function connectedGuide(appSlug, options) {
    const app = await apps.find(appSlug, options);
    const allowed = app.connectedAccess || [];
    return { allowed, guide: allowed.some((id) => id !== "ai") ? await connected().guide(options, allowed) : "" };
  }

  /**
   * Someone left the home (the bots' homeChanged): the jobs that ran as them have no person for connected apps any more,
   * until someone in the home switches each off and on again (D-136). One write, by the index on runs_as_user_id.
   */
  async function forgetPerson(userId, options) {
    await appScripts.patchWhere({ runsAsUserId: String(userId) }, { runsAsUserId: null }, { ...passedOn(options), returning: "count" });
  }

  /** The app's scripts with their recent runs and coding-loop rounds (the Logic tab). */
  async function list(appSlug, { runs = 20 } = {}, options) {
    const app = await apps.find(appSlug, options);
    const tables = await registry.loadTables(options);
    const rows = await appScripts.queryAll({ filters: { appId: app.id }, sort: ["key"] }, passedOn(options));
    // Each script's latest runs in one query, however many scripts: one index range each (script_id, id).
    const recent = await repository.latestRuns(rows.map((row) => row.id), Math.max(Math.trunc(Number(runs)) || 0, 0), passedOn(options));
    const runsOf = Map.groupBy(recent, (run) => run.scriptId);
    const scripts = rows.map((row) => ({
      ...show(row, tables),
      runs: (runsOf.get(row.id) || []).map((run) => ({
        at: run.startedAt,
        ok: run.ok,
        ms: run.ms,
        calls: run.calls,
        error: run.error,
        log: run.log,
        via: run.via
      }))
    }));
    const { records: rounds } = await appScriptRounds.query({ filters: { appId: app.id }, sort: ["-id"], page: { size: 50 } }, passedOn(options));
    return {
      scripts,
      rounds: rounds.map((round) => ({
        script: round.scriptKey,
        round: round.round,
        passed: round.passed,
        failed: round.failed,
        failures: round.failures,
        at: round.createdAt
      })),
      // The bots' and pictures' work its scripts queued (D-136).
      aiWork: await aiWork.listFor(app.id, options)
    };
  }

  /**
   * Every script of the home, or only those of one `kind` (the home's recurring tasks read its jobs, D-132), for the
   * Apps home's Scripts tab, in its apps' name order.
   * @param {{ kind?: string | null }} where
   */
  async function overview({ kind = null } = {}, options) {
    const rows = await appScripts.queryAll({ ...(kind ? { filters: { kind } } : {}), sort: ["key"] }, passedOn(options));
    const appIds = [...new Set(rows.map((row) => row.appId))];
    const owners = appIds.length ? await appRows.queryAll({ filters: { id: appIds }, sort: ["name"] }, passedOn(options)) : [];
    const order = new Map(owners.map((app, index) => [app.id, index]));
    const ownerOf = new Map(owners.map((app) => [app.id, app]));
    const last = await repository.latestRuns(rows.map((row) => row.id), 1, passedOn(options));
    const lastOf = new Map(last.map((run) => [run.scriptId, run]));
    const tables = await registry.loadTables(options);
    return rows
      .filter((row) => ownerOf.has(row.appId))
      .sort((a, b) => order.get(a.appId) - order.get(b.appId))
      .map((row) => {
        const run = lastOf.get(row.id);
        return {
          ...show(row, tables),
          app: { slug: ownerOf.get(row.appId).slug, name: ownerOf.get(row.appId).name },
          lastRun: run ? { at: run.startedAt, ok: run.ok, error: run.error } : null
        };
      });
  }

  /** The coding loop's rounds, shown in the Logic tab. */
  async function recordRound(appId, key, round, { passed, failed, failures }, options) {
    await appScriptRounds.create(
      { appId, scriptKey: key, round, passed, failed, failures: failures || [] },
      { ...passedOn(options), returning: "none" }
    );
  }

  // ---- Running ----

  /**
   * The host functions of a real run: the data gate as the script, and allowed web addresses. A run
   * on a draft's practice copy (`ctx.practice`, D-71) reads web addresses but only pretends to send
   * anything that could change something there, as a test copy does (D-69), and notes it for the call.
   */
  function realHost(ctx, limits, row) {
    let data = 0;
    let webCalls = 0;
    const connectedCall = connectedApps.forRun(ctx, limits, row);
    const aiCall = aiWork.forRun(ctx, row);
    const tableFor = async (key) => (await gate.tableFor(String(key), ctx.options)).table;
    return async (group, name, args) => {
      if (group === "connected") return connectedCall(name, args);
      if (group === "ai") return aiCall(name, args);
      if (group === "people") return personOfRun(ctx, row);
      if (group === "web") {
        if ((webCalls += 1) > limits.web) throw new Error(`at most ${limits.web} web calls per run`);
        const answer = await web.fetch(args[0], args[1] || {}, ctx.options, { simulate: Boolean(ctx.practice) });
        if (ctx.practice && answer.simulated) {
          ctx.practice.simulated.push({ web: { method: String(args[1]?.method || "GET").toUpperCase(), url: String(args[0]) }, script: ctx.via.script });
        }
        return answer;
      }
      if ((data += 1) > limits.data) throw new Error(`at most ${limits.data} record calls per run`);
      const [key, ...rest] = args;
      const table = await tableFor(key);
      if (name === "list") {
        const options = rest[0] || {};
        const sortField = table.fields.find((field) => !field.obsolete && field.key === String(options.sort || "").replace(/^-/u, ""));
        if (isCalculated(sortField)) throw new Error(`"${sortField.key}" is calculated, so records can't be sorted by it`);
        const size = Math.min(Math.max(Number(options.limit) || PAGE, 1), PAGE);
        const result = await gate.read(ctx, table.id, {
          where: whereFor(table, options.where, options.params),
          sort: sortField ? [{ field: sortField.id, desc: options.sort.startsWith("-") }] : [],
          page: { size, number: Number(options.page) || 1 }
        });
        return result.records.map((record) => scriptRecord(table, record));
      }
      if (name === "get") return (gate.get(ctx, table.id, String(rest[0]))).then((record) => scriptRecord(table, record), () => null);
      if (name === "totals") {
        const options = rest[0] || {};
        const id = (fieldKey) => table.fields.find((field) => !field.obsolete && field.key === fieldKey)?.id;
        if (!id(options.groupBy)) throw new Error(`${table.label} has no field "${options.groupBy}" to group by.`);
        const measureKey = options.sum || options.avg;
        if (measureKey && !id(measureKey)) throw new Error(`${table.label} has no field "${measureKey}".`);
        return gate.totals(ctx, table.id, {
          where: whereFor(table, options.where, options.params),
          groupBy: id(options.groupBy),
          measure: options.sum ? "sum" : options.avg ? "avg" : "count",
          field: measureKey ? id(measureKey) : null
        });
      }
      if (name === "create") return (gate.create(ctx, table.id, rest[0] || {})).then((record) => scriptRecord(table, record));
      if (name === "update") {
        return gate.update(ctx, table.id, String(rest[0]), rest[1] || {}).then((record) => scriptRecord(table, record));
      }
      if (name === "markObsolete") {
        return gate.markObsolete(ctx, table.id, String(rest[0])).then(() => ({ id: String(rest[0]), obsolete: true }));
      }
      throw new Error(`records.${name} isn't available here`);
    };
  }

  /**
   * One real run, recorded in the script's runs. `via` says what started it. A run for a visitor's
   * page (`reach`: their `visitor` and `access`) reaches only what the app's visitor access lists
   * (D-66); rules on saving and jobs run as the home. A run in a draft's preview (`reach.practice`)
   * works on the draft's practice copy and isn't recorded (D-71). With `runs`, the run's row is added
   * to it for the caller to write with others (recordRuns) instead of being written at once. `options`
   * are the call's that started it (a member's, a visitor's or a job's home); the run's reads and
   * writes, and its row, are its own, outside any transaction the caller holds.
   */
  async function execute(row, input, via, reach, runs, options, out = null) {
    const limits = row.kind === "rule" ? LIMITS.rule : LIMITS.run;
    const ctx = {
      // A button's changes in connected apps waiting for its person to confirm (scriptConnected.js), for runNamed's caller.
      ...(out ? { confirms: out.confirms } : {}),
      options: { context: options.context },
      actor: { type: "script", id: row.id, name: row.summary.slice(0, 80) },
      via: { kind: "script", appId: row.appId, scriptId: row.id, script: row.key, trigger: via },
      ...(reach?.visitor ? { visitor: reach.visitor, access: reach.access } : {}),
      ...(reach?.practice ? { practice: reach.practice } : {})
    };
    const started = Date.now();
    let outcome;
    try {
      const result = await pool.run({
        code: row.code,
        input,
        cpuMs: limits.cpuMs,
        memory: limits.memory,
        wallMs: limits.wallMs,
        host: hostFor(row.kind),
        call: realHost(ctx, limits, row)
      });
      outcome = { ok: true, value: result.value, calls: result.calls, logs: result.logs };
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      outcome = { ok: false, error: error.message, calls: error.calls || 0, logs: error.logs || [] };
    }
    const run = {
      scriptId: row.id,
      ms: Date.now() - started,
      calls: outcome.calls,
      ok: outcome.ok,
      error: outcome.error || null,
      log: outcome.logs.join("\n").slice(0, 4096) || null,
      via
    };
    if (ctx.practice) return outcome;
    if (runs) {
      runs.push(run);
    } else {
      await appScriptRuns.create(run, { ...ctx.options, returning: "none" });
    }
    return outcome;
  }

  /** Writes run rows collected by execute(), in their order, a statement per RUNS_PER_INSERT. */
  async function recordRuns(runs, options) {
    if (runs.length) await appScriptRuns.createMany(runs, { context: options.context, chunkSize: RUNS_PER_INSERT, returning: "none" });
  }

  /**
   * A script an app runs by name: a button's (`action`, its result becomes the button's effects) or
   * a screen query's (`source`: a list, totals as [{ label, value }], or one object). `reach`, for
   * a visitor's page, holds the run to their access, and for a draft's preview keeps it in the
   * practice copy, as execute() says.
   */
  async function runNamed(kind, appId, key, input, via, reach, options, out = null) {
    const { records: [row] } = await appScripts.query({ filters: { appId, key: String(key) }, page: { size: 1 } }, passedOn(options));
    if (!row || row.kind !== kind) {
      throw new GateError(409, `This app has no ${kind} script "${key}".`, { code: "apps_script_kind_missing", params: { kind, key } });
    }
    if (!row.enabled) {
      throw new GateError(409, `“${row.summary}” is switched off (the app's Logic tab).`, {
        code: "apps_script_switched_off",
        params: { script: row.summary }
      });
    }
    const outcome = await execute(row, input, via, reach, null, options, out);
    if (!outcome.ok) {
      throw new GateError(422, `Something went wrong in “${row.summary}”: ${outcome.error}`, {
        code: "apps_script_failed",
        params: { script: row.summary, reason: outcome.error }
      });
    }
    return outcome.value;
  }

  /**
   * Rules on saving: every enabled rule of the home for this table, in key order. Returns the
   * values to write (by field id), maybe filled in; a refusal or a broken rule stops the save. They
   * run as the home, in the practice copy when the save is a draft preview's.
   */
  async function beforeSave(ctx, table, action, values, previous, clean) {
    return applyRules(await rulesFor(ctx, table, action), ctx, table, action, values, previous, clean);
  }

  /**
   * The same rules, read once for many saves (an import): returns `{ apply, flush }`. apply(values,
   * previous) runs them as beforeSave does, but keeps each run's row; flush() writes the rows kept
   * so far together, so 500 rows under R rules cost one insert, not 500·R.
   */
  async function beforeSaveEach(ctx, table, action, clean) {
    const rules = await rulesFor(ctx, table, action);
    const runs = [];
    return {
      apply: (values, previous) => applyRules(rules, ctx, table, action, values, previous, clean, runs),
      flush: () => recordRuns(runs.splice(0), ctx.options)
    };
  }

  /** Every enabled rule of the home for this table and action, in key order. */
  async function rulesFor(ctx, table, action) {
    return appScripts.queryAll({ filters: { kind: "rule", enabled: true, ruleTable: table.id, ruleOn: action }, sort: ["key"] }, passedOn(ctx.options));
  }

  async function applyRules(rules, ctx, table, action, values, previous, clean, runs = null) {
    let next = values;
    for (const row of rules) {
      const record = scriptRecord(table, { ...(previous || {}), ...next, id: previous?.id ?? "" });
      const outcome = await execute(
        row,
        {
          action,
          record,
          previous: previous ? scriptRecord(table, previous) : null,
          actor: await whoActed({ type: "person", ...ctx.actor }, ctx.options)
        },
        { kind: "rule", table: table.key, by: ctx.via?.kind || null },
        ctx.practice ? { practice: ctx.practice } : null,
        runs,
        ctx.options
      );
      if (!outcome.ok) {
        throw new GateError(400, `A rule (${row.summary}) failed: ${outcome.error}`, {
          code: "apps_rule_failed",
          params: { rule: row.summary, reason: outcome.error }
        });
      }
      const result = outcome.value || {};
      if (result.refuse) throw new GateError(400, String(result.refuse).slice(0, 500), { code: "apps_rule_refused" });
      if (result.set && typeof result.set === "object") next = { ...next, ...clean(table, result.set) };
    }
    return next;
  }

  /**
   * The app's formula functions, ready for CEL: [{ name, arity, call }], and a key that changes
   * whenever one of them does (formula environments are cached by it).
   */
  const functionRows = (appId, options) =>
    appScripts.queryAll({ filters: { appId, kind: "function", enabled: true }, sort: ["key"] }, passedOn(options));
  async function functionsFor(appId, options) {
    const rows = await functionRows(appId, options);
    if (!rows.length) return null;
    const engine = await ready();
    return {
      id: `${appId}:${rows.map((row) => `${row.key}@${row.version}`).join(",")}`,
      list: rows.map((row) => ({
        name: row.key,
        arity: row.settings.params?.length || 0,
        call: (...args) => runFunction(engine, row.code, args)
      }))
    };
  }

  /** For the browser: the same functions' code, run there by the same sandbox. */
  async function functionCode(appId, options) {
    return (await functionRows(appId, options)).map((row) => ({
      name: row.key,
      params: row.settings.params || [],
      code: row.code,
      version: row.version
    }));
  }

  // ---- Jobs: timetables and watches, claimed once across servers ----

  // The call options of a job's run, in its script's home.
  const homeOf = (row) => ({ context: systemContext("due scripts").forWorkspace(row.workspaceId) });

  /** The next job whose timetable slot has come, taken with SKIP LOCKED and moved to its next slot. */
  async function claimTimetable() {
    return appScripts.withTransaction({ context: systemContext("due scripts") }, async (txOptions) => {
      const [row] = await appScripts.claim(
        { filters: { kind: "job", enabled: true, due: true }, sort: ["nextRunAt"], take: 1 },
        { ...txOptions, fields: SCRIPT_FIELDS }
      );
      if (!row) return null;
      await appScripts.patch(row.id, { nextRunAt: nextSlot(row.settings).toISOString() }, { ...txOptions, returning: "none" });
      return { row, input: { at: new Date().toISOString(), every: row.settings.every, timeZone: row.settings.timeZone || "UTC" } };
    });
  }

  /**
   * The next job watching a table that has changes since its cursor, taken with SKIP LOCKED: its
   * cursor moves to the horizon, and the changes it hasn't seen are matched as a watch's are.
   */
  async function claimWatch(matchChanges) {
    return appScripts.withTransaction({ context: systemContext("due scripts") }, async (txOptions) => {
      // The change horizon, read in the claim's transaction.
      const horizon = await appScripts.changeHorizon(txOptions);
      const candidates = await repository.watchingScriptsWithNews(horizon, txOptions);
      const [row] = candidates.length
        ? await appScripts.claim(
          { filters: { id: candidates, kind: "job", enabled: true }, sort: ["id"], take: 1 },
          { ...txOptions, fields: SCRIPT_FIELDS }
        )
        : [];
      if (!row) return null;
      const home = { ...txOptions, ...homeOf(row) };
      const watch = row.settings.watch;
      await appScripts.patch(row.id, { cursor: horizon }, { ...home, returning: "none" });
      const table = (await registry.loadTables(home)).find((entry) => entry.id === watch.table && !entry.obsolete);
      if (!table) return { row: null };
      // The script's own writes never set it off again.
      const { matches, count } = await matchChanges(home, {
        table,
        on: watch.on,
        cursor: row.cursor,
        horizon,
        condition: watch.condition,
        skip: (event) => event.via?.scriptId === row.id,
        keep: 100
      });
      return count ? { row, input: { changes: matches, more: count - matches.length } } : { row: null };
    });
  }

  /** Called by the watches loop: runs the jobs that are due, each slot or batch of changes once. */
  async function runDue({ matchChanges, max = 20 }) {
    for (let count = 0; count < max; count += 1) {
      const claimed = (await claimTimetable()) || (await claimWatch(matchChanges));
      if (!claimed) return;
      if (claimed.row) {
        await execute(claimed.row, claimed.input, { kind: claimed.input.changes ? "watch" : "timetable" }, null, null, homeOf(claimed.row));
      }
    }
  }

  /** Keeps each script's newest RUNS_KEPT runs, in every home. */
  async function prune() {
    const options = { context: systemContext("prune old script runs") };
    await connectedApps.prune(options);
    const ids = await repository.runsPastNewest(RUNS_KEPT, options);
    for (let start = 0; start < ids.length; start += RUNS_PER_INSERT) {
      await appScriptRuns.deleteWhere({ id: ids.slice(start, start + RUNS_PER_INSERT) }, options);
    }
  }

  const appOf = (slug, options) => apps.find(slug, options);

  const close = () => pool.close();

  return Object.freeze({
    appOf,
    recordRound,
    checkScript,
    test,
    save,
    remove,
    // readable-check: allow setter-seam - not a slot: switches a script off or on
    setEnabled,
    list,
    overview,
    runNamed,
    beforeSave,
    beforeSaveEach,
    functionsFor,
    functionCode,
    runDue,
    prune,
    forgetPerson,
    confirmConnected: connectedApps.confirm,
    connectedGuide,
    web,
    close
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ nextSlot });
