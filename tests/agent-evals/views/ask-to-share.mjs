import { dealsTable, fail, haveView, pass, PIPELINE, viewsOf } from "./helpers.mjs";
// Every view is already the whole home's (D-66): the bot says so, and changes nothing.
export const builder = false;
export async function setup(ctx) {
  await dealsTable(ctx);
  await haveView(ctx, "Pipeline", PIPELINE);
}
export const prompt = "Share my Pipeline view with everyone in the home please.";
export async function judge(ctx) {
  const views = await viewsOf(ctx);
  if (views.length !== 1) return fail(`${views.length} views`);
  if (views[0].versions.length !== 1) return fail("it changed the view");
  if (!/already|everyone in (?:the|your) home|anyone in (?:the|your) home|whole home/iu.test(ctx.reply)) return fail(`doesn't say everyone sees it: ${ctx.reply.slice(0, 300)}`);
  if (/\bonly me\b/iu.test(ctx.reply)) return fail(`sends the person to a setting that's gone: ${ctx.reply.slice(0, 300)}`);
  return pass();
}
