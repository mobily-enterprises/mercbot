import assert from "node:assert/strict";
import test from "node:test";
import { previewOf } from "../../packages/bots/src/server/botRows.js";
import { DISCUSSION_LIMITS, discussionTokens, roundPrompt, wrapPrompt } from "../../packages/bots/src/server/discussions.js";
import { DECIDED_CHARACTERS, DECIDED_MESSAGES, DECIDING, decidedConversation, decidingInstructions, decisionOf } from "../../packages/bots/src/server/joiningIn.js";

// Bots together (D-115, D-129): what a bot the message doesn't call reads to decide whether to reply, and how its answer
// is read, and what a discussion may cost, in tokens, for each choice of rounds.
const bots = [{ id: "7", name: "Ada" }, { id: "9", name: "Bo" }];

test("a decision is REPLY or PASS, as its first word in any case; anything else is neither", () => {
  for (const reply of ["REPLY", "reply", " Reply.", "**REPLY**", "REPLY: it answers my question"]) assert.equal(decisionOf(reply), true, reply);
  for (const pass of ["PASS", "pass", "Pass.", "`PASS`"]) assert.equal(decisionOf(pass), false, pass);
  for (const odd of ["Sure!", "", null, "{\"bot\": \"Ada\"}", "I'd PASS", "REPLYING"]) assert.equal(decisionOf(odd), undefined, String(odd));
});

test("a decision reads the latest messages under their authors' names, its own as (you), the message decided on marked", () => {
  const messages = Array.from({ length: DECIDED_MESSAGES + 3 }, (_, at) => ({ id: String(at + 1), body: { text: `Line ${at}`, authorName: at % 2 ? "Kim" : "Pat" } }));
  messages.push({ id: "100", author_bot_id: "7", body: { text: "Question 4 of 6. What must never appear on the artwork?", authorName: "Ada" } });
  messages.push({ id: "101", body: { text: `<@bot:9>, ${"long ".repeat(200)}`, authorName: "Kim" } });
  messages.push({ id: "102", author_bot_id: "9", body: { text: "who's free\n\n  on Saturday?" } });
  const lines = decidedConversation({ botId: "7", decidedId: "101", bots }, messages).split("\n");
  assert.equal(lines[0], "The conversation, oldest first. Decide on the message marked \">>\"; anything after it was said since.");
  assert.equal(lines.length, DECIDED_MESSAGES + 1, "only the latest");
  assert.equal(lines.at(-3), "[Ada (you)]: Question 4 of 6. What must never appear on the artwork?", "its own words");
  assert.ok(lines.at(-2).startsWith(">> [Kim]: @Bo, long long"), "the message decided on");
  assert.equal(lines.at(-2).length, ">> [Kim]: ".length + DECIDED_CHARACTERS, "each clipped");
  assert.equal(lines.at(-1), "[Someone]: who's free on Saturday?", "said since; spaces folded; no name is Someone");

  const instructions = decidingInstructions({ name: "Ada", job: "Plans trips." });
  assert.ok(instructions.startsWith(`${DECIDING}\nYou are Ada, one of the bots in it. Your job: Plans trips.\n`));
  assert.match(instructions, /Above all, reply when the message answers a question you asked/u);
  assert.match(instructions, /Pass when you'd add nothing: people talking to each other/u);
  assert.match(instructions, /Answer with one word: REPLY or PASS\.$/u);
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
