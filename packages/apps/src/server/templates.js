import { readdirSync, readFileSync } from "node:fs";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

// The ready-made apps (D-35, stage 3), kept as JSON next to the package: tables and fields, the app
// (by names, as the Builder writes it) and optional sample records. Read once; they're data.
const folder = new URL("../../templates/", import.meta.url);
const TEMPLATES = readdirSync(folder)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(new URL(name, folder), "utf8")))
  .sort((a, b) => a.name.localeCompare(b.name));

const templateNamed = (key) => TEMPLATES.find((template) => template.key === key) || null;

/**
 * Installs a template in a home (D-35): the shared tables it uses come from the catalog (D-130); each of its own
 * tables is reused when the home already has one with that key (adding only the fields it lacks) or made new; the app
 * is created and its screens saved as a draft for a person to preview and publish; sample records are added on request.
 * Nothing is removed or renamed. Returns the app and, if the draft didn't pass the save check
 * (say, an existing field has another type), the errors for the Builder to fix. Sample records
 * that don't fit a table the home already had (say, other choices) are skipped and counted.
 * `ctx` is a gate ctx: `{ options, actor, via }`.
 */
export async function installTemplate({ registry, apps, gate, catalog }, ctx, key, { sample = false } = {}) {
  const template = templateNamed(key);
  if (!template) throw new AppError(404, `There's no template "${key}".`, { code: "apps_template_missing", params: { key } });
  const { options, actor } = ctx;
  // The shared tables it's built on (D-130), with those they link to, made or completed once.
  for (const shared of template.uses || []) await catalog.ensureTable(ctx, shared);
  for (const table of template.tables) {
    const existing = (await registry.loadTables(options)).find((entry) => !entry.obsolete && entry.key === table.key);
    if (!existing) {
      await registry.createTable(actor, { key: table.key, fields: table.fields }, options);
    } else {
      for (const field of table.fields.filter((wanted) => !existing.fields.some((entry) => !entry.obsolete && entry.key === wanted.key))) {
        await registry.addField(actor, table.key, field, options);
      }
    }
  }
  const app = await apps.createApp(actor, { name: template.name, icon: template.icon, color: template.color }, options);
  const { errors = [] } = await apps.saveDraft(actor, app.slug, template.definition, `From the ${template.name} template`, options);
  let skipped = 0;
  if (sample) {
    const sampleCtx = { ...ctx, via: { kind: "template", template: template.key } };
    // The sample's records as they're made, by table: { row, id }, for the sample's own links.
    const made = new Map();
    for (const [tableKey, rows] of Object.entries(template.sample || {})) {
      made.set(tableKey, []);
      // Row by row through the gate, so each sample row gets every record's checks and a refused one is skipped, with
      // the rows that link to it.
      for (const row of rows) {
        const values = sampleLinks(row, made);
        const record = values && await gate.create(sampleCtx, tableKey, values).catch((error) => {
          if (!(Number.isInteger(error?.statusCode) && error.statusCode < 500)) throw error;
          return null;
        });
        if (record) made.get(tableKey).push({ row, id: record.id });
        else skipped += 1;
      }
    }
  }
  return { app, errors, skipped };
}

/**
 * A sample row's values with its links to the sample's own records made: a link names one by its table, made earlier in
 * the sample, and its values, as `{ "sample": "contacts", "name": "Ana Ruiz" }`, and gets the id it was given. Null when
 * that record wasn't made (it didn't fit the home's table), so the row is skipped too.
 */
function sampleLinks(row, made) {
  const values = { ...row };
  for (const [key, value] of Object.entries(row)) {
    if (!value || typeof value !== "object" || typeof value.sample !== "string") continue;
    const { sample: tableKey, ...match } = value;
    const found = (made.get(tableKey) || []).find((entry) => Object.entries(match).every(([field, wanted]) => entry.row[field] === wanted));
    if (!found) return null;
    values[key] = found.id;
  }
  return values;
}

/** What the Templates tab shows of each. */
export const templateSummaries = () => TEMPLATES.map((template) => ({
  key: template.key,
  name: template.name,
  icon: template.icon,
  color: template.color,
  description: template.description,
  screens: Object.keys(template.definition.screens).length,
  tables: [...(template.uses || []), ...template.tables.map((table) => table.key)],
  public: Boolean(template.definition.public),
  sample: Object.values(template.sample || {}).some((rows) => rows.length)
}));

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ TEMPLATES });
