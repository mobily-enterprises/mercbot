import { PAGE_MAX } from "../shared/index.js";
import { GateError } from "./validate.js";

// The different days a date field's totals by period read at most (periodTotals): about eleven years of every day.
const PERIOD_DAYS = 4000;

/** The first day of the week (Monday), month or year a date (YYYY-MM-DD) is in, or the day itself; null for none. */
function periodStart(day, by) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(day || ""));
  if (!match) return null;
  if (by === "year") return `${match[1]}-01-01`;
  if (by === "month") return `${match[1]}-${match[2]}-01`;
  if (by !== "week") return match[0];
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * A date field's totals by week, month or year (D-140): the database groups them by day, at most PERIOD_DAYS days
 * read PAGE_MAX at a time in date order, and the days fold into their periods, each keyed by its first day. The newest
 * 100 periods come back, oldest first. Its cost follows the days the records span, never how many records there are.
 */
export async function periodTotals(api, table, where, { groupBy, by, measure, field }) {
  const summed = measure === "sum" || measure === "avg";
  const measures = { count: { count: "*" }, ...(summed ? { total: { sum: field }, values: { count: field } } : {}) };
  const periods = new Map();
  for (let number = 1; ; number += 1) {
    if ((number - 1) * PAGE_MAX >= PERIOD_DAYS) {
      throw new GateError(400, `These records span more than ${PERIOD_DAYS} different days: filter them first, such as to the last few years.`, {
        code: "apps_period_too_long",
        params: { days: PERIOD_DAYS }
      });
    }
    const { data = [] } = await api.resources[table.id].aggregate({
      groupBy: [groupBy],
      measures,
      queryParams: { sort: [groupBy], page: { size: PAGE_MAX, number } }
    }, { where });
    for (const row of data) {
      const key = periodStart(row[groupBy], by);
      const period = periods.get(key) || { key, count: 0, sum: 0, values: 0 };
      periods.set(key, period);
      period.count += Number(row.count);
      period.sum += Number(row.total ?? 0);
      period.values += Number(row.values ?? 0);
    }
    if (data.length < PAGE_MAX) break;
  }
  return [...periods.values()]
    .sort((first, second) => String(first.key ?? "").localeCompare(String(second.key ?? "")))
    .slice(-100)
    .map(({ key, count, sum, values }) => ({
      key,
      count,
      ...(summed && values ? { total: measure === "avg" ? sum / values : sum } : {})
    }));
}
