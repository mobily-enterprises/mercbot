import { appsOf, fail, json, pass } from "./helpers.mjs";
// A rule checked on every save, written as a script with its own tests.
export async function setup(ctx) {
  await ctx.apps.installTemplate({ workspaceId: ctx.workspaceId, actor: ctx.actor }, "crm");
}
export const prompt = "In the CRM app, a deal must never be saved with a negative amount: refuse it with a clear message. Make sure it's tested.";
export async function judge(ctx) {
  const { apps } = await appsOf(ctx);
  const crm = apps.find((entry) => /crm/iu.test(entry.app.name));
  if (!crm || crm.errors.length) return fail(`CRM missing or broken: ${json(crm?.errors?.slice(0, 3))}`);
  const scripts = await ctx.knex("app_scripts").where({ app_id: crm.app.id });
  if (!scripts.length) return fail("no script");
  const tested = scripts.filter((script) => (script.tests || []).length);
  if (!tested.length) return fail("no tests");
  // The rule itself: saving a negative deal is refused, a positive one isn't.
  const data = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "app", appId: crm.app.id } };
  const bad = await ctx.apps.gate.create(data, "deals", { title: "Refund", amount: -50 }).then(() => null, (error) => error);
  if (!bad) return fail("a negative deal was saved");
  const good = await ctx.apps.gate.create(data, "deals", { title: "Fine", amount: 50 }).then(() => null, (error) => error);
  if (good) return fail(`a positive deal was refused: ${good.message}`);
  return pass(String(bad.message).slice(0, 120));
}
