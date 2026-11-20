import assert from "node:assert/strict";
import test from "node:test";
import {
  JUDGED_CHARACTERS,
  JUDGED_MESSAGES,
  judgedConversation,
  judgementOf,
  judgingInstructions,
  namesBot
} from "../../packages/bots/src/server/joiningIn.js";

// The judging call a Shared bot makes before joining in a shared tab (D-102): its fixed instructions, the conversation
// it reads (the tab's last 12 text messages, oldest first, each clipped to 400 characters, named by speaker), how its
// answer is read, and what calls the bot without one. The prompt's size is measured for 12 typical messages and 12 of
// the longest, and reported (about 4 characters a token).

const bot = { id: "41", name: "Ledger" };
const JOB = "Keeps the household's calendar, shopping and chores in order.";
const person = (name, text) => ({ role: "user", body: { text, from: { id: name, name } } });
const said = (text) => ({ role: "bot", body: { text } });

// A family planning a Saturday in General: people talking to each other, now and then to the bot.
const TYPICAL = [
  person("Ada", "Morning all! Is anyone around this afternoon to help move the sofa upstairs?"),
  person("Ben", "I can do it after 3, I've got a call before that."),
  person("Ada", "Perfect, 3 it is. Ledger, can you put it on the family calendar?"),
  said("Done: \"Move the sofa\" is on the family calendar today at 15:00, for Ada and Ben."),
  person("Ben", "Thanks! Do we need anything from the hardware shop for the new shelves?"),
  person("Ada", "Screws and wall plugs, I think. And maybe a spirit level."),
  person("Cleo", "We have a spirit level in the garage, top shelf on the left."),
  person("Ben", "Oh nice, I'll grab it later."),
  person("Ada", "Ledger, add screws and wall plugs to the shopping list please"),
  said("Added to the shopping list: screws (4 mm, for wood) and wall plugs. Anything else for the shelves?"),
  person("Cleo", "Not from me. See you all at dinner"),
  person("Ben", "See you! I'll cook tonight, pasta okay for everyone?")
];
const LONGEST = Array.from({ length: JUDGED_MESSAGES }, (_, at) =>
  at % 4 === 3 ? said(`${"An answer from the bot that runs on and on. ".repeat(20)}`) : person(["Ada", "Ben", "Cleo"][at % 3], "word ".repeat(200)));

test("the instructions are the decision's words, fixed for a bot, with its name and its job", () => {
  assert.equal(judgingInstructions("Ledger", JOB), [
    "You decide whether Ledger, a bot in a shared conversation, should answer the latest message. Several people talk here, " +
      "to each other and sometimes to Ledger. Ledger's job: Keeps the household's calendar, shopping and chores in order.",
    "Answer with one JSON object and nothing else: {\"reply\": true} or {\"reply\": false}.",
    "Answer true when the latest message asks Ledger something, asks for something its job covers, asks everyone a question " +
      "Ledger can usefully answer, or carries on a conversation the person is having with Ledger.",
    "Answer false when people are talking to each other, chatting, thanking, agreeing or saying goodbye, or when an answer would " +
      "interrupt. When unsure, answer false."
  ].join("\n"));
  assert.equal(judgingInstructions("Ledger", JOB), judgingInstructions("Ledger", JOB), "the same every time, so the provider caches it");
});

test("the conversation is the last 12 text messages, oldest first, each on a line of at most 400 characters, by speaker", () => {
  const thirteen = [person("Zed", "the oldest, left out"), ...TYPICAL];
  const lines = judgedConversation(bot, thirteen).split("\n");
  assert.equal(lines[0], "The conversation, oldest first; decide on the last message:");
  assert.equal(lines.length, 1 + JUDGED_MESSAGES);
  assert.ok(!lines.some((line) => line.includes("Zed")), "the 13th from the end isn't read");
  assert.equal(lines[1], "[Ada]: Morning all! Is anyone around this afternoon to help move the sofa upstairs?");
  assert.equal(lines[4], "[Ledger]: Done: \"Move the sofa\" is on the family calendar today at 15:00, for Ada and Ben.");
  assert.equal(lines.at(-1), "[Ben]: See you! I'll cook tonight, pasta okay for everyone?", "the one decided on, last");

  const clipped = judgedConversation(bot, [person("Ada", `Line one\n\n  line two ${"x".repeat(900)}`), person("Ben", `<@bot:41> and <@bot:7>, look`), said("")]);
  const [, first, second, third] = clipped.split("\n");
  assert.equal(first.length, "[Ada]: ".length + JUDGED_CHARACTERS, "clipped to 400 characters");
  assert.ok(first.startsWith("[Ada]: Line one line two xxx"), "on one line");
  assert.equal(second, "[Ben]: @Ledger and @someone, look", "mentions as plain names");
  assert.equal(third, "[Ledger]: ");
  assert.equal(judgedConversation(bot, [{ role: "user", body: { text: "hi" } }]).split("\n")[1], "[Someone]: hi");
});

test("the prompt's size for 12 typical messages and for 12 of the longest", (t) => {
  const system = judgingInstructions(bot.name, JOB);
  const typical = judgedConversation(bot, TYPICAL);
  const longest = judgedConversation(bot, LONGEST);
  const tokens = (characters) => Math.round(characters / 4);
  const fixed = system.length;
  const report = (label, conversation) =>
    `${label}: ${fixed} + ${conversation.length} = ${fixed + conversation.length} characters, about ${tokens(fixed + conversation.length)} tokens in`;
  t.diagnostic(`judging prompt, instructions with a ${JOB.length}-character job: ${fixed} characters, about ${tokens(fixed)} tokens`);
  t.diagnostic(report("judging prompt, 12 typical messages", typical));
  t.diagnostic(report("judging prompt, 12 longest messages", longest));
  // Every line of the longest is clipped: the conversation can't pass 12 lines of 400 characters and a speaker.
  const header = "The conversation, oldest first; decide on the last message:".length;
  const bound = header + JUDGED_MESSAGES * (1 + "[Ledger]: ".length + JUDGED_CHARACTERS);
  assert.ok(longest.length <= bound, `${longest.length} <= ${bound}`);
  assert.equal(longest.length, header + 12 + 3 * (10 + 400) + 6 * (7 + 400) + 3 * (8 + 400), "each of the 12 lines clipped");
  assert.ok(longest.split("\n").slice(1).every((line) => line.length <= "[Ledger]: ".length + JUDGED_CHARACTERS));
  assert.ok(typical.length < longest.length / 3, "a typical chat is a fraction of the clip");
  assert.ok(fixed < 1400, "the fixed part stays small");
});

test("the judge's answer is {\"reply\": true|false}, in a code fence or not; anything else is no answer", () => {
  assert.equal(judgementOf("{\"reply\": true}"), true);
  assert.equal(judgementOf(" ```json\n{\"reply\": false}\n``` "), false);
  assert.equal(judgementOf("```\n{\"reply\":true}\n```"), true);
  for (const odd of ["", "yes", "{\"reply\": \"true\"}", "{\"answer\": true}", "[true]", "null", "{\"reply\": 1}", undefined]) {
    assert.equal(judgementOf(odd), null, String(odd));
  }
});

test("the bot is called by its name as a word, in any case, or an @-mention of it", () => {
  for (const text of ["Ledger, what's on today?", "what do you think ledger", "Thanks LEDGER!", "ok (Ledger) fine", "<@bot:41> ping"]) {
    assert.equal(namesBot(bot, text), true, text);
  }
  for (const text of ["Ledgerman was great", "the ledgers are done", "<@bot:410> ping", "<@bot:7> ping", "", undefined]) {
    assert.equal(namesBot(bot, text), false, String(text));
  }
  const named = { id: "5", name: "Otto (home)" };
  assert.equal(namesBot(named, "otto (HOME), hi"), true, "a name's own punctuation is taken literally");
  assert.equal(namesBot(named, "otto home"), false);
  assert.equal(namesBot({ id: "6", name: "Zoë" }, "zoë?"), true, "letters beyond ASCII");
  assert.equal(namesBot({ id: "6", name: "Zoë" }, "Zoëy"), false);
});
