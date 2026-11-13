import assert from "node:assert/strict";
import test from "node:test";
import { estimateTokens } from "@jskit-ai/agent/server";
import { toModelHistory } from "../../packages/bots/src/server/botAgent.js";
import { SUMMARY_LIMITS as LIMITS, cutPoint, transcriptText } from "@jskit-ai/agent/server";

// Compaction's pure parts: where to cut, what the summariser reads, and how a reply replays an
// earlier one's tool calls.
const turn = (id, text) => ({ id: String(id), kind: "text", role: "user", body: { text } });
const answer = (id, text, transcript) => ({ id: String(id), kind: "text", role: "bot", body: { text, ...(transcript ? { transcript } : {}) } });

test("the latest turns stay word for word, fewer when they're big", () => {
  const messages = [turn(1, "a"), answer(2, "b"), turn(3, "c"), answer(4, "d"), turn(5, "e"), answer(6, "f"), turn(7, "g"), answer(8, "h")];
  const small = messages.map(() => 10);
  assert.equal(cutPoint(messages, small, { ...LIMITS, keepTurns: 2 }), 4, "keeps the last two turns");
  assert.equal(cutPoint(messages, small, { ...LIMITS, keepTurns: 10 }), 2, "always leaves the first turn to summarise");
  const bigLast = [10, 10, 10, 10, 10, 10, 10, 5000];
  assert.equal(cutPoint(messages, bigLast, { ...LIMITS, keepTurns: 3, keepTokens: 1000 }), 6, "at least the last turn, even when it's big");
  assert.equal(cutPoint([turn(1, "only")], [10], LIMITS), 0, "a single turn has nothing to summarise");
  assert.equal(cutPoint([answer(1, "x"), answer(2, "y")], [10, 10], LIMITS), 0, "no turn boundary, no cut");
});

test("a reply's transcript is replayed, with long results cut the same way every time", () => {
  const transcript = [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "openWebPage", input: { url: "https://example.com" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "openWebPage", output: { type: "text", value: "x".repeat(20000) } }] },
    { role: "assistant", content: [{ type: "text", text: "The page says hello." }] }
  ];
  const history = toModelHistory([turn(1, "Open it"), answer(2, "The page says hello.", transcript)]);
  assert.equal(history.length, 4, "the person's message and the reply's three steps");
  assert.equal(history[1].content[0].toolName, "openWebPage");
  const result = history[2].content[0].output.value;
  assert.ok(result.length < 6100 && result.endsWith("no longer shown]"));
  assert.deepEqual(toModelHistory([answer(2, "x", transcript)]), toModelHistory([answer(2, "x", transcript)]), "deterministic");
  const routine = toModelHistory([{ id: "3", kind: "text", role: "bot", body: { text: "Done", trigger: "Routine: check the price", transcript: [{ role: "assistant", content: "Done" }] } }]);
  assert.deepEqual(routine.map((message) => message.role), ["user", "assistant"], "a routine run replays the prompt that started it");

  const text = transcriptText(history);
  assert.match(text, /^Person: Open it$/mu);
  assert.match(text, /Bot used openWebPage\(\{"url":"https:\/\/example\.com"\}\)/u);
  assert.match(text, /Result of openWebPage: x{100}/u);
  assert.ok(!text.includes("x".repeat(900)), "the summariser reads results shortened");
  assert.ok(estimateTokens(history) > 1500 && estimateTokens(history) < 2000);
});
