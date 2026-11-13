import { OPEN_TOTAL, cards, dealsTable, fail, pass, viewsOf } from "./helpers.mjs";
// The first thing anyone asks: figures they want kept current, from a bot that isn't the Builder.
export const builder = false;
export const setup = dealsTable;
export const prompt = "Can you show me open deals by stage as a chart, and the ten biggest? I want to keep an eye on this every day.";
export async function judge(ctx) {
  const views = await viewsOf(ctx);
  if (views.length !== 1) return fail(`${views.length} views`);
  const [view] = views;
  if (view.errors.length) return fail(`check: ${JSON.stringify(view.errors)}`);
  if (!(await cards(ctx, "view")).length) return fail("no card");
  if ((await cards(ctx, "view")).length !== 1) return fail("more than one card");
  if ((await ctx.knex("apps").where({ workspace_id: ctx.workspaceId, kind: "app" })).length) return fail("made an app");
  if (!view.parts.includes('"chart"')) return fail("no chart");
  const lists = Object.values(view.answers).filter((answer) => answer.records);
  if (!lists.some((list) => list.records.length === 10)) return fail(`no list of ten: ${lists.map((list) => list.records.length)}`);
  const list = lists.find((entry) => entry.records.length === 10);
  if (list.records.some((record) => ["Won", "Lost"].includes(record.stage))) return fail("closed deals in the open list");
  if (list.records[0].title !== "Kite expansion") return fail(`biggest first? ${list.records[0].title}`);
  const totals = Object.values(view.answers).find((answer) => answer.totals);
  if (!totals) return fail("no figures by stage");
  const open = totals.totals.reduce((sum, item) => sum + (item.total ?? 0), 0);
  if (open !== OPEN_TOTAL) return fail(`open by stage adds to ${open}, not ${OPEN_TOTAL}`);
  return pass();
}
