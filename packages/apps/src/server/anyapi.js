// readable-check: allow no-direct-knex - infrastructure: AnyAPI keeps each home's runtime tables (the ones people define while the app runs, which no table resource describes) on the app's Knex
// readable-check: allow no-transaction-reader - infrastructure: a draft's practice copy (D-71) is written and cleared in the transaction that holds its app_practices row, which AnyAPI takes as its own Knex transaction
import { AnyapiRegistry, JsonRestApi, RestApiAnyapiKnexPlugin, RestApiPlugin, RowPolicyPlugin } from "json-rest-api";
import { PAGE_MAX, isCalculated } from "../shared/index.js";
import { applyPlan } from "./sqlPlan.js";

// One AnyAPI instance per home on each server (D-35, D-15). Instances are cheap (json-rest-api
// 2.1: shared registry, no start-up checks) and disposable: they are rebuilt from the field
// registry. Table ids are AnyAPI resource names and field ids are AnyAPI field names, so renames
// never touch AnyAPI. Other servers learn about changes through notices: "apps-schema" carries
// AnyAPI's own schema versions, "apps-registry" says the registry changed (rebuild).
// A draft's practice copy (D-71) is another tenant of the same tables, `ws:<home>:p:<copy id>`,
// with an instance of its own: the copy's records live in PostgreSQL like any home's, so every
// server reads and writes the same copy. A copy id is never reused (Reset makes a new one).
export const STORAGE_TYPES = {
  text: "string",
  email: "string",
  phone: "string",
  choice: "string",
  link: "string",
  number: "number",
  money: "number",
  date: "date",
  yesno: "boolean"
};

export const OBSOLETE = "obsolete_at";
// The newest records of each table a practice copy starts with (D-71).
const PRACTICE_RECORDS = 1000;
const quiet = { error: (...args) => console.error(...args), warn() {}, info() {}, debug() {}, trace() {}, log() {} };

const tenantOf = (workspaceId) => `ws:${workspaceId}`;
const PRACTICE_MARK = ":p:";
const practiceTenantOf = (workspaceId, copyId) => `${tenantOf(workspaceId)}${PRACTICE_MARK}${copyId}`;
// An instance's key: the home's id, or the home's and its practice copy's.
const keyOf = (workspaceId, copyId = null) => (copyId ? `${workspaceId}${PRACTICE_MARK}${copyId}` : String(workspaceId));
// The tables and fields a practice instance declared: one changes, and it is built again (schema follows).
const shapeOf = (tables) => tables.map((table) => `${table.id}:${table.fields.map((field) => field.id).join(",")}`).join(";");

// A calculated field (D-78) has no slot: it is worked out whenever a record is read.
function resourceSchema(fields) {
  const schema = { [OBSOLETE]: { type: "dateTime", nullable: true } };
  for (const field of fields) if (!isCalculated(field)) schema[field.id] = { type: STORAGE_TYPES[field.type], nullable: true };
  return schema;
}

/**
 * One AnyAPI instance per home on this server (see above).
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {(workspaceId: string) => Promise<object[]>} dependencies.loadTables a home's tables with their fields,
 *   obsolete ones included (tables.js), read in the home's system context
 * @param {number} [dependencies.maxInstances]
 */
export function createAnyapi({ knex, notices, loadTables, maxInstances = 500 }) {
  const registry = new AnyapiRegistry({ knex, cacheSize: 5000 });
  const instances = new Map();

  /**
   * Page `where` plans arrive in the caller context; the row-policy helper maps fields to slots.
   * `ids` reads the given records (by AnyAPI's string ids) in one query instead of one get() each.
   */
  const rowPolicy = ({ query, context, column }) => {
    if (context?.ids) query.whereIn(column("id"), context.ids);
    if (context?.where) query.where((builder) => applyPlan(builder, context.where.plan, context.where, (field) => column(field), knex));
    if (!context?.includeObsolete) query.whereNull(column(OBSOLETE));
    return true;
  };

  async function declare(api, table) {
    await api.addResource(table.id, { schema: resourceSchema(table.fields), rowPolicy });
  }

  /**
   * A home's instance, or (with `copyId`) its practice copy's, declaring `tables` when given (the
   * caller's, which a practice copy follows) or else the home's from the registry.
   */
  async function build(workspaceId, copyId, tables) {
    const key = keyOf(workspaceId, copyId);
    const api = new JsonRestApi({ name: `apps-${key}`, logger: quiet });
    // json-rest-api caps a page at 100 records unless told otherwise; the gate's pages hold PAGE_MAX.
    await api.use(RestApiPlugin, { format: "plain", returning: "full", queryMaxLimit: PAGE_MAX });
    await api.use(RestApiAnyapiKnexPlugin, {
      knex,
      tenantId: copyId ? practiceTenantOf(workspaceId, copyId) : tenantOf(workspaceId),
      registry,
      ensureSchema: false,
      ownsKnex: false,
      schemaCheckInterval: 5000,
      onSchemaChanged: (change) => notices.publish("apps-schema", key, change).catch((error) => console.warn("Publishing a change notice failed; other servers catch up on their next read.", error))
    });
    await api.use(RowPolicyPlugin);
    // Every field ever made is declared, obsolete ones too: AnyAPI keeps their slots.
    for (const table of tables ?? (await loadTables(String(workspaceId)))) await declare(api, table);
    const unsubscribe = [
      notices.subscribe("apps-schema", key, (change) => api.anyapi.handleSchemaChange(change).catch(() => drop(key))),
      notices.subscribe("apps-registry", workspaceId, () => drop(key))
    ];
    return { api, unsubscribe };
  }

  /** Drops an instance by its key (a home's id for the home's own). */
  function drop(key) {
    const entry = instances.get(String(key));
    instances.delete(String(key));
    entry?.ready.then((built) => built.unsubscribe.forEach((stop) => stop()), () => {});
  }

  async function instance(workspaceId, copyId = null, tables = null) {
    const key = keyOf(workspaceId, copyId);
    const shape = tables ? shapeOf(tables) : null;
    let entry = instances.get(key);
    if (entry && entry.shape !== shape) {
      drop(key);
      entry = null;
    }
    if (entry) {
      instances.delete(key);
      instances.set(key, entry);
    } else {
      const ready = build(workspaceId, copyId, tables);
      entry = { ready, shape };
      instances.set(key, entry);
      ready.catch(() => instances.get(key) === entry && instances.delete(key));
      if (instances.size > maxInstances) drop(instances.keys().next().value);
    }
    return (await entry.ready).api;
  }

  /** A home's own instance: its live records. */
  const instanceFor = (workspaceId) => instance(workspaceId);

  /**
   * A draft's practice copy's instance (D-71), declaring the home's `tables` (all of them, obsolete
   * ones too, as the registry gives them); when they change, it is built again with them.
   */
  const practiceFor = (workspaceId, copyId, tables) => instance(workspaceId, copyId, tables);

  /**
   * Copies a table's newest PRACTICE_RECORDS records, obsolete ones too, from the home into its
   * practice copy, in the caller's transaction (`txOptions.trx`). Records keep their ids, so links
   * between copied records still hold; they go in oldest first, as they were made.
   */
  async function copyTable(workspaceId, copyId, tables, table, txOptions) {
    const live = await instanceFor(workspaceId);
    const practice = await practiceFor(workspaceId, copyId, tables);
    // AnyAPI's own row id grows as records are made, so its order is theirs; the logical id is the record's.
    const newest = await knex("any_records")
      .where({ tenant_id: tenantOf(workspaceId), resource: table.id })
      .orderBy("id", "desc")
      .limit(PRACTICE_RECORDS)
      .pluck("logical_id");
    const ids = newest.reverse();
    for (let start = 0; start < ids.length; start += PAGE_MAX) {
      const batch = ids.slice(start, start + PAGE_MAX);
      const { data } = await live.resources[table.id].query(
        { queryParams: { page: { size: batch.length } } },
        { ids: batch, includeObsolete: true }
      );
      const byId = new Map(data.map((row) => [String(row.id), row]));
      const rows = batch.filter((id) => byId.has(id)).map((id) => {
        const row = byId.get(id);
        const stored = table.fields.filter((field) => !isCalculated(field));
        return Object.fromEntries([["id", id], [OBSOLETE, row[OBSOLETE] ?? null], ...stored.map((field) => [field.id, row[field.id] ?? null])]);
      });
      if (rows.length) {
        await practice.resources[table.id].postMany({ data: rows, returning: "minimal", transaction: txOptions.trx }, { includeObsolete: true });
      }
    }
  }

  /**
   * Clears a practice copy's records and AnyAPI's slots for it, in the caller's transaction, and
   * drops this server's instance of it (others drop theirs as they leave their caches: the id is
   * never used again).
   */
  async function dropPractice(workspaceId, copyId, txOptions) {
    const tenant = practiceTenantOf(workspaceId, copyId);
    await txOptions.trx("any_links").where({ tenant_id: tenant }).del();
    await txOptions.trx("any_records").where({ tenant_id: tenant }).del();
    // Its field and relationship slots go with it (ON DELETE CASCADE).
    await txOptions.trx("any_resource_configs").where({ tenant_id: tenant }).del();
    drop(keyOf(workspaceId, copyId));
  }

  /** Every practice copy AnyAPI holds slots for, as { workspaceId, copyId }: for the sweep's leftovers. */
  async function practiceCopies() {
    const tenants = await knex("any_resource_configs").distinct("tenant_id").whereLike("tenant_id", `ws:%${PRACTICE_MARK}%`).pluck("tenant_id");
    return tenants.map((tenant) => {
      const [home, copyId] = tenant.slice("ws:".length).split(PRACTICE_MARK);
      return { workspaceId: home, copyId };
    });
  }

  return Object.freeze({
    instanceFor,
    practiceFor,
    copyTable,
    dropPractice,
    practiceCopies,
    declare,
    drop,
    registry
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ tenantOf, practiceTenantOf });
