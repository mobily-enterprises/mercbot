// readable-check: allow no-transaction-reader - infrastructure: roll-ups (D-140) are written in the AnyAPI runtime tables of a home, in the transaction of the write they follow, which AnyAPI takes as its own Knex transaction
import { tableFormulaToNames } from "../shared/definitions.js";
import { PAGE_MAX, calculatedFormulas, celSchema, isRollup, storedFieldIds } from "../shared/index.js";
import { compileWhere, planToIds } from "../shared/where.js";

// Roll-up fields (D-140): a number or money field holding the sum, count, smallest or largest of a field across the
// records of another table that link to its record (an invoice's total of its lines, an event's sign-ups), maybe only
// those a filter keeps. It is stored, so lists filter and sort by it in the database like any field, and the data gate
// keeps it up to date in the same transaction as every write of the records it totals: for the records whose link was
// or is now the changed record's, one grouped read, one read of those records and one write of those whose total
// changed, however many records each totals and however many were written (an import's). A roll-up over roll-ups
// follows on, at most DEPTH tables up. It is the system's value: no rules run on it and no audit entry is written, and
// a visitor's sign-up changes its event's count as anyone's does.
const DEPTH = 3;

/** The roll-ups over `tableId`'s records, grouped by the table they're on, the link and the filter: one read a group. */
export function rollupsFrom(tables, tableId) {
  const groups = new Map();
  for (const parent of tables) {
    if (parent.obsolete) continue;
    for (const field of parent.fields) {
      if (field.obsolete || !isRollup(field) || field.options.rollup.from !== tableId) continue;
      const { link, where = "" } = field.options.rollup;
      const key = `${parent.id}\n${link}\n${where}`;
      if (!groups.has(key)) groups.set(key, { parent, link, where, fields: [] });
      groups.get(key).fields.push(field);
    }
  }
  return [...groups.values()];
}

const compiled = new WeakMap();

/**
 * A roll-up's filter (a formula stored by ids over `child`'s fields) as the record store's where, compiled once for
 * each of the registry's frozen tables. Throws with the reason when the database can't run it.
 */
export function rollupWhere(child, source) {
  const cache = compiled.get(child) || new Map();
  compiled.set(child, cache);
  if (!cache.has(source)) {
    const plan = compileWhere(celSchema(child), tableFormulaToNames(source, child), { calculated: calculatedFormulas(child) });
    cache.set(source, { plan: planToIds(plan, storedFieldIds(child)), variables: {}, values: {} });
  }
  return cache.get(source);
}

/** The where of a group's records linking to `ids`, and its filter's. */
function linkedTo(child, group, ids) {
  const plan = { kind: "in", field: { name: group.link }, value: "ids" };
  const linked = { plan, variables: { ids: "dyn" }, values: { ids } };
  if (!group.where) return linked;
  return { ...linked, plan: { kind: "and", items: [rollupWhere(child, group.where).plan, plan] } };
}

/** A roll-up with no linked records: nothing to count or add is 0; nothing to compare is empty. */
const emptyValue = (field) => (["sum", "count"].includes(field.options.rollup.measure) ? 0 : null);

const measureOf = ({ options: { rollup } }) => (rollup.measure === "count" ? { count: "*" } : { [rollup.measure]: rollup.field });

/** A group's totals for the records linking to `ids`: a Map of linked record id → its row of measures m0, m1… */
async function totalsFor(api, child, group, ids, trx) {
  const measures = Object.fromEntries(group.fields.map((field, index) => [`m${index}`, measureOf(field)]));
  const { data = [] } = await api.resources[child.id].aggregate(
    { groupBy: [group.link], measures, queryParams: { page: { size: ids.length } }, transaction: trx },
    { where: linkedTo(child, group, ids) }
  );
  return new Map(data.map((row) => [String(row[group.link]), row]));
}

const valueOf = (field, row, index) => {
  const value = row?.[`m${index}`];
  return value === undefined || value === null ? emptyValue(field) : Number(value);
};

/** Works out a group's roll-ups for `ids` (its table's records) and writes those that changed; answers their rows. */
async function recompute(api, child, group, ids, trx) {
  const changed = [];
  for (let start = 0; start < ids.length; start += PAGE_MAX) {
    const batch = ids.slice(start, start + PAGE_MAX);
    const totals = await totalsFor(api, child, group, batch, trx);
    const { data: records } = await api.resources[group.parent.id].query(
      { queryParams: { page: { size: batch.length } }, transaction: trx },
      { ids: batch, includeObsolete: true }
    );
    const writes = [];
    for (const record of records) {
      const values = {};
      group.fields.forEach((field, index) => {
        const next = valueOf(field, totals.get(String(record.id)), index);
        if ((record[field.id] ?? null) !== next) values[field.id] = next;
      });
      if (!Object.keys(values).length) continue;
      writes.push({ id: String(record.id), ...values });
      changed.push(record);
    }
    if (writes.length) await api.resources[group.parent.id].patchMany({ data: writes, transaction: trx }, { includeObsolete: true });
  }
  return changed;
}

/** The tables whose roll-ups a write of `table`'s records can change, through roll-ups over roll-ups too. */
export function rollupTables(tables, table, depth = 0) {
  if (depth >= DEPTH) return [];
  const parents = [...new Set(rollupsFrom(tables, table.id).map((group) => group.parent))];
  return [...new Set([...parents, ...parents.flatMap((parent) => rollupTables(tables, parent, depth + 1))])];
}

/**
 * Keeps the roll-ups over `table`'s records up to date after some of them were written: `rows` are each written
 * record's values before and after (null for one just made), by field id. Runs in the write's transaction, and tells
 * `changed` each table whose records changed, once, for its notice.
 * @param {{ api: object, tables: object[], txOptions: object, changed: (tableId: string) => Promise<unknown> | null }} store
 *   the record store and transaction the write used, with every table of rollupTables in it (a draft's practice copy
 *   takes the tables it writes first)
 * @param {object} table
 * @param {Array<[object | null, object | null]>} rows
 * @param {number} [depth]
 * @param {Set<string>} [touched] the tables already told
 */
export async function followRollups(store, table, rows, depth = 0, touched = new Set()) {
  if (depth >= DEPTH) return;
  for (const group of rollupsFrom(store.tables, table.id)) {
    const ids = [...new Set(rows.flatMap((pair) => pair.map((row) => row?.[group.link])).filter(Boolean).map(String))];
    if (!ids.length) continue;
    const changed = await recompute(store.api, table, group, ids, store.txOptions.trx);
    if (!changed.length) continue;
    if (!touched.has(group.parent.id)) await store.changed(group.parent.id);
    touched.add(group.parent.id);
    await followRollups(store, group.parent, changed.map((row) => [row, row]), depth + 1, touched);
  }
}

/**
 * A new roll-up worked out for every record of its table, `parent`, obsolete ones too: all set to the empty value in
 * one write, then those with linked records, a page of them at a time (a grouped read and a write each).
 */
export async function fillRollup(api, tables, parent, field, txOptions) {
  const { trx } = txOptions;
  const child = tables.find((table) => table.id === field.options.rollup.from);
  const group = { parent, link: field.options.rollup.link, where: field.options.rollup.where || "", fields: [field] };
  if (emptyValue(field) !== null) {
    const data = { [field.id]: emptyValue(field) };
    await api.resources[parent.id].patchWhere({ all: true, data, transaction: trx }, { includeObsolete: true });
  }
  const measures = { m0: measureOf(field) };
  const where = group.where ? { plan: rollupWhere(child, group.where).plan, variables: {}, values: {} } : null;
  for (let number = 1; ; number += 1) {
    const { data = [] } = await api.resources[child.id].aggregate(
      { groupBy: [group.link], measures, queryParams: { sort: [group.link], page: { size: PAGE_MAX, number } }, transaction: trx },
      { where }
    );
    const writes = data
      .filter((row) => row[group.link])
      .map((row) => ({ id: String(row[group.link]), [field.id]: valueOf(field, row, 0) }));
    if (writes.length) {
      await api.resources[parent.id].patchMany({ data: writes, missing: "skip", transaction: trx }, { includeObsolete: true });
    }
    if (data.length < PAGE_MAX) return;
  }
}
