import { PAGE_MAX, isFileField, isWorkedOut } from "@local/apps/shared";
import { appsApi } from "./appsApi.js";

// CSV and Excel files for the Data tab (D-35). Export writes a table's live records with field
// labels as headers; import reads the first sheet, matches its headers to fields by label or key,
// and sends the rows to the data gate, which checks every row before writing any. The libraries
// load only when a file is read or written.
const IMPORT_PAGE = 500;

// What a cell holds for a value of the field: money in units, dates as real dates in Excel, a
// link as the linked record's title (the import looks titles up again), a file or picture as its name.
export function toCell(field, value, excel) {
  if (value === null || value === undefined || value === "") return null;
  // A person by name too (the import reads it back by name), tags as "a, b", a moment as a real date and time in Excel.
  if (field.type === "link" || field.type === "person") return typeof value === "object" ? value.label : String(value);
  if (field.type === "tags") return Array.isArray(value) ? value.join(", ") : String(value);
  // Excel shows a moment's time too (its cells have no zone: UTC, as the import reads them back).
  if (field.type === "datetime") return excel ? { value: new Date(value), type: Date, format: "yyyy-mm-dd hh:mm" } : value;
  if (isFileField(field)) return value?.name ?? null;
  if (field.type === "money") return value / 100;
  if (field.type === "date") return excel ? new Date(`${value}T00:00:00Z`) : value;
  if (field.type === "yesno") return excel ? Boolean(value) : value ? "Yes" : "No";
  return value;
}

export async function exportTable(key, format) {
  let table = null;
  const records = [];
  for (let page = 1; ; page += 1) {
    const result = await appsApi.records(key, { page, size: PAGE_MAX });
    table = result.table;
    records.push(...result.records);
    if (result.records.length < PAGE_MAX) break;
  }
  const fields = table.fields.filter((field) => !field.obsolete);
  const excel = format === "xlsx";
  const rows = [fields.map((field) => field.label), ...records.map((record) => fields.map((field) => toCell(field, record[field.id], excel)))];
  if (excel) {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    await writeExcelFile(rows, { sheet: table.label.slice(0, 31), dateFormat: "yyyy-mm-dd", stickyRowsCount: 1 }).toFile(`${table.key}.xlsx`);
  } else {
    const { stringify } = await import("csv-stringify/browser/esm/sync");
    download(new Blob([`\uFEFF${stringify(rows)}`], { type: "text/csv;charset=utf-8" }), `${table.key}.csv`);
  }
  return records.length;
}

function download(blob, name) {
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// The file's rows as arrays of cells, header first. Excel dates arrive as UTC dates.
export async function readSheetFile(file) {
  if (/\.xlsx$/iu.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    return readSheet(file);
  }
  if (!/\.csv$/iu.test(file.name)) throw new Error("Choose a .csv or .xlsx file.");
  const { parse } = await import("csv-parse/browser/esm/sync");
  return parse(await file.text(), { bom: true, skip_empty_lines: true, relax_column_count: true });
}

// Which column fills which field. Headers match a field's label or key, ignoring case. A calculated field's or a
// roll-up's column (an exported sheet has them) is worked out again, never imported (D-78, D-140).
export function matchColumns(table, header) {
  const name = (value) => String(value ?? "").trim().toLowerCase();
  const named = (fields, cell) => fields.find((field) => name(field.label) === name(cell) || field.key === name(cell));
  const live = table.fields.filter((field) => !field.obsolete);
  // A file or picture goes onto a record by upload only (D-130): its column, a file's name, is ignored like any other.
  const fields = live.filter((field) => !isWorkedOut(field) && !isFileField(field));
  const columns = header.map((cell) => named(fields, cell) || null);
  const calculated = header.filter((cell, index) => !columns[index] && name(cell) && named(live.filter(isWorkedOut), cell));
  const ignored = header.filter((cell, index) => !columns[index] && name(cell) && !calculated.includes(cell));
  const missing = fields.filter((field) => field.options?.required && !columns.includes(field));
  return { columns, ignored, calculated, missing };
}

// An Excel date as the field takes it: a date and time as its instant, a date as its day.
const cellText = (cell, field) => (cell instanceof Date ? (field.type === "datetime" ? cell.toISOString() : cell.toISOString().slice(0, 10)) : cell);

// Sends the rows: first every page is checked, then (only if all pass) written. Returns
// { imported, errors }; errors name the file's row numbers.
export async function importRows(key, file, rows, columns) {
  const records = rows.map((row) => Object.fromEntries(columns.flatMap((field, index) => (field && row[index] !== null && row[index] !== undefined ? [[field.id, cellText(row[index], field)]] : []))));
  const pages = [];
  for (let start = 0; start < records.length; start += IMPORT_PAGE) pages.push({ rows: records.slice(start, start + IMPORT_PAGE), firstRow: start + 2, file: file.name });
  const errors = [];
  for (const page of pages) errors.push(...(await appsApi.importRecords(key, { ...page, dryRun: true })).errors);
  if (errors.length) return { imported: 0, errors: errors.slice(0, 20) };
  let imported = 0;
  for (const page of pages) {
    const result = await appsApi.importRecords(key, page);
    if (result.errors.length) return { imported, errors: result.errors };
    imported += result.imported;
  }
  return { imported, errors: [] };
}
