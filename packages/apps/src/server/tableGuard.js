import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { isRollup } from "../shared/calculated.js";
import { allows, accessOf, levelWords } from "../shared/tableAccess.js";
import { isFenced } from "./visitorAccess.js";
import { GateError } from "./validate.js";

// The data gate's keeper of private tables (D-138): who a gate ctx is (a member, the person a bot works for or a job runs
// as; a public app's visitor, whom visitor access holds instead), worked out once a ctx, and whether they may read or
// change a table's records. Every read and write of records comes through the gate, so this is the one place it's kept.

/**
 * @param {object} dependencies
 * @param {(tableIdOrKey: string, options: object, how?: { forWrite?: boolean }) => Promise<{ table: object, tables: object[] }>}
 *   dependencies.tableFor the gate's table lookup
 * @param {(userId: string, options: object) => Promise<string | null>} dependencies.roleOf someone's role in the home
 */
export function createTableGuard({ tableFor, roleOf }) {
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

  return Object.freeze({
    whoOf,
    tableAs,
    can,
    canRead,
    hideRollups
  });
}
