import { dealsTable, fail, pass, toolsCalled, viewsOf } from "./helpers.mjs";
// Figures the home doesn't hold: it mustn't invent a table or fake a view.
export const builder = false;
export const setup = dealsTable;
export const prompt = "Make me a live view of my gym visits per month.";
export async function judge(ctx) {
  const views = await viewsOf(ctx);
  if (views.length) return fail(`made a view: ${views[0].parts.slice(0, 200)}`);
  if (!/table|builder/iu.test(ctx.reply)) return fail(`didn't say it needs a table: ${ctx.reply.slice(0, 200)}`);
  if ((await toolsCalled(ctx)).includes("dataCreate")) return fail("wrote data");
  return pass();
}
