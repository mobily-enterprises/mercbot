import { describe, expect, it } from "vitest";
import { iconGroups, iconWords, lookToSave, startingLook } from "../../src/components/apps/appIconChoices.js";

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

// What the picker starts on and saves: with a bot's picture on the tile, no set picture is chosen, so changing only the
// colour keeps the bot's picture; choosing a set picture sends it, which takes the bot's away.
describe("the picture picker's choice", () => {
  const drawn = { icon: "pets", color: "#7A4E2D", picture: "/files/db/tables/app-pictures/a1/tile/paw.png" };
  it("starts with no set picture chosen when a bot's picture is on the tile", () => {
    expect(startingLook(drawn)).toEqual({ icon: null, color: "#7A4E2D" });
    expect(startingLook({ ...drawn, picture: null })).toEqual({ icon: "pets", color: "#7A4E2D" });
  });
  it("saves only the colour until a set picture is chosen", () => {
    expect(lookToSave({ ...startingLook(drawn), color: "#0B7A5B" })).toEqual({ color: "#0B7A5B" });
    expect(lookToSave({ icon: "home", color: "#0B7A5B" })).toEqual({ icon: "home", color: "#0B7A5B" });
  });
});
