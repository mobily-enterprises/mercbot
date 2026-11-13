import { appsOf, fail, fieldsOf, json, pass } from "./helpers.mjs";
// A new app from scratch: a table with the right kinds of fields, a list and a way to add.
export const prompt = "Please make me an app to keep track of watering our house plants: each plant has a name, the date it was last watered and notes. I want a list with the most recently watered first, and a form to add a plant.";
export async function judge(ctx) {
  const { apps, tables } = await appsOf(ctx);
  const table = tables.find((entry) => fieldsOf(entry).some((field) => field.type === "date"));
  if (!table) return fail(`no table with a date field: ${json(tables.map((entry) => entry.key))}`);
  const types = fieldsOf(table).map((field) => field.type);
  if (!types.includes("text")) return fail(`no text field: ${json(types)}`);
  const app = apps.find((entry) => json(entry.definition || {}).includes(table.key));
  if (!app) return fail("no app uses the table");
  if (app.errors.length) return fail(`the app fails its save check: ${json(app.errors.slice(0, 3))}`);
  const text = json(app.definition);
  if (!/"(create|form|add)/iu.test(text)) return fail("no way to add a plant");
  if (!/"(sort|order)/iu.test(text)) return fail("the list isn't sorted");
  return pass(app.app.name);
}
