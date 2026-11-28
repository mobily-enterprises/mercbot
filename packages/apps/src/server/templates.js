import { createHash } from "node:crypto";
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

/** A template's version: a short hash of what an app gets from it, its screens and the tables they need (D-130). */
const templateVersionOf = (template) =>
  createHash("sha256").update(JSON.stringify([template.definition, template.tables, template.uses || []])).digest("hex").slice(0, 16);

/** The tables a template needs, made or completed with the fields they lack: nothing removed or renamed. */
async function prepareTables({ registry, catalog }, ctx, template) {
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
}

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
  await prepareTables({ registry, catalog }, ctx, template);
  const app = await apps.createApp(actor, { name: template.name, icon: template.glyph || template.icon, color: template.color }, options);
  const { errors = [] } = await apps.saveDraft(actor, app.slug, template.definition, `From the ${template.name} template`, options);
  // It remembers its template, so the Builder can tell when the template changes (D-130).
  await apps.markTemplate(app.id, { key: template.key, version: templateVersionOf(template) }, options);
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
 * The template an app came from: the one it recorded, or, for an app made before apps recorded it, the template of the
 * same name (a guess the Builder checks with the person). Null when none.
 */
function templateOfApp(app) {
  const recorded = app.templateKey ? templateNamed(app.templateKey) : null;
  if (recorded) return { template: recorded, by: "recorded" };
  const named = TEMPLATES.find((template) => template.name.toLowerCase() === String(app.name || "").trim().toLowerCase());
  return named ? { template: named, by: "name" } : null;
}

/**
 * The home's apps made from a ready-made template, and whether each is up to date with it (D-130): "up to date", "an
 * update is ready" (the template changed since the app was made or last updated from it), or "can't tell" (an app made
 * before apps recorded their template, matched by its name).
 * @param {{ apps: object }} parts
 * @param {object} options the call's
 */
export async function templateStatus({ apps }, options) {
  const { apps: list } = await apps.list({ withPins: false, kind: "app" }, options);
  return list.flatMap((app) => {
    const found = templateOfApp(app);
    if (!found) return [];
    const latest = templateVersionOf(found.template);
    const state = found.by === "name" || !app.templateVersion ? "can't tell" : app.templateVersion === latest ? "up to date" : "an update is ready";
    const published = Boolean(app.liveVersionId);
    return [{ app: app.slug, name: app.name, template: found.template.key, matchedBy: found.by, state, published }];
  });
}

/**
 * Brings an app up to its template's latest version as a draft (D-130): the tables the template needs are made or
 * completed (nothing removed or renamed), the template's screens become the app's draft, and the app notes the
 * version. The live app keeps working until a person publishes. Answers the app, the draft's save errors, and the
 * screens the app had (its draft, else live), by names, so the Builder can carry over the person's own changes.
 * @param {object} parts registry, apps, catalog
 * @param {{ actor: object, options: object }} ctx a gate ctx
 * @param {string} slugOrId the app
 */
export async function updateFromTemplate({ registry, apps, catalog }, ctx, slugOrId) {
  const { options, actor } = ctx;
  const before = await apps.get(slugOrId, { version: "draft" }, options);
  const found = templateOfApp(before.app);
  if (!found) {
    throw new AppError(409, `${before.app.name} wasn't made from a ready-made template.`, {
      code: "apps_template_unknown",
      params: { app: before.app.slug }
    });
  }
  const { template } = found;
  await prepareTables({ registry, catalog }, ctx, template);
  const { errors = [] } = await apps.saveDraft(actor, before.app.slug, template.definition, `Updated from the ${template.name} template`, options);
  await apps.markTemplate(before.app.id, { key: template.key, version: templateVersionOf(template) }, options);
  return { app: before.app, template: template.key, errors, previous: before.definition };
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

/** What a template's screens do, for its card: line items, a board, a calendar, a timeline, a public page, sending. */
function abilitiesOf(definition) {
  const parts = JSON.stringify(definition.screens || {});
  const has = (type) => parts.includes(`"type":"${type}"`);
  return [
    ...(has("lines") ? ["lines"] : []),
    ...(has("board") ? ["board"] : []),
    ...(has("calendar") ? ["calendar"] : []),
    ...(has("timeline") ? ["timeline"] : []),
    ...(definition.public ? ["public"] : []),
    ...(parts.includes('"onSubmit"') ? ["sends"] : [])
  ];
}

/** What the Templates tab shows of each: its picture, the kinds of use it serves and what it needs switched on. */
export const templateSummaries = () => TEMPLATES.map((template) => ({
  key: template.key,
  name: template.name,
  icon: template.glyph || template.icon,
  color: template.color,
  audiences: template.audiences || [],
  abilities: abilitiesOf(template.definition),
  needs: template.needs?.words || null,
  description: template.description,
  screens: Object.keys(template.definition.screens).length,
  tables: [...(template.uses || []), ...template.tables.map((table) => table.key)],
  public: Boolean(template.definition.public),
  sample: Object.values(template.sample || {}).some((rows) => rows.length)
}));

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ TEMPLATES });
