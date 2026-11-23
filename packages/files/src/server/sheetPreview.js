import fs from "node:fs";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";

// A spreadsheet as the viewer shows it: a table per sheet, with readable columns, instead of a printout whose narrow
// columns cut text and turn dates into ####. Only .xlsx and .csv are read here; other spreadsheets keep the pictures of
// their pages (officeApps.js pagesOf).

/** What one preview carries at most; `more` says a sheet has more, which the download shows. */
export const SHEET_LIMITS = Object.freeze({ sheets: 10, rows: 500, columns: 40, cell: 1000 });
export const READS_AS_SHEET = new Set(["xlsx", "csv"]);

const pad = (number) => String(number).padStart(2, "0");

/** A cell as text: a date as 2026-11-23 (with its time when it has one), true and false as TRUE and FALSE. */
function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // Excel keeps a time as a fraction of a day, so 09:30 can come back a hair early: to the nearest minute.
    const at = new Date(Math.round(value.getTime() / 60000) * 60000);
    const time = at.getUTCHours() || at.getUTCMinutes() ? ` ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}` : "";
    return at.toISOString().slice(0, 10) + time;
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).slice(0, SHEET_LIMITS.cell);
}

/** A sheet's rows within the limits, its empty rows at the end and empty columns on the right left out. */
function shown(name, data) {
  const rows = data.map((row) => row.map(cellText));
  while (rows.length && rows.at(-1).every((cell) => cell === "")) rows.pop();
  const width = Math.max(0, ...rows.map((row) => row.findLastIndex((cell) => cell !== "") + 1));
  const more = rows.length > SHEET_LIMITS.rows || width > SHEET_LIMITS.columns;
  const columns = Math.min(width, SHEET_LIMITS.columns);
  return {
    name,
    rows: rows.slice(0, SHEET_LIMITS.rows).map((row) => Array.from({ length: columns }, (_cell, index) => row[index] ?? "")),
    more
  };
}

/**
 * The sheets of an .xlsx or .csv file, each `{ name, rows, more }`, rows as text cells, header first.
 * @param {string} real the file on disk
 * @param {string} ext its extension
 * @returns {Promise<{ sheets: Array<{ name: string, rows: string[][], more: boolean }>, more: boolean }>}
 */
export async function sheetPreview(real, ext) {
  if (ext === "csv") {
    const rows = parse(await fs.promises.readFile(real, "utf8"), { bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
    return { sheets: [shown("Sheet", rows)], more: false };
  }
  const sheets = await readXlsxFile(fs.createReadStream(real));
  const first = sheets.slice(0, SHEET_LIMITS.sheets);
  return { sheets: first.map((sheet) => shown(sheet.sheet, sheet.data)), more: sheets.length > SHEET_LIMITS.sheets };
}
