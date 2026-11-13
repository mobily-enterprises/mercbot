import assert from "node:assert/strict";
import test from "node:test";
import { withoutRepeat } from "../../packages/bots/src/server/replyChecks.js";

// After a status line, the bot's own announcement of what it's about to do goes; real answers stay.
test("an announcement after a status line is dropped, an answer is kept", () => {
  const posted = ["Checking your calendars for Friday."];
  const answer = "Friday is clear on all three calendars.";
  assert.equal(withoutRepeat(`I'll check both your calendars.\n\n${answer}`, posted), answer);
  assert.equal(withoutRepeat(`I'll check your calendars first, then add it.\n\n${answer}`, posted), answer);
  assert.equal(withoutRepeat(`On it, drawing it now.\n\n${answer}`, posted), answer);
  assert.equal(withoutRepeat(`Sure, it's done. Friday is clear.\n\n${answer}`, posted), `Sure, it's done. Friday is clear.\n\n${answer}`, "two sentences of answer stay");
  assert.equal(withoutRepeat(`I'll check both your calendars.\n\n${answer}`, []), `I'll check both your calendars.\n\n${answer}`, "no status line, nothing dropped");
  assert.equal(withoutRepeat("I'll add it once you pick a calendar.", posted), "I'll add it once you pick a calendar.", "a reply of one paragraph stays");
});
