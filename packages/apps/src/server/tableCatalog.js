import { readdirSync, readFileSync } from "node:fs";
import { STORAGE_TYPES } from "./anyapi.js";
import { RegistryError } from "./registry.js";

// The shared tables every home builds on (D-130): one JSON file per table next to the package, with its fields (as a
// template's), the other names people use for it (aliases), and, for a one-to-one extension, the table it extends. A
// table needs the tables its links point to; the catalog is checked as the server starts, and a broken file stops it,
// naming the problem. Read once; they're data.
const folder = new URL("../../catalog/", import.meta.url);

/** A name as the catalog compares names: lower case, words joined by _ ("To-do list" → "to_do_list"). */
export const plainName = (name) => String(name ?? "").trim().toLowerCase().replace(/[\s\-']+/gu, "_").replace(/[^a-z0-9_]/gu, "");

/** The catalog tables a table's links point to, itself aside, in its fields' order. */
export const needsOf = (entry) => [...new Set(entry.fields.filter((field) => field.type === "link" && field.target !== entry.key).map((field) => field.target))];

/** The link field an extension has to the table it extends, as a template field: required and one-to-one. */
export const extensionLink = (entry) => entry.fields.find((field) => field.type === "link" && field.target === entry.extends && field.unique === true && field.required === true);

/**
 * The problems of a catalog, each a sentence naming its table: keys, field types, links that point at no catalog table,
 * an extension without its one-to-one link, tables that need each other round in a circle, names used twice, and seed
 * rows naming fields the table lacks. Empty when it's sound.
 * @param {object[]} entries the catalog's tables
 */
export function catalogProblems(entries) {
  const problems = [];
  const keys = new Map(entries.map((entry) => [entry.key, entry]));
  const names = new Map();
  for (const entry of entries) {
    const at = `Catalog table "${entry.key}"`;
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(String(entry.key))) problems.push(`${at}: its key must be a–z, 0–9 and _.`);
    if (!entry.label || !entry.description) problems.push(`${at}: it needs a label and a one-line description.`);
    const fieldKeys = new Set();
    for (const field of entry.fields || []) {
      if (fieldKeys.has(field.key)) problems.push(`${at}: field "${field.key}" appears twice.`);
      fieldKeys.add(field.key);
      if (!(field.type in STORAGE_TYPES)) problems.push(`${at}: field "${field.key}" has an unknown type "${field.type}".`);
      if (field.type === "link" && !keys.has(field.target)) problems.push(`${at}: field "${field.key}" links to "${field.target}", which isn't in the catalog.`);
    }
    if (!(entry.fields || []).some((field) => field.type === "text" || field.type === "link")) problems.push(`${at}: it needs a text or link field.`);
    if (entry.extends !== undefined && (!keys.has(entry.extends) || !extensionLink(entry))) {
      problems.push(`${at}: it extends "${entry.extends}", so it needs a required, one-to-one link field to that catalog table.`);
    }
    for (const name of [entry.key, entry.label, ...(entry.aliases || [])].map(plainName)) {
      const other = names.get(name);
      if (other && other !== entry.key) problems.push(`${at}: the name "${name}" is also "${other}"'s.`);
      names.set(name, entry.key);
    }
    for (const row of entry.seed || []) {
      for (const name of Object.keys(row).filter((name) => !fieldKeys.has(name))) problems.push(`${at}: a seed row names field "${name}", which it lacks.`);
    }
  }
  // Needs in a circle would never finish being made.
  const state = new Map();
  const visit = (key, path) => {
    if (state.get(key) === "done" || !keys.has(key)) return;
    if (state.get(key) === "visiting") {
      problems.push(`Catalog tables need each other in a circle: ${[...path, key].join(" → ")}.`);
      return;
    }
    state.set(key, "visiting");
    for (const need of needsOf(keys.get(key))) visit(need, [...path, key]);
    state.set(key, "done");
  };
  for (const key of keys.keys()) visit(key, []);
  return problems;
}

function loadCatalog() {
  const entries = readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(new URL(name, folder), "utf8")));
  const problems = catalogProblems(entries);
  if (problems.length) throw new Error(`The shared tables' catalog (packages/apps/catalog) is broken:\n- ${problems.join("\n- ")}`);
  return new Map(entries.map((entry) => [entry.key, Object.freeze(entry)]));
}

/** The catalog, by key. */
export const CATALOG = loadCatalog();

/**
 * The catalog table a name means, by its key, label or one of its aliases, singular or plural ("contact", "Tasks",
 * "to-do list"), or null. What a bot or the Builder would make a second table for is found by this.
 * @param {string} name
 */
export function catalogMatch(name) {
  const wanted = plainName(name);
  if (!wanted) return null;
  const forms = [wanted, `${wanted}s`, wanted.replace(/s$/u, ""), wanted.replace(/ies$/u, "y"), wanted.replace(/y$/u, "ies")];
  for (const form of forms) {
    for (const entry of CATALOG.values()) {
      if ([entry.key, entry.label, ...(entry.aliases || [])].some((known) => plainName(known) === form)) return entry.key;
    }
  }
  return null;
}

/**
 * Making a home's shared tables from the catalog (D-130), with the registry and the data gate. Each is made once: a
 * home's table with the same key is reused and gets only the fields it lacks, and nothing is renamed or removed.
 * @param {object} dependencies
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {{ create: Function }} dependencies.gate the data gate, which adds seed rows
 */
export function createTableCatalog({ registry, gate }) {
  const liveByKey = async (key, options) => {
    const tables = await registry.loadTables(options);
    return tables.find((table) => !table.obsolete && table.key === key) || null;
  };

  /** Makes `entry`'s table, or adds the fields an existing one lacks; answers whether it made it. */
  async function ensureFields(ctx, entry) {
    const { actor, options } = ctx;
    const self = (field) => field.type === "link" && field.target === entry.key;
    let existing = await liveByKey(entry.key, options);
    let made = false;
    if (!existing) {
      // A link to itself waits until the table is there.
      const fields = entry.fields.filter((field) => !self(field));
      made = await registry.createTable(actor, { key: entry.key, label: entry.label, fields }, options)
        .then(() => true, (error) => {
          // Another bot made it a moment ago: reuse theirs.
          if (error?.code === "apps_table_key_taken") return false;
          throw error;
        });
      existing = await liveByKey(entry.key, options);
    }
    for (const field of entry.fields.filter((wanted) => !existing.fields.some((have) => !have.obsolete && have.key === wanted.key))) {
      await registry.addField(actor, entry.key, field, options).catch((error) => {
        if (error?.code !== "apps_field_key_taken") throw error;
      });
    }
    return made;
  }

  /**
   * A catalog table in the home, with the tables it needs first (those its links point to), each made or completed
   * once; seed rows go only into a table this made. Answers the table as the registry has it now and the keys of the
   * tables made, in the order they were.
   * @param {{ actor: object, options: object, via?: object }} ctx a gate ctx
   * @param {string} key a catalog key
   */
  async function ensureTable(ctx, key, made = []) {
    const entry = CATALOG.get(key);
    if (!entry) throw new RegistryError(404, `There's no shared table "${key}".`, { code: "apps_catalog_table_unknown", params: { key: String(key) } });
    for (const need of needsOf(entry)) await ensureTable(ctx, need, made);
    if (await ensureFields(ctx, entry)) {
      made.push(entry.key);
      const seedCtx = { ...ctx, via: ctx.via || { kind: "catalog", table: entry.key } };
      for (const row of entry.seed || []) await gate.create(seedCtx, entry.key, row);
    }
    return { table: await liveByKey(entry.key, ctx.options), made };
  }

  /**
   * A home's one-to-one extension of a table (D-130): `key`'s table holds more about each record of `base`, one row at
   * most per record, through a required, one-to-one link named after the base ("contact" for contacts). A catalog base
   * is made first. Its key can't be a shared table's or one of their names: those are the catalog's own.
   * @param {{ actor: object, options: object }} ctx
   * @param {string} base the table it extends, a catalog key or the home's own table
   * @param {{ key: string, label?: string, fields?: object[] }} extension
   */
  async function ensureExtension(ctx, base, { key, label, fields = [] }) {
    const taken = catalogMatch(key);
    if (taken) {
      throw new RegistryError(409, `"${key}" is the shared ${CATALOG.get(taken).label} table's name: use it, or name the extension otherwise.`, {
        code: "apps_table_in_catalog",
        params: { key: String(key), table: taken }
      });
    }
    const made = [];
    const baseTable = CATALOG.has(base) ? (await ensureTable(ctx, base, made)).table : await liveByKey(base, ctx.options);
    if (!baseTable) throw new RegistryError(404, `There's no table "${base}" to extend.`, { code: "apps_extension_base_missing", params: { base: String(base) } });
    const singular = (name) => name.replace(/ies$/u, "y").replace(/s$/u, "");
    const link = { key: singular(baseTable.key), label: singular(baseTable.label), type: "link", target: baseTable.key, required: true, unique: true };
    const existing = await liveByKey(key, ctx.options);
    const holds = existing?.fields.find((field) => !field.obsolete && field.type === "link" && field.options?.target === baseTable.id && field.options?.unique === true);
    if (existing && !holds) {
      throw new RegistryError(409, `"${key}" is already a table, and not a one-to-one extension of ${baseTable.label}.`, {
        code: "apps_extension_key_taken",
        params: { key: String(key), base: baseTable.key }
      });
    }
    const wanted = { key, label, extends: baseTable.key, fields: [link, ...fields.filter((field) => field.key !== link.key)] };
    if (await ensureFields(ctx, wanted)) made.push(key);
    return { table: await liveByKey(key, ctx.options), made };
  }

  return Object.freeze({
    ensureTable,
    ensureExtension
  });
}
