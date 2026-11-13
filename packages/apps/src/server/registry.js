import { randomBytes } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { CALCULATED_TYPES, checkCalculated, isCalculated } from "../shared/calculated.js";
import { tableFormulaToIds } from "../shared/definitions.js";
import { STORAGE_TYPES } from "./anyapi.js";
import { homeIdOf } from "./callOptions.js";
import { loadTables, toField } from "./tables.js";

// Tables and fields of a home (D-35). Ids are permanent; keys (what the Builder writes) and labels
// (what people see) can change. Nothing is deleted: tables and fields are marked obsolete.
const FIELD_TYPES = Object.keys(STORAGE_TYPES);
const KEY = /^[a-z][a-z0-9_]{0,63}$/u;
// Names formulas use for themselves can't be field or table names.
const RESERVED = new Set(["id", "obsolete_at", "state", "params", "data", "row", "form", "user", "today", "now"]);

/** A refusal of a change to a home's tables, fields or apps, answered with its status, message and code. */
export class RegistryError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "RegistryError";
  }
}

export const newId = (prefix) => `${prefix}_${BigInt(`0x${randomBytes(10).toString("hex")}`).toString(36).padStart(16, "0").slice(0, 16)}`;

function cleanKey(key, what) {
  const value = String(key || "").trim().toLowerCase();
  if (!KEY.test(value)) {
    throw new RegistryError(400, `${what} "${key}" must start with a letter and use only a–z, 0–9 and _ (up to 64).`, {
      code: "apps_key_invalid",
      params: { what, key }
    });
  }
  if (RESERVED.has(value)) {
    throw new RegistryError(400, `${what} "${value}" is reserved.`, { code: "apps_key_reserved", params: { what, key: value } });
  }
  return value;
}

/** A key like "work_phone" reads as "Work phone" when no label is given. */
const humanize = (key) => String(key).replace(/_+/gu, " ").replace(/^./u, (first) => first.toUpperCase());
const cleanLabel = (label, key) => String(label || humanize(key)).trim().slice(0, 120) || humanize(key);

// Every screen query, record call, script call, watch claim and import row looks a home's tables up,
// so each server keeps them per home instead of reading app_tables and app_fields (2 queries) every
// time. A change made here drops them at once; the "apps-registry" notice it publishes drops them on
// every other server (D-15). A notice lost while the notices connection reconnects can leave them
// stale for at most TRUST_MS, as AnyAPI's own schema checks bound its instances (anyapi.js).
const TRUST_MS = 5000;
const MAX_HOMES = 500;

/** Cached tables are shared by every caller on the server, so nothing may change them in place. */
function frozen(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) frozen(entry);
    Object.freeze(value);
  }
  return value;
}

/**
 * A home's tables and fields: made, changed and marked obsolete, never deleted (see above). Every
 * method takes the call's options last; the handles keep each read and write in that home.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the apps
 *   feature's handles (appTables, appFields, auditEvents)
 * @param {import("./types.js").Anyapi} dependencies.anyapi
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {number} [dependencies.trustMs] How long cached tables are used without news (see above).
 */
export function createRegistry({ resources, anyapi, notices, trustMs = TRUST_MS }) {
  const { appTables, appFields, auditEvents } = resources;
  const cached = new Map(); // home id → { tables: Promise<object[]>, at }
  const listening = new Map(); // home id → stops listening for its "apps-registry" notices

  /** Drops a home's cached tables: after a change here, or on another server's notice. */
  function forget(homeId) {
    cached.delete(String(homeId));
  }

  function listen(key) {
    if (listening.has(key)) return;
    listening.set(key, notices.subscribe("apps-registry", key, () => forget(key)));
    if (listening.size <= MAX_HOMES) return;
    const [oldest, stop] = listening.entries().next().value;
    listening.delete(oldest);
    cached.delete(oldest);
    stop();
  }

  /**
   * A home's tables with their fields, obsolete ones included, read once and kept (see above); frozen.
   * The read is shared by every caller in the home, so it runs in the caller's context but outside its
   * transaction, as a cached read must: no row policy narrows these tables.
   */
  function tablesOf(options) {
    const key = homeIdOf(options);
    const entry = cached.get(key);
    if (entry && Date.now() - entry.at < trustMs) return entry.tables;
    listen(key);
    const fresh = { tables: loadTables({ appTables, appFields }, { context: options.context }).then(frozen), at: Date.now() };
    cached.set(key, fresh);
    fresh.tables.catch(() => cached.get(key) === fresh && cached.delete(key));
    return fresh.tables;
  }

  /** Every change to tables or fields: the home's cached tables go, here and (by the notice) elsewhere. */
  async function changed(options) {
    const homeId = homeIdOf(options);
    forget(homeId);
    await notices.publish("apps-registry", homeId, {}).catch((error) => console.warn("Publishing a change notice failed; other servers catch up on their next read.", error));
  }

  /** A live table of the home by id or key, or null. */
  async function liveTable(idOrKey, txOptions) {
    const { records } = await appTables.query({ filters: { idOrKey: String(idOrKey), obsolete: false }, page: { size: 1 } }, txOptions);
    return records[0] ?? null;
  }

  async function validateField(input, txOptions) {
    const type = String(input.type || "");
    if (!FIELD_TYPES.includes(type)) {
      const types = FIELD_TYPES.join(", ");
      throw new RegistryError(400, `Field type "${type}" isn't one of: ${types}.`, {
        code: "apps_field_type_unknown",
        params: { type, types }
      });
    }
    const options = {};
    const formula = input.formula ?? input.options?.formula;
    if (formula !== undefined && formula !== null && formula !== "") {
      // A calculated field (D-78): its formula, by names here, is checked against the table's other
      // fields by checkFormulas once they are all known.
      if (!CALCULATED_TYPES.includes(type)) {
        throw new RegistryError(400, `A ${type} field can't be calculated: a calculated field is ${CALCULATED_TYPES.join(", ")}.`, {
          code: "apps_calculated_type_invalid",
          params: { type, types: CALCULATED_TYPES.join(", ") }
        });
      }
      if (input.required) {
        throw new RegistryError(400, "A calculated field can't be required: nobody fills it in.", { code: "apps_calculated_required" });
      }
      return { type, options: { formula: String(formula) } };
    }
    if (input.required) options.required = true;
    if (type === "choice") {
      const choices = [...new Set((input.choices || input.options?.choices || []).map((choice) => String(choice).trim()).filter(Boolean))];
      if (!choices.length) {
        throw new RegistryError(400, "A choice field needs at least one choice.", { code: "apps_choice_field_choices_missing" });
      }
      options.choices = choices;
    }
    if (type === "link") {
      const target = input.target || input.options?.target;
      // Read inside the change's transaction, so a table may link to itself as it is made.
      const table = target && (await liveTable(target, txOptions));
      if (!table) {
        const given = target ?? "";
        throw new RegistryError(400, `A link field needs an existing table to point to (got "${given}").`, {
          code: "apps_link_field_target_missing",
          params: { target: given }
        });
      }
      options.target = table.id;
    }
    return { type, options };
  }

  /**
   * A table with its fields as they are now, read in the transaction once it holds the table's row: two changes to
   * its calculated fields, on one server or several (D-15), are then checked one after the other, never both against
   * the fields before either, which would let a chain back to itself through.
   */
  async function lockedTable(tableId, txOptions) {
    const table = await appTables.lock(tableId, txOptions);
    return { ...table, fields: (await appFields.queryAll({ filters: { tableId }, sort: ["position", "createdAt"] }, txOptions)).map(toField) };
  }

  /**
   * The check of a table's calculated fields as they will be (D-78): `fields` holds every field the
   * table will have, the `checking` ones with their formulas by names. Each formula is stored by ids
   * in place, or the change is refused naming the field and what is wrong with its formula.
   */
  function checkFormulas(table, fields, checking) {
    const byIds = fields.map((field) => {
      if (!checking.includes(field)) return field;
      return { ...field, options: { ...field.options, formula: tableFormulaToIds(field.options.formula, { ...table, fields }).formula } };
    });
    for (const field of checking) {
      const others = byIds.map((entry) => (entry.id === field.id ? field : entry));
      const result = checkCalculated({ ...table, fields: others }, field);
      if (result.error) {
        throw new RegistryError(400, `${field.key}: ${result.error}`, {
          code: "apps_calculated_formula_invalid",
          params: { field: field.key, problem: result.error }
        });
      }
      field.options = { ...field.options, formula: result.formula };
    }
  }

  function audit(actor, tableId, changes, txOptions) {
    return auditEvents.create({ actor, via: { kind: "schema" }, tableId, action: "schema", changes }, { ...txOptions, returning: "none" });
  }

  /**
   * Registry rows are written in our transaction; AnyAPI allocates slots in its own. If AnyAPI
   * fails, ours rolls back; an AnyAPI slot whose registry row failed later is unused and harmless.
   * The table and its fields are two writes however many fields it has.
   */
  async function createTable(actor, input, options) {
    const key = cleanKey(input?.key, "Table name");
    const label = cleanLabel(input?.label, key);
    const homeId = homeIdOf(options);
    const api = await anyapi.instanceFor(homeId);
    const table = await appTables.withTransaction(options, async (txOptions) => {
      if (await liveTable(key, txOptions)) {
        throw new RegistryError(409, `There is already a table called "${key}".`, { code: "apps_table_key_taken", params: { key } });
      }
      const id = newId("t");
      const fields = [];
      const seen = new Set();
      for (const [position, fieldInput] of (input?.fields || []).entries()) {
        const fieldKey = cleanKey(fieldInput.key, "Field name");
        if (seen.has(fieldKey)) {
          throw new RegistryError(400, `Field "${fieldKey}" appears twice.`, {
            code: "apps_field_key_repeated",
            params: { key: fieldKey }
          });
        }
        seen.add(fieldKey);
        const { type, options: fieldOptions } = await validateField(fieldInput, txOptions);
        fields.push({ id: newId("f"), tableId: id, key: fieldKey, label: cleanLabel(fieldInput.label, fieldKey), type, options: fieldOptions, position });
      }
      checkFormulas({ id, key }, fields, fields.filter(isCalculated));
      // The title is looked for in the database (link pickers, imports), so it is a stored field.
      const titleField = fields.find((field) => field.type === "text" && !isCalculated(field));
      await appTables.create({ id, key, label, titleFieldId: titleField?.id ?? null }, { ...txOptions, returning: "none" });
      if (fields.length) await appFields.createMany(fields, { ...txOptions, returning: "none" });
      const made = fields.map(toField);
      await audit(actor, id, {
        createdTable: { key, label },
        fields: made.map(({ id: fieldId, key: fieldKey, type }) => ({ id: fieldId, key: fieldKey, type }))
      }, txOptions);
      await anyapi.declare(api, { id, fields: made });
      return { id, key, label, titleFieldId: titleField?.id ?? null, obsolete: false, fields: made };
    }).catch((error) => {
      anyapi.drop(homeId);
      throw error;
    });
    await changed(options);
    return table;
  }

  /** A table of the home by id (obsolete too) or by its live key. */
  async function tableOf(tableIdOrKey, txOptions) {
    const { records } = await appTables.query({ filters: { idOrLiveKey: String(tableIdOrKey) }, page: { size: 1 } }, txOptions);
    if (!records[0]) {
      throw new RegistryError(404, `No table "${tableIdOrKey}".`, { code: "apps_table_not_found", params: { table: tableIdOrKey } });
    }
    return records[0];
  }

  /** A live field of a table by key, or null. */
  async function liveField(tableId, key, txOptions) {
    const { records } = await appFields.query({ filters: { tableId, key, obsolete: false }, page: { size: 1 } }, txOptions);
    return records[0] ?? null;
  }

  async function addField(actor, tableIdOrKey, input, options) {
    const homeId = homeIdOf(options);
    const api = await anyapi.instanceFor(homeId);
    const field = await appFields.withTransaction(options, async (txOptions) => {
      const table = await tableOf(tableIdOrKey, txOptions);
      if (table.obsoleteAt) {
        throw new RegistryError(409, `Table "${table.key}" is obsolete.`, { code: "apps_table_obsolete", params: { table: table.key } });
      }
      const key = cleanKey(input?.key, "Field name");
      if (await liveField(table.id, key, txOptions)) {
        throw new RegistryError(409, `Table "${table.key}" already has a field "${key}".`, {
          code: "apps_field_key_taken",
          params: { table: table.key, key }
        });
      }
      const { type, options: fieldOptions } = await validateField(input || {}, txOptions);
      const [{ last = null } = {}] = await appFields.aggregate({ measures: { last: { max: "position" } }, filters: { tableId: table.id } }, txOptions);
      const record = {
        id: newId("f"),
        tableId: table.id,
        key,
        label: cleanLabel(input?.label, key),
        type,
        options: fieldOptions,
        position: Number(last ?? -1) + 1
      };
      if (isCalculated(record)) checkFormulas(table, [...(await lockedTable(table.id, txOptions)).fields, record], [record]);
      await appFields.create(record, { ...txOptions, returning: "none" });
      const formula = isCalculated(record) ? { formula: record.options.formula } : {};
      await audit(actor, table.id, { addedField: { id: record.id, key, type, ...formula } }, txOptions);
      // A calculated field has no slot: it is worked out whenever a record is read.
      if (!isCalculated(record)) {
        await api.resources[table.id].addKnexFields({ fields: { [record.id]: { type: STORAGE_TYPES[type], nullable: true } } });
      }
      return toField(record);
    }).catch((error) => {
      anyapi.drop(homeId);
      throw error;
    });
    await changed(options);
    return field;
  }

  /** Renaming touches only the registry: apps and records use the field's id. */
  async function renameField(actor, fieldId, input, options) {
    const field = await appFields.withTransaction(options, async (txOptions) => {
      const record = await appFields.get(String(fieldId), {}, { ...txOptions, missing: "skip" });
      if (!record) throw new RegistryError(404, "No such field.", { code: "apps_field_not_found" });
      const changes = {};
      if (input?.key !== undefined) {
        const key = cleanKey(input.key, "Field name");
        if (key !== record.key && (await liveField(record.tableId, key, txOptions))) {
          throw new RegistryError(409, `That table already has a field "${key}".`, { code: "apps_field_rename_taken", params: { key } });
        }
        changes.key = key;
      }
      if (input?.label !== undefined) changes.label = cleanLabel(input.label, record.label);
      if (!Object.keys(changes).length) return toField(record);
      await appFields.patch(record.id, changes, { ...txOptions, returning: "none" });
      await audit(actor, record.tableId, {
        renamedField: { id: record.id, from: { key: record.key, label: record.label }, to: changes }
      }, txOptions);
      return toField({ ...record, ...changes });
    });
    await changed(options);
    return field;
  }

  /**
   * A calculated field's new formula, by names (D-78): checked against the table's fields as they
   * are, stored by ids. Records keep nothing of it, so the next read shows the new values.
   */
  async function changeFormula(actor, fieldId, formula, options) {
    const field = await appFields.withTransaction(options, async (txOptions) => {
      const record = await appFields.get(String(fieldId), {}, { ...txOptions, missing: "skip" });
      if (!record) throw new RegistryError(404, "No such field.", { code: "apps_field_not_found" });
      if (!isCalculated(record) || record.obsoleteAt) {
        throw new RegistryError(409, `${record.key} isn't a calculated field: its values are typed in, not worked out.`, {
          code: "apps_field_not_calculated",
          params: { field: record.key }
        });
      }
      const table = await lockedTable(record.tableId, txOptions);
      const changing = { ...toField(record), options: { ...record.options, formula: String(formula ?? "") } };
      checkFormulas(table, table.fields.map((entry) => (entry.id === changing.id ? changing : entry)), [changing]);
      if (changing.options.formula === record.options.formula) return toField(record);
      await appFields.patch(record.id, { options: changing.options }, { ...txOptions, returning: "none" });
      await audit(actor, record.tableId, {
        changedFormula: { id: record.id, key: record.key, from: record.options.formula, to: changing.options.formula }
      }, txOptions);
      return changing;
    });
    await changed(options);
    return field;
  }

  return Object.freeze({
    loadTables: tablesOf,
    changed,
    createTable,
    addField,
    renameField,
    changeFormula
  });
}
