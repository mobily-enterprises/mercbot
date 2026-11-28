import assert from "node:assert/strict";
import test from "node:test";
import { toolSchema } from "@jskit-ai/agent/server";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { buildBuilderTools } from "../../packages/bots/src/server/builderTools.js";

// The Builder's script abilities live in its instructions, so a long chat never drops them (owner,
// 2026-10-29); other bots don't get them.
test("only the Builder's instructions describe scripts", () => {
  const builder = instructionsFor({ id: "1", name: "Bea", isBuilder: true });
  for (const phrase of ["script_write", "script_save", "- rule:", "- function:", "- job:", "- source:", "- action:", "Apps → Scripts"]) assert.ok(builder.includes(phrase), phrase);
  assert.ok(!instructionsFor({ id: "2", name: "Otto" }).includes("script_write"));
});

// A calculated field (D-78) isn't stored: lists filter and sort by it only when it's arithmetic over number fields
// (D-140), never group by it, and a sum or average of one adds up at most 5,000 records. The owner (2026-11-12): keep the limits, and make them clear up front. The Builder's
// instructions, and the descriptions of the tools that add a field or change its formula as the model is shown them,
// tell it to say so whenever it adds one, and to offer a stored field when the person will want to filter, sort or
// group by the value. This checks the wording the model gets; no model is called.
test("the Builder is told to say what a calculated field can and can't do, and to offer a stored field instead", () => {
  const builder = instructionsFor({ id: "1", name: "Bea", isBuilder: true });
  for (const phrase of ["only when it's a number or amount worked out by arithmetic over number fields", "never group by it", "at most 5,000 records", "Whenever you add one, tell the person so", "offer a stored field instead"]) {
    assert.ok(builder.includes(phrase), phrase);
  }
  assert.ok(!instructionsFor({ id: "2", name: "Otto" }).includes("offer a stored field"), "only the Builder adds fields");

  const tools = buildBuilderTools({ apps: {}, call: {}, actor: async () => null, ctx: async () => null, failed: (error) => ({ error }), after: [], scriptModel: null });
  const shown = (tool) => `${tool.description}\n${JSON.stringify(toolSchema(tool.inputSchema))}`;
  for (const tool of [tools.tableCreate, tools.fieldAdd]) {
    for (const phrase of ["filter and sort by a calculated field only when it's a number or amount worked out by arithmetic", "never group by one", "at most 5,000 records", "tell the person so when you add one", "offer a stored field"]) {
      assert.ok(shown(tool).includes(phrase), `${tool.id}: ${phrase}`);
    }
  }
  for (const phrase of ["lists filter and sort by it only while it's arithmetic over number fields, and never group by it", "offer a stored field"]) {
    assert.ok(shown(tools.fieldFormula).includes(phrase), `field_formula: ${phrase}`);
  }
});

// What apps can do now (D-137–D-140): the Builder's instructions, its skill and its tools tell it each new part, step,
// field option, schedule and host call, the patterns to use them for, and what an owner or admin must switch on. This
// checks the wording the model gets; no model is called.
test("the Builder knows what apps can do now, and when to use each", async () => {
  const { readFile } = await import("node:fs/promises");
  const builder = instructionsFor({ id: "1", name: "Bea", isBuilder: true });
  for (const phrase of [
    "\"=params.event\"", "\"search\": true", "time zone", "\"=quantity <= reorder_level\"", "line items", "roll-up field", "board", "calendar", "timeline",
    "field check (min, max, pattern, unique)", "actor.id (and actor.role)", "\"confirm\"", "\"if\"", "docs.pdf", "attach", "notify.member", "\"onSubmit\"",
    "What it sends by itself", "all or nothing", "app's draft", "private", "Who can see it"
  ]) assert.ok(builder.includes(phrase), `rules: ${phrase}`);
  assert.ok(!instructionsFor({ id: "2", name: "Otto" }).includes("Who can see it"), "only the Builder builds apps");

  const skill = await readFile(new URL("../../packages/bots/skills/building-apps.md", import.meta.url), "utf8");
  for (const phrase of [
    "\"type\": \"lines\"", "rollup", "\"type\": \"board\"", "\"type\": \"calendar\"", "\"type\": \"timeline\"", "\"if\":", "\"confirm\"", "field_checks", "\"onSubmit\"",
    "notify.member", "docs.pdf", "attach", "Private tables", "app's draft", "people.me", "\"15min\"", "addDays", "\"by\": \"week\" | \"month\""
  ]) assert.ok(skill.toLowerCase().includes(phrase.toLowerCase()), `skill: ${phrase}`);

  const { SCRIPT_GUIDE } = await import("../../packages/bots/src/server/scriptWriter.js");
  for (const phrase of ["people.me()", "notify.member", "notify.email", "docs.pdf", "attach:", "a rule has half a second", "all or nothing"]) {
    assert.ok(SCRIPT_GUIDE.includes(phrase), `script guide: ${phrase}`);
  }

  const tools = buildBuilderTools({ apps: {}, call: {}, actor: async () => null, ctx: async () => null, failed: (error) => ({ error }), after: [], scriptModel: null });
  const shown = (tool) => `${tool.description}\n${JSON.stringify(toolSchema(tool.inputSchema))}`;
  for (const phrase of ["rollup", "min", "max", "pattern", "patternMessage", "unique"]) assert.ok(shown(tools.fieldAdd).includes(phrase), `field_add: ${phrase}`);
  assert.match(shown(tools.fieldChecks), /required, min, max, pattern/u);
  assert.match(shown(tools.scriptSave), /goes into the app's draft/u);

  // Pictures, templates and shared lists (D-141): the tools offer them and the skill says when to use each.
  assert.match(shown(tools.appSetIcon), /make_picture/u);
  assert.ok(shown(tools.appSetIcon).includes("receiptLong") && shown(tools.appCreate).includes("receiptLong"), "the app icons");
  assert.match(shown(tools.templateList), /corporate.*business.*family.*personal/su);
  for (const phrase of ["App icons", "app_set_icon", "list_items", "\"kind\"", "{ \"field\": \"group\", \"label\": \"Aisle\" }"]) {
    assert.ok(skill.includes(phrase), `skill: ${phrase}`);
  }
});

// Progress bars, celebrations and reading a record's file (D-143): the Builder's skill says how to write each and when,
// its instructions name them among the patterns, and the script writer knows docs.text. No model is called.
test("the Builder knows progress bars, celebrations and reading a record's file as text", async () => {
  const { readFile } = await import("node:fs/promises");
  const skill = await readFile(new URL("../../packages/bots/skills/building-apps.md", import.meta.url), "utf8");
  for (const phrase of ["progress (value, max, label)", "{ \"celebrate\": ", "docs.text({ record: { table, id }, field })"]) {
    assert.ok(skill.includes(phrase), `skill: ${phrase}`);
  }
  const builder = instructionsFor({ id: "1", name: "Bea", isBuilder: true });
  for (const phrase of ["a progress bar", "\"celebrate\"", "docs.text"]) assert.ok(builder.includes(phrase), `rules: ${phrase}`);
  const { SCRIPT_GUIDE } = await import("../../packages/bots/src/server/scriptWriter.js");
  assert.ok(SCRIPT_GUIDE.includes("await docs.text({ record: { table, id }, field }) → { name, text, more }"), "script guide: docs.text");
});

// An app's own bot and a link field's choices from a list (D-144): the skill and the script guide say how they work.
test("the Builder knows a link field's choices from a list, and that an app's AI work goes to its own bot", async () => {
  const { readFile } = await import("node:fs/promises");
  const skill = await readFile(new URL("../../packages/bots/skills/building-apps.md", import.meta.url), "utf8");
  for (const phrase of ['"choices": "=data.', "the app's own bot"]) assert.ok(skill.includes(phrase), `skill: ${phrase}`);
  const { SCRIPT_GUIDE } = await import("../../packages/bots/src/server/scriptWriter.js");
  assert.ok(SCRIPT_GUIDE.includes("\"default\" is the app's own bot when it came with one, else the home's main one"), "script guide: default bot");
});
