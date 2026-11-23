// readable-check: allow no-transaction-reader - infrastructure: a one-to-one link is checked in the AnyAPI write's own transaction (the audit_events handle's), under a lock taken in it, as the data gate writes
import { GateError } from "./validate.js";

/**
 * The record checks that need more than the record: a person field holds someone in the home now (read once per
 * call, so an import's rows share it) and reads back with their name; a one-to-one link (a link field marked unique)
 * leaves at most one live record linking to each target.
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

  /** A person field holds someone who is in the home now. */
  async function checkPeople(ctx, table, values) {
    const given = table.fields.filter((field) => field.type === "person" && values[field.id]);
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

  /**
   * A one-to-one link (a link field marked unique): at most one live record links to each target. Checked in the
   * write's transaction after a lock on the table, field and target, so two writes at once can't both get in. `row`
   * holds the values as they'll be; `selfId` the record itself, when it exists.
   */
  async function checkUnique(ctx, api, table, row, selfId, txOptions) {
    for (const field of table.fields.filter((entry) => entry.type === "link" && entry.options?.unique && !entry.obsolete && row[entry.id])) {
      const target = String(row[field.id]);
      const scope = `${homeOf(ctx)}:${ctx.practice?.id ?? ""}`;
      await txOptions.trx.raw("select pg_advisory_xact_lock(hashtext(?))", [`apps-unique:${scope}:${table.id}:${field.id}:${target}`]);
      const same = { kind: "compare", op: "=", field: { name: field.id, lower: false }, value: JSON.stringify(target) };
      const notSelf = { kind: "compare", op: "<>", field: { name: "id", lower: false }, value: JSON.stringify(String(selfId ?? "")) };
      const where = { plan: selfId ? { kind: "and", items: [same, notSelf] } : same, variables: {}, values: {} };
      const found = await api.resources[table.id].query({ queryParams: { page: { size: 1 } }, transaction: txOptions.trx }, { where });
      if (found.data.length) {
        throw new GateError(409, `${field.label}: that record already has one, and it can have only one.`, {
          code: "apps_link_unique_taken",
          params: { field: field.label }
        });
      }
    }
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
    membersOf,
    checkPeople,
    checkUnique,
    labelPeople
  });
}
