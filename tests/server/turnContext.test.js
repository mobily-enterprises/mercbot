import assert from "node:assert/strict";
import test from "node:test";
import { trimOldResults } from "@jskit-ai/agent/server";

// Room inside one long turn (D-48): past a size, the oldest tool results give way to a note, never
// the newest ones, until the request is back under the target; calls and the bot's words stay, and
// what was left out stays left out.
const step = (n) => [
  { role: "assistant", content: [{ type: "text", text: `Reading part ${n}.` }, { type: "tool-call", toolCallId: `c${n}`, toolName: "read_file", input: { part: n } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: "read_file", output: { type: "text", value: "x".repeat(4000) } }] }
];
const results = (prompt) => prompt.filter((message) => message.role === "tool").map((message) => (message.content[0].output.value.includes("left out") ? "short" : "whole"));

test("old tool results give way inside a long turn, the newest never", () => {
  const limits = { trimAt: 5000, trimTo: 3000, keepRecent: 2 };
  const prompt = [{ role: "system", content: "You are a bot." }, { role: "user", content: [{ type: "text", text: "Read all six parts." }] }, ...[1, 2, 3, 4, 5, 6].flatMap(step)];
  const left = new Set();
  const trimmed = trimOldResults(prompt, left, limits);
  assert.deepEqual(results(trimmed), ["short", "short", "short", "short", "whole", "whole"]);
  assert.equal(trimmed.filter((message) => message.role === "assistant").length, 6, "the calls and words stay");
  assert.equal(results(prompt).join(), "whole,whole,whole,whole,whole,whole", "the stored messages are untouched");
  assert.equal(results(trimOldResults([...prompt.slice(0, 4)], left, { ...limits, trimAt: 1e9 })).join(), "short", "left out stays left out");
  assert.equal(trimOldResults(prompt, new Set(), { ...limits, trimAt: 1e9 }), prompt, "under the limit nothing changes");
});
