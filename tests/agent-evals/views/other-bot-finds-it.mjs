import { anotherBot, dealsTable, fail, haveView, pass, PIPELINE, viewsOf } from "./helpers.mjs";
// Asked in another bot's chat, weeks later: it finds the person's view instead of making another.
export const builder = false;
export async function setup(ctx) {
  await dealsTable(ctx);
  const first = await anotherBot(ctx, "Ledger");
  await haveView(ctx, "Pipeline", PIPELINE, { botId: first.id });
}
export const prompt = "Change my Pipeline view's chart to a line chart.";
export async function judge(ctx) {
  const views = await viewsOf(ctx);
  if (views.length !== 1) return fail(`${views.length} views`);
  if (!views[0].parts.includes('"line"')) return fail(`not a line: ${views[0].parts.slice(0, 200)}`);
  if (views[0].versions.length !== 2) return fail(`${views[0].versions.length} versions`);
  return pass();
}
