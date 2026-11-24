import assert from "node:assert/strict";
import test from "node:test";
import { createMeter, createMeteredFetch, currentWork } from "../../packages/account/src/server/meter.js";
import { WORK } from "../../packages/account/src/server/providers/index.js";
import { DISCUSSION_LIMITS, discussionTokens } from "../../packages/bots/src/server/discussions.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { FREE_RECORDER, botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// Discuss (D-115), against the disposable test database, each test in a home of its own: a card in a chat with two or
// more bots, proposed with what it may cost (the meter's estimate), started only by its person's press; each round one
// turn per bot, that only talks and may PASS, metered to the person and the speaking bot; no round runs without a
// press; a round of passes ends it; Wrap up has one bot sum it up; the server's cap stops it mid-round; Stop ends it and
// lets go of the bots, which then answer what was written meanwhile, and a turn in progress ends at the next heartbeat;
// a discussion counts only its own turns' calls; a round whose server stopped reads as interrupted once its lease
// lapses. The model is a scripted reply that makes one call through the meter, as every AI call goes, costing what the
// script says.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];
// The test's prices, in nanodollars per token: what the chat AI's estimate answers.
const PER_INPUT = 1;
const PER_OUTPUT = 4;
// A model call through the meter, as every AI call goes: an answer giving `nano` input tokens, so `nano` nanodollars at
// the test's prices.
const modelCall = createMeteredFetch({}, "stand-in");
const callCosting = (nano) =>
  modelCall(`data:application/json,${encodeURIComponent(JSON.stringify({ usage: { prompt_tokens: Math.round(nano), completion_tokens: 0 } }))}`);
const isDiscussion = (prompt) => String(prompt ?? "").startsWith("(A discussion");
const seatsOf = async (knex, chatId) => (await knex("chat_bots").where({ conversation_id: chatId }).orderBy("position")).map((row) => ({ id: String(row.id), botId: String(row.bot_id) }));

/**
 * A home of Pat (its owner), Kim and Lee, with Pat's bots Ada, Bo and Cy, and the turns, whose replies follow
 * `script(bot, prompt, options)` (a text, PASS, or a promise of either) and make one model call costing
 * `cost(bot, prompt)` nanodollars, which the recorder adds up per person and bot (the meter's spentSince, which a
 * discussion must not count by). Every turn is kept in `turns`. `discussionLimits` replaces the discussion's.
 */
async function setup(context, { discussionLimits } = {}) {
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
  const steer = { script: (bot) => `${bot.name}: a point.`, cost: () => 1000 };
  const kit = await startChatTurns(context, {
    ...(discussionLimits ? { discussionLimits } : {}),
    meter,
    reply: async (bot, _timeline, tools, _state, prompt, options) => {
      const turn = { bot: bot.name, prompt, tools: Object.keys(tools), who: meter.currentMeter(), work: currentWork(), options };
      turns.push(turn);
      const said = await steer.script(bot, prompt, options);
      const cost = steer.cost(bot, prompt);
      await callCosting(cost);
      const key = `${turn.who.userId}:${turn.who.botId}`;
      spent.set(key, (spent.get(key) || 0) + cost / 1e9);
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
  /** The card as a page reads it now: the chat's newest page, as the person reads it. */
  const shown = async (chatId, cardId, person) =>
    (await kit.records.messages.timeline(chatId, {}, as(person))).messages.find((message) => message.id === String(cardId)).body;
  return { ...kit, meter, spent, estimates, turns, steer, homeId, pat, kim, lee, ada, bo, cy, owner, as, chatOf, chat, propose, cardOf, press, said, shown };
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
  steer.cost = (bot) => (bot.name === "Ada" ? cap - choices[0].turnNano / 2 : 1000);
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

test("a discussion counts only its own turns: the person's other work with its bots meanwhile doesn't bring its cap nearer", async (context) => {
  const { kim, ada, bo, turns, steer, spent, as, chatOf, chat, propose, cardOf, drain } = await setup(context);
  const kitchen = await chatOf([ada, bo]);
  const elsewhere = await chatOf([ada], [kim]);
  const card = await propose(kitchen, kim, "Tiles or wood?");
  const { choices } = await cardOf(card.id);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  // Kim's other work with Ada costs twice what the whole discussion may.
  steer.cost = (_bot, prompt) => (isDiscussion(prompt) ? 1000 : 2 * choices[0].upToNano);
  steer.script = (bot, prompt) => (bot.name === "Ada" && isDiscussion(prompt) ? held.then(() => "Ada: tiles.") : `${bot.name}: sure.`);
  await chat.startDiscussion(kitchen, card.id, { rounds: 1 }, as(kim));
  while (!turns.length) await new Promise((resolve) => setImmediate(resolve));

  const sent = await chat.sendMessage(elsewhere, { text: "Ada, what's for dinner?" }, as(kim));
  const answer = await chat.reply(elsewhere, { afterMessageId: sent.messages.at(-1).id }, undefined, as(kim));
  assert.equal(answer.messages?.at(-1)?.body.text, "Ada: sure.", "Ada answered Kim in another chat meanwhile");
  assert.ok(spent.get(`${kim}:${ada}`) * 1e9 > choices[0].upToNano, "Kim's work with Ada since it started is past its cap");
  release();
  await drain();

  const body = await cardOf(card.id);
  assert.deepEqual([body.status, body.ended], ["waiting", null], "its cap wasn't reached: round 1 ran to its end");
  assert.deepEqual(turns.filter((turn) => isDiscussion(turn.prompt)).map((turn) => turn.bot), ["Ada", "Bo"]);
  assert.deepEqual(body.spentByBot, { [ada]: 1000, [bo]: 1000 }, "each bot's turns in it, and nothing else");
  assert.equal(body.spentNano, 2000);
});

test("a round whose server stopped reads as interrupted once its lease lapses, and its person carries on on the runs it left", async (context) => {
  const { knex, kim, lee, ada, bo, turns, chatOf, propose, cardOf, press, shown } = await setup(context);
  const kitchen = await chatOf([ada, bo], [kim, lee]);
  const card = await propose(kitchen, kim, "Tiles or wood?");
  await press("start", kitchen, card.id, kim, { rounds: 3 });
  // Round 2 started on a server that then stopped: the card says it runs, and the bots' runs are that server's, stale.
  const seats = await seatsOf(knex, kitchen);
  await knex("agent_runs").insert(seats.map((seat) => ({
    conversation_id: seat.id, bot_id: seat.botId, user_id: kim, heartbeat_at: knex.raw("now() - interval '5 minutes'")
  })));
  const leased = (seconds) => knex("messages").where({ id: card.id }).update({
    body: knex.raw("body || ?::jsonb", [JSON.stringify({ status: "running", run: "a-stopped-server", round: 2, leaseUntil: new Date(Date.now() + seconds * 1000).toISOString() })])
  });

  await leased(60);
  const holding = await shown(kitchen, card.id, lee);
  assert.equal(holding.status, "running", "while its lease holds, it runs");
  assert.ok(holding.leaseLeftMs > 50000 && holding.leaseLeftMs <= 60000, "and the page is told what's left of it by the server's clock");
  await assert.rejects(press("round", kitchen, card.id, kim), { statusCode: 409, code: "bots_discussion_not_waiting" });

  await leased(-1);
  assert.equal((await shown(kitchen, card.id, lee)).status, "interrupted", "lapsed, it never reads as running");
  assert.equal((await shown(kitchen, card.id, kim)).status, "interrupted");
  const before = turns.length;
  await press("round", kitchen, card.id, kim);
  const body = await cardOf(card.id);
  assert.deepEqual([body.status, body.round], ["waiting", 3], "One more round ran, on the runs the stopped server left");
  assert.notEqual(body.run, "a-stopped-server");
  assert.deepEqual(turns.slice(before).map((turn) => turn.bot), ["Ada", "Bo"]);
  assert.equal(await knex("agent_runs").whereIn("conversation_id", seats.map((seat) => seat.id)).first(), undefined, "and let them go");
});

// Renewed every 100 ms, the lease holds 1 s, so the round outlasts a stall of this process or its database on a busy
// host: with a 300 ms lease, a heartbeat that came late on a host running 20 processes for its 8 CPUs let it lapse,
// which ends a round for good.
test("Stop during a turn ends it at the round's next heartbeat, which renews the card's lease while the round runs", async (context) => {
  const { knex, kim, lee, ada, bo, turns, steer, as, chatOf, chat, propose, cardOf, drain, said, shown } = await setup(context, {
    discussionLimits: { heartbeatMs: 100, leaseMs: 1000 }
  });
  const kitchen = await chatOf([ada, bo], [kim, lee]);
  const card = await propose(kitchen, kim, "Tiles or wood?");
  // Ada's turn talks until it's stopped, or for 5 seconds at most.
  steer.script = (bot, _prompt, options) => new Promise((resolve, reject) => {
    const late = setTimeout(() => resolve(`${bot.name}: at last.`), 5000);
    options.signal?.addEventListener("abort", () => {
      clearTimeout(late);
      reject(options.signal.reason);
    }, { once: true });
  });
  await chat.startDiscussion(kitchen, card.id, { rounds: 1 }, as(kim));
  while (!turns.length) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal((await shown(kitchen, card.id, lee)).status, "running", "twice its lease later, renewed at each heartbeat");

  const stoppedAt = Date.now();
  await chat.stopDiscussion(kitchen, card.id, as(kim));
  await drain();
  assert.ok(Date.now() - stoppedAt < 2000, `the turn stopped at the next heartbeat, not when it would have ended (${Date.now() - stoppedAt} ms)`);
  assert.equal(turns[0].options.signal.aborted, true, "Ada's turn was stopped");
  const body = await cardOf(card.id);
  assert.deepEqual([body.status, body.ended], ["ended", "stopped"]);
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada"], "Bo's turn never ran");
  assert.deepEqual(await said(kitchen), [], "the stopped turn posted nothing");
  const seats = await seatsOf(knex, kitchen);
  assert.equal(await knex("agent_runs").whereIn("conversation_id", seats.map((seat) => seat.id)).first(), undefined, "its runs are free");
});
