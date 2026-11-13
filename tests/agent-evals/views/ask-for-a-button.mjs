import { dealsTable, fail, haveView, pass, PIPELINE, saysItCant, viewsOf } from "./helpers.mjs";
// A view can't do things: it says so honestly and offers the way, rather than pretending.
export const builder = false;
export async function setup(ctx) {
  await dealsTable(ctx);
  const made = await haveView(ctx, "Pipeline", PIPELINE);
  if (made.errors.length) throw new Error(JSON.stringify(made.errors));
}
export const prompt = "On my Pipeline view, add a button next to each deal that marks it as Won.";
export async function judge(ctx) {
  const [view] = await viewsOf(ctx);
  if (view.errors.length) return fail("saved something a view can't hold");
  if (/"button"|onRowClick|rowActions/u.test(view.parts)) return fail("a button got in");
  if (!saysItCant(ctx.reply)) return fail(`didn't say it can't: ${ctx.reply.slice(0, 300)}`);
  return pass();
}
