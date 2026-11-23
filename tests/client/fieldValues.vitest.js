import { describe, expect, it } from "vitest";
import { SHARED_TYPES, TEXT_INPUT, inputOf, localDateTime, personChoices, storedOf } from "../../src/components/apps/fieldValues.js";

// The new field types as both forms hold them (D-130): a person as their id, tags as a list, a date and time in the
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

  it("list the home's people to pick from, and a member who has left by what the record shows", () => {
    const people = [{ id: "12", name: "Ana" }];
    expect(personChoices(people, { id: "12", label: "Ana" })).toEqual(people);
    expect(personChoices(people, null)).toEqual(people);
    expect(personChoices(people, { id: "17", label: "Former member" })).toEqual([...people, { id: "17", name: "Former member" }]);
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

  it("send a moment back unchanged, its seconds too, when nobody touched it", () => {
    for (const stored of ["2026-11-24T08:30:45.000Z", "2026-11-24T08:30:45.120Z"]) {
      expect(storedOf(field("datetime"), localDateTime(stored))).toBe(stored);
    }
  });

  it("show a moment in the reader's own zone, not UTC", () => {
    process.env.TZ = "America/New_York";
    try {
      expect(localDateTime("2026-11-24T08:30:00.000Z")).toBe("2026-11-24T03:30");
      expect(storedOf(field("datetime"), "2026-11-24T03:30")).toBe("2026-11-24T08:30:00.000Z");
    } finally {
      process.env.TZ = "UTC";
    }
  });
});
