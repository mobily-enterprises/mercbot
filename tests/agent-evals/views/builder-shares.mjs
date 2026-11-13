import { dealsTable, fail, haveView, pass, PIPELINE, viewParts } from "./helpers.mjs";
// The Builder puts a home-wide view in a new app: shared, in a draft that's checked and that loads.
export async function setup(ctx) {
  await dealsTable(ctx);
  ctx.view = await haveView(ctx, "Pipeline", PIPELINE);
}
export const prompt = "Make a small Sales app whose home screen shows our Pipeline view, plus a list of all deals. If Pipeline changes later I want the app to show the change.";
export async function judge(ctx) {
  const made = await ctx.knex("apps").where({ workspace_id: ctx.workspaceId, kind: "app" });
  if (!made.length) return fail("no app");
  if (made.length > 1) return fail(`made ${made.length} apps: ${made.map((entry) => entry.slug)}`);
  const [app] = made;
  const { parts } = await viewParts(ctx, app.slug);
  const part = parts.find((entry) => entry.view === "pipeline");
  if (!part) return fail(`no shared view part: ${JSON.stringify(parts)}`);
  if (part.screen) return fail("made a copy");
  if (app.live_version_id) return fail("published by itself");
  return pass();
}
