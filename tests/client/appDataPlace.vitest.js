import { describe, expect, it } from "vitest";
import { dataPlace, otherApps } from "../../src/components/apps/appDataPlace.js";

// Where an app keeps its data, in plain words, from its tables and the apps that use each (D-141): its own tables, a
// fresh copy's own (named "…_copy_2"), or tables it shares with other apps.
const app = { id: "a2", name: "Study copy 2", templateCopy: null };
const table = (key, ...apps) => ({ key, usedBy: apps.map(([id, name]) => ({ id, name })) });

describe("where an app keeps its data", () => {
  it("says a fresh copy keeps its own, and what its tables are called", () => {
    expect(dataPlace({ ...app, templateCopy: 2 }, [table("study_courses_copy_2", ["a2", "Study copy 2"])]))
      .toBe("Its own data, separate from the other apps: its tables end in “copy 2”.");
  });
  it("names the apps it shares data with", () => {
    expect(dataPlace(app, [table("study_courses", ["a1", "Study"], ["a2", "Study copy 2"]), table("books", ["a1", "Study"], ["a2", "Study copy 2"], ["a3", "Reading list"])]))
      .toBe("Shares its data with Study and Reading list.");
  });
  it("tells apps of the same name apart by their address", () => {
    const named = (id, slug) => ({ id, name: "Study", slug });
    const tables = [{ key: "books", usedBy: [named("a1", "study"), named("a2", "study-2"), named("a3", "study-3")] }];
    expect(dataPlace({ id: "a1", name: "Study" }, tables)).toBe("Shares its data with Study (study-2) and Study (study-3).");
    expect(otherApps({ id: "a1", name: "Study" }, tables[0])).toEqual(["Study (study-2)", "Study (study-3)"]);
  });

  it("says when no other app uses its tables, or it has none", () => {
    expect(dataPlace(app, [table("study_courses", ["a2", "Study copy 2"])])).toBe("Its own data: no other app uses its tables.");
    expect(dataPlace(app, [])).toBe("");
  });
});
