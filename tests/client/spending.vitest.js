import { describe, expect, it } from "vitest";
import { nanoMoney, priceTag, refusedWork, workRefusals } from "../../src/components/mercbot/accountApi.js";
import {
  barWidths, daysKeptFrom, duration, kindAmount, periodRange, rangeProblem, stepPeriod
} from "../../src/components/mercbot/spendingView.js";

// Settings → Spending, its reports and the bots' price tags (D-73, D-76). Dollars are written the way the machine's own
// locale writes them ("$21.09" in English, "USD 21.09" in some others).
const usd = (amount, digits = 2) => new Intl.NumberFormat(undefined, {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits
}).format(amount);

describe("spending in dollars", () => {
  it("shows nanodollars as dollars, and a price tag in whole cents with <$0.01 for less", () => {
    expect(nanoMoney(21_090_000_000)).toBe(usd(21.09));
    expect(priceTag(0)).toBe(usd(0));
    expect(priceTag(4_000_000)).toBe(`<${usd(0.01)}`);
    expect(priceTag(5_000_000)).toBe(usd(0.01));
    expect(priceTag(4_123_000_000)).toBe(usd(4.12));
  });
});

describe("work the copy refused", () => {
  it("is a 402, each counted so a shell part that shows why reads again", () => {
    const before = workRefusals.value;
    expect(refusedWork({ status: 402, message: "Not now." })).toBe(true);
    expect(refusedWork({ status: 502 })).toBe(false);
    expect(refusedWork(undefined)).toBe(false);
    expect(workRefusals.value).toBe(before + 1);
  });
});

describe("a month's spending", () => {
  it("says how much of each kind there was", () => {
    expect(kindAmount({ kind: "premium", calls: 1 })).toBe("1 AI call");
    expect(kindAmount({ kind: "economy", calls: 1200 })).toBe(`${(1200).toLocaleString()} AI calls`);
    expect(kindAmount({ kind: "images", calls: 3, images: 3 })).toBe("3 pictures");
    expect(kindAmount({ kind: "images", calls: 4, images: 3 })).toBe("3 pictures, 1 photo read");
    expect(kindAmount({ kind: "images", calls: 2, images: 0 })).toBe("2 photos read");
    expect(kindAmount({ kind: "computer", calls: 3 })).toBe("3 days");
    expect(kindAmount({ kind: "computer", calls: 1 })).toBe("1 day");
    expect(kindAmount({ kind: "computation", seconds: 42 })).toBe("42 s running");
    expect(duration(3600)).toBe("1 h");
    expect(duration(150)).toBe("3 min");
  });

  it("draws each row's bar against the largest, with a sliver for anything spent", () => {
    expect(barWidths([{ spentNano: 100 }, { spentNano: 50 }, { spentNano: 1 }, { spentNano: 0 }])).toEqual([100, 50, 2, 0]);
    expect(barWidths([{ spentNano: 0 }])).toEqual([0]);
  });

  it("reports a UTC day, a Monday-to-Sunday week or a month, and steps a period back and forth", () => {
    const thursday = new Date("2026-01-01T09:00:00Z");
    expect(periodRange("day", thursday)).toMatchObject({ from: "2026-01-01", to: "2026-01-01" });
    expect(periodRange("week", thursday)).toMatchObject({ from: "2025-12-29", to: "2026-01-04" });
    expect(periodRange("month", thursday)).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
    expect(periodRange("month", new Date("2028-02-10T12:00:00Z"))).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("month", stepPeriod("month", new Date("2026-03-31T12:00:00Z"), -1))).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("week", stepPeriod("week", thursday, 1))).toMatchObject({ from: "2026-01-05", to: "2026-01-11" });
    expect(periodRange("day", stepPeriod("day", thursday, -1))).toMatchObject({ from: "2025-12-31", to: "2025-12-31" });
    // Late on the last day of a month, UTC's day is the next one, whatever the machine's own zone.
    expect(periodRange("day", new Date("2026-02-01T00:30:00Z"))).toMatchObject({ from: "2026-02-01" });
  });

  it("takes a custom range of one day to a year and a day, starting within the 13 months days are kept", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(daysKeptFrom(now)).toBe("2025-11-01");
    expect(rangeProblem("2026-01-01", "2026-01-01", now)).toBe("");
    expect(rangeProblem("2025-11-01", "2026-10-31", now)).toBe("");
    expect(rangeProblem("2026-01-02", "2026-01-01", now)).toMatch(/before the first/u);
    expect(rangeProblem("2025-11-01", "2026-11-02", now)).toMatch(/at most a year/u);
    expect(rangeProblem("2025-10-31", "2025-11-30", now)).toMatch(/kept 13 months.*choose Month/u);
    expect(rangeProblem("", "2026-01-01", now)).toMatch(/Choose/u);
  });
});
