import assert from "node:assert/strict";
import test from "node:test";
import { stoppedShort } from "@jskit-ai/agent/server";

// A reply that ends by announcing its next step and stops is sent back once to finish (D-47);
// a finished reply, an offer or a question is left alone.
test("replies that stop at 'let me…' are caught; finished ones aren't", () => {
  for (const text of [
    "I'll take a look at the file first.",
    "I'll take a look at your spending file first.... let me read the whole file structure.",
    "I'll start by checking the file and making the GIF.>",
    "I'll check what's there first, then combine them.",
    "I'll start by reading the script and the data files to understand what it does.\n\nThe script compares every pair of rows (O(n²)) — 60000 rows means ~1.8 billion comparisons. I'll replace that with key-based grouping that produces the identical grouping, then verify it against the original on many inputs before switching it in."
  ]) assert.equal(stoppedShort(text), true, text);
  for (const text of [
    "Done — here's the GIF. If you need it lighter, say the word and I'll shrink it.",
    "Total: 106.40, due 28 October 2026. Want me to set a reminder?",
    "I saved it as plan.docx. Let me know if you want changes.",
    `I'll take a look. ${"Here are the totals by month. ".repeat(12)}`
  ]) assert.equal(stoppedShort(text), false, text);
});
