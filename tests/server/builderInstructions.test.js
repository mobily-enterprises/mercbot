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

// A calculated field (D-78) isn't stored: lists can't be filtered, sorted or grouped by it, and a sum or average of one
// adds up at most 5,000 records. The owner (2026-11-12): keep the limits, and make them clear up front. The Builder's
// instructions, and the descriptions of the tools that add a field or change its formula as the model is shown them,
// tell it to say so whenever it adds one, and to offer a stored field when the person will want to filter, sort or
// group by the value. This checks the wording the model gets; no model is called.
test("the Builder is told to say what a calculated field can't do, and to offer a stored field instead", () => {
  const builder = instructionsFor({ id: "1", name: "Bea", isBuilder: true });
  for (const phrase of ["lists can't be filtered, sorted or grouped by it", "at most 5,000 records", "Whenever you add one, tell the person so", "offer a stored field instead"]) {
    assert.ok(builder.includes(phrase), phrase);
  }
  assert.ok(!instructionsFor({ id: "2", name: "Otto" }).includes("offer a stored field"), "only the Builder adds fields");

  const tools = buildBuilderTools({ apps: {}, call: {}, actor: async () => null, ctx: async () => null, failed: (error) => ({ error }), after: [], scriptModel: null });
  const shown = (tool) => `${tool.description}\n${JSON.stringify(toolSchema(tool.inputSchema))}`;
  for (const tool of [tools.tableCreate, tools.fieldAdd]) {
    for (const phrase of ["can't be filtered, sorted or grouped by a calculated field", "at most 5,000 records", "tell the person so when you add one", "offer a stored field"]) {
      assert.ok(shown(tool).includes(phrase), `${tool.id}: ${phrase}`);
    }
  }
  for (const phrase of ["still can't be filtered, sorted or grouped by it", "offer a stored field"]) {
    assert.ok(shown(tools.fieldFormula).includes(phrase), `field_formula: ${phrase}`);
  }
});
