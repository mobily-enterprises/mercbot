import { CATALOG } from "./tableCatalog.js";

// A copy of a template that starts fresh, with its own things (D-141, the owner, 28 Nov): its own tables, named after
// the copy as its address is ("study_courses_copy_2" for Study copy 2, at /apps/study-copy-2), so nothing of the first
// app's shows in it. The shared tables (Contacts, List items…, the catalog's) stay shared, as every app's are, even
// when the template adds fields to one.

/**
 * Renames, in `value`, what names a table: a string under one of `props`, and an object's keys under one of `maps`.
 * Everything else (screens, queries, fields, choices, a script test's own data) keeps its words, whatever they are.
 */
function renameIn(value, rename, { props = [], maps = [] }, prop = null) {
  if (Array.isArray(value)) return value.map((item) => renameIn(item, rename, { props, maps }, prop));
  if (value && typeof value === "object") {
    const keyOf = (key) => (maps.includes(prop) ? rename(key) : key);
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [keyOf(key), renameIn(inner, rename, { props, maps }, key)]));
  }
  return typeof value === "string" && props.includes(prop) ? rename(value) : value;
}

/** A template's own tables: its tables but the shared ones (the catalog's), which a template may add fields to. */
const ownTables = (template) => template.tables.filter((table) => !CATALOG.has(table.key));

/**
 * Whether a copy of the template can start fresh: it keeps things of its own, and no shared table it adds to links to
 * one of them (Meal planner's shopping items, in the shared list, link to its meals: a fresh copy's would link to the
 * first app's).
 * @param {object} template
 */
export function canStartFresh(template) {
  const own = new Set(ownTables(template).map((table) => table.key));
  const shared = template.tables.filter((table) => !own.has(table.key));
  const sharedLinks = shared.flatMap((table) => table.fields || []).map((field) => field.target);
  return own.size > 0 && !sharedLinks.some((target) => own.has(target));
}

/**
 * Whether a copy of the template can share the first app's things: it has no jobs, which work on their own in the
 * background (Study's, watching for books and courses; Canary's hourly check), and which two apps on the same records
 * would each run: everything done twice. Rules, which work out a record's values as it's saved, give the same answer.
 * @param {object} template
 */
export const canShare = (template) => !(template.scripts || []).some((script) => script.kind === "job");

/**
 * The template as copy `copy` installs it: each of its own tables is `<key>_copy_<copy>` wherever the template names it:
 * the tables, their links (`target`) and roll-ups (`from`); the screens' queries (`from`, `record`), forms, lines and
 * steps (`table`) and public tables; the sample's tables and links (`sample`); the scripts' settings (`table`), tests
 * (`records`, `table`) and code, which names tables as quoted words. Its key and version stay the template's, so the
 * copy follows it as any app does. No copy number: the template itself.
 * @param {object} template
 * @param {number | null} copy
 */
export function ownCopy(template, copy) {
  if (!copy) return template;
  const own = new Set(ownTables(template).map((table) => table.key));
  const rename = (key) => (own.has(key) ? `${key}_copy_${copy}` : key);
  const inCode = (code) =>
    String(code).replace(/(["'`])([a-z][a-z0-9_]*)\1/gu, (all, quote, word) => (own.has(word) ? `${quote}${rename(word)}${quote}` : all));
  const definition = renameIn(template.definition, rename, { props: ["from", "record", "table"] });
  if (definition.public?.tables) {
    definition.public = { ...definition.public, tables: renameIn(definition.public.tables, rename, { maps: [null] }) };
  }
  return {
    ...template,
    tables: template.tables.map((table) => ({
      ...renameIn(table, rename, { props: ["target", "from"] }),
      key: rename(table.key)
    })),
    definition,
    ...(template.sample ? { sample: renameIn(template.sample, rename, { props: ["sample"], maps: [null] }) } : {}),
    ...(template.scripts ? {
      scripts: template.scripts.map((script) => ({
        ...script,
        ...(script.settings ? { settings: renameIn(script.settings, rename, { props: ["table"] }) } : {}),
        ...(script.tests ? { tests: renameIn(script.tests, rename, { props: ["table"], maps: ["records"] }) } : {}),
        code: inCode(script.code)
      }))
    } : {})
  };
}
