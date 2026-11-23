import assert from "node:assert/strict";
import test from "node:test";
import { CLAIM_CHECKS, SPREADSHEET_CHECK, unaskedSpreadsheet } from "../../packages/bots/src/server/replyChecks.js";

// No bot keeps records in a spreadsheet (D-130): a reply whose turn saved a spreadsheet the person didn't ask for is sent
// back once, to use the home's tables. What the turn saved decides it, never the reply's words.
const run = (saved, tools = { tableEnsure: {}, dataCreate: {} }) => ({
  tools,
  attempted: [],
  after: [],
  picturesOn: false,
  showsCard: () => false,
  madePicture: () => false,
  savedFiles: () => saved
});
const checks = (turn, about, text = "Done.") => CLAIM_CHECKS.map((check) => check(turn, text, about)).filter(Boolean);

test("an unasked spreadsheet is sent back once, for the home's tables", () => {
  assert.deepEqual(checks(run(["/files/chat/Household bills.xlsx"]), "Keep track of our bills, please"), [SPREADSHEET_CHECK]);
  assert.deepEqual(checks(run(["/files/chat/guests.csv"]), "Who's coming on Saturday?", "Nothing saved."), [SPREADSHEET_CHECK], "whatever the reply says");
  assert.match(SPREADSHEET_CHECK, /data_tables and table_ensure/u);
});

test("a spreadsheet the person asked for, other files, and a copy without apps aren't sent back", () => {
  for (const about of ["Export it to Excel", "Can I have a CSV of the guests?", "put it in a spreadsheet", "Make me a file I can download"]) {
    assert.equal(unaskedSpreadsheet(["/files/chat/guests.xlsx"], about), false, about);
  }
  assert.deepEqual(checks(run(["/files/chat/notes.docx", "/files/chat/chart.png"]), "Keep track of our bills"), []);
  assert.deepEqual(checks(run([]), "Keep track of our bills"), []);
  assert.deepEqual(checks(run(["/files/chat/bills.xlsx"], {}), "Keep track of our bills"), [], "no tables to use");
});
