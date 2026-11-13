import { VISITOR, celSchema } from "../shared/formulas.js";
import { OPERATIONS, listedAccess, visitorReads } from "../shared/visitorAccess.js";
import { storedFieldIds } from "../shared/calculated.js";
import { compileWhere, planToIds } from "../shared/where.js";
import { GateError } from "./validate.js";

// The one fence (D-66): a visitor reaches a home's records only through the data gate, and only what
// the public app's visitor access lists (shared/visitorAccess.js). A visitor's ctx carries `access`,
// compiled from the app's live version; the gate refuses a visitor's ctx without it, and checks
// every call against it. Data scripts a visitor's page runs carry the same `access`. Members, bots,
// rules on saving and jobs have no fence.
const NONE = { plan: { kind: "value", source: "false" }, variables: {}, values: {} };
const DOING = { list: "list", get: "open records of", create: "add to", update: "change", delete: "remove records from" };

/** Whether the gate holds this ctx to visitor access: a visitor's, or a script's run for one. */
export const isFenced = (ctx) => Boolean(ctx?.visitor || ctx?.actor?.type === "visitor");

/** Which records of a table a visitor reaches, as a `where` for the row policy. */
function rowsOf(rule, table, ownerId, visitor) {
  if (rule.rows === "all") return null;
  if (rule.rows === "own") {
    if (!ownerId || !visitor?.signedIn) return NONE;
    return {
      plan: { kind: "compare", op: "=", field: { name: ownerId, lower: true }, value: "visitor.email.lowerAscii()" },
      variables: { visitor: VISITOR },
      values: { visitor }
    };
  }
  if (typeof rule.rows !== "string" || !rule.rows.startsWith("=")) return NONE;
  try {
    const plan = planToIds(compileWhere({ ...celSchema(table), visitor: VISITOR }, rule.rows), storedFieldIds(table));
    return { plan, variables: { visitor: VISITOR }, values: { visitor } };
  } catch {
    return NONE; // a removed field, or anything else that can't be a filter: nothing, never everything
  }
}

/**
 * A visitor's access to a home's tables, by table and field ids, from the app's definition (by
 * names, as loaded): { tables: Map of table id → { can, rows, owner, read, write } }. Names that no
 * longer exist are left out, so a removed owner field reaches no records.
 */
export function compile(definition, tables, visitor) {
  const access = new Map();
  for (const [key, rule] of Object.entries(listedAccess(definition, tables))) {
    const table = tables.find((entry) => !entry.obsolete && entry.key === key);
    if (!table || !rule || typeof rule !== "object") continue;
    const idOf = (name) => table.fields.find((field) => !field.obsolete && field.key === name)?.id;
    const ids = (names) => new Set((Array.isArray(names) ? names : []).map(idOf).filter(Boolean));
    const owner = typeof rule.owner === "string" ? idOf(rule.owner) || null : null;
    const write = ids(rule.write);
    write.delete(owner);
    access.set(table.id, {
      can: new Set((Array.isArray(rule.can) ? rule.can : []).filter((operation) => OPERATIONS.includes(operation))),
      rows: rowsOf(rule, table, owner, visitor),
      owner,
      read: ids(visitorReads(table, rule.read)),
      write
    });
  }
  return { tables: access };
}

const forbidden = (message, params = {}) => new GateError(403, message, { code: "apps_visitor_forbidden", params });

/**
 * A fenced ctx's access to a table, once `operation` is allowed there (null: the table need only be
 * listed); null for a ctx the fence doesn't hold.
 */
export function fence(ctx, table, operation = null) {
  if (!isFenced(ctx)) return null;
  if (!ctx.access?.tables) throw forbidden("Visitors can't reach this app's records.");
  const entry = ctx.access.tables.get(table.id);
  if (!entry || (operation && !entry.can.has(operation))) {
    throw forbidden(`Visitors can't ${operation ? DOING[operation] : "use"} ${table.label}.`, { table: table.label, operation });
  }
  return entry;
}

/** What visitors never do: restore, count, history, import and the home's activity. */
export function refuse(ctx) {
  if (isFenced(ctx)) throw forbidden("Visitors can't do that.");
}

/** The field ids a `where` plan compares (shared/where.js). */
export function planFields(plan) {
  if (!plan) return [];
  return [...(plan.field ? [plan.field.name] : []), ...(plan.items || []).flatMap(planFields), ...planFields(plan.item)];
}

/** Fields a visitor's query filters, sorts, groups or sums by must all be readable. */
export function checkFields(entry, table, fieldIds) {
  const hidden = [...new Set(fieldIds.filter((id) => id && !entry.read.has(id)))];
  if (!hidden.length) return;
  const labels = hidden.map((id) => table.fields.find((field) => field.id === id)?.label || id).join(", ");
  throw forbidden(`Visitors can't read ${labels} of ${table.label}.`, { table: table.label, fields: labels });
}

/** A `where` ANDed with the records the visitor reaches. */
export function rowsWhere(entry, where) {
  if (!entry.rows) return where;
  if (!where) return entry.rows;
  return {
    plan: { kind: "and", items: [where.plan, entry.rows.plan] },
    variables: { ...where.variables, ...entry.rows.variables },
    values: { ...where.values, ...entry.rows.values }
  };
}

/** Whether a stored row is the signed-in visitor's own: its owner field holds their email. */
export function ownsRecord(entry, ctx, row) {
  const email = ctx.visitor?.signedIn ? String(ctx.visitor.email || "").toLowerCase() : "";
  return Boolean(entry.owner && email && String(row?.[entry.owner] ?? "").toLowerCase() === email);
}

/** A record (by field ids) with only what the visitor may read. */
export function project(entry, record) {
  if (!record) return record;
  const out = { id: record.id, obsolete: record.obsolete };
  for (const id of entry.read) if (Object.hasOwn(record, id)) out[id] = record[id];
  return out;
}

/**
 * A visitor's input (by field id or name) held to `write`: the owner is never theirs to set, so it
 * is dropped, and on a new record it becomes the signed-in visitor's email; anything else not
 * writable, or a link to a table that isn't listed, refuses the whole request.
 */
export function visitorInput(entry, table, ctx, input, { creating = false } = {}) {
  const out = {};
  const refused = [];
  for (const [name, value] of Object.entries(input || {})) {
    if (name === "id") continue;
    const field = table.fields.find((item) => item.id === name) || table.fields.find((item) => !item.obsolete && item.key === name);
    if (field && field.id === entry.owner) continue;
    if (!field || !entry.write.has(field.id) || (field.type === "link" && !ctx.access.tables.has(field.options?.target))) {
      refused.push(field?.label || name);
      continue;
    }
    out[field.id] = value;
  }
  if (refused.length) throw forbidden(`Visitors can't write ${refused.join(", ")} of ${table.label}.`, { table: table.label, fields: refused.join(", ") });
  if (creating && entry.owner) out[entry.owner] = ctx.visitor?.signedIn ? ctx.visitor.email : null;
  return out;
}

/** Whether a fenced ctx may see the titles of a table's records, as link labels. */
export const labelled = (ctx, target) => !isFenced(ctx) || Boolean(ctx.access?.tables?.get(target.id)?.read.has(target.titleFieldId));

/**
 * The records of a table a fenced ctx reaches through a link (a label, a group's name, a link it
 * writes), as a `where` for the row policy: the table's rows, as for its lists; none when the table
 * isn't listed. Null for a ctx the fence doesn't hold, which reaches every record.
 */
export function linkedRows(ctx, target) {
  if (!isFenced(ctx)) return null;
  const entry = ctx.access?.tables?.get(target.id);
  return entry ? entry.rows : NONE;
}
