import assert from "node:assert/strict";
import test from "node:test";
import { RUNS, combinedResult, decided } from "../support/templateCheck.mjs";
import { lastCheck, resultProblems } from "../../packages/bots/src/server/templateResults.js";

// One run of a template on a real AI can be unlucky either way, so the template check (npm run check:templates) gives
// a template up to three runs and it passes on two (D-79): it stops as soon as two agree, and records how many passed.
const run = (passed, reasons = passed ? [] : ["It didn't ask: which day."], turns = 9) => ({
  date: "2026-11-23", commit: "abc1234", behaviour: "6d0598646e718c33", template: "0123456789abcdef", models: null, passed, reasons, turns, asked: "5 of 5"
});

test("a template's runs stop once two agree, and never go past three", () => {
  assert.equal(RUNS, 3);
  assert.equal(decided([]), false);
  assert.equal(decided([run(true)]), false);
  assert.equal(decided([run(true), run(true)]), true, "two passes");
  assert.equal(decided([run(false), run(false)]), true, "two failures");
  assert.equal(decided([run(true), run(false)]), false, "split: a third run decides");
  assert.equal(decided([run(true), run(false), run(true)]), true);
});

test("two passes of up to three pass it; a failed run's reasons are kept either way, each once", () => {
  const twice = combinedResult([run(true), run(true, [], 7)]);
  assert.deepEqual([twice.passed, twice.runs, twice.reasons, twice.turns], [true, { passed: 2, of: 2 }, [], 7]);

  const unlucky = combinedResult([run(true), run(false), run(true, [], 8)]);
  assert.deepEqual([unlucky.passed, unlucky.runs, unlucky.turns], [true, { passed: 2, of: 3 }, 8]);
  assert.deepEqual(unlucky.reasons, ["In the run that failed: It didn't ask: which day."]);

  const failing = combinedResult([run(false), run(true), run(false, ["It didn't ask: which day.", "Its setup didn't finish within 12 turns."], 12)]);
  assert.deepEqual([failing.passed, failing.runs, failing.turns], [false, { passed: 1, of: 3 }, 12]);
  assert.deepEqual(failing.reasons, ["It didn't ask: which day.", "Its setup didn't finish within 12 turns."]);

  for (const result of [twice, unlucky, failing]) assert.deepEqual(resultProblems(result), [], "each is a well-formed result");
});

test("a recorded result's runs are checked when there, and shown with its newest check", () => {
  assert.deepEqual(resultProblems({ ...run(true), runs: { passed: 3, of: 2 } }), ["runs: how many runs passed, of how many"]);
  assert.deepEqual(resultProblems({ ...run(true), runs: "2 of 3" }), ["runs: how many runs passed, of how many"]);
  assert.deepEqual(resultProblems(run(true)), [], "a result recorded before runs has none");
  const template = { slug: "plants", fingerprint: "0123456789abcdef" };
  assert.deepEqual(lastCheck(template, { plants: { ...run(true), runs: { passed: 2, of: 3 } } }, "6d0598646e718c33").runs, { passed: 2, of: 3 });
  assert.equal(lastCheck(template, { plants: run(true) }, "6d0598646e718c33").runs, null);
});
