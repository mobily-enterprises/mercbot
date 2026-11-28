import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { isRollup } from "../shared/calculated.js";
import { allows, accessOf, levelWords, ownerFieldOf } from "../shared/tableAccess.js";
import { isFenced, linkedRows } from "./visitorAccess.js";
import { bothWhere } from "./sqlPlan.js";
import { GateError } from "./validate.js";

// The data gate's keeper of private tables (D-138): who a gate ctx is (a member, the person a bot works for or a job runs
// as; a public app's visitor, whom visitor access holds instead), worked out once a ctx, and whether they may read or
// change a table's records. Every read and write of records comes through the gate, so this is the one place it's kept.

/**
 * @param {object} dependencies
 * @param {(tableIdOrKey: string, options: object, how?: { forWrite?: boolean }) => Promise<{ table: object, tables: object[] }>}
 *   dependencies.tableFor the gate's table lookup
 * @param {(userId: string, options: object) => Promise<string | null>} dependencies.roleOf someone's role in the home
 * @param {(options: object) => Promise<object[]>} dependencies.loadTables the home's tables, which are personal (D-145)
 */
export function createTableGuard({ tableFor, roleOf, loadTables }) {
  const known = new WeakMap();

  /**
   * Who a ctx is: `{ visitor: true }`, or `{ person, role }` (a job's ctx names its person as `person`, null when they
   * left the home); read once a ctx, so a call costs one role lookup however many tables it reaches.
   */
  function whoOf(ctx) {
    if (ctx.visitor || isFenced(ctx)) return Promise.resolve({ visitor: true });
    if (!known.has(ctx)) {
      const person = Object.hasOwn(ctx, "person") ? ctx.person : resolveAuditActorId(ctx.options?.context);
      const role = person ? roleOf(String(person), ctx.options) : Promise.resolve(null);
      known.set(ctx, role.then((found) => ({ person: person ? String(person) : null, role: found })));
    }
    return known.get(ctx);
  }

  /** A table of the call's home, as tableFor answers it, refused (403) to someone who may not read it, or change it (`forWrite`). */
  async function tableAs(ctx, tableIdOrKey, { forWrite = false } = {}) {
    const found = await tableFor(tableIdOrKey, ctx.options, { forWrite });
    if (ownerFieldOf(found.table) && (ctx.visitor || isFenced(ctx))) {
      throw new GateError(403, `${found.table.label} is each person's own: a public app's visitors can't reach it.`, {
        code: "apps_personal_visitor",
        params: { table: found.table.label }
      });
    }
    const mode = forWrite ? "change" : "read";
    if (!allows(found.table, await whoOf(ctx), mode)) {
      const access = accessOf(found.table);
      const level = forWrite ? access.change : access.read;
      throw new GateError(403, `${found.table.label} is private: only ${levelWords(level, access.people)} can ${forWrite ? "change" : "see"} its records.`, {
        code: "apps_table_private",
        params: { table: found.table.label }
      });
    }
    return found;
  }

  /** Whether a ctx may `mode` ("read" or "change") a table's records: for what links show, related records, lists of tables. */
  const can = async (ctx, table, mode) => allows(table, await whoOf(ctx), mode);
  const canRead = (ctx, table) => can(ctx, table, "read");

  /** Records' roll-ups over a table the ctx may not read, emptied: a total of what they can't see is theirs neither. */
  async function hideRollups(ctx, table, tables, records) {
    const who = await whoOf(ctx);
    const hidden = table.fields.filter((field) => isRollup(field) && !allows(tables.find((entry) => entry.id === field.options.rollup.from), who, "read"));
    for (const record of hidden.length ? records : []) for (const field of hidden) record[field.id] = null;
    return records;
  }

  // Personal tables (D-145): each person reaches only their own records. A job's run works for everyone (`everyone`, which
  // only the scripts' runner sets): it reads every person's and names whose each record it adds is.
  const NONE = { plan: { kind: "value", source: "false" }, variables: {}, values: {} };

  /** A personal table's records the ctx reaches, as a `where`: the acting person's; null for a shared table or a job's run. */
  async function mineWhere(ctx, table) {
    const owner = ownerFieldOf(table);
    if (!owner || ctx.everyone) return null;
    const { person } = await whoOf(ctx);
    if (!person) return NONE;
    return { plan: { kind: "compare", op: "=", field: { name: owner.id, lower: false }, value: JSON.stringify(person) }, variables: {}, values: {} };
  }

  /** Whether a stored row of a personal table is one the ctx reaches (any row of a shared table, or for a job). */
  async function reaches(ctx, table, row) {
    const owner = ownerFieldOf(table);
    if (!owner || ctx.everyone) return true;
    const { person } = await whoOf(ctx);
    return Boolean(person) && String(row?.[owner.id] ?? "") === person;
  }

  /**
   * Whose a new record of a personal table is: the acting person's, whatever was sent; a job names it (`given`, a person of
   * the home, checked as every person field is), or is refused.
   */
  async function ownerOfNew(ctx, table, given) {
    if (ctx.everyone) {
      if (!given) {
        throw new GateError(400, `A job adding to ${table.label} names whose record it is (${ownerFieldOf(table).key}).`, {
          code: "apps_personal_owner_missing",
          params: { table: table.label }
        });
      }
      return String(given);
    }
    const { person } = await whoOf(ctx);
    if (!person) {
      throw new GateError(403, `${table.label} is each person's own: only someone of this home adds to it.`, { code: "apps_personal_nobody", params: { table: table.label } });
    }
    return person;
  }

  /** The records of a table a ctx reaches through a link, a label or a group's name: a visitor's rows, a person's own. */
  const reach = async (ctx, table) => bothWhere(linkedRows(ctx, table), await mineWhere(ctx, table));

  /** A new record's input with whose it is set here, for a personal table; anything sent for it is dropped. */
  async function owned(ctx, table, input) {
    const owner = ownerFieldOf(table);
    if (!owner) return input;
    const given = input?.[owner.id] ?? input?.[owner.key] ?? null;
    const rest = Object.fromEntries(Object.entries(input || {}).filter(([name]) => name !== owner.id && name !== owner.key));
    return { ...rest, [owner.id]: await ownerOfNew(ctx, table, given) };
  }

  /**
   * A change's values for a personal table: whose a record is never changes (the same value sent back is no change, and
   * is left out). Values by field id.
   */
  function keepOwner(table, values, before) {
    const owner = ownerFieldOf(table);
    if (!owner || !Object.hasOwn(values, owner.id)) return values;
    if (String(values[owner.id] ?? "") !== String(before[owner.id] ?? "")) {
      throw new GateError(400, `Whose a ${table.label} record is never changes.`, { code: "apps_personal_owner_fixed", params: { table: table.label } });
    }
    return Object.fromEntries(Object.entries(values).filter(([fieldId]) => fieldId !== owner.id));
  }

  /** Activity entries with a personal table's values shown only to who made the change: others see what, never what it held. */
  async function maskActivity(ctx, entries) {
    const personal = new Set((await loadTables(ctx.options)).filter((table) => ownerFieldOf(table)).map((table) => table.id));
    if (!entries.some((entry) => personal.has(entry.tableId))) return entries;
    const { person } = await whoOf(ctx);
    return entries.map((entry) => (personal.has(entry.tableId) && String(entry.actor?.id ?? "") !== String(person ?? "") ? { ...entry, changes: null } : entry));
  }

  return Object.freeze({
    reach,
    owned,
    keepOwner,
    maskActivity,
    mineWhere,
    reaches,
    ownerOfNew,
    whoOf,
    tableAs,
    can,
    canRead,
    hideRollups
  });
}
