import { isDeepStrictEqual } from "node:util";
import { isCalculated, storedFieldIds } from "../shared/calculated.js";
import { fieldsIn } from "../shared/definitions.js";
import { BUILT_IN_FUNCTIONS, celSchema, evaluateFormula, isFormula } from "../shared/formulas.js";
import { ScriptError, runFunction } from "../shared/sandbox.js";
import { compileWhere, planToIds } from "../shared/where.js";

// Checking and testing a script before it's saved (scripts.js saves and runs them), with the
// limits, pages, where formulas and host functions that real runs share with tests.
const KINDS = ["action", "source", "rule", "function", "job"];
const KEY = /^[a-z][a-z0-9_]{0,63}$/u;
const MAX_CODE = 20000;
const MAX_TESTS = 20;
export const LIMITS = {
  run: { cpuMs: 1000, wallMs: 30000, memory: 32 * 1024 * 1024, data: 50, web: 5 },
  rule: { cpuMs: 500, wallMs: 10000, memory: 16 * 1024 * 1024, data: 20, web: 0 },
  test: { cpuMs: 1000, wallMs: 10000, memory: 32 * 1024 * 1024 }
};
export const PAGE = 100;
const EVERY = ["hour", "day", "week"];
export const ON = { create: ["create"], update: ["update"], any: ["create", "update"] };
const READS = { list: true, get: true, totals: true };
const WRITES = { create: true, update: true, markObsolete: true };

const typeOf = (value) => (typeof value === "number" ? "double" : typeof value === "boolean" ? "bool" : "string");

/** The where of records.list/totals: a formula over the table's fields, with `params` for values. */
export function whereFor(table, where, params) {
  if (!where) return null;
  if (!isFormula(where)) throw new ScriptError('where is a formula starting with "=", like "=stage == params.stage".');
  const clean = Object.fromEntries(
    Object.entries(params || {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
  );
  const variables = { params: Object.fromEntries(Object.entries(clean).map(([name, value]) => [name, typeOf(value)])) };
  // A filter runs in the database, on stored fields: a calculated one (D-78) isn't there.
  const keyToId = storedFieldIds(table);
  try {
    return { plan: planToIds(compileWhere({ ...celSchema(table), ...variables }, where), keyToId), variables, values: { params: clean } };
  } catch (error) {
    if (error.message !== "needs attention") throw new ScriptError(`where: ${error.message}`);
    const calculated = fieldsIn(where, { bareTable: table.key }).map(([, name]) => name)
      .find((name) => isCalculated(table.fields.find((field) => !field.obsolete && field.key === name)));
    throw new ScriptError(`where: ${calculated ? `"${calculated}" is calculated, so it can't be filtered on: filter on the fields it's worked out from` : "names a field this table doesn't have"}`);
  }
}

/** The host functions each kind of script may call. */
export const hostFor = (kind) =>
  kind === "rule" ? { records: READS } : kind === "function" ? {} : { records: { ...READS, ...WRITES }, web: { fetch: true } };

/**
 * Checking a script's shape and running its tests against fake records in the script pool.
 * @param {object} dependencies
 * @param {import("./types.js").ScriptPool} dependencies.pool
 * @param {() => Promise<object>} dependencies.ready The QuickJS module formula functions run in.
 */
export function createScriptChecks({ pool, ready }) {
  /** What a script must look like to be saved, by kind. Returns cleaned settings (tables by id). */
  function checkScript(input, tables) {
    const live = tables.filter((table) => !table.obsolete);
    const tableNamed = (key) => live.find((table) => table.key === key);
    const errors = [];
    const fail = (path, message) => errors.push({ path, message });
    if (!KEY.test(String(input.key || ""))) fail("key", "use a–z, 0–9 and _, starting with a letter (e.g. score_leads).");
    if (!KINDS.includes(input.kind)) fail("kind", `must be one of: ${KINDS.join(", ")}.`);
    if (!String(input.summary || "").trim()) fail("summary", "say in a sentence what it does, for people to read.");
    if (typeof input.code !== "string" || !input.code.trim()) fail("code", "needs the script, defining function main.");
    else if (input.code.length > MAX_CODE) fail("code", `at most ${MAX_CODE} characters.`);
    if (!Array.isArray(input.tests) || !input.tests.length) fail("tests", "needs at least one test: { name, input, expect }.");
    else if (input.tests.length > MAX_TESTS) fail("tests", `at most ${MAX_TESTS} tests.`);
    const settings = input.settings || {};
    let clean = {};
    if (input.kind === "rule") {
      const table = tableNamed(settings.table);
      if (!table) fail("settings.table", `must name a table of this home: ${live.map((entry) => entry.key).join(", ")}.`);
      const on = Array.isArray(settings.on) && settings.on.length ? settings.on : ["create", "update"];
      if (!on.every((action) => ["create", "update"].includes(action))) fail("settings.on", "lists create and/or update.");
      clean = { table: table?.id, on };
    }
    if (input.kind === "function") {
      const params = Array.isArray(settings.params) ? settings.params : [];
      if (params.length > 6 || !params.every((name) => /^[a-z][a-zA-Z0-9_]*$/u.test(String(name)))) {
        fail("settings.params", 'names the function\'s arguments (at most 6), e.g. ["amount"].');
      }
      if (BUILT_IN_FUNCTIONS.has(input.key)) fail("key", `"${input.key}" is a built-in function of formulas; choose another name.`);
      clean = { params };
    }
    if (input.kind === "job") {
      if (settings.watch) {
        const table = tableNamed(settings.watch.table);
        if (!table) fail("settings.watch.table", "must name a table of this home.");
        const on = settings.watch.on || "any";
        if (!ON[on]) fail("settings.watch.on", "must be create, update or any.");
        if (settings.watch.condition && !isFormula(settings.watch.condition)) {
          fail("settings.watch.condition", 'a formula like "=row.stage == \\"Won\\"".');
        }
        clean = { watch: { table: table?.id, on, ...(settings.watch.condition ? { condition: settings.watch.condition } : {}) } };
      } else {
        if (!EVERY.includes(settings.every)) {
          fail("settings.every", "a job runs every hour, day or week, or on a watch: { watch: { table, on, condition? } }.");
        }
        if (settings.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(settings.at)) fail("settings.at", "a time like 08:30.");
        if (settings.every === "week" && !(Number.isInteger(settings.day) && settings.day >= 0 && settings.day <= 6)) {
          fail("settings.day", "the weekday, 0 (Sunday) to 6 (Saturday).");
        }
        const timeZone = settings.timeZone || "UTC";
        try {
          new Intl.DateTimeFormat("en-US", { timeZone });
        } catch {
          fail("settings.timeZone", "a time zone like Europe/Rome.");
        }
        clean = {
          every: settings.every,
          at: settings.at || "00:00",
          ...(settings.every === "week" ? { day: settings.day } : {}),
          timeZone
        };
      }
    }
    return { errors, settings: clean };
  }

  /** Test doubles for the record functions: the test's `records` ({ table: [records] }), in memory. */
  function fakeRecords(tables, seed = {}) {
    const store = new Map();
    let nextId = 1000;
    const tableNamed = (key) => {
      const table = tables.find((entry) => !entry.obsolete && entry.key === key);
      if (!table) throw new Error(`No table "${key}".`);
      return table;
    };
    const rows = (table) => {
      if (!store.has(table.key)) {
        store.set(
          table.key,
          (seed[table.key] || []).map((record, index) => ({ id: String(record.id ?? index + 1), ...record }))
        );
      }
      return store.get(table.key);
    };
    const named = (table, values) => {
      for (const name of Object.keys(values || {})) {
        if (name !== "id" && !table.fields.some((field) => !field.obsolete && field.key === name)) {
          throw new Error(`${table.label} has no field "${name}".`);
        }
      }
      return values || {};
    };
    const matching = (table, { where, params } = {}) => rows(table).filter((record) => {
      if (record.obsolete) return false;
      if (!where) return true;
      const values = Object.fromEntries(
        table.fields
          .filter((field) => !field.obsolete)
          .map((field) => [
            field.key,
            record[field.key] ?? (["number", "money"].includes(field.type) ? 0 : field.type === "yesno" ? false : "")
          ])
      );
      const variables = whereFor(table, where, params).variables;
      return evaluateFormula({ ...celSchema(table), ...variables }, where, { ...values, id: record.id, params: params || {} }) === true;
    });
    const plain = ({ obsolete, ...record }) => record;
    return {
      list: (key, options = {}) => {
        const table = tableNamed(key);
        let found = matching(table, options);
        if (options.sort) {
          const field = options.sort.replace(/^-/u, "");
          const sign = options.sort.startsWith("-") ? -1 : 1;
          found = [...found].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
        }
        const size = Math.min(Math.max(Number(options.limit) || PAGE, 1), PAGE);
        const page = Math.max(Number(options.page) || 1, 1);
        return found.slice((page - 1) * size, page * size).map(plain);
      },
      get: (key, id) => {
        const record = rows(tableNamed(key)).find((entry) => entry.id === String(id));
        return record ? plain(record) : null;
      },
      totals: (key, options = {}) => {
        const table = tableNamed(key);
        const groups = new Map();
        const measure = options.sum || options.avg;
        for (const record of matching(table, options)) {
          const group = groups.get(record[options.groupBy] ?? null) || { key: record[options.groupBy] ?? null, count: 0, sum: 0 };
          group.count += 1;
          group.sum += Number(record[measure] || 0);
          groups.set(group.key, group);
        }
        return [...groups.values()].map((group) => ({
          key: group.key,
          count: group.count,
          ...(measure ? { total: options.avg ? group.sum / group.count : group.sum } : {})
        }));
      },
      create: (key, values) => {
        const table = tableNamed(key);
        const record = { id: String((nextId += 1)), ...named(table, values) };
        rows(table).push(record);
        return plain(record);
      },
      update: (key, id, values) => {
        const table = tableNamed(key);
        const record = rows(table).find((entry) => entry.id === String(id));
        if (!record) throw new Error("That record doesn't exist.");
        Object.assign(record, named(table, values));
        return plain(record);
      },
      markObsolete: (key, id) => {
        const record = rows(tableNamed(key)).find((entry) => entry.id === String(id));
        if (!record) throw new Error("That record doesn't exist.");
        record.obsolete = true;
        return { id: record.id, obsolete: true };
      }
    };
  }

  /** Runs every test; each gets its own fake records. `web` answers web.fetch by URL. */
  async function runTests(input, tables) {
    const results = [];
    for (const [index, test] of (input.tests || []).entries()) {
      const name = String(test?.name || `test ${index + 1}`);
      try {
        let value;
        let logs = [];
        if (input.kind === "function") {
          value = runFunction(await ready(), input.code, Array.isArray(test.input) ? test.input : [test.input]);
        } else {
          const fake = fakeRecords(tables, test.records || {});
          const answers = test.web || {};
          const result = await pool.run({
            code: input.code,
            input: test.input ?? null,
            ...LIMITS.test,
            host: hostFor(input.kind),
            call: async (group, operation, args) => {
              if (group === "web") {
                const answer = answers[String(args[0])];
                if (!answer) throw new Error(`no web answer for ${args[0]} in this test`);
                return {
                  status: 200,
                  ok: true,
                  headers: {},
                  text: typeof answer === "string" ? answer : JSON.stringify(answer),
                  json: typeof answer === "string" ? null : answer,
                  ...(answer.status ? answer : {})
                };
              }
              return fake[operation](...args);
            }
          });
          value = result.value;
          logs = result.logs;
        }
        if (test.expectError !== undefined) {
          results.push({ name, passed: false, expected: `an error containing "${test.expectError}"`, got: value, logs });
        } else if (!isDeepStrictEqual(value, test.expect ?? null)) {
          results.push({ name, passed: false, expected: test.expect ?? null, got: value, logs });
        } else {
          results.push({ name, passed: true });
        }
      } catch (error) {
        const message = String(error?.message || error);
        if (test.expectError !== undefined && message.includes(String(test.expectError))) {
          results.push({ name, passed: true });
        } else {
          results.push({
            name,
            passed: false,
            expected: test.expectError !== undefined ? `an error containing "${test.expectError}"` : (test.expect ?? null),
            error: message,
            logs: error.logs || []
          });
        }
      }
    }
    return results;
  }

  return Object.freeze({
    checkScript,
    runTests
  });
}
