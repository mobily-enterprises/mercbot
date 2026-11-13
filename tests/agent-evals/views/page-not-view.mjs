import { cards, dealsTable, fail, pass, viewsOf } from "./helpers.mjs";
// Written content stays a page, even in a home that has figures.
export const builder = false;
export const setup = dealsTable;
export const prompt = "Write me a page with a checklist for onboarding a new salesperson, something we can keep and tick off.";
export async function judge(ctx) {
  if ((await viewsOf(ctx)).length) return fail("made a view");
  if (!(await cards(ctx, "page")).length) return fail("no page card");
  return pass();
}
