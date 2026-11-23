import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import writeExcelFile from "write-excel-file/node";
import { SHEET_LIMITS, sheetPreview } from "../../packages/files/src/server/sheetPreview.js";

// A spreadsheet in the viewer is a table per sheet (sheetPreview.js), never a printout whose narrow columns cut text
// and turn dates into ####: every sheet by name, dates as dates, numbers as written, and within its limits.
async function folder(context) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-sheet-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("an .xlsx shows every sheet by name, with dates as dates and nothing cut short", async (context) => {
  const file = path.join(await folder(context), "gaps.xlsx");
  const long = "Only figures from the 2024 schedule, which the harbour master says are out of date";
  await writeExcelFile([
    {
      sheet: "Gaps",
      data: [
        [{ value: "Port" }, { value: "Missing piece" }, { value: "Date raised" }, { value: "Logged" }, { value: "Open" }],
        [{ value: "Northport" }, { value: long }, { type: Date, value: new Date("2026-11-20T00:00:00Z"), format: "dd/mm/yyyy" },
          { type: Date, value: new Date("2026-11-20T09:30:00Z"), format: "dd/mm/yyyy hh:mm" }, { type: Boolean, value: true }],
        [],
        []
      ]
    },
    { sheet: "Notes", data: [[{ value: "Count" }], [{ value: 42 }]] }
  ]).toFile(file);
  assert.deepEqual(await sheetPreview(file, "xlsx"), {
    sheets: [
      { name: "Gaps", rows: [["Port", "Missing piece", "Date raised", "Logged", "Open"], ["Northport", long, "2026-11-20", "2026-11-20 09:30", "TRUE"]], more: false },
      { name: "Notes", rows: [["Count"], ["42"]], more: false }
    ],
    more: false
  });
});

test("a .csv is one sheet, its quoting and byte-order mark read as Excel reads them, its rows evened out", async (context) => {
  const file = path.join(await folder(context), "ports.csv");
  await writeFile(file, '﻿Port,Note\nSouthport,"Berth 3, then 4"\nEastport\n\n');
  assert.deepEqual(await sheetPreview(file, "csv"), { sheets: [{ name: "Sheet", rows: [["Port", "Note"], ["Southport", "Berth 3, then 4"], ["Eastport", ""]], more: false }], more: false });
});

test("a big sheet shows its first rows and columns, and says there's more", async (context) => {
  const dir = await folder(context);
  const tall = path.join(dir, "tall.csv");
  await writeFile(tall, Array.from({ length: SHEET_LIMITS.rows + 20 }, (_row, index) => `row ${index}`).join("\n"));
  const rows = await sheetPreview(tall, "csv");
  assert.equal(rows.sheets[0].rows.length, SHEET_LIMITS.rows);
  assert.equal(rows.sheets[0].more, true);
  const wide = path.join(dir, "wide.csv");
  await writeFile(wide, Array.from({ length: SHEET_LIMITS.columns + 5 }, (_cell, index) => `c${index}`).join(","));
  const columns = await sheetPreview(wide, "csv");
  assert.equal(columns.sheets[0].rows[0].length, SHEET_LIMITS.columns);
  assert.equal(columns.sheets[0].more, true);
});
