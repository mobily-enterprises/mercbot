import { describe, expect, it, vi } from "vitest";

// A table's sheet with the shared tables' types (D-130): a file or picture exports as its name, a date and time keeps its
// time in Excel, and an Excel date and time imports as the same instant (a date field still as its day).
const sent = vi.hoisted(() => []);
vi.mock("../../src/components/apps/appsApi.js", () => ({
  appsApi: {
    importRecords: async (key, page) => {
      sent.push(page.rows);
      return { imported: page.rows.length, errors: [] };
    }
  }
}));

const { importRows, toCell } = await import("../../src/components/apps/sheets.js");

const field = (id, type) => ({ id, key: id, label: id, type, options: {} });

describe("a sheet's cells for the shared tables' types", () => {
  it("export a file or picture as its name, in a CSV and in Excel", () => {
    const value = { path: "/files/db/tables/graphics/5/picture/p.png", name: "p.png", size: 9, type: "image/png" };
    expect([toCell(field("f1", "image"), value, false), toCell(field("f1", "file"), value, true)]).toEqual(["p.png", "p.png"]);
  });

  it("export a link or a person as its label, or the id a record's history keeps", () => {
    for (const type of ["link", "person"]) {
      expect([toCell(field("f4", type), { id: "7", label: "Ana Ruiz" }, false), toCell(field("f4", type), 7, true)]).toEqual(["Ana Ruiz", "7"]);
    }
  });

  it("export a date and time to Excel with its time shown", () => {
    const cell = toCell(field("f2", "datetime"), "2026-11-24T08:30:00.000Z", true);
    expect(cell.value).toEqual(new Date("2026-11-24T08:30:00.000Z"));
    expect(cell.type).toBe(Date);
    expect(cell.format).toMatch(/hh:mm/u);
    expect(toCell(field("f2", "datetime"), "2026-11-24T08:30:00.000Z", false)).toBe("2026-11-24T08:30:00.000Z");
  });

  it("import an Excel date and time as the same instant, and a date as its day", async () => {
    sent.length = 0;
    const columns = [field("f2", "datetime"), field("f3", "date")];
    const result = await importRows("tasks", { name: "tasks.xlsx" }, [[new Date("2026-11-24T08:30:00.000Z"), new Date("2026-11-25T00:00:00.000Z")]], columns);
    expect(result).toEqual({ imported: 1, errors: [] });
    expect(sent.at(-1)).toEqual([{ f2: "2026-11-24T08:30:00.000Z", f3: "2026-11-25" }]);
  });
});
