import { celSchema } from "./formulas.js";

// Boards, calendars and timelines (D-140): a list query's records as cards, where moving a card changes its record
// through the data gate, as an edit of that field would (its checks, the table's rules, a visitor's access).
//   { "type": "board", "rows": "=data.deals", "groupBy": "stage", "title": "=row.name", "subtitle": "=row.owner" }
//     a column per choice of a choice field; a card moved to another column takes that choice.
//   { "type": "calendar", "rows": "=data.visits", "date": "when", "end": "until", "title": "=row.client", "span": "month" }
//     a month (or week) of days; a card moved to another day moves its date, and its end by as many days.
//   { "type": "timeline", "rows": "=data.jobs", "start": "starts", "end": "ends", "title": "=row.name", "groupBy": "crew" }
//     a bar a record from its start to its end, in lanes by a field; a bar moved along moves both by as many days.
// `onClick` runs steps with the card's record as `row`, as a table row's click does; `move: false` keeps them where
// they are. A board's, calendar's or timeline's fields are names of the rows' table; `title` and `subtitle` are
// formulas over `row`.
export const BOARD_CATALOG = {
  board: ["rows", "groupBy", "title", "subtitle", "onClick", "move"],
  calendar: ["rows", "date", "end", "title", "subtitle", "onClick", "move", "span"],
  timeline: ["rows", "start", "end", "groupBy", "title", "subtitle", "onClick", "move"]
};
// What a view may hold of them (D-55): they only show, so no clicks and no moves.
export const BOARD_READ_ONLY = Object.fromEntries(
  Object.entries(BOARD_CATALOG).map(([type, keys]) => [type, keys.filter((key) => !["onClick", "move"].includes(key))])
);
/** The settings of a part that name fields of its rows' table, and those that are formulas over its rows. */
export const BOARD_FIELDS = { board: ["groupBy"], calendar: ["date", "end"], timeline: ["start", "end", "groupBy"] };
export const ROW_FORMULAS = ["title", "subtitle"];
/** The settings naming the fields a move changes. */
export const MOVED_FIELDS = { board: ["groupBy"], calendar: ["date", "end"], timeline: ["start", "end"] };
export const isBoard = (node) => Object.hasOwn(BOARD_CATALOG, node?.type || "");

const DATED = new Set(["date", "datetime"]);
const DAY = /^(\d{4})-(\d{2})-(\d{2})/u;

/**
 * The save check of a board, calendar or timeline at `path`: `table` is its rows' table (null when they aren't a
 * list of a table's records, which it reports), `rowVariables` what its row formulas see.
 */
export function checkBoard(path, node, { table, report, formula, rowVariables }) {
  if (!table) return report(`${path}.rows`, `a ${node.type} shows a list query of a table's records ("from"), not a script's or a total's.`);
  const live = (name) => table.fields.find((field) => !field.obsolete && field.key === name);
  const needs = (key, wanted, words, optional = false) => {
    if (node[key] === undefined && optional) return null;
    const field = live(String(node[key] ?? ""));
    if (!field || !wanted(field)) report(`${path}.${key}`, `is ${words} of ${table.key}${node[key] ? `, and "${node[key]}" isn't one` : ""}.`);
    return field ?? null;
  };
  if (node.type === "board") needs("groupBy", (field) => field.type === "choice", "a choice field");
  if (node.type === "calendar") {
    const date = needs("date", (field) => DATED.has(field.type), "a date or date and time field");
    needs("end", (field) => field.type === date?.type, `a field of the same type as ${node.date}`, true);
    if (node.span !== undefined && !["month", "week"].includes(node.span)) report(`${path}.span`, "is month or week.");
  }
  if (node.type === "timeline") {
    const start = needs("start", (field) => DATED.has(field.type), "a date or date and time field");
    needs("end", (field) => field.type === start?.type, `a field of the same type as ${node.start}`);
    needs("groupBy", (field) => !field.options?.formula, "a stored field to make lanes of", true);
  }
  if (node.title === undefined) report(`${path}.title`, 'a card needs a title, a formula over its record such as "=row.name".');
  for (const key of ROW_FORMULAS) formula(`${path}.${key}`, node[key], rowVariables);
  if (node.move !== undefined && typeof node.move !== "boolean") report(`${path}.move`, "is true or false.");
}

/** The row formulas' variables of a part over `table`'s records. */
export const boardRow = (variables, table) => (table ? { ...variables, row: celSchema(table) } : variables);

/** A date or a date and time moved by whole days, as it's stored: "2026-11-27", or an ISO moment. */
export function shiftDays(value, days) {
  if (!value || !days) return value ?? null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    const [, year, month, day] = DAY.exec(text).map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  }
  return new Date(new Date(text).getTime() + days * 86_400_000).toISOString();
}

/**
 * The values (by field id) a card's move gives its record (by field id, as the data gate reads it): `to` is a board's
 * choice ("" for none), or the whole days a calendar's card or a timeline's bar moved. Throws with words for the
 * person when the move isn't one of the part's.
 * @param {object} node the part
 * @param {object} table its rows' table
 * @param {object} record
 * @param {string | number} to
 */
export function movedValues(node, table, record, to) {
  const id = (key) => table.fields.find((field) => !field.obsolete && field.key === node[key])?.id;
  if (node.type === "board") {
    const field = table.fields.find((entry) => entry.id === id("groupBy"));
    if (!field) throw new Error(`${table.key} no longer has the field its columns are of ("${node.groupBy}"), so its cards can't move.`);
    const choice = String(to ?? "");
    if (choice && !field?.options?.choices?.includes(choice)) throw new Error(`"${choice}" isn't one of this board's columns.`);
    return { [field.id]: choice || null };
  }
  const days = Number(to);
  if (!Number.isInteger(days) || Math.abs(days) > 3660) throw new Error("A card moves by a whole number of days.");
  const moved = MOVED_FIELDS[node.type].map(id).filter((fieldId) => fieldId && record[fieldId]);
  return Object.fromEntries(moved.map((fieldId) => [fieldId, shiftDays(record[fieldId], days)]));
}
