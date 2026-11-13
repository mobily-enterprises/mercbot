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
 * Installs a template in a home (D-35): each of its tables is reused when the home already has one
 * with that key (adding only the fields it lacks) or made new; the app is created and its screens
 * saved as a draft for a person to preview and publish; sample records are added on request.
 * Nothing is removed or renamed. Returns the app and, if the draft didn't pass the save check
 * (say, an existing field has another type), the errors for the Builder to fix. Sample records
 * that don't fit a table the home already had (say, other choices) are skipped and counted.
 * `ctx` is a gate ctx: `{ options, actor, via }`.
 */
export async function installTemplate({ registry, apps, gate }, ctx, key, { sample = false } = {}) {
  const template = templateNamed(key);
  if (!template) throw new AppError(404, `There's no template "${key}".`, { code: "apps_template_missing", params: { key } });
  const { options, actor } = ctx;
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
    for (const [tableKey, rows] of Object.entries(template.sample || {})) {
      // Row by row through the gate, so each sample row gets every record's checks and a refused one is skipped.
      for (const row of rows) {
        await gate.create(sampleCtx, tableKey, row).catch((error) => {
          if (!(Number.isInteger(error?.statusCode) && error.statusCode < 500)) throw error;
          skipped += 1;
        });
      }
    }
  }
  return { app, errors, skipped };
}

/** What the Templates tab shows of each. */
export const templateSummaries = () => TEMPLATES.map((template) => ({
  key: template.key,
  name: template.name,
  icon: template.icon,
  color: template.color,
  description: template.description,
  screens: Object.keys(template.definition.screens).length,
  tables: template.tables.map((table) => table.key),
  public: Boolean(template.definition.public),
  sample: Object.values(template.sample || {}).some((rows) => rows.length)
}));

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ TEMPLATES });
