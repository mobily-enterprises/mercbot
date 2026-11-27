import assert from "node:assert/strict";
import test from "node:test";
import { movedValues, shiftDays } from "../../packages/apps/src/shared/boards.js";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { toIds, toNames } from "../../packages/apps/src/shared/definitions.js";

// Boards, calendars and timelines (D-140): the save check names what each needs, a view only shows them, a public one
// that moves needs visitors to be able to change what it moves, names and ids translate, and a move's values.
const field = (id, key, type, options = {}) => ({ id, key, label: key, type, options, obsolete: false });
const tables = [{
  id: "t_jobs",
  key: "jobs",
  label: "Jobs",
  obsolete: false,
  titleFieldId: "f_name",
  fields: [
    field("f_name", "name", "text"),
    field("f_stage", "stage", "choice", { choices: ["Open", "Done"] }),
    field("f_starts", "starts", "date"),
    field("f_ends", "ends", "date"),
    field("f_visit", "visit", "datetime"),
    field("f_crew", "crew", "text"),
    field("f_owner", "owner", "email")
  ]
}];
const parts = {
  board: { type: "board", rows: "=data.jobs", groupBy: "stage", title: "=row.name", subtitle: "=row.crew", onClick: [{ notify: "=row.name" }] },
  calendar: { type: "calendar", rows: "=data.jobs", date: "starts", end: "ends", title: "=row.name", span: "week" },
  timeline: { type: "timeline", rows: "=data.jobs", start: "starts", end: "ends", groupBy: "crew", title: "=row.name" }
};
const app = (part, extra = {}) => ({
  home: "plan",
  screens: { plan: { data: { jobs: { from: "jobs" }, byStage: { from: "jobs", groupBy: "stage" } }, content: [part], ...extra.screen } },
  ...extra.app
});
const errors = (definition, options) => JSON.stringify(checkApp(definition, tables, options));

test("each part with what it needs passes; what's wrong is named", () => {
  for (const part of Object.values(parts)) assert.deepEqual(checkApp(app(part), tables), [], part.type);
  assert.match(errors(app({ ...parts.board, groupBy: "name" })), /is a choice field of jobs, and \\"name\\" isn't one/u);
  assert.match(errors(app({ ...parts.calendar, date: "crew" })), /is a date or date and time field of jobs/u);
  assert.match(errors(app({ ...parts.calendar, end: "visit" })), /a field of the same type as starts/u);
  assert.match(errors(app({ ...parts.calendar, span: "year" })), /is month or week/u);
  assert.match(errors(app({ ...parts.timeline, end: undefined })), /timeline.*end|end.*a field of the same type/u);
  assert.match(errors(app({ ...parts.board, title: undefined })), /a card needs a title/u);
  assert.match(errors(app({ ...parts.board, title: "=row.nope" })), /nope/u);
  assert.match(errors(app({ ...parts.board, rows: "=data.byStage" })), /a board shows a list query of a table's records/u);
  assert.match(errors(app({ ...parts.board, move: "yes" })), /is true or false/u);
  assert.match(errors(app({ ...parts.board, color: "red" })), /color.{0,2} isn.t a setting of board/u);
});

test("a view only shows them; a public board that moves needs visitors to change what it moves", () => {
  assert.match(errors(app(parts.board), { readOnly: true }), /onClick.{0,2} isn.t a setting of board/u);
  const { onClick: _click, ...shown } = parts.board;
  assert.deepEqual(checkApp(app(shown), tables, { readOnly: true }), []);
  const open = (rule, part = shown) => app(part, { screen: { public: true }, app: { public: { home: "plan", signIn: "required", tables: { jobs: { can: ["list", "update"], rows: "own", owner: "owner", read: ["name", "stage", "crew"], ...rule } } } } });
  assert.match(errors(open({})), /stage/u, "moving needs stage in write");
  assert.deepEqual(checkApp(open({ write: ["stage"] }), tables), [], "visitors may change the stage");
  assert.deepEqual(checkApp(open({ can: ["list"] }, { ...shown, move: false }), tables), [], "a board that doesn't move only reads");
});

test("a part's fields and card words are stored by ids and come back by names", () => {
  const { definition, errors: problems } = toIds(app(parts.timeline), tables);
  assert.deepEqual(problems, []);
  const stored = definition.screens.plan.content[0];
  assert.deepEqual([stored.start, stored.end, stored.groupBy, stored.title], ["f_starts", "f_ends", "f_crew", "=row.f_name"]);
  const back = toNames(definition, tables).screens.plan.content[0];
  assert.deepEqual([back.start, back.end, back.groupBy, back.title], ["starts", "ends", "crew", "=row.name"]);
  const board = toIds(app(parts.board), tables).definition.screens.plan.content[0];
  assert.deepEqual(board.onClick, [{ notify: "=row.f_name" }], "a card's click sees its row");
});

test("a move's values: a board's choice, a calendar's and a timeline's days, kept within what a card can do", () => {
  const table = tables[0];
  const record = { id: "1", f_stage: "Open", f_starts: "2026-02-27", f_ends: "2026-03-02", f_visit: "2026-11-27T09:30:00.000Z" };
  assert.deepEqual(movedValues(parts.board, table, record, "Done"), { f_stage: "Done" });
  assert.deepEqual(movedValues(parts.board, table, record, ""), { f_stage: null }, "back to none");
  assert.throws(() => movedValues(parts.board, table, record, "Gone"), /isn't one of this board's columns/u);
  assert.deepEqual(movedValues(parts.timeline, table, record, 2), { f_starts: "2026-03-01", f_ends: "2026-03-04" }, "both by two days, past February");
  assert.deepEqual(movedValues({ ...parts.calendar, date: "visit", end: undefined }, table, record, -1), { f_visit: "2026-11-26T09:30:00.000Z" }, "the time kept");
  assert.deepEqual(movedValues(parts.calendar, table, { ...record, f_ends: null }, 1), { f_starts: "2026-02-28" }, "no end: only the date");
  assert.throws(() => movedValues(parts.calendar, table, record, 1.5), /whole number of days/u);
  assert.equal(shiftDays("2024-02-28", 1), "2024-02-29", "a leap day");
});

test("a board whose column field was removed refuses a move with words, even to its empty column", () => {
  const table = { ...tables[0], fields: tables[0].fields.map((entry) => (entry.key === parts.board.groupBy ? { ...entry, obsolete: true } : entry)) };
  const record = { id: "1", f_stage: "Open" };
  assert.throws(() => movedValues(parts.board, table, record, ""), /no longer has the field its columns are of/u);
  assert.throws(() => movedValues(parts.board, table, record, "Done"), /no longer has the field its columns are of/u);
});
