// readable-check: allow no-transaction-reader - infrastructure: AnyAPI writes a home's runtime tables (no table resource describes them) in the transaction the audit_events handle opened, which it takes as its own Knex transaction
import { publishIn } from "@local/notices/server/publishIn";
import { PAGE_MAX, isCalculated, withCalculated } from "../shared/index.js";
import { OBSOLETE } from "./anyapi.js";
import { homeIdOf } from "./callOptions.js";
import { GateError, cleanRecord } from "./validate.js";
import {
  checkFields,
  fence,
  isFenced,
  labelled,
  linkedRows,
  ownsRecord,
  planFields,
  project,
  refuse,
  rowsWhere,
  visitorInput
} from "./visitorAccess.js";

const IMPORT_MAX = 500;
// The Activity filter's actors: every person, bot and script of a home that changed something.
const ACTORS_MAX = 1000;
// A calculated field's sum or average is worked out from the records themselves (D-78), read a page
// at a time: past this many, the total is refused rather than slow every view that shows it.
const CALCULATED_TOTALS_MAX = 5000;

/**
 * A spreadsheet cell as the gate expects it: money is written in units (12.50 → 1250 cents),
 * yes/no accepts yes, no, true, false, 1 and 0, a date may carry a time, and a link is the linked
 * record's title (as exported) or its id.
 */
function fromSheet(table, row, titles) {
  const input = {};
  for (const [fieldId, cell] of Object.entries(row || {})) {
    const field = table.fields.find((entry) => entry.id === fieldId);
    const text = String(cell ?? "").trim();
    // A calculated column of an exported sheet is worked out again from the others, never imported.
    if (!field || !text || isCalculated(field)) continue;
    if (field.type === "money") {
      const plain = text.replace(/[\s,]/gu, "").replace(/^[^\d.-]{1,3}/u, ""); // "$1,250.50" → "1250.50"
      if (!/^-?\d*\.?\d+$/u.test(plain)) {
        throw new GateError(400, `${field.label}: must be an amount like 12.50.`, {
          code: "apps_value_amount_invalid",
          params: { field: field.label }
        });
      }
      input[fieldId] = Math.round(Number(plain) * 100);
    } else if (field.type === "yesno") {
      const word = text.toLowerCase();
      input[fieldId] = ["yes", "y", "true", "1"].includes(word) ? true : ["no", "n", "false", "0"].includes(word) ? false : text;
    } else if (field.type === "date") {
      input[fieldId] = /^\d{4}-\d{2}-\d{2}T/u.test(text) ? text.slice(0, 10) : text;
    } else if (field.type === "link") {
      const ids = titles.get(fieldId)?.get(text.toLowerCase()) || [];
      if (ids.length > 1) {
        throw new GateError(400, `${field.label}: ${ids.length} records are called "${text}".`, {
          code: "apps_link_value_ambiguous",
          params: { field: field.label, count: ids.length, text }
        });
      }
      input[fieldId] = ids[0] || text;
    } else {
      input[fieldId] = cell;
    }
  }
  return input;
}

/**
 * Every read and write of a home's records.
 *
 * The only door to a home's records (D-35): screens, the Data tab, bots and imports all come
 * through here. It validates by field type, never deletes, and writes the audit entry in the same
 * transaction as the change. ctx = { options, actor: { type, id, name }, via: { kind, … } }, where
 * `options` are the call options of whoever acts (a member's request, a visitor's or a job's home):
 * the home is theirs, and the audit_events handle writes under them.
 * A visitor's ctx also carries `visitor` and `access`, and every call is held to that access, the
 * one fence around a home's records (D-66, visitorAccess.js).
 * A draft preview's ctx carries `practice` (practice.js): its reads and writes go to the draft's
 * practice copy instead of the home's records, and leave no audit entry and no notice (D-71); what
 * it changed is added to `practice.changes` for the call to report.
 * @param {object} dependencies
 * @param {{ auditEvents: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} dependencies.resources
 * @param {{ nextActor: (afterId: string | null, options: object) => Promise<object | null> }} dependencies.repository
 * @param {import("./types.js").Anyapi} dependencies.anyapi
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {import("./types.js").Practices} dependencies.practices
 * @param {(ctx: object, table: object, action: string, values: object, previous: object | null,
 *   clean: Function) => Promise<object>} dependencies.beforeSave Scripts' rules on saving: returns the
 *   values to write, maybe filled in, or throws a GateError to refuse.
 * @param {(ctx: object, table: object, action: string, clean: Function) => Promise<{
 *   apply: (values: object, previous: object | null) => Promise<object>, flush: () => Promise<void> }>} [dependencies.beforeSaveEach]
 *   The same rules read once for many saves (an import): apply runs them for one save, and flush
 *   records the runs made so far together; by default, beforeSave for each and nothing to flush.
 * @param {number} [dependencies.calculatedTotalsMax] The most records a calculated field's sum or average is worked out
 *   from (see above); a test makes it small.
 */
export function createDataGate({
  resources,
  repository,
  anyapi,
  registry,
  practices,
  beforeSave,
  beforeSaveEach = async (ctx, table, action, clean) => ({
    apply: (values, previous) => beforeSave(ctx, table, action, values, previous, clean),
    flush: async () => {}
  }),
  calculatedTotalsMax = CALCULATED_TOTALS_MAX
}) {
  const { auditEvents } = resources;
  // The home a ctx acts in: its call options'.
  const homeOf = (ctx) => homeIdOf(ctx.options);

  /** A table of the call's home by id, or by its live key. */
  async function tableFor(tableIdOrKey, options, { forWrite = false } = {}) {
    const tables = await registry.loadTables(options);
    const table =
      tables.find((entry) => entry.id === tableIdOrKey) || tables.find((entry) => !entry.obsolete && entry.key === tableIdOrKey);
    if (!table) throw new GateError(404, `No table "${tableIdOrKey}".`, { code: "apps_table_not_found", params: { table: tableIdOrKey } });
    if (forWrite && table.obsolete) {
      throw new GateError(409, `${table.label} has been removed and can't be changed.`, {
        code: "apps_table_removed",
        params: { table: table.label }
      });
    }
    return { table, tables };
  }

  /**
   * The AnyAPI instance a ctx reads and writes `table` in: the home's, or its practice copy's, which
   * first gets the table and the tables its links point to (their labels are read with it).
   */
  async function apiFor(ctx, tables, table) {
    if (!ctx.practice) return anyapi.instanceFor(homeOf(ctx));
    const linked = table.fields.filter((field) => field.type === "link").map((field) => tables.find((entry) => entry.id === field.options?.target));
    for (const each of [table, ...linked.filter(Boolean)]) await practices.ensure(ctx.practice, tables, each, ctx.options);
    return anyapi.practiceFor(homeOf(ctx), ctx.practice.id, tables);
  }

  const toRecord = (table, row) => {
    if (!row) return null;
    const record = { id: String(row.id), obsolete: Boolean(row[OBSOLETE]) };
    for (const field of table.fields) record[field.id] = row[field.id] ?? null;
    return withCalculated(table, record);
  };

  /**
   * A table's records by id, obsolete ones too, as a Map of id → row: one query per PAGE_MAX ids
   * rather than a get() each. `where` keeps only the records it matches.
   */
  async function rowsById(api, table, ids, { where = null, includeObsolete = true } = {}) {
    const wanted = [...new Set(ids.map(String))];
    const found = new Map();
    for (let start = 0; start < wanted.length; start += PAGE_MAX) {
      const batch = wanted.slice(start, start + PAGE_MAX);
      const result = await api.resources[table.id].query(
        { queryParams: { page: { size: batch.length } } },
        { ids: batch, where, includeObsolete }
      );
      for (const row of result.data) found.set(String(row.id), row);
    }
    return found;
  }

  /**
   * Link values come back as { id, label, obsolete }, one batched read per link field. A visitor
   * gets a label only when the linked table's title is theirs to read, and only for the records
   * they reach there (its rows); otherwise { id, label: null }, whether or not the record exists.
   */
  async function withLinks(ctx, api, tables, table, records) {
    for (const field of table.fields.filter((entry) => entry.type === "link")) {
      const target = tables.find((entry) => entry.id === field.options?.target);
      const ids = [...new Set(records.map((record) => record[field.id]).filter(Boolean))];
      const shown = target && labelled(ctx, target);
      const found = shown && ids.length ? await rowsById(api, target, ids, { where: linkedRows(ctx, target) }) : new Map();
      for (const record of records) {
        const id = record[field.id];
        if (!id) continue;
        const row = found.get(String(id));
        if (target && (!shown || (isFenced(ctx) && !row))) {
          record[field.id] = { id: String(id), label: null };
          continue;
        }
        record[field.id] = {
          id: String(id),
          label: row ? String(row[target.titleFieldId] ?? id) : String(id),
          obsolete: !row || Boolean(row[OBSOLETE]),
          missing: !row
        };
      }
    }
    return records;
  }

  /**
   * A page of records. A visitor needs `list`, filters and sorts by readable fields only, reaches
   * only their rows and never obsolete records, and gets readable fields only.
   */
  async function read(ctx, tableIdOrKey, { where = null, sort = [], page = {}, includeObsolete = false } = {}) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options);
    const access = fence(ctx, table, "list");
    const api = await apiFor(ctx, tables, table);
    const size = Math.min(Math.max(Number(page.size) || 50, 1), PAGE_MAX);
    const number = Math.max(Number(page.number) || 1, 1);
    // A calculated field has no column to sort by (D-78): the save check refuses it in a screen's sort.
    const sorted = sort.filter((entry) => table.fields.some((field) => field.id === entry.field && !isCalculated(field)));
    if (access) {
      checkFields(access, table, [...planFields(where?.plan), ...sorted.map((entry) => entry.field)]);
      where = rowsWhere(access, where);
      includeObsolete = false;
    }
    const sortParams = sorted.map((entry) => `${entry.desc ? "-" : ""}${entry.field}`);
    const result = await api.resources[table.id].query(
      { queryParams: { ...(sortParams.length ? { sort: sortParams } : {}), page: { size, number } } },
      { where, includeObsolete }
    );
    const records = result.data.map((row) => toRecord(table, row)).map((record) => (access ? project(access, record) : record));
    return {
      records: await withLinks(ctx, api, tables, table, records),
      page: { size, number },
      total: result.meta?.pagination?.total ?? null
    };
  }

  /** One record. A visitor needs `get`; a record outside their rows, or obsolete, answers 404. */
  async function get(ctx, tableIdOrKey, id, { includeObsolete = true } = {}) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options);
    const access = fence(ctx, table, "get");
    const api = await apiFor(ctx, tables, table);
    const row = access
      ? ((await rowsById(api, table, [id], { where: rowsWhere(access, null), includeObsolete: false })).get(String(id)) ?? null)
      : await api.resources[table.id].get({ id: String(id) }, { includeObsolete }).catch((error) => {
        if (error?.subtype === "not_found" || /not found/iu.test(String(error?.message))) return null;
        throw error;
      });
    if (!row) throw new GateError(404, "That record doesn't exist.", { code: "apps_record_not_found" });
    const record = toRecord(table, row);
    const [linked] = await withLinks(ctx, api, tables, table, [access ? project(access, record) : record]);
    return linked;
  }

  /**
   * Records by id as get() reads each, obsolete ones too, in a few queries: a Map of id → record,
   * without the missing. A visitor gets labels only (a listed table's records within its rows,
   * with their title when it's readable), for totals grouped by a link.
   */
  async function getMany(ctx, tableIdOrKey, ids) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options);
    const access = fence(ctx, table);
    const api = await apiFor(ctx, tables, table);
    const rows = [...(await rowsById(api, table, ids, { where: linkedRows(ctx, table) })).values()];
    if (access) {
      const titled = { ...access, read: new Set(access.read.has(table.titleFieldId) ? [table.titleFieldId] : []) };
      return new Map(rows.map((row) => project(titled, toRecord(table, row))).map((record) => [record.id, record]));
    }
    const records = await withLinks(ctx, api, tables, table, rows.map((row) => toRecord(table, row)));
    return new Map(records.map((record) => [record.id, record]));
  }

  /**
   * Links must point to existing records, obsolete ones too. `known` (target table id → ids found)
   * lets many saves, such as an import's rows, skip reading the same records again. With a visitor's
   * ctx, only to records they reach (the linked table's rows): any other reads as missing.
   */
  async function checkLinks(api, tables, table, values, known = new Map(), ctx = null) {
    for (const field of table.fields.filter((entry) => entry.type === "link" && values[entry.id])) {
      const target = tables.find((entry) => entry.id === field.options?.target);
      const id = String(values[field.id]);
      if (target && !known.get(target.id)?.has(id) && (await rowsById(api, target, [id], { where: linkedRows(ctx, target) })).has(id)) {
        known.set(target.id, (known.get(target.id) || new Set()).add(id));
      }
      if (!target || !known.get(target.id)?.has(id)) {
        const what = target?.label || "record";
        throw new GateError(400, `${field.label}: that ${what} doesn't exist.`, {
          code: "apps_link_value_missing",
          params: { field: field.label, target: what }
        });
      }
    }
  }

  const auditRow = (ctx, tableId, recordId, action, changes) => ({
    actor: ctx.actor,
    via: ctx.via || {},
    tableId,
    recordId: String(recordId),
    action,
    changes
  });

  /**
   * A write's transaction, the audit_events handle's, which AnyAPI joins as its Knex transaction:
   * the change, its audit entry and its notice commit together or not at all.
   * @param {object} ctx
   * @param {(txOptions: object) => Promise<any>} work
   */
  const withTransaction = (ctx, work) => auditEvents.withTransaction(ctx.options, work);

  /**
   * Writes join the given `txOptions` (from withTransaction: several steps of one button succeed or
   * fail together); otherwise each runs in its own.
   */
  const within = (ctx, given, work) => (given ? work(given) : withTransaction(ctx, work));

  // Open views re-read a table that changed (D-55): the notice goes out when the write commits.
  const dataChanged = (txOptions, ctx, table) => publishIn(txOptions, "apps-data", homeOf(ctx), { tables: [table.id] });

  /**
   * A change's audit entry and notice; a practice copy's change is only added to what the call
   * reports (D-71), as `{ table, id, action, changes }` by field id.
   */
  async function recorded(ctx, table, recordId, action, changes, txOptions) {
    if (ctx.practice) {
      ctx.practice.changes.push({ table: table.id, id: String(recordId), action, changes });
      return;
    }
    await auditEvents.create(auditRow(ctx, table.id, recordId, action, changes), { ...txOptions, returning: "none" });
    await dataChanged(txOptions, ctx, table);
  }

  /** A new record's audit changes: each value given, from nothing. */
  const createdChanges = (values) =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([, value]) => value !== null)
        .map(([fieldId, value]) => [fieldId, [null, value]])
    );

  /**
   * What a new record must pass before it's written, for create() and for each row of an import:
   * values by type, the table's rules (`rules`) and links. Returns the values to write; `known` is
   * as for checkLinks.
   */
  async function checkNew(ctx, api, tables, table, input, rules, known) {
    const values = cleanRecord(table, await rules(cleanRecord(table, input, { creating: true })), { creating: true });
    await checkLinks(api, tables, table, values, known);
    return values;
  }

  /**
   * A visitor needs `create`, writes only `write`, links only to records they reach, and the owner
   * is set to them; they get back only what they may read.
   */
  async function create(ctx, tableIdOrKey, input, { txOptions: given = null } = {}) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options, { forWrite: true });
    const access = fence(ctx, table, "create");
    const api = await apiFor(ctx, tables, table);
    if (access) {
      input = visitorInput(access, table, ctx, input, { creating: true });
      await checkLinks(api, tables, table, cleanRecord(table, input), new Map(), ctx);
    }
    const values = await checkNew(ctx, api, tables, table, input, (cleaned) => beforeSave(ctx, table, "create", cleaned, null, cleanRecord));
    const row = await within(ctx, given, async (txOptions) => {
      const created = await api.resources[table.id].post({ data: values, transaction: txOptions.trx }, { includeObsolete: true });
      await recorded(ctx, table, created.id, "create", createdChanges(values), txOptions);
      return created;
    });
    return access ? project(access, toRecord(table, row)) : toRecord(table, row);
  }

  /**
   * A visitor changes or marks obsolete only their own live records, never restores one, and gets
   * back only what they may read.
   */
  async function change(ctx, tableIdOrKey, id, input, action, given = null) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options, { forWrite: true });
    if (action === "restore") refuse(ctx);
    const access = fence(ctx, table, action === "obsolete" ? "delete" : "update");
    let values = input;
    const api = await apiFor(ctx, tables, table);
    const row = await within(ctx, given, async (txOptions) => {
      const transaction = txOptions.trx;
      // AnyAPI's get() has no not-found answer: it throws for a missing record, which reads as null here.
      const before = await api.resources[table.id].get({ id: String(id), transaction }, { includeObsolete: true }).catch(() => null);
      if (!before || (access && (before[OBSOLETE] || !ownsRecord(access, ctx, before)))) {
        throw new GateError(404, "That record doesn't exist.", { code: "apps_record_not_found" });
      }
      if (action === "update") {
        const ruled = await beforeSave(ctx, table, "update", values, before, cleanRecord);
        if (ruled !== values) await checkLinks(api, tables, table, (values = ruled));
      }
      const changes = {};
      for (const [fieldId, value] of Object.entries(values)) {
        const old = before[fieldId] ?? null;
        if (String(old) !== String(value ?? null) || (old === null) !== (value === null)) changes[fieldId] = [old, value];
      }
      if (!Object.keys(changes).length) return before;
      const after = await api.resources[table.id].patch({ id: String(id), data: values, transaction }, { includeObsolete: true });
      await recorded(ctx, table, id, action, action === "update" ? changes : {}, txOptions);
      return after;
    });
    return access ? project(access, toRecord(table, row)) : toRecord(table, row);
  }

  async function update(ctx, tableIdOrKey, id, input, { txOptions = null } = {}) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options, { forWrite: true });
    const access = fence(ctx, table, "update");
    const values = cleanRecord(table, access ? visitorInput(access, table, ctx, input) : input);
    await checkLinks(await apiFor(ctx, tables, table), tables, table, values, new Map(), access ? ctx : null);
    return change(ctx, table.id, id, values, "update", txOptions);
  }

  /** Nothing is ever deleted: obsolete records are hidden, kept, and can come back. */
  const markObsolete = (ctx, tableIdOrKey, id, { txOptions = null } = {}) =>
    change(ctx, tableIdOrKey, id, { [OBSOLETE]: new Date().toISOString() }, "obsolete", txOptions);
  const restore = (ctx, tableIdOrKey, id, { txOptions = null } = {}) =>
    change(ctx, tableIdOrKey, id, { [OBSOLETE]: null }, "restore", txOptions);

  async function history(ctx, tableIdOrKey, id) {
    refuse(ctx);
    const { table } = await tableFor(tableIdOrKey, ctx.options);
    return newestAudits({ tableId: table.id, recordId: String(id) }, 200, ctx.options);
  }

  /** The newest audit entries the filters select, up to `limit`: one page. */
  async function newestAudits(filters, limit, options) {
    return (await auditEvents.query({ filters, sort: ["-id"], page: { size: limit } }, options)).records;
  }

  /**
   * Grouped totals through json-rest-api's aggregate (2.2), so the same row policy applies as for
   * lists: the home's tenant, the page's filter, and obsolete records hidden. A visitor needs `list`,
   * and groups, sums and filters by readable fields only, over their rows.
   */
  async function totals(ctx, tableIdOrKey, { where = null, groupBy, measure = "count", field = null } = {}) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options);
    where = fencedWhere(ctx, table, where, [groupBy, measure === "count" ? null : field]);
    const api = await apiFor(ctx, tables, table);
    const grouping = table.fields.find((entry) => entry.id === groupBy);
    if (isCalculated(grouping)) {
      throw new GateError(400, `${grouping.label} is calculated, so records can't be grouped by it: group by a field it is worked out from.`, {
        code: "apps_calculated_group",
        params: { field: grouping.label }
      });
    }
    if (measure !== "count" && isCalculated(table.fields.find((entry) => entry.id === field))) {
      return (await calculatedMeasure(api, table, where, measure, field, groupBy)).slice(0, 100);
    }
    const measures = { count: { count: "*" }, ...(measure === "sum" || measure === "avg" ? { total: { [measure]: field } } : {}) };
    const result = await api.resources[table.id].aggregate({
      groupBy: [groupBy],
      measures,
      queryParams: { sort: [measure === "count" ? "-count" : "-total"], page: { size: 100 } }
    }, { where });
    return (result.data || []).map((row) => ({
      key: row[groupBy],
      count: Number(row.count),
      ...(row.total !== undefined && row.total !== null ? { total: Number(row.total) } : {})
    }));
  }

  /** One figure across a table's matching records, whatever the groups: how many, and the sum or average. */
  async function grandTotal(ctx, tableIdOrKey, { where = null, measure = "count", field = null } = {}) {
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options);
    where = fencedWhere(ctx, table, where, [measure === "count" ? null : field]);
    const api = await apiFor(ctx, tables, table);
    if (measure !== "count" && isCalculated(table.fields.find((entry) => entry.id === field))) {
      const [all = { count: 0 }] = await calculatedMeasure(api, table, where, measure, field, null);
      return { count: all.count, ...(all.total !== undefined ? { total: all.total } : {}) };
    }
    const measures = { count: { count: "*" }, ...(measure === "sum" || measure === "avg" ? { total: { [measure]: field } } : {}) };
    const row = (await api.resources[table.id].aggregate({ measures }, { where })).data?.[0];
    return { count: Number(row?.count ?? 0), ...(row?.total !== undefined && row?.total !== null ? { total: Number(row.total) } : {}) };
  }

  /**
   * The sum or average (`measure`) of a calculated field, by `groupBy` (a stored field's id) or for
   * all, as the database's aggregate answers them: groups with the most first, a count of every
   * record, and a total only over the records whose value could be worked out. The records are read
   * a page at a time, up to calculatedTotalsMax; past that, they're counted and refused unread.
   */
  async function calculatedMeasure(api, table, where, measure, fieldId, groupBy) {
    const field = table.fields.find((entry) => entry.id === fieldId);
    const counted = await api.resources[table.id].aggregate({ measures: { count: { count: "*" } } }, { where });
    if (Number(counted.data?.[0]?.count ?? 0) > calculatedTotalsMax) {
      throw new GateError(400, `${field.label} is calculated, so its ${measure === "avg" ? "average" : "sum"} is worked out from the records, and there are more than ${calculatedTotalsMax}: filter them first.`, {
        code: "apps_calculated_totals_too_many",
        params: { field: field.label, max: calculatedTotalsMax }
      });
    }
    const groups = new Map();
    // No more pages than the bound fills, even when records are added while it reads.
    for (let number = 1; (number - 1) * PAGE_MAX < calculatedTotalsMax; number += 1) {
      const { data } = await api.resources[table.id].query({ queryParams: { page: { size: PAGE_MAX, number } } }, { where });
      for (const row of data) {
        const key = groupBy ? (row[groupBy] ?? null) : null;
        const group = groups.get(key) || { key, count: 0, sum: 0, values: 0 };
        groups.set(key, group);
        group.count += 1;
        const value = toRecord(table, row)[fieldId];
        if (typeof value === "number") {
          group.sum += value;
          group.values += 1;
        }
      }
      if (data.length < PAGE_MAX) break;
    }
    return [...groups.values()]
      .map(({ key, count, sum, values }) => ({ key, count, ...(values ? { total: measure === "avg" ? sum / values : sum } : {}) }))
      .sort((first, second) => (second.total ?? -Infinity) - (first.total ?? -Infinity));
  }

  /** A totals' `where` for a visitor: `list`, readable fields only (with `fields`), and their rows. */
  function fencedWhere(ctx, table, where, fields) {
    const access = fence(ctx, table, "list");
    if (!access) return where;
    checkFields(access, table, [...planFields(where?.plan), ...fields]);
    return rowsWhere(access, where);
  }

  /** How many live (not obsolete) records a table has. */
  async function count(ctx, tableIdOrKey) {
    refuse(ctx);
    const { table } = await tableFor(tableIdOrKey, ctx.options);
    const api = await anyapi.instanceFor(homeOf(ctx));
    const result = await api.resources[table.id].aggregate({ measures: { count: { count: "*" } } }, {});
    return Number(result.data?.[0]?.count ?? 0);
  }

  /** The audit trail of a home, newest first, by table, app or person; `before` pages by id. */
  async function activity(ctx, { table = null, app = null, actor = null, from = null, to = null, before = null, limit = 50 } = {}) {
    refuse(ctx);
    const filters = {
      ...(table ? { tableId: table } : {}),
      ...(app ? { viaApp: String(app) } : {}),
      ...(actor ? { actorId: String(actor) } : {}),
      ...(from ? { atFrom: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { atBefore: new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString() } : {}),
      ...(before ? { beforeId: String(before) } : {})
    };
    return (await newestAudits(filters, Math.min(Number(limit) || 50, 200), ctx.options)).map((entry) => ({
      id: String(entry.id),
      at: entry.at,
      actor: entry.actor,
      via: entry.via,
      tableId: entry.tableId,
      recordId: entry.recordId,
      action: entry.action,
      changes: entry.changes
    }));
  }

  /**
   * Everyone and every bot that has changed something in this home, for the Activity filter: one
   * entry per actor id, with the type and name of their latest entry. A loose index scan over
   * ix_audit_events_actor (workspace_id, actor id, id desc): each step reads the first entry past the
   * previous actor in the index's own order, which is the next actor's latest, so the cost grows with
   * the number of actors, not with the home's history. Asking for "the latest entry of actor X" apart
   * instead lets the planner walk the home's entries newest first until it meets X, which for someone
   * who changed something long ago is the whole history.
   */
  async function actors(ctx) {
    refuse(ctx);
    const found = [];
    // One statement per actor, the loose index scan's steps (nextActor); past ACTORS_MAX the filter lists the first ones.
    for (let actor = await repository.nextActor(null, ctx.options); actor && found.length < ACTORS_MAX; ) {
      found.push({ id: String(actor.id), type: actor.type ?? null, name: actor.name ?? null });
      actor = await repository.nextActor(String(actor.id), ctx.options);
    }
    return found;
  }

  /** Two `where`s that must both hold; either may be null. */
  const bothWhere = (first, second) =>
    !first || !second
      ? first || second
      : {
          plan: { kind: "and", items: [first.plan, second.plan] },
          variables: { ...first.variables, ...second.variables },
          values: { ...first.values, ...second.values }
        };

  /**
   * A table's records, obsolete ones too, whose title (trimmed and lowercased) is one of `texts`
   * (lowercased): a query per PAGE_MAX texts, and another page while one fills, as several records
   * may share a title. Within the linked table's rows for a visitor's ctx, as rowsById.
   */
  async function rowsTitled(ctx, api, table, texts) {
    const found = new Map();
    if (!table.titleFieldId) return found;
    for (let start = 0; start < texts.length; start += PAGE_MAX) {
      const titled = {
        plan: { kind: "in", field: { name: table.titleFieldId, lower: true, trim: true }, value: "texts" },
        variables: { texts: "dyn" },
        values: { texts: texts.slice(start, start + PAGE_MAX) }
      };
      const where = bothWhere(titled, linkedRows(ctx, table));
      for (let number = 1; ; number += 1) {
        const page = { queryParams: { page: { size: PAGE_MAX, number } } };
        const { data } = await api.resources[table.id].query(page, { where, includeObsolete: true });
        for (const row of data) found.set(String(row.id), row);
        if (data.length < PAGE_MAX) break;
      }
    }
    return found;
  }

  /**
   * Titles of the records that an import's link columns point to, lowercased, to their ids; and
   * every id read (target table id → ids), so the rows' links are checked without reading again.
   * Only the records the sheet names are read, whatever the linked table holds: those whose title
   * is a cell's text (as fromSheet matches it), then those whose id is a text no title matched.
   */
  async function linkTitles(ctx, api, tables, table, rows) {
    const titles = new Map();
    const known = new Map();
    for (const field of table.fields.filter((entry) => entry.type === "link")) {
      const target = tables.find((entry) => entry.id === field.options?.target);
      const texts = [...new Set(rows.map((row) => String(row?.[field.id] ?? "").trim()).filter(Boolean))];
      const byTitle = new Map();
      titles.set(field.id, byTitle);
      if (!target || !texts.length) continue;
      const ids = known.get(target.id) || new Set();
      known.set(target.id, ids);
      const lowered = [...new Set(texts.map((text) => text.toLowerCase()))];
      for (const [id, row] of await rowsTitled(ctx, api, target, lowered)) {
        ids.add(id);
        const title = String(row[target.titleFieldId] ?? "").trim().toLowerCase();
        if (title) byTitle.set(title, [...(byTitle.get(title) || []), id]);
      }
      const untitled = texts.filter((text) => !byTitle.has(text.toLowerCase()));
      for (const id of (await rowsById(api, target, untitled, { where: linkedRows(ctx, target) })).keys()) ids.add(id);
    }
    return { titles, known };
  }

  /**
   * Adds a spreadsheet's rows (keyed by field id) in one transaction: every row is checked, and if
   * any fails (or `dryRun`), nothing is written; empty lines are skipped. Errors name the sheet row (`firstRow` is the
   * first one's number). Each record gets its own audit entry, via { kind: "import", file }.
   *
   * Each row gets create()'s checks (values by type, the table's rules, links) before
   * anything is written, then the records go in with their audit entries written together, so the
   * cost per row is AnyAPI's own insert and a dry run writes nothing at all.
   */
  async function importRecords(ctx, tableIdOrKey, rows, { dryRun = false, firstRow = 2 } = {}) {
    refuse(ctx);
    const { table, tables } = await tableFor(tableIdOrKey, ctx.options, { forWrite: true });
    if (!Array.isArray(rows) || !rows.length) throw new GateError(400, "There are no rows to import.", { code: "apps_import_empty" });
    if (rows.length > IMPORT_MAX) {
      throw new GateError(400, `At most ${IMPORT_MAX} rows at a time.`, { code: "apps_import_too_many", params: { max: IMPORT_MAX } });
    }
    const api = await anyapi.instanceFor(homeOf(ctx));
    const { titles, known } = await linkTitles(ctx, api, tables, table, rows);
    const rules = await beforeSaveEach(ctx, table, "create", cleanRecord);
    const errors = [];
    const checked = [];
    try {
      for (const [index, row] of rows.entries()) {
        try {
          const input = fromSheet(table, row, titles);
          if (!Object.keys(input).length) continue; // an empty line
          checked.push(await checkNew(ctx, api, tables, table, input, (cleaned) => rules.apply(cleaned, null), known));
        } catch (error) {
          if (!(error instanceof GateError)) throw error;
          errors.push({ row: firstRow + index, message: error.message });
          if (errors.length >= 20) break;
        }
      }
    } finally {
      await rules.flush(); // the rules' runs are recorded together, a failed or dry-run import's too
    }
    if (dryRun || errors.length || !checked.length) return { imported: 0, errors };
    await withTransaction(ctx, async (txOptions) => {
      // One insert per chunk of rows, answering their ids in the rows' order.
      const { data: created } = await api.resources[table.id].postMany(
        { data: checked, returning: "minimal", transaction: txOptions.trx },
        { includeObsolete: true }
      );
      const audits = checked.map((values, index) => auditRow(ctx, table.id, created[index].id, "create", createdChanges(values)));
      await auditEvents.createMany(audits, { ...txOptions, returning: "none" }); // at most IMPORT_MAX rows
      await dataChanged(txOptions, ctx, table);
    });
    return { imported: checked.length, errors };
  }


  return Object.freeze({
    read,
    get,
    getMany,
    create,
    update,
    markObsolete,
    restore,
    history,
    totals,
    grandTotal,
    count,
    activity,
    actors,
    importRecords,
    tableFor,
    withTransaction
  });
}
