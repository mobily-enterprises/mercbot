import { appsOf, fail, fieldsOf, json, pass } from "./helpers.mjs";
// Change an existing app (the CRM template): a new field, shown on the contacts list.
export async function setup(ctx) {
  await ctx.apps.installTemplate({ workspaceId: ctx.workspaceId, actor: ctx.actor }, "crm");
}
export const prompt = "In the CRM app, add a \"Birthday\" date field to contacts, and show it as a column on the contacts list.";
export async function judge(ctx) {
  const { apps, tables } = await appsOf(ctx);
  const contacts = tables.find((table) => table.key === "contacts");
  const field = contacts && fieldsOf(contacts).find((entry) => /birth/iu.test(`${entry.key} ${entry.label}`));
  if (!field) return fail(`no birthday field: ${json(contacts && fieldsOf(contacts).map((entry) => entry.key))}`);
  if (field.type !== "date") return fail(`birthday is ${field.type}, not a date`);
  const crm = apps.find((entry) => /crm/iu.test(entry.app.name));
  if (!crm) return fail("no CRM app");
  if (crm.errors.length) return fail(`the CRM fails its save check: ${json(crm.errors.slice(0, 3))}`);
  if (!json(crm.definition).includes(field.key)) return fail("the list doesn't show the field");
  return pass();
}
