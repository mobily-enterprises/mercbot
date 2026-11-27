import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFormula, isTimeZone, periodLabel, useTimeZoneSource } from "../../packages/apps/src/shared/formulas.js";
import { checkApp } from "../../packages/apps/src/shared/check.js";

// Dates in formulas (D-140): days and months added, days between, a week's Monday and a month's first, all on plain
// YYYY-MM-DD dates; "today" in the home's time zone; a totals group's period as people read it.
const run = (source, values = {}, variables = {}) => evaluateFormula(variables, source, values);
const plain = (value) => (typeof value === "bigint" ? Number(value) : value);

test("adding days and months, and the days between two dates", () => {
  assert.equal(run('=addDays("2026-11-27", 7)'), "2026-12-04");
  assert.equal(run('=addDays("2026-03-01", -1)'), "2026-02-28");
  assert.equal(run('=addDays("2028-02-28", 1)'), "2028-02-29", "a leap year");
  assert.equal(run('=addDays("2026-11-27", 2.0)'), "2026-11-29", "a number field's value");
  assert.equal(run('=addMonths("2026-01-31", 1)'), "2026-02-28", "kept within the month");
  assert.equal(run('=addMonths("2028-01-31", 1)'), "2028-02-29");
  assert.equal(run('=addMonths("2026-11-15", -12)'), "2025-11-15");
  assert.equal(run('=addDays("", 3)'), "", "no date, no date");
  assert.equal(plain(run('=daysBetween("2026-11-27", "2026-12-25")')), 28);
  assert.equal(plain(run('=daysBetween("2026-12-25", "2026-11-27")')), -28);
  assert.equal(plain(run('=daysBetween("2026-03-28", "2026-03-30")')), 2, "across a clock change it's still days");
  assert.equal(run('=startOfWeek("2026-11-29")'), "2026-11-23", "a Sunday's week began on Monday");
  assert.equal(run('=startOfWeek("2026-11-23")'), "2026-11-23");
  assert.equal(run('=startOfMonth("2026-11-27")'), "2026-11-01");
});

test("today is in the home's time zone, and in UTC when the home's zone doesn't exist", (context) => {
  context.after(() => useTimeZoneSource(() => "UTC"));
  // Noon in UTC: already the next day in Kiribati, still the same day in American Samoa.
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-27T12:00:00Z") });
  const todayIn = (zone) => {
    useTimeZoneSource(() => zone);
    return run("=today()");
  };
  assert.deepEqual(["Pacific/Kiritimati", "Pacific/Pago_Pago", "Not/AZone"].map(todayIn), ["2026-11-28", "2026-11-27", "2026-11-27"]);
  useTimeZoneSource(() => "Pacific/Kiritimati");
  assert.equal(plain(run('=daysSince("2026-11-20")')), 8, "daysSince counts from the home's today");
  assert.equal(isTimeZone("Europe/Rome"), true);
  assert.equal(isTimeZone("Mars/Base"), false);
});

test("a period's group as people read it, and the check of a grouping by period", () => {
  assert.equal(periodLabel("month", "2026-11-01"), "Nov 2026");
  assert.equal(periodLabel("week", "2026-11-23"), "Week of 23 Nov 2026");
  assert.equal(periodLabel("year", "2026-01-01"), "2026");
  assert.equal(periodLabel("day", "2026-11-27"), "27 Nov 2026");
  assert.equal(periodLabel("month", null), "(none)");
  const field = (id, key, type) => ({ id, key, label: key, type, options: {}, obsolete: false });
  const tables = [{ id: "t1", key: "orders", label: "Orders", titleFieldId: "f1", fields: [field("f1", "name", "text"), field("f2", "ordered_on", "date"), field("f3", "amount", "money")] }];
  const app = (query) => ({ home: "s", screens: { s: { data: { q: query }, content: [{ type: "totals", label: "By month", rows: "=data.q" }] } } });
  assert.deepEqual(checkApp(app({ from: "orders", groupBy: "ordered_on", by: "month", sum: "amount" }), tables), []);
  assert.match(JSON.stringify(checkApp(app({ from: "orders", groupBy: "name", by: "month" }), tables)), /needs groupBy to be a date field/u);
  assert.match(JSON.stringify(checkApp(app({ from: "orders", groupBy: "ordered_on", by: "fortnight" }), tables)), /groups a date by day, week, month, year/u);
});
