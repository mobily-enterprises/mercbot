import assert from "node:assert/strict";
import test from "node:test";
import { remindOnRepeat } from "@jskit-ai/agent/server";

// The same call over and over gets a reminder at the 3rd, 5th and 8th time in a row (D-48, after
// DeepSeek Harness G1); a different call starts the count again, and argument order doesn't matter.
test("a repeated identical call is told to change course", async () => {
  const repeats = { key: "", count: 0 };
  const tool = { id: "read_file", execute: async ({ path }) => ({ text: path }) };
  const other = { id: "list_files", execute: async () => ["a"] };
  remindOnRepeat(tool, repeats);
  remindOnRepeat(other, repeats);
  const calls = [];
  for (let n = 0; n < 8; n += 1) calls.push(await tool.execute(n % 2 ? { path: "x", from: 1 } : { from: 1, path: "x" }));
  assert.deepEqual(calls.map((result) => Boolean(result.reminder)), [false, false, true, false, true, false, false, true]);
  assert.match(calls[2].reminder, /exact same tool call/u);
  assert.match(calls[4].reminder, /call number 5/u);
  assert.equal(calls[2].text, "x", "the result itself is kept");
  assert.equal((await other.execute({})).reminder, undefined, "another call starts again");
  const wrapped = [await tool.execute({ path: "x" }), await tool.execute({ path: "x" }), await other.execute({}), await other.execute({}), await other.execute({})];
  assert.equal(wrapped[1].reminder, undefined);
  assert.deepEqual(wrapped[4], { result: ["a"], reminder: wrapped[4].reminder }, "a list result is wrapped");
  assert.ok(wrapped[4].reminder);
});
