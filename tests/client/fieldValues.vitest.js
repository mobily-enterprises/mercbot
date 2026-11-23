import { describe, expect, it } from "vitest";
import { SHARED_TYPES, TEXT_INPUT, inputOf, localDateTime, storedOf } from "../../src/components/apps/fieldValues.js";

// The new field types as both forms hold them (D-127): a person as their id, tags as a list, a date and time in the
// reader's zone for a datetime-local input, and back as the server takes them.
const field = (type) => ({ type });

describe("the shared field types in forms", () => {
  it("are the five new types, with the right input for the text-like ones", () => {
    expect([...SHARED_TYPES].sort()).toEqual(["datetime", "longtext", "person", "tags", "url"]);
    expect([TEXT_INPUT.url, TEXT_INPUT.datetime]).toEqual(["url", "datetime-local"]);
  });

  it("hold a person as their id and send it back so; empty is nothing", () => {
    expect(inputOf(field("person"), { id: "12", label: "Ana" })).toBe("12");
    expect(inputOf(field("person"), null)).toBe(null);
    expect([storedOf(field("person"), "12"), storedOf(field("person"), "")]).toEqual(["12", null]);
  });

  it("hold tags as a list, and an empty list is nothing", () => {
    expect(inputOf(field("tags"), ["a", "b"])).toEqual(["a", "b"]);
    expect(inputOf(field("tags"), null)).toEqual([]);
    expect([storedOf(field("tags"), ["a"]), storedOf(field("tags"), [])]).toEqual([["a"], null]);
  });

  it("show a moment in this browser's zone and send the same instant back", () => {
    const stored = "2026-11-24T08:30:00.000Z";
    const local = localDateTime(stored);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
    expect(storedOf(field("datetime"), local)).toBe(stored);
    expect([localDateTime(""), localDateTime("nonsense"), storedOf(field("datetime"), "")]).toEqual(["", "", null]);
  });
});
