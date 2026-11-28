import { describe, expect, it } from "vitest";
import { iconGroups, iconWords } from "../../src/components/apps/appIconChoices.js";

// The picture picker's search (D-141): a picture's name read as words, and the groups narrowed to the pictures whose
// name or group has every word searched for.
describe("the picture picker's search", () => {
  it("reads a picture's name as words", () => {
    expect(iconWords("receiptLong")).toBe("receipt long");
  });
  it("shows every group with nothing searched for, and only matching pictures otherwise", () => {
    expect(iconGroups("").map((entry) => entry.group)).toEqual(["Work", "Money", "Things", "Time", "People", "Home", "Health", "Leisure"]);
    const found = iconGroups("receipt");
    expect(found.map((entry) => entry.group)).toEqual(["Money"]);
    expect(found[0].names).toEqual(expect.arrayContaining(["receipt", "receiptLong"]));
    expect(iconGroups("home").find((entry) => entry.group === "Home").names.length).toBeGreaterThan(5);
    expect(iconGroups("zzzz")).toEqual([]);
  });
});
