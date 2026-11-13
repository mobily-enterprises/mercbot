import { fail, json, pass } from "./helpers.mjs";
// Records through the bot: add three contacts to an existing app's table.
export async function setup(ctx) {
  await ctx.apps.installTemplate({ workspaceId: ctx.workspaceId, actor: ctx.actor }, "crm");
}
export const prompt = "Add these three people to the CRM's contacts: Ana Ruiz (ana@ruiz.example, Ruiz Design), Ben Okafor (ben@okafor.example) and Chloe Tan of Tan & Co (chloe@tanco.example). They're all leads.";
export async function judge(ctx) {
  const data = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "app" } };
  const rows = (await ctx.apps.gate.read(data, "contacts", { page: { size: 200 } }))?.records || [];
  // A record's values sit under field ids or keys depending on the layer; look in both.
  const emails = rows.map((row) => String(Object.values({ ...row, ...(row.values || {}) }).find((value) => /@/u.test(String(value))) || "").toLowerCase()).sort();
  const wanted = ["ana@ruiz.example", "ben@okafor.example", "chloe@tanco.example"];
  if (json(emails.filter((email) => wanted.includes(email))) !== json(wanted)) return fail(`emails: ${json(emails)}`);
  return pass();
}
