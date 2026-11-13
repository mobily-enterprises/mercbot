import { checkApp } from "../../../packages/apps/src/shared/check.js";
import { toNames } from "../../../packages/apps/src/shared/definitions.js";

// What the judges look at: the home's live apps and tables, each app's latest saved version,
// and whether that version passes the app's own save check.
export async function appsOf(ctx) {
  const rows = await ctx.knex("apps").where({ workspace_id: ctx.workspaceId }).orderBy("id");
  const tables = await ctx.apps.registry.loadTables(ctx.workspaceId);
  const result = [];
  for (const app of rows) {
    const version = await ctx.knex("app_versions").where({ app_id: app.id }).orderBy("id", "desc").first();
    // Saved definitions refer to tables and fields by id; the checker reads names, as the Builder writes them.
    const stored = typeof version?.definition === "string" ? JSON.parse(version.definition) : version?.definition;
    const definition = stored ? toNames(stored, tables) : null;
    result.push({ app, definition, errors: definition ? checkApp(definition, tables, { scripts: null }) : [{ message: "no version" }] });
  }
  return { apps: result, tables: tables.filter((table) => !table.obsolete) };
}

export const fieldsOf = (table) => table.fields.filter((field) => !field.obsolete);
export const json = (value) => JSON.stringify(value);
export function fail(message) { return { pass: false, notes: message }; }
export function pass(notes = "") { return { pass: true, notes }; }
