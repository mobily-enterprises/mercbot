import { dealsTable, fail, pass, viewsOf } from "./helpers.mjs";
// A real back-and-forth: it's changed three times, in passing, and stays one view that stays live.
export const builder = false;
export async function setup(ctx) {
  ctx.deals = await dealsTable(ctx);
}
export async function script({ say }) {
  await say("Make me a view of open deals by stage as a chart.");
  await say("Make it a pie and add the total.");
  await say("Good. Add a list of the five biggest under it, and call the whole thing Pipeline.");
}
export async function judge(ctx) {
  const views = await viewsOf(ctx);
  if (views.length !== 1) return fail(`${views.length} views: ${views.map((view) => view.row.name)}`);
  const [view] = views;
  if (view.errors.length) return fail(`check: ${JSON.stringify(view.errors)}`);
  if (view.versions.length < 3) return fail(`${view.versions.length} versions`);
  if (view.row.name !== "Pipeline") return fail(`called ${view.row.name}`);
  if (!view.parts.includes('"pie"')) return fail("no pie");
  const totals = Object.values(view.body.data).some((query) => query.grandTotal === true);
  if (!totals && !view.parts.includes('"totals"')) return fail("no total");
  const lists = Object.values(view.answers).filter((answer) => answer.records);
  if (!lists.some((list) => list.records.length === 5)) return fail("no list of five");
  return pass();
}
