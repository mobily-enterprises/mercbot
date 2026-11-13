// The words and figures of Settings → Spending (D-73, D-76): what each kind of use is called, how much of it there was
// and the periods a report covers (UTC's days, as the totals are kept).

export const KIND_LABELS = Object.freeze({
  premium: "Premium AI",
  economy: "Economy AI",
  images: "Pictures",
  computer: "Computer days",
  computation: "Commands"
});

const plural = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** A length of time, e.g. "3 h 20 min", "12 min", "40 s". */
export function duration(seconds) {
  const whole = Math.round(Number(seconds) || 0);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/** How much of a kind there was in a month, e.g. "12 replies and steps", "3 pictures", "2 h 5 min". */
export function kindAmount(row) {
  // The images kind's calls that make no picture are photos read for the Vault (D-73).
  if (row.kind === "images") {
    const pictures = row.images || 0;
    const reads = Math.max(0, (row.calls || 0) - pictures);
    const said = [];
    if (pictures || !reads) said.push(plural(pictures, "picture", "pictures"));
    if (reads) said.push(plural(reads, "photo read", "photos read"));
    return said.join(", ");
  }
  if (row.kind === "computer") return plural(row.calls, "day", "days");
  if (row.kind === "computation") return `${duration(row.seconds)} running`;
  return plural(row.calls, "AI call", "AI calls");
}

/** Each row's share of the largest, as a bar's width in percent (at least a sliver for anything spent). */
export function barWidths(rows) {
  const most = Math.max(0, ...rows.map((row) => row.spentNano));
  return rows.map((row) => (most > 0 && row.spentNano > 0 ? Math.max(2, Math.round((row.spentNano / most) * 100)) : 0));
}

/** The periods a report covers (D-76). */
export const PERIODS = Object.freeze([
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "custom", label: "Custom range" }
]);

/** A UTC day at noon, so it's the same day wherever it's shown with timeZone "UTC". */
const utcDay = (year, month, day) => new Date(Date.UTC(year, month, day, 12));

/** A moment's day (UTC) as "YYYY-MM-DD". */
export const isoDay = (date) => date.toISOString().slice(0, 10);

/** "YYYY-MM-DD" as that day (UTC), at noon. */
export const dayOf = (day) => new Date(`${day}T12:00:00Z`);

/**
 * The days a period covers around a day, first and last (UTC), with what to call them: the day itself, its week
 * (Monday to Sunday) or its month.
 * @param {"day" | "week" | "month"} period
 * @param {Date} anchor
 */
export function periodRange(period, anchor) {
  const day = utcDay(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const utc = { timeZone: "UTC" };
  if (period === "day") {
    return { from: isoDay(day), to: isoDay(day), label: day.toLocaleDateString(undefined, { ...utc, weekday: "short", day: "numeric", month: "short", year: "numeric" }) };
  }
  if (period === "week") {
    const first = utcDay(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const last = utcDay(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + 6);
    const short = { ...utc, day: "numeric", month: "short" };
    return { from: isoDay(first), to: isoDay(last), label: `${first.toLocaleDateString(undefined, short)} – ${last.toLocaleDateString(undefined, { ...short, year: "numeric" })}` };
  }
  const first = utcDay(day.getUTCFullYear(), day.getUTCMonth(), 1);
  const last = utcDay(day.getUTCFullYear(), day.getUTCMonth() + 1, 0);
  return { from: isoDay(first), to: isoDay(last), label: first.toLocaleDateString(undefined, { ...utc, month: "long", year: "numeric" }) };
}

/** The same day a period earlier (-1) or later (1). */
export function stepPeriod(period, anchor, step) {
  const [year, month, day] = [anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()];
  if (period === "day") return utcDay(year, month, day + step);
  if (period === "week") return utcDay(year, month, day + 7 * step);
  return utcDay(year, month + step, 1);
}

/** The most days one report covers, as the server allows. */
export const MOST_REPORT_DAYS = 366;
/** The daily totals are kept for this month and the twelve before it (D-73); older months have their totals only. */
const DAILY_MONTHS = 13;

/** The first day whose daily totals are still kept, "YYYY-MM-DD". */
export const daysKeptFrom = (now = new Date()) => isoDay(utcDay(now.getUTCFullYear(), now.getUTCMonth() - (DAILY_MONTHS - 1), 1));

/** Why a custom range can't be reported, or "" when it can. */
export function rangeProblem(from, to, now = new Date()) {
  if (!from || !to) return "Choose the first and last day.";
  const days = Math.round((dayOf(to) - dayOf(from)) / 86400000) + 1;
  if (days < 1) return "The last day comes before the first.";
  if (days > MOST_REPORT_DAYS) return "A report covers at most a year and a day.";
  if (from < daysKeptFrom(now)) return `Day-by-day totals are kept ${DAILY_MONTHS} months: for an older month, choose Month.`;
  return "";
}

/** A day of a month, "2026-11-05", as "5 Nov". */
export const dayLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** A month, "2026-11", as "November 2026", or as "November" without its year. */
export const monthLabel = (month, { year = true } = {}) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
