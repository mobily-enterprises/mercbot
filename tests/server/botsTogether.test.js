import assert from "node:assert/strict";
import test from "node:test";
import { previewOf } from "../../packages/bots/src/server/botRows.js";
import { DISCUSSION_LIMITS, discussionTokens, roundPrompt, wrapPrompt } from "../../packages/bots/src/server/discussions.js";
import { JUDGED_CHARACTERS, JUDGED_MESSAGES, judgedConversation, judgementOf, judgingInstructions } from "../../packages/bots/src/server/joiningIn.js";

// Bots together (D-115): the join-in judge's instructions, what it reads and how its answer is read, and what a
// discussion may cost, in tokens, for each choice of rounds.
const bots = [{ id: "7", name: "Ada" }, { id: "9", name: "Bo" }];

test("the judge's answer names one of the chat's bots, null, or nothing it can use", () => {
  assert.equal(judgementOf("{\"bot\": \"Ada\"}", bots), bots[0]);
  assert.equal(judgementOf("```json\n{\"bot\": \" bo \"}\n```", bots), bots[1], "in a code fence, in any case, trimmed");
  assert.equal(judgementOf("{\"bot\": null}", bots), null);
  for (const odd of ["{\"bot\": \"Zed\"}", "{\"reply\": true}", "Sure!", "", "{\"bot\": 7}", "null", "[]"]) {
    assert.equal(judgementOf(odd, bots), undefined, odd);
  }
});

test("the judge reads the latest messages under their authors' names, clipped, mentions as names; its instructions list the bots", () => {
  const messages = Array.from({ length: JUDGED_MESSAGES + 3 }, (_, at) => ({ body: { text: `Line ${at}`, authorName: at % 2 ? "Kim" : "Pat" } }));
  messages.push({ body: { text: `<@bot:9>, ${"long ".repeat(200)}`, authorName: "Kim" } });
  messages.push({ body: { text: "who's free\n\n  on Saturday?" } });
  const lines = judgedConversation(bots, messages).split("\n");
  assert.equal(lines[0], "The conversation, oldest first; decide on the last message:");
  assert.equal(lines.length, JUDGED_MESSAGES + 1, "only the latest");
  assert.ok(lines.at(-2).startsWith("[Kim]: @Bo, long long"));
  assert.equal(lines.at(-2).length, "[Kim]: ".length + JUDGED_CHARACTERS, "each clipped");
  assert.equal(lines.at(-1), "[Someone]: who's free on Saturday?", "spaces folded; no name is Someone");

  const instructions = judgingInstructions([{ name: "Ada", job: "Plans trips." }, { name: "Bo", job: "Keeps the accounts." }]);
  assert.match(instructions, /^- Ada: Plans trips\.$/mu);
  assert.match(instructions, /^- Bo: Keeps the accounts\.$/mu);
  assert.match(instructions, /Never name more than one/u);
});

test("a discussion's tokens: every turn reads the chat and all said before it, and writes at most a turn's output", () => {
  const out = DISCUSSION_LIMITS.turnOutputTokens;
  const wrap = DISCUSSION_LIMITS.wrapOutputTokens;
  const [one, two, three] = discussionTokens({ bots: 2, baseTokens: 1000 });
  assert.deepEqual(one, {
    rounds: 1,
    // Two turns: 1000, then 1000 + one turn's output; then the wrap-up reads 1000 and both.
    all: { input: 1000 + (1000 + out) + (1000 + 2 * out), output: 2 * out + wrap },
    turn: { input: 1000 + out, output: out },
    wrap: { input: 1000 + 2 * out, output: wrap }
  });
  assert.deepEqual([two.rounds, two.turn, two.wrap], [2, { input: 1000 + 3 * out, output: out }, { input: 1000 + 4 * out, output: wrap }]);
  assert.equal(two.all.input, 4 * 1000 + out * (0 + 1 + 2 + 3) + (1000 + 4 * out));
  assert.equal(three.all.output, 6 * out + wrap);
  assert.equal(discussionTokens({ bots: 3, baseTokens: 1000 }).length, DISCUSSION_LIMITS.rounds, "one choice per round allowed");
});

test("a round's words and the wrap-up's name the question, the round and the others, and ask for something new or PASS", () => {
  const words = roundPrompt({ question: "Tiles or wood?", round: 2, rounds: 3, others: "Bo, Cy", by: "Kim" });
  assert.match(words, /^\(A discussion Kim started: "Tiles or wood\?"\. This is round 2 of 3, with Bo, Cy\. /u);
  assert.match(words, /reply with exactly PASS\.\)$/u);
  assert.match(wrapPrompt({ question: "Tiles or wood?" }), /^\(Wrap up the discussion of "Tiles or wood\?": /u);
});

test("a discussion's card shows in the chat list as its question", () => {
  assert.equal(previewOf({ kind: "discussion", body: { question: "Tiles or wood?", status: "waiting" } }), "Discussion: Tiles or wood?");
});
