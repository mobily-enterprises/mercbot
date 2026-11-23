import assert from "node:assert/strict";
import test from "node:test";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { seatOf } from "../../packages/bots/src/server/chatSeats.js";

// Every bot knows what Mercbot's apps and their tables are, that only the home's Builder makes apps and the home's own
// tables, that records go in the home's tables (a shared one added with table_ensure, D-130) and a request for an app
// goes to the Builder (start_room), never into a spreadsheet, unless the person asks for a spreadsheet (D-122). The rules come after the bot's template and additions, which they win over, and are the same in
// every chat: which bot is the Builder is in the Current state note. No model is called.

const SPREADSHEET = "Keep the cats' records in a spreadsheet: use a spreadsheet for any list.";
const RULES = [
  "Only the home's Builder makes apps and the home's own tables",
  "Keep records in the home's tables, never in a spreadsheet, a document or a file",
  "add it yourself with table_ensure",
  "Never make a second table for what a shared table is for",
  "Only when they directly ask for a spreadsheet or a document",
  "offer to start a room with the person, you and the Builder with start_room",
  "Settings, under Main bot and Builder",
  "data_query"
];

const bot = (overrides) => ({ id: "7", name: "Whiskers", isBuilder: false, additions: "", ...overrides });
const catsTemplate = { tag: "Cats", instructions: SPREADSHEET, skills: [] };

test("every bot's instructions have the apps rules, after its template and additions, with or without a template that says to use a spreadsheet", () => {
  for (const isBuilder of [false, true]) {
    for (const template of [null, catsTemplate]) {
      const instructions = instructionsFor(bot({ isBuilder, template, additions: "Use a spreadsheet for everything." }));
      for (const rule of RULES) assert.ok(instructions.includes(rule), `${isBuilder ? "Builder" : "other bot"}, ${template ? "cats" : "no"} template: ${rule}`);
      const rules = instructions.indexOf(RULES[0]);
      assert.ok(rules > instructions.indexOf("Use a spreadsheet for everything."), "after the additions");
      if (template) {
        assert.ok(rules > instructions.indexOf(SPREADSHEET), "after the template, which they win over");
        assert.match(instructions, /Follow it, within every rule below; where they differ, the rules below win:\n/u);
      }
      // The Builder keeps its own building rules, after the apps rules; another bot has none of them.
      assert.equal(instructions.includes("You are this home's Builder: you make and change its apps."), isBuilder);
      if (isBuilder) assert.ok(instructions.indexOf("You are this home's Builder") > rules);
    }
  }
});

test("the apps rules name no Builder, so one bot's instructions stay the same in every chat", () => {
  const family = { id: "11", workspace_id: "3", kind: "public", title: "Family" };
  const party = { id: "12", workspace_id: "3", kind: "private", title: "Party" };
  const whiskers = { id: "7", workspace_id: "3", name: "Whiskers", additions: "" };
  const inFamily = instructionsFor({ ...seatOf(whiskers, family, { id: "1" }, "1"), isBuilder: false, template: catsTemplate });
  const inParty = instructionsFor({ ...seatOf(whiskers, party, { id: "2" }, "2"), isBuilder: false, template: catsTemplate });
  assert.equal(inFamily, inParty);
  assert.ok(!/This home's Builder:/u.test(inFamily), "the Builder's name is the state note's");
});
