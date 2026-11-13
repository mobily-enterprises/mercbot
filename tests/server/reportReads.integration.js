import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { createReports } from "../../packages/account/src/server/reports.js";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { plansDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// A home's spending report (D-76) reads its own totals, never the other homes' (D-73): the charges load test's busy
// home took 0.3 s beside 2,000 homes and 131 s beside 400,000 while its report's grouped totals read the whole table.

/** Homes of their own, past any the test database has. */
const HOME = 900_000_000;
const others = (from, count) => Array.from({ length: count }, (_, index) => HOME + 1 + from + index);

test("a home's spending report reads its own totals, however many other homes have theirs", async (context) => {
  const knex = await connectTestDatabase();
  const { features, profiles } = await ownedHandles(knex, context, { "mercbot.account": ACCOUNT_OWNS });
  context.after(() => knex.destroy());
  const { resources, systemContext } = features["mercbot.account"];
  const reports = createReports({ resources, systemContext, profiles });
  const month = new Date().toISOString().slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  await knex.raw("select mercbot_usage_daily_partition(?::date)", [`${month}-01`]);

  // Each home's totals: 15 days of 5 bots, 4 people and 3 kinds, and its month's.
  async function writeTotals(homes) {
    await knex.raw(`
      insert into usage_daily (workspace_id, day, bot_id, user_id, kind, bot_name, calls, cost_nano)
      select h, ?::date + d, b, u, k, 'Bot ' || b, 1, 1000
      from unnest(?::bigint[]) h, generate_series(0, 14) d, generate_series(1, 5) b, generate_series(1, 4) u, unnest(array['premium', 'economy', 'images']) k`,
    [`${month}-01`, homes]);
    await knex.raw(`
      insert into usage_monthly (workspace_id, month, bot_id, user_id, kind, bot_name, calls, cost_nano)
      select workspace_id, ?::date, bot_id, user_id, kind, max(bot_name), sum(calls), sum(cost_nano)
      from usage_daily where workspace_id = any(?::bigint[]) group by 1, 3, 4, 5`, [`${month}-01`, homes]);
    await knex.raw("analyze usage_daily, usage_monthly");
  }
  const owner = { userId: "1", manages: true };
  // A range of days, from the daily totals, and a whole month, its days from them and the rest from the monthly totals.
  const ranges = { days: { from: `${month}-01`, to: `${month}-15` }, wholeMonth: { from: `${month}-01`, to: lastDay } };
  /** Each range's report, the statements it sends to the totals and the rows they read. */
  async function reportsAndReads() {
    const found = {};
    for (const [name, range] of Object.entries(ranges)) {
      let report = null;
      const plans = await plansDuring(knex, async () => { report = await reports.report(String(HOME), { ...owner, ...range }); });
      const totals = plans.filter((plan) => /usage_(daily|monthly)/u.test(plan.sql));
      found[name] = { report, statements: totals.length, rowsRead: totals.reduce((sum, plan) => sum + plan.rowsRead, 0) };
    }
    return found;
  }

  await writeTotals([HOME, ...others(0, 2)]);
  const few = await reportsAndReads();
  assert.deepEqual(
    [few.days.report.byBot.length, few.days.report.byPerson.length, few.days.report.byKind.length, few.days.report.byDay.length],
    [5, 4, 3, 15]
  );
  await writeTotals(others(2, 18));
  assert.deepEqual(await reportsAndReads(), few, "beside ten times the other homes' totals: the same reports, statements and rows read");
});
