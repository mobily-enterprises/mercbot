import assert from "node:assert/strict";
import test from "node:test";
import { createMeter, currentWork } from "../../packages/account/src/server/meter.js";
import { WORK } from "../../packages/account/src/server/providers/index.js";
import { DISCUSSION_LIMITS, discussionTokens } from "../../packages/bots/src/server/discussions.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { FREE_RECORDER, botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// Discuss (D-115), against the disposable test database, each test in a home of its own: a card in a chat with two or
// more bots, proposed with what it may cost (the meter's estimate), started only by its person's press; each round one
// turn per bot, that only talks and may PASS, metered to the person and the speaking bot; no round runs without a
// press; a round of passes ends it; Wrap up has one bot sum it up; the server's cap stops it mid-round; Stop ends it and
// lets go of the bots, which then answer what was written meanwhile. The model is a scripted reply, the spending the
// test's own: a turn costs what the script says.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];
// The test's prices, in nanodollars per token: what the chat AI's estimate answers.
const PER_INPUT = 300;
const PER_OUTPUT = 1200;

/**
 * A home of Pat (its owner), Kim and Lee, with Pat's bots Ada, Bo and Cy, and the turns, whose replies follow
 * `script(bot, prompt, options)` (a text, PASS, or a promise of either) and spend `cost(bot)` dollars each, which the
 * meter's spentSince adds up per person and bot. Every turn is kept in `turns`.
 */
async function setup(context) {
  const spent = new Map();
  const estimates = [];
  const meter = {
    ...createMeter({ recorder: FREE_RECORDER }),
    pausedMessage: async () => null,
    estimateNano: async (input) => {
      estimates.push(input);
      return (input.cacheMiss || 0) * PER_INPUT + (input.output || 0) * PER_OUTPUT;
    },
    spentSince: async ({ userId, botId }) => spent.get(`${userId}:${botId}`) || 0
  };
  const turns = [];
  const steer = { script: (bot) => `${bot.name}: a point.`, cost: () => 0.000001 };
  const kit = await startChatTurns(context, {
    meter,
    reply: async (bot, _timeline, tools, _state, prompt, options) => {
      const turn = { bot: bot.name, prompt, tools: Object.keys(tools), who: meter.currentMeter(), work: currentWork(), options };
      turns.push(turn);
      const said = await steer.script(bot, prompt, options);
      const key = `${turn.who.userId}:${turn.who.botId}`;
      spent.set(key, (spent.get(key) || 0) + steer.cost(bot));
      if (options.followUp && said === "PASS") return { text: "", transcript: [], passed: true };
      return { text: said, transcript: [] };
    }
  });
  const { homeId, people: [pat, kim, lee] } = await homeOfPeople(kit, ["Pat", "Kim", "Lee"]);
  const [ada, bo, cy] = await botsOf(kit, homeId, pat, ["Ada", "Bo", "Cy"]);
  const owner = memberOptions({ userId: pat, homeId, role: "owner", permissions: MANAGE });
  const as = (person) => (person === pat ? owner : kit.as(person, homeId));
  const chatOf = async (bots = [ada, bo], people = [pat, kim]) => (await seedChat(kit.knex, { homeId, people, bots, madeBy: pat })).id;
  const chat = kit.turns.chat;
  /** `person` proposes a discussion of `question`; the card. */
  const propose = async (chatId, person, question) => (await chat.discuss(chatId, { question }, as(person))).messages[0];
  const cardOf = async (cardId) => (await kit.knex("messages").where({ id: cardId }).first()).body;
  /** A press on the card, and the round it starts run to its end. */
  async function press(verb, chatId, cardId, person, input = {}) {
    const work = { start: chat.startDiscussion, round: chat.discussMore, wrap: chat.wrapUpDiscussion }[verb];
    const answer = await work(chatId, cardId, { timeZone: "Europe/Rome", ...input }, as(person));
    await kit.drain();
    return answer;
  }
  const said = async (chatId) => (await kit.knex("messages").where({ conversation_id: chatId, role: "bot", kind: "text" }).orderBy("id"))
    .map((row) => ({ bot: String(row.author_bot_id), text: row.body.text, discussion: row.body.discussion, round: row.body.round, answers: row.body.answers }));
  return { ...kit, meter, spent, estimates, turns, steer, homeId, pat, kim, lee, ada, bo, cy, owner, as, chatOf, chat, propose, cardOf, press, said };
}

test("a discussion needs two bots, the chat's person and a question, and is proposed with what it may cost", async (context) => {
  const { knex, homeId, pat, kim, lee, ada, bo, estimates, turns, as, chatOf, chat, propose, cardOf } = await setup(context);
  const lonely = await chatOf([ada]);
  await assert.rejects(propose(lonely, pat, "Paint the kitchen?"), { statusCode: 409, code: "bots_discussion_needs_bots" });
  const kitchen = await chatOf([ada, bo]);
  await assert.rejects(propose(kitchen, lee, "Paint the kitchen?"), { statusCode: 403, code: "bots_chat_join_first" }, "not in the chat");
  await assert.rejects(propose(kitchen, kim, "   "), { statusCode: 400, code: "bots_discussion_empty" });
  await assert.rejects(propose(kitchen, kim, "x".repeat(DISCUSSION_LIMITS.questionChars + 1)), { statusCode: 400, code: "bots_discussion_too_long" });
  await chat.sendMessage(kitchen, { text: "We need to decide about the kitchen" }, as(kim));

  const card = await propose(kitchen, kim, "Should we repaint the kitchen, or wait until spring?");
  assert.equal(card.kind, "discussion");
  assert.equal(String(card.authorUserId), kim, "the card is Kim's, in the chat");
  const body = await cardOf(card.id);
  assert.equal(body.status, "proposed");
  assert.deepEqual(body.for, { id: kim, name: "Kim" });
  assert.deepEqual(body.bots, [{ id: ada, name: "Ada" }, { id: bo, name: "Bo" }], "the chat's bots, in its order");
  assert.equal(body.rounds, DISCUSSION_LIMITS.defaultRounds);

  // The estimate: the chat's tokens (its messages before the card, no summary yet) on each turn's prefix, at the meter's prices.
  const before = await knex("messages").where({ conversation_id: kitchen }).where("id", "<", card.id);
  const chatTokens = before.reduce((sum, row) => sum + Math.ceil(JSON.stringify(row.body).length / 4), 0);
  const expected = discussionTokens({ bots: 2, baseTokens: DISCUSSION_LIMITS.prefixTokens + chatTokens });
  const cost = (tokens) => tokens.input * PER_INPUT + tokens.output * PER_OUTPUT;
  assert.deepEqual(body.choices, expected.map((choice) => ({ rounds: choice.rounds, upToNano: cost(choice.all), turnNano: cost(choice.turn), wrapNano: cost(choice.wrap) })));
  assert.ok(body.choices[0].upToNano < body.choices[1].upToNano && body.choices[1].upToNano < body.choices[2].upToNano);
  assert.ok(estimates.length >= 2 && estimates.every((input) => input.workspaceId === homeId && input.kind === WORK.chat.kind), "the home's chat AI prices");
  assert.equal(turns.length, 0, "nothing runs before its Start");
});

test("only its person starts it, with 1 to 3 rounds; each round is one turn per bot that only talks, and no round runs without a press", async (context) => {
  const { homeId, pat, kim, ada, bo, turns, chatOf, propose, cardOf, press, said, drain } = await setup(context);
  const kitchen = await chatOf();
  const card = await propose(kitchen, kim, "Repaint the kitchen?");
  await assert.rejects(press("start", kitchen, card.id, pat), { statusCode: 403, code: "bots_discussion_forbidden" }, "not Pat, even an owner");
  await assert.rejects(press("start", kitchen, card.id, kim, { rounds: 4 }), { statusCode: 400, code: "bots_discussion_rounds" });
  await assert.rejects(press("round", kitchen, card.id, kim), { statusCode: 409, code: "bots_discussion_not_waiting" }, "no round before Start");
  assert.equal(turns.length, 0);

  const started = await press("start", kitchen, card.id, kim, { rounds: 2, capNano: 1e18 });
  assert.equal(started.message.body.status, "running");
  let body = await cardOf(card.id);
  assert.deepEqual([body.status, body.round, body.rounds], ["waiting", 1, 2], "round 1 ran, and it waits for a press");
  assert.equal(body.capNano, body.choices[1].upToNano, "the cap is the server's, for the rounds chosen: the page's is ignored");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada", "Bo"], "one turn per bot, in the chat's order");
  for (const turn of turns) {
    assert.match(turn.prompt, /^\(A discussion Kim started: "Repaint the kitchen\?"\. This is round 1 of 2, with (Bo|Ada)\./u);
    assert.deepEqual(turn.tools, [], "no tools");
    assert.equal(turn.options.followUp, true, "it may PASS");
    assert.equal(turn.options.modelSettings.maxOutputTokens, DISCUSSION_LIMITS.turnOutputTokens, "its output held to the estimate's");
    assert.equal(turn.options.reasoning.deepseek.thinking.type, "disabled", "without reasoning");
  }
  // Usage per speaking bot, as Kim's work (R8).
  assert.deepEqual(turns.map((turn) => turn.who), [
    { userId: kim, botId: ada, workspaceId: homeId, work: "chat" },
    { userId: kim, botId: bo, workspaceId: homeId, work: "chat" }
  ]);
  assert.deepEqual(turns.map((turn) => turn.work), ["chat", "chat"]);
  assert.deepEqual(body.spentByBot, { [ada]: 1000, [bo]: 1000 }, "what each bot's turns cost, from the meter");
  assert.equal(body.spentNano, 2000);
  const posted = await said(kitchen);
  assert.deepEqual(posted, [
    { bot: ada, text: "Ada: a point.", discussion: String(card.id), round: 1, answers: 0 },
    { bot: bo, text: "Bo: a point.", discussion: String(card.id), round: 1, answers: 0 }
  ], "each turn in the chat, naming its discussion and round, answering nobody's message");

  await drain();
  assert.equal(turns.length, 2, "nothing more runs by itself");
  await assert.rejects(press("start", kitchen, card.id, kim), { statusCode: 409, code: "bots_discussion_started" });
  await assert.rejects(press("round", kitchen, card.id, pat), { statusCode: 403, code: "bots_discussion_forbidden" });
  await press("round", kitchen, card.id, kim);
  body = await cardOf(card.id);
  assert.deepEqual([body.status, body.round, turns.length], ["waiting", 2, 4], "One more round: round 2");
  await assert.rejects(press("round", kitchen, card.id, kim), { statusCode: 409, code: "bots_discussion_rounds_done" }, "never past the rounds chosen");
});

test("a round in which every bot passes ends it; Wrap up has one bot sum it up, and ends it", async (context) => {
  const { pat, kim, ada, cy, turns, steer, chatOf, propose, cardOf, press, said } = await setup(context);
  const kitchen = await chatOf([ada, cy]);
  const card = await propose(kitchen, pat, "New fridge?");
  steer.script = (bot, prompt) => (/round 2 of/u.test(prompt) ? "PASS" : `${bot.name}: a point.`);
  await press("start", kitchen, card.id, pat, { rounds: 3 });
  await press("round", kitchen, card.id, pat);
  let body = await cardOf(card.id);
  assert.deepEqual([body.status, body.ended, body.round], ["ended", "passed", 2], "all passed: it ends early");
  assert.deepEqual(body.passed, [ada, cy]);
  assert.equal((await said(kitchen)).length, 2, "a pass posts nothing");
  await assert.rejects(press("round", kitchen, card.id, pat), { statusCode: 409 });
  await assert.rejects(press("wrap", kitchen, card.id, pat), { statusCode: 409 });

  const other = await propose(kitchen, kim, "Paint the hall?");
  steer.script = (bot) => `${bot.name}: a point.`;
  await press("start", kitchen, other.id, kim, { rounds: 1 });
  const before = turns.length;
  await assert.rejects(press("wrap", kitchen, other.id, pat), { statusCode: 403, code: "bots_discussion_forbidden" });
  await press("wrap", kitchen, other.id, kim);
  body = await cardOf(other.id);
  assert.deepEqual([body.status, body.ended, body.wrappedBy], ["ended", "wrapped", ada]);
  const wrap = turns.slice(before);
  assert.deepEqual(wrap.map((turn) => turn.bot), ["Ada"], "one bot writes the summary");
  assert.match(wrap[0].prompt, /^\(Wrap up the discussion of "Paint the hall\?"/u);
  assert.equal(wrap[0].options.followUp, false, "a summary doesn't pass");
  assert.equal(wrap[0].options.modelSettings.maxOutputTokens, DISCUSSION_LIMITS.wrapOutputTokens);
  assert.equal((await said(kitchen)).at(-1).round, "wrap");
});

test("the server's cap stops it mid-round, before a turn that could pass it", async (context) => {
  const { kim, ada, bo, cy, turns, steer, chatOf, propose, cardOf, press } = await setup(context);
  const kitchen = await chatOf([ada, bo, cy]);
  const card = await propose(kitchen, kim, "Move the sofa?");
  const { choices } = await cardOf(card.id);
  // Ada's turn costs all but half a turn of the cap for 1 round: Bo's turn could pass it, so it never starts.
  const cap = choices[0].upToNano;
  steer.cost = (bot) => (bot.name === "Ada" ? (cap - choices[0].turnNano / 2) / 1e9 : 0.000001);
  await press("start", kitchen, card.id, kim, { rounds: 1 });
  const body = await cardOf(card.id);
  assert.deepEqual([body.status, body.ended], ["ended", "cap"]);
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada"], "stopped mid-round: Bo and Cy never spoke");
  assert.ok(body.spentNano <= body.capNano, "and it never spent past the cap");
});

test("Stop ends it for its person or a manager, and the bots then answer what was written meanwhile", async (context) => {
  const { pat, kim, lee, ada, bo, turns, steer, as, chatOf, chat, propose, cardOf, drain, said } = await setup(context);
  const kitchen = await chatOf([ada, bo], [pat, kim, lee]);
  const card = await propose(kitchen, kim, "Tiles or wood?");
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  steer.script = (bot, prompt) => (bot.name === "Ada" && prompt.startsWith("(A discussion") ? held.then(() => "Ada: tiles.") : `${bot.name} here.`);
  await chat.startDiscussion(kitchen, card.id, { rounds: 2 }, as(kim));
  while (!turns.length) await new Promise((resolve) => setImmediate(resolve));

  // Lee writes to Bo meanwhile: Bo's run is the discussion's, so the message waits.
  const sent = await chat.sendMessage(kitchen, { text: "Bo, can you check the shop's hours?" }, as(lee));
  const meanwhile = await chat.reply(kitchen, { afterMessageId: sent.messages.at(-1).id }, undefined, as(lee));
  assert.equal(meanwhile.pending, true, "Bo is busy with the discussion");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada"]);

  await assert.rejects(chat.stopDiscussion(kitchen, card.id, as(lee)), { statusCode: 403, code: "bots_discussion_forbidden" }, "another member can't");
  const stopped = await chat.stopDiscussion(kitchen, card.id, as(pat));
  assert.deepEqual([stopped.message.body.status, stopped.message.body.ended, stopped.message.body.stoppedBy.id], ["ended", "stopped", pat], "a manager can");
  release();
  await drain();
  const body = await cardOf(card.id);
  assert.equal(body.status, "ended");
  assert.equal(body.spentByBot[ada], 1000, "the turn that was running still counts");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada", "Bo"], "Bo's discussion turn never ran; its waiting message did");
  assert.match(turns[1].prompt, /^\(The message "Bo, can you check the shop's hours\?" arrived while you were busy/u, "Bo's turn answered Lee's message, as any reply freed later does");
  assert.equal(turns[1].who.userId, lee);
  const last = (await said(kitchen)).at(-1);
  assert.deepEqual([last.bot, last.text, last.discussion], [bo, "Bo here.", undefined]);
  assert.equal((await chat.stopDiscussion(kitchen, card.id, as(kim))).message.body.status, "ended", "stopping again changes nothing");
});

test("a bot still answering refuses the press and keeps the others free; Cancel ends a proposed card, only its person's", async (context) => {
  const { pat, kim, turns, steer, as, chatOf, chat, propose, cardOf, press, drain } = await setup(context);
  const kitchen = await chatOf();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  steer.script = (bot, prompt) => (prompt ? `${bot.name}: a point.` : held.then(() => `${bot.name} here.`));
  const card = await propose(kitchen, kim, "Repaint?");
  const sent = await chat.sendMessage(kitchen, { text: "Bo, are you there?" }, as(kim));
  const replying = chat.reply(kitchen, { afterMessageId: sent.messages.at(-1).id }, undefined, as(kim));
  while (!turns.length) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(chat.startDiscussion(kitchen, card.id, {}, as(kim)), { statusCode: 409, code: "bots_discussion_busy", message: "Bo is still answering. Try again once it has." });
  assert.equal((await cardOf(card.id)).status, "proposed", "the card waits");
  release();
  await replying;
  await drain();
  await press("start", kitchen, card.id, kim, { rounds: 1 });
  assert.equal((await cardOf(card.id)).status, "waiting", "once Bo is free, Ada (let go after the refusal) and Bo both speak");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Bo", "Ada", "Bo"]);

  const other = await propose(kitchen, kim, "Wallpaper?");
  await assert.rejects(chat.cancelDiscussion(kitchen, other.id, as(pat)), { statusCode: 403, code: "bots_discussion_forbidden" });
  assert.equal((await chat.cancelDiscussion(kitchen, other.id, as(kim))).message.body.ended, "cancelled");
  await assert.rejects(press("start", kitchen, other.id, kim), { statusCode: 409, code: "bots_discussion_started" });
  await assert.rejects(chat.cancelDiscussion(kitchen, card.id, as(kim)), { statusCode: 409 }, "a started one is stopped, not cancelled");
});
