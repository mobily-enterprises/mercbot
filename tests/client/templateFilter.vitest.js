import { describe, expect, it } from "vitest";
import { TEMPLATE_AUDIENCES, matchesTemplate } from "../../src/components/apps/templateFilter.js";

// The Templates tab's filter (D-141): a kind of use keeps the templates that serve it, and every word searched for must
// be in a template's name, description, tables or picture, whatever its case.
const invoices = { name: "Invoices", description: "Invoices with their lines and totals.", tables: ["contacts", "invoices"], icon: "receiptLong", audiences: ["business"] };
const chores = { name: "Chores", description: "Who does which job at home, with points.", tables: ["chores"], icon: "cleaningServices", audiences: ["family"] };

describe("the Templates tab's filter", () => {
  it("offers the four kinds of use in order", () => {
    expect(TEMPLATE_AUDIENCES.map((entry) => entry.label)).toEqual(["Corporate", "Small business", "Family", "Personal"]);
  });
  it("keeps the templates of the chosen kind of use, or all of them", () => {
    expect([invoices, chores].filter((template) => matchesTemplate(template, "family", ""))).toEqual([chores]);
    expect([invoices, chores].filter((template) => matchesTemplate(template, "all", ""))).toEqual([invoices, chores]);
  });
  it("finds every word searched for in the name, description, tables or picture", () => {
    expect(matchesTemplate(invoices, "all", "LINES contacts")).toBe(true);
    expect(matchesTemplate(invoices, "all", "receipt")).toBe(true);
    expect(matchesTemplate(chores, "all", "points")).toBe(true);
    expect(matchesTemplate(chores, "all", "points invoices")).toBe(false);
    expect(matchesTemplate(chores, "business", "points")).toBe(false);
  });
});
