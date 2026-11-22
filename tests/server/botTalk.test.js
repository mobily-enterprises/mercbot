import assert from "node:assert/strict";
import test from "node:test";
import { BOT_TALK_LIMIT, handBackLine, mentionedNext, pastTalkLimit } from "../../packages/bots/src/server/botTalk.js";
import { briefFor } from "../../packages/bots/src/server/roomTools.js";

// Bots talking to each other (R3, D-124), the parts that decide without a database: where the chat's bots are against
// the limit, from one bounded read of its newest text messages; the plain line said at the limit; which bots answer a
// round's mentions; and which bot a room's brief is for.

const BOTS = [{ bot_id: "1", name: "Ada" }, { bot_id: "2", name: "Bo" }, { bot_id: "3", name: "Cy", archived_at: new Date() }];
const answer = (botId, extra = {}) => ({ role: "bot", kind: "text", authorBotId: botId, body: { text: "Yes.", answersBot: botId === "1" ? "2" : "1", ...extra } });
const person = { role: "user", kind: "text", body: { text: "Hi" } };

/** pastTalkLimit against `newest` (newest first), with what it read and said. */
async function past(newest) {
  const reads = [];
  const said = [];
  const turns = { messages: async (chatId, filters, order) => { reads.push({ chatId, filters, order }); return newest.slice(0, order.limit); } };
  const seats = {
    readerOf: () => ({ reader: true }),
    say: async (_seat, messages) => { said.push(...messages); return messages; },
    tell: async () => {}
  };
  const posted = [];
  const held = await pastTalkLimit({ turns, seats }, { chat_id: "9", id: "1" }, { text: "<@bot:1>, shall we add cake? Maybe." }, BOTS, posted);
  return { held, reads, said, posted };
}

test("the limit reads the chat's newest text messages once, at most 6, and counts the bots' replies since a person wrote", async () => {
  const five = Array.from({ length: BOT_TALK_LIMIT }, (_, index) => answer(index % 2 ? "1" : "2"));
  const atLimit = await past([...five, person]);
  assert.equal(BOT_TALK_LIMIT, 5);
  assert.deepEqual(atLimit.reads, [{ chatId: "9", filters: { kind: "text" }, order: { newestFirst: true, limit: 6 } }], "one bounded read");
  assert.equal(atLimit.held, true);
  assert.deepEqual(atLimit.said.map((message) => message.body), [{ text: "We need you to go on: shall we add cake?", handBack: true }]);
  assert.deepEqual(atLimit.posted, atLimit.said);

  // Four replies: it answers.
  assert.equal((await past([...five.slice(1), person])).held, false);
  // A person wrote after them, to anyone: it answers.
  assert.equal((await past([person, ...five])).held, false);
  // The line said since the person wrote: it holds back, and isn't said again.
  const again = await past([answer("1", { answersBot: undefined }), { role: "bot", kind: "text", body: { text: "We need you to go on: …", handBack: true } }, ...five.slice(0, 4)]);
  assert.deepEqual([again.held, again.said], [true, []]);
});

test("the plain line names the asking bot's last question, without the mention it starts with, or says they went back and forth", () => {
  assert.equal(handBackLine("<@bot:2>, can you add a vet column? It helps.", BOTS), "We need you to go on: can you add a vet column?");
  assert.equal(handBackLine("Tables done. Does <@bot:1> agree?", BOTS), "We need you to go on: Does @Ada agree?");
  assert.equal(handBackLine("<@bot:2> done.", BOTS), "We need you to go on: we've gone back and forth 5 times, so tell us how you'd like to continue.");
});

test("a round's mentions: each live bot once, never the author, nor one that spoke after the mention", () => {
  const posted = [
    { role: "bot", kind: "text", authorBotId: "1", body: { text: "<@bot:1> <@bot:2> <@bot:3>", authorName: "Ada" } },
    { role: "bot", kind: "text", authorBotId: "2", body: { text: "<@bot:1> sure", authorName: "Bo" } },
    { role: "bot", kind: "text", authorBotId: "2", body: { text: "<@bot:1> hm", handBack: true } }
  ];
  assert.deepEqual(mentionedNext(posted, BOTS).map((bot) => [bot.bot_id, bot.botAsked.id, bot.botAsked.name]), [["1", "2", "Bo"]],
    "Bo spoke after Ada's mention, Cy is archived, Ada doesn't answer herself, and the plain line mentions no one");
});

test("a room's brief is for the Builder when the card names it, else the first other bot", () => {
  const bots = [{ id: "1", name: "Whiskers" }, { id: "2", name: "Pantry" }, { id: "3", name: "Mercbot" }];
  assert.equal(briefFor(bots, "3").name, "Mercbot");
  assert.equal(briefFor(bots, "9").name, "Pantry");
  assert.equal(briefFor(bots, "1").name, "Pantry", "the proposer never answers its own brief");
  assert.equal(briefFor(bots.slice(0, 1), "1"), null);
});
