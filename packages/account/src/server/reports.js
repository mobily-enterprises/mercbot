import { Readable } from "node:stream";
import { AccountError } from "./accountError.js";
import { DAILY_MONTHS } from "./retention.js";
import { everyGroup, seen } from "./spending.js";

// Spending reports (D-76): what a home spent over any range of days, by day, kind, bot and person, and the same as a
// CSV, read from the totals every finished piece of work adds to (D-73), never from each call's row, so a report costs
// the same for a busy home or a quiet one. Days are UTC's, as the totals keep them. The daily totals are kept 13
// months; a whole month is read from the monthly totals, kept for good, so an older month still has its totals
// (without its days). Everyone sees what was spent: owners and admins the whole home, a member their own use. What's
// spent is the totals' `spend` measure: what the work cost at its AI providers, unless a copy built on Mercbot names
// another.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 86_400_000;
/** The longest range a report covers: a year and a day, so any calendar year fits. */
const MOST_DAYS = 366;
const CSV_COLUMNS = Object.freeze(["Bot", "Person", "Kind", "Uses", "Pictures", "Seconds", "Spent (USD)"]);
const KIND_NAMES = Object.freeze({ premium: "Premium AI", economy: "Economy AI", images: "Pictures", computer: "Computer days", computation: "Commands" });
const NANO_PER_DOLLAR = 1_000_000_000n;

/** A date "YYYY-MM-DD" as its parts, or null when it isn't a real one. */
function dateParts(text) {
  const match = DATE.exec(String(text || ""));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? { year, month, day } : null;
}

/** A day "YYYY-MM-DD", `days` after the given one. */
const dayAfter = ({ year, month, day }, days = 1) => new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);

/**
 * The range a report covers, from its first day to its last (both included), in UTC days. With no range, this month
 * so far. A range of one whole month is that month, read from the monthly totals; any other is read from the daily
 * totals, so it must start within the 13 months they're kept.
 * @param {{ from?: string, to?: string }} asked
 * @param {Date} now
 */
export function reportRange(asked, now) {
  const today = now.toISOString().slice(0, 10);
  const from = dateParts(asked.from || `${today.slice(0, 8)}01`);
  const to = dateParts(asked.to || today);
  if (!from || !to) throw new AccountError(400, "Choose the days as YYYY-MM-DD.", { code: "report_range_invalid" });
  const days = Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / DAY_MS) + 1;
  if (days < 1 || days > MOST_DAYS) {
    throw new AccountError(400, `A report covers 1 to ${MOST_DAYS} days, from its first day to its last.`, { code: "report_range_invalid" });
  }
  const first = dayAfter(from, 0);
  const before = dayAfter(to);
  const month = from.day === 1 && before.endsWith("-01") && to.year === from.year && to.month === from.month ? first : null;
  const daysKept = first >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (DAILY_MONTHS - 1), 1)).toISOString().slice(0, 10);
  if (!daysKept && !month) {
    throw new AccountError(400, `Day-by-day totals are kept ${DAILY_MONTHS} months: for an older month, choose the whole month.`, {
      code: "report_range_too_old"
    });
  }
  return { from: first, to: dayAfter(to, 0), before, days, month, daysKept };
}

/** Every day of a range, "YYYY-MM-DD", first to last. */
function everyDay(range) {
  const from = dateParts(range.from);
  return Array.from({ length: range.days }, (_, index) => dayAfter(from, index));
}

/**
 * One CSV field: quoted when it holds a comma, a quote or a line break, and a name a spreadsheet would read as a
 * formula (=, +, -, @ first) starts with an apostrophe, so opening the file runs nothing.
 */
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Whole nanodollars as dollars with every digit kept, counted in integers, for a spreadsheet: "1.23", "0.000042". */
export function csvDollars(nano) {
  const amount = BigInt(String(nano ?? 0));
  const size = amount < 0n ? -amount : amount;
  const fraction = (size % NANO_PER_DOLLAR).toString().padStart(9, "0").replace(/0+$/u, "");
  return `${amount < 0n ? "-" : ""}${size / NANO_PER_DOLLAR}${fraction ? `.${fraction}` : ""}`;
}

/**
 * @param {object} dependencies
 * @param {{ usageDaily: any, usageMonthly: any }} dependencies.resources the totals' handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} dependencies.profiles
 * @param {string} [dependencies.spend] the totals' measure that is what was spent
 * @param {() => Date} [dependencies.now]
 */
export function createReports({ resources, systemContext, profiles, spend = "costNano", now = () => new Date() }) {
  const { usageDaily, usageMonthly } = resources;

  /** A range's days, from the daily totals. */
  const daysOf = (homeId, reader, range) => ({
    handle: usageDaily,
    filters: { ...seen(homeId, reader), dayFrom: range.from, dayBefore: range.before }
  });
  /** A range's totals: its month's from the monthly totals, or its days'. */
  const totalsOf = (homeId, reader, range) => (range.month
    ? { handle: usageMonthly, filters: { ...seen(homeId, reader), month: range.month } }
    : daysOf(homeId, reader, range));

  /** People's names, by id: their display name, else their email's first part. */
  async function namesOf(userIds) {
    const ids = userIds.filter((id) => Number(id) > 0).map(String);
    if (!ids.length) return new Map();
    const found = await profiles.listByIds(ids, { context: systemContext("name the people in a home's spending report") });
    return new Map(found.map((user) => [String(user.id), user.displayName || String(user.email || "").split("@")[0] || "Someone"]));
  }

  /**
   * A home's spending over a range of days: the total, each day (while the daily totals are kept), each kind, each
   * bot and, for owners and admins, each person.
   * @param {string} homeId
   * @param {{ userId: string, manages: boolean, from?: string, to?: string }} reader
   */
  async function report(homeId, reader) {
    const range = reportRange(reader, now());
    const totals = totalsOf(homeId, reader, range);
    const options = { context: systemContext("add up the spending a home's member may see over a range of days") };
    // Each of a report's few groups (days, kinds, bots, people) from a range's totals.
    const groups = ({ handle, filters }, spec) => everyGroup(handle, { ...spec, filters }, options);
    const money = { spentNano: { sum: spend }, calls: { sum: "calls" } };
    const [byDay, byKind, byBot, byPerson] = await Promise.all([
      range.daysKept ? groups(daysOf(homeId, reader, range), { groupBy: ["day"], measures: { spentNano: { sum: spend } } }) : [],
      groups(totals, { groupBy: ["kind"], measures: { ...money, images: { sum: "images" }, seconds: { sum: "seconds" } } }),
      groups(totals, { groupBy: ["botId"], measures: { ...money, name: { max: "botName" } }, sort: ["-spentNano"] }),
      reader.manages ? groups(totals, { groupBy: ["userId"], measures: money, sort: ["-spentNano"] }) : []
    ]);
    const names = await namesOf(byPerson.map((row) => row.userId));
    const spentOn = new Map(byDay.map((row) => [String(row.day).slice(0, 10), Number(row.spentNano) || 0]));
    return {
      scope: reader.manages ? "home" : "own",
      from: range.from,
      to: range.to,
      daysKept: range.daysKept,
      totalNano: byKind.reduce((total, row) => total + (Number(row.spentNano) || 0), 0),
      byDay: range.daysKept ? everyDay(range).map((day) => ({ day, spentNano: spentOn.get(day) || 0 })) : [],
      byKind: byKind.map((row) => ({
        kind: row.kind,
        spentNano: Number(row.spentNano) || 0,
        calls: Number(row.calls) || 0,
        images: Number(row.images) || 0,
        seconds: Number(row.seconds) || 0
      })),
      byBot: byBot.map((row) => ({
        botId: Number(row.botId) > 0 ? String(row.botId) : null,
        name: row.name || "",
        spentNano: Number(row.spentNano) || 0,
        calls: Number(row.calls) || 0
      })),
      byPerson: byPerson.map((row) => ({
        userId: Number(row.userId) > 0 ? String(row.userId) : null,
        name: names.get(String(row.userId)) || "",
        spentNano: Number(row.spentNano) || 0,
        calls: Number(row.calls) || 0
      }))
    };
  }

  /** A table's rows, a page at a time by cursor (so each page costs the same however far in), each handed on as read. */
  async function* rowPages(handle, params, options) {
    for (let after = null; ;) {
      const size = handle.pageLimits().request;
      const { records, page } = await handle.query({ ...params, page: after ? { size, after } : { size } }, options);
      yield records;
      if (!page.hasMore) return;
      after = page.next;
    }
  }

  /**
   * The same range as a CSV, streamed a page of totals at a time: one line per day, bot, person and kind, or, for a
   * month older than the daily totals, per bot, person and kind. Each line is one totals row, as those are its keys.
   * The file name, and the stream of its lines.
   * @param {string} homeId
   * @param {{ userId: string, manages: boolean, from?: string, to?: string }} reader
   */
  function exportCsv(homeId, reader) {
    const range = reportRange(reader, now());
    const { handle, filters } = range.daysKept ? daysOf(homeId, reader, range) : totalsOf(homeId, reader, range);
    const period = range.daysKept ? "day" : "month";
    const options = { context: systemContext("export the spending a home's member may see over a range of days") };
    const params = {
      filters,
      fields: [period, "botId", "botName", "userId", "kind", "calls", "images", "seconds", spend],
      sort: [period, "botId", "userId", "kind"]
    };
    async function* lines() {
      yield `${[range.daysKept ? "Day" : "Month", ...CSV_COLUMNS].map(csvCell).join(",")}\r\n`;
      for await (const page of rowPages(handle, params, options)) {
        const names = await namesOf([...new Set(page.map((row) => row.userId))]);
        yield page.map((row) => [
          String(row[period]).slice(0, range.daysKept ? 10 : 7),
          row.botName || (Number(row.botId) > 0 ? "A deleted bot" : "Not for a bot"),
          Number(row.userId) > 0 ? names.get(String(row.userId)) || "Someone who left" : "Nobody in particular",
          KIND_NAMES[row.kind] || row.kind,
          Number(row.calls) || 0,
          Number(row.images) || 0,
          Number(row.seconds) || 0,
          csvDollars(row[spend])
        ].map(csvCell).join(",")).join("\r\n") + (page.length ? "\r\n" : "");
      }
    }
    return { fileName: `mercbot-spending-${range.from}-to-${range.to}.csv`, stream: Readable.from(lines()) };
  }

  return Object.freeze({
    report,
    exportCsv
  });
}
