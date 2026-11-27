// readable-check: allow no-transaction-reader - infrastructure: a one-to-one link is checked in the AnyAPI write's own transaction (the audit_events handle's), under a lock taken in it, as the data gate writes
import { PAGE_MAX } from "../shared/index.js";
import { CASELESS_TYPES, uniqueKey } from "../shared/fieldChecks.js";
import { GateError } from "./validate.js";

/**
 * The record checks that need more than the record: a person field holds someone in the home now (read once per
 * call, so an import's rows share it), reads back with their name and is imported by it; a one-to-one link (a link field marked unique)
 * leaves at most one live record linking to each target, and a unique field (D-140) at most one live record with each
 * value (text without case).
 * @param {object} dependencies
 * @param {{ activeIds: (options: object) => Promise<Array<string | number>>, names: (ids: string[], options: object) =>
 *   Promise<Map<string, string>> }} dependencies.people the home's members
 * @param {(ctx: object) => string} dependencies.homeOf the home a gate ctx acts in
 */
export function createRecordChecks({ people, homeOf }) {
  // The home's members, read once per call (an import's rows share it).
  const membersOfCall = new WeakMap();
  async function membersOf(ctx) {
    if (!membersOfCall.has(ctx)) membersOfCall.set(ctx, people.activeIds(ctx.options).then((ids) => new Set(ids.map(String))));
    return membersOfCall.get(ctx);
  }

  /** The home's members by name, lowercased, each to their ids (several share a name), as a sheet's person column names them. */
  async function membersByName(ctx) {
    const byName = new Map();
    for (const [id, name] of await people.names([...(await membersOf(ctx))], ctx.options)) {
      const key = String(name).trim().toLowerCase();
      byName.set(key, [...(byName.get(key) || []), String(id)]);
    }
    return byName;
  }

  /**
   * A person field set holds someone who is in the home now; with `before` (an update), only the ones it changes, so a
   * record keeps a member who has left until someone sets another.
   */
  async function checkPeople(ctx, table, values, before = null) {
    const kept = (field) => before && String(before[field.id] ?? "") === String(values[field.id]);
    const given = table.fields.filter((field) => field.type === "person" && values[field.id] && !kept(field));
    if (!given.length) return;
    const members = await membersOf(ctx);
    for (const field of given) {
      if (!members.has(String(values[field.id]))) {
        throw new GateError(400, `${field.label}: must be someone in this home.`, {
          code: "apps_value_person_unknown",
          params: { field: field.label }
        });
      }
    }
  }

  // One-to-one links and unique fields, each value's lock, and the refusal of a second live record with one.
  const uniqueFields = (table) => table.fields.filter((entry) => entry.options?.unique && !entry.obsolete);
  // A field's lock (an import takes it alone, a single write shares it) and each target's under it.
  const lockKey = (ctx, table, field, target = "") => `apps-unique:${homeOf(ctx)}:${ctx.practice?.id ?? ""}:${table.id}:${field.id}:${target}`;
  const taken = (field) =>
    field.type === "link"
      ? new GateError(409, `${field.label}: that record already has one, and it can have only one.`, {
        code: "apps_link_unique_taken",
        params: { field: field.label }
      })
      : new GateError(409, `${field.label}: another record already has that, and each record's must be different.`, {
        code: "apps_value_unique_taken",
        params: { field: field.label }
      });
  /** The where of a field's records holding `value` (text without case). */
  const holding = (field, value) => ({ kind: "compare", op: "=", field: { name: field.id, lower: CASELESS_TYPES.has(field.type) }, value: JSON.stringify(value) });

  /**
   * A one-to-one link (a link field marked unique): at most one live record links to each target. Checked in the
   * write's transaction after a lock on the table, field and target, so two writes at once can't both get in (and a
   * share of the field's, which an import takes alone). `row` holds the values as they'll be; `selfId` the record
   * itself, when it exists.
   */
  async function checkUnique(ctx, api, table, row, selfId, txOptions) {
    for (const field of uniqueFields(table).filter((entry) => row[entry.id] !== null && row[entry.id] !== undefined && row[entry.id] !== "")) {
      const target = uniqueKey(field, field.type === "link" ? String(row[field.id]) : row[field.id]);
      await txOptions.trx.raw("select pg_advisory_xact_lock_shared(hashtext(?))", [lockKey(ctx, table, field)]);
      await txOptions.trx.raw("select pg_advisory_xact_lock(hashtext(?))", [lockKey(ctx, table, field, String(target))]);
      const same = holding(field, target);
      const notSelf = { kind: "compare", op: "<>", field: { name: "id", lower: false }, value: JSON.stringify(String(selfId ?? "")) };
      const where = { plan: selfId ? { kind: "and", items: [same, notSelf] } : same, variables: {}, values: {} };
      const found = await api.resources[table.id].query({ queryParams: { page: { size: 1 } }, transaction: txOptions.trx }, { where });
      if (found.data.length) throw taken(field);
    }
  }

  /**
   * New records' one-to-one links (an import's rows): each target at most once among them, and none a live record links
   * to already. Answers each row that can't go in, by its index, with its refusal: one read per one-to-one link field
   * and PAGE_MAX targets, whatever the rows. Given the write's transaction, under the field's lock, which keeps out every
   * single write of the field (checkUnique shares it) until the import is in.
   */
  async function uniqueTakenIn(ctx, api, table, rows, txOptions = null) {
    const refused = [];
    for (const field of uniqueFields(table)) {
      const firstRow = new Map();
      for (const [index, row] of rows.entries()) {
        if (row[field.id] === null || row[field.id] === undefined || row[field.id] === "") continue;
        const target = String(uniqueKey(field, row[field.id]));
        if (firstRow.has(target)) refused.push({ index, error: taken(field) });
        else firstRow.set(target, index);
      }
      const targets = [...firstRow.keys()];
      // The field's lock alone: no single write of the field gets in while the import checks and writes.
      if (txOptions && targets.length) await txOptions.trx.raw("select pg_advisory_xact_lock(hashtext(?))", [lockKey(ctx, table, field)]);
      for (let start = 0; start < targets.length; start += PAGE_MAX) {
        const batch = targets.slice(start, start + PAGE_MAX);
        const values = field.type === "number" ? batch.map(Number) : batch;
        const where = { plan: { kind: "in", field: { name: field.id, lower: CASELESS_TYPES.has(field.type) }, value: "targets" }, variables: { targets: "dyn" }, values: { targets: values } };
        const params = { queryParams: { page: { size: batch.length } }, ...(txOptions ? { transaction: txOptions.trx } : {}) };
        const found = await api.resources[table.id].query(params, { where });
        for (const record of found.data) {
          refused.push({ index: firstRow.get(String(uniqueKey(field, record[field.id]))), error: taken(field) });
        }
      }
    }
    return refused.sort((a, b) => a.index - b.index);
  }

  /** A page's person values as { id, label }: one read of names and one of who's in the home, whatever the page. */
  async function labelPeople(ctx, table, records) {
    // The member's name, or "Former member" for someone who has left.
    const personFields = table.fields.filter((entry) => entry.type === "person");
    const memberIds = [...new Set(records.flatMap((record) => personFields.map((field) => record[field.id])).filter(Boolean).map(String))];
    const named = memberIds.length ? await people.names(memberIds, ctx.options) : new Map();
    const current = memberIds.length ? new Set((await people.activeIds(ctx.options)).map(String)) : new Set();
    for (const record of records) {
      for (const field of personFields) {
        const id = record[field.id];
        if (!id) continue;
        record[field.id] = { id: String(id), label: current.has(String(id)) ? (named.get(String(id)) ?? "Someone") : "Former member" };
      }
    }
  }

  return Object.freeze({
    membersByName,
    checkPeople,
    checkUnique,
    uniqueTakenIn,
    labelPeople
  });
}
