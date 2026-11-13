import { dealsTable, fail, haveView, pass, PIPELINE, viewParts } from "./helpers.mjs";
// The person wants this app kept apart: a copy, which goes through Draft and Publish, and its query runs.
export async function setup(ctx) {
  await dealsTable(ctx);
  await haveView(ctx, "Pipeline", PIPELINE);
}
export const prompt = "Make a small Board Report app showing our Pipeline view. The board signs this off, so later changes to Pipeline must not change this app unless I say so.";
export async function judge(ctx) {
  const made = await ctx.knex("apps").where({ workspace_id: ctx.workspaceId, kind: "app" });
  if (!made.length) return fail("no app");
  if (made.length > 1) return fail(`made ${made.length} apps: ${made.map((entry) => entry.slug)}`);
  const [app] = made;
  const { definition, parts } = await viewParts(ctx, app.slug);
  const part = parts.find((entry) => entry.screen);
  if (!part) return fail(`no copy: ${JSON.stringify(parts)}`);
  const screen = definition.screens[part.screen];
  if (screen?.copiedFrom?.view !== "pipeline") return fail(`copiedFrom: ${JSON.stringify(screen?.copiedFrom)}`);
  const context = { workspaceId: ctx.workspaceId, actor: ctx.actor, via: { kind: "data" } };
  const answer = await ctx.apps.runtime.query(context, { slug: app.slug, version: "draft", screen: part.screen, query: Object.keys(screen.data)[0] });
  if (answer.needsAttention) return fail("the copy's query doesn't run");
  return pass();
}
