import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { createMeter, currentWork } from "../../packages/account/src/server/meter.js";
import { generateReply } from "../../packages/bots/src/server/botAgent.js";
import { queriesDuring } from "../support/queryCount.mjs";
import { seedChat, seedMessages } from "../support/chatFixtures.mjs";
import { FREE_RECORDER, botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// Bots join in when useful (D-115, D-129), against the disposable test database, each test in a home of its own. In a
// chat of several people with the chat's switch on, every live bot reads every person's message, one after another in
// the chat's order: a bot the message calls answers it and can't pass; any other first decides, in a call of its own
// with no tools (here a stand-in model that answers what the test says and records what it read, and for whom), and
// only on REPLY takes a turn, which may still PASS; nothing of a bot that passed is posted or shown, and no judge is
// asked. Off, it's as before: only a bot that is called answers, and nothing else calls the model. New chats start on,
// and the migration turns it on for every chat made before. A paused home decides nothing; the statements don't grow
// with the chat; a decision costs a fraction of a turn.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];
// A bot's decision (joiningIn.js), and D-115's one-bot judge, which D-129 removed, by their instructions' first words.
const DECIDING = "You decide whether you reply to a message in a chat that several people share.";
const JUDGING = "You decide whether one of the bots in a shared conversation";
const require = createRequire(import.meta.url);
const MIGRATION = path.resolve(import.meta.dirname, "..", "..", "migrations", "20261124120000_bots_join_in_on.cjs");

/**
 * One model call as the stand-in got it: its instructions, what it read, its tools, its options, whose work it ran in,
 * and its size in tokens as the agent loop counts them (4 characters each, of the prompt and the tools).
 */
function callOf(options, meter) {
  const system = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const user = options.prompt.filter((message) => message.role === "user")
    .flatMap((message) => (typeof message.content === "string" ? [{ text: message.content }] : message.content))
    .map((part) => part.text || "").join("\n");
  const tools = options.tools ?? [];
  return {
    system,
    user,
    tools,
    maxOutputTokens: options.maxOutputTokens,
    providerOptions: options.providerOptions,
    who: meter.currentMeter(),
    work: currentWork(),
    tokens: Math.ceil(JSON.stringify({ prompt: options.prompt, tools }).length / 4)
  };
}

/**
 * A home of Pat (its owner), Kim and Lee, with Pat's bots Studio and Chorus, and the stand-in model, which keeps every
 * call by its kind (`calls.decisions`, each with the bot deciding; `calls.judged`; `calls.turns`, a turn's own model
 * calls when `realTurns` runs generateReply itself). The test steers each bot's decision (`steer.decide(name, read)`:
 * "REPLY", "PASS", other words, or an Error to fail) and its words in a turn (`steer.reply(bot, prompt)`, which may
 * wait; "PASS" stays quiet only in a turn that may pass, as generateReply has it). `turns` is each turn the stand-in
 * reply ran, `news` every event sent to open pages.
 */
async function setup(context, { realTurns = false } = {}) {
  const meter = { ...createMeter({ recorder: FREE_RECORDER }), pausedMessage: async () => null };
  const calls = { decisions: [], judged: [], turns: [] };
  const steer = { decide: () => "PASS", reply: async (bot) => `${bot.name} here.`, turnText: () => "Noted." };
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const call = callOf(options, meter);
      let text;
      if (call.system.startsWith(DECIDING)) {
        const bot = /^You are (.+?), one of the bots in it\./mu.exec(call.system)?.[1];
        calls.decisions.push({ ...call, bot });
        const answer = await steer.decide(bot, call.user);
        if (answer instanceof Error) throw answer;
        text = answer;
      } else if (call.system.startsWith(JUDGING)) {
        calls.judged.push(call);
        text = "{\"bot\": null}";
      } else {
        calls.turns.push(call);
        text = steer.turnText(call);
      }
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  const turns = [];
  const news = [];
  const kit = await startChatTurns(context, {
    meter,
    model,
    notices: { publishEach: async (_topic, _people, event) => news.push(event) },
    reply: realTurns
      ? (...args) => generateReply(...args)
      : async (bot, _timeline, _tools, _state, prompt, options) => {
        turns.push({ bot: bot.name, prompt, mayPass: Boolean(options.followUp), who: meter.currentMeter(), work: currentWork() });
        const text = await steer.reply(bot, prompt);
        return text === "PASS" && options.followUp ? { text: "", transcript: [], passed: true } : { text, transcript: [] };
      }
  });
  const { homeId, people: [pat, kim, lee] } = await homeOfPeople(kit, ["Pat", "Kim", "Lee"]);
  const [studio, chorus] = await botsOf(kit, homeId, pat, ["Studio", "Chorus"]);
  const owner = memberOptions({ userId: pat, homeId, role: "owner", permissions: MANAGE });
  const as = (person) => (person === pat ? owner : kit.as(person, homeId));
  const chatOf = async (people, extra = {}) => (await seedChat(kit.knex, { homeId, people, bots: [studio, chorus], botsJoinIn: true, ...extra })).id;
  /** `person` says `text` (with `extra` such as replyTo); the message sent. */
  const send = async (chatId, person, text, extra = {}) => (await kit.turns.chat.sendMessage(chatId, { text, ...extra }, as(person))).messages.at(-1);
  /** The page asks for the reply, and the background work finishes; the bots' texts the chat has after the message. */
  async function ask(chatId, person, afterMessageId) {
    await kit.turns.chat.reply(chatId, { afterMessageId }, undefined, as(person));
    await kit.drain();
    return (await botTexts(chatId, afterMessageId)).map((message) => message.body.text);
  }
  const say = async (chatId, person, text, extra) => ask(chatId, person, (await send(chatId, person, text, extra)).id);
  /** A chat's bot text messages after a message id, oldest first. */
  const botTexts = (chatId, after = 0) => kit.knex("messages").where({ conversation_id: chatId, role: "bot", kind: "text" }).andWhere("id", ">", after).orderBy("id");
  /** Every message a bot wrote in a chat, of any kind. */
  const writtenBy = (chatId, botId) => kit.knex("messages").where({ conversation_id: chatId, author_bot_id: botId });
  const reply = kit.turns.chat.reply;
  return { ...kit, meter, model, calls, steer, turns, news, homeId, pat, kim, lee, studio, chorus, owner, as, chatOf, send, ask, say, reply, botTexts, writtenBy };
}

test("on, an answer that names no bot reaches the bot whose question it answers, which reads it and carries on", async (context) => {
  const { pat, kim, calls, steer, turns, chatOf, say } = await setup(context);
  const chat = await chatOf([pat, kim]);
  steer.reply = async (bot) => (bot.name === "Studio" ? "Question 4 of 6. What must never appear on the poster? Tell me which of those is wrong." : "Chorus here.");
  // Studio replies when what it reads answers its own question; Chorus has nothing to add.
  steer.decide = (bot, read) => (bot === "Studio" && /\[Studio \(you\)\]: Question 4 of 6/u.test(read) ? "REPLY" : "PASS");
  assert.deepEqual(await say(chat, pat, "Studio, run me through the poster questionnaire"), [
    "Question 4 of 6. What must never appear on the poster? Tell me which of those is wrong."
  ]);
  assert.deepEqual(turns.map((turn) => [turn.bot, turn.mayPass]), [["Studio", false]], "Studio, called by name, answers and can't pass");

  steer.reply = async (bot) => `Question 5 of 6, from ${bot.name}.`;
  const answered = await say(chat, pat, "There is no real requirement about this one");
  assert.deepEqual(answered, ["Question 5 of 6, from Studio."], "Studio carries on its questionnaire without being named");
  assert.deepEqual(turns.slice(1).map((turn) => [turn.bot, turn.mayPass]), [["Studio", true]], "in a turn that may still pass");
  assert.match(turns[1].prompt, /^\(Nobody called you by name in it: you read it and chose to reply\..*reply with exactly PASS\.\)$/su);
  assert.equal(turns[1].who.userId, pat, "for Pat, who wrote it");

  const decided = calls.decisions.filter((decision) => decision.bot === "Studio").at(-1);
  assert.deepEqual(decided.tools, [], "it decided with no tools");
  assert.match(decided.user, /\[Studio \(you\)\]: Question 4 of 6\. What must never appear on the poster\?/u, "reading its own question");
  assert.match(decided.user, />> \[Pat\]: There is no real requirement about this one$/u, "and the message it decides on, last");
  assert.equal(calls.judged.length, 0, "no judge");
});

test("on, every bot reads a message in turn, after the ones before it spoke; one with nothing to add passes, and nothing of it shows", async (context) => {
  const { kim, pat, chorus, calls, steer, turns, news, chatOf, say, writtenBy } = await setup(context);
  const chat = await chatOf([pat, kim]);
  steer.decide = (bot) => (bot === "Studio" ? "REPLY" : "PASS");
  assert.deepEqual(await say(chat, kim, "What colours does the logo use?"), ["Studio here."]);
  assert.deepEqual(calls.decisions.map((decision) => decision.bot), ["Studio", "Chorus"], "each bot decides, in the chat's order");
  assert.match(calls.decisions[1].user, />> \[Kim\]: What colours does the logo use\?\n\[Studio\]: Studio here\.$/u, "Chorus read Studio's reply to it");
  assert.deepEqual(turns.map((turn) => [turn.bot, turn.who.userId]), [["Studio", kim]], "only Studio took a turn, for Kim");
  assert.deepEqual(await writtenBy(chat, chorus), [], "nothing of Chorus in the chat");
  assert.ok(!news.some((event) => event.type === "working" && event.botId === chorus), "nor was Chorus shown working");

  // A bot that chose to reply and then, in its turn, finds nothing to add passes there: nothing is posted either.
  steer.decide = () => "REPLY";
  steer.reply = async (bot) => (bot.name === "Chorus" ? "PASS" : "Studio here again.");
  assert.deepEqual(await say(chat, kim, "Thanks, and which font?"), ["Studio here again."]);
  assert.deepEqual(turns.slice(1).map((turn) => [turn.bot, turn.mayPass]), [["Studio", true], ["Chorus", true]]);
  assert.deepEqual(await writtenBy(chat, chorus), [], "Chorus' PASS posted nothing");
});

test("on, people chatting: every bot reads it and passes, nothing is posted or shown, and no judge is asked", async (context) => {
  const { homeId, pat, kim, studio, chorus, calls, turns, news, chatOf, say, botTexts } = await setup(context);
  const chat = await chatOf([pat, kim]);
  news.length = 0;
  assert.deepEqual(await say(chat, kim, "Pat, lunch at one?"), []);
  assert.deepEqual(calls.decisions.map((decision) => decision.bot), ["Studio", "Chorus"], "every bot read it");
  assert.equal(turns.length, 0, "no turn");
  assert.equal(calls.judged.length, 0, "no judge");
  assert.deepEqual(await botTexts(chat), []);
  assert.ok(!news.some((event) => event.type === "working"), "no bot was shown working");

  // Each decision is one call of that bot's own: Kim's chat work for it, no tools, a word or two out, no reasoning.
  const [first, second] = calls.decisions;
  assert.deepEqual(first.who, { userId: kim, botId: studio, workspaceId: homeId, work: "chat" });
  assert.deepEqual(second.who, { userId: kim, botId: chorus, workspaceId: homeId, work: "chat" });
  assert.deepEqual(first.tools, []);
  assert.ok(first.maxOutputTokens <= 10, "a word out");
  assert.equal(first.providerOptions?.deepseek?.thinking?.type, "disabled", "without reasoning");
  assert.match(first.system, /^You decide whether you reply to a message in a chat that several people share\.\nYou are Studio, one of the bots in it\. Your job: An all-round helper/u);
  assert.match(first.system, /Above all, reply when the message answers a question you asked/u);
  assert.match(first.system, /Answer with one word: REPLY or PASS\.$/u);
  assert.deepEqual(first.user.split("\n"), [
    "The conversation, oldest first. Decide on the message marked \">>\"; anything after it was said since.",
    ">> [Kim]: Pat, lunch at one?"
  ]);

  // The runs a decision claimed are let go: a call straight after is answered.
  assert.deepEqual(await say(chat, kim, "Studio, are you still there?"), ["Studio here."]);
});

test("on, a bot that is called answers and can't pass, by name, @-mention, reply or everyone; the others decide", async (context) => {
  const { knex, pat, kim, studio, chorus, calls, turns, chatOf, say } = await setup(context);
  const chat = await chatOf([pat, kim]);
  const turnsSince = (from) => turns.slice(from).map((turn) => [turn.bot, turn.mayPass, turn.prompt]);
  const decidedSince = (from) => calls.decisions.slice(from).map((decision) => decision.bot);

  let [at, decided] = [turns.length, calls.decisions.length];
  await say(chat, kim, "chorus, anything to add?");
  assert.deepEqual(turnsSince(at), [["Chorus", false, ""]], "named as a word, in any case: Chorus' turn may not pass");
  assert.deepEqual(decidedSince(decided), ["Studio"], "Studio, not called, decided; Chorus didn't");

  [at, decided] = [turns.length, calls.decisions.length];
  await say(chat, pat, `Could <@bot:${studio}> check the sketch?`);
  assert.deepEqual(turnsSince(at), [["Studio", false, ""]], "@-mentioned");
  assert.deepEqual(decidedSince(decided), ["Chorus"]);

  [at, decided] = [turns.length, calls.decisions.length];
  const chorusSaid = await knex("messages").where({ conversation_id: chat, author_bot_id: chorus }).orderBy("id").first();
  await say(chat, kim, "and for Saturday?", { replyTo: { id: String(chorusSaid.id) } });
  assert.deepEqual(turnsSince(at), [["Chorus", false, ""]], "replied to");
  assert.deepEqual(decidedSince(decided), ["Studio"]);

  [at, decided] = [turns.length, calls.decisions.length];
  await say(chat, pat, "<@everyone> morning");
  assert.deepEqual(turnsSince(at), [["Studio", false, ""], ["Chorus", false, ""]], "everyone: every bot answers");
  assert.deepEqual(decidedSince(decided), [], "and none decides");
  assert.equal(calls.judged.length, 0);
});

test("off, it's as before: only a bot that is called answers, and nothing else calls the model; alone, every bot answers", async (context) => {
  const { knex, pat, kim, studio, calls, turns, steer, chatOf, say } = await setup(context);
  const off = await chatOf([pat, kim], { botsJoinIn: false });
  steer.decide = () => "REPLY";
  const turnsSince = (from) => turns.slice(from).map((turn) => [turn.bot, turn.mayPass, turn.prompt]);

  assert.deepEqual(await say(off, kim, "Does anyone know a good plumber?"), [], "a message that calls no bot is left to the people");
  assert.deepEqual(await say(off, pat, "There is no real requirement about this one"), []);
  assert.equal(turns.length, 0);

  let at = turns.length;
  assert.deepEqual(await say(off, kim, "Chorus, does anyone know a good plumber?"), ["Chorus here."]);
  assert.deepEqual(turnsSince(at), [["Chorus", false, ""]], "named: that bot alone, which can't pass");
  at = turns.length;
  await say(off, pat, `Could <@bot:${studio}> check the sketch?`);
  assert.deepEqual(turnsSince(at), [["Studio", false, ""]], "@-mentioned");
  at = turns.length;
  const studioSaid = await knex("messages").where({ conversation_id: off, author_bot_id: studio }).orderBy("id").first();
  await say(off, kim, "and for Saturday?", { replyTo: { id: String(studioSaid.id) } });
  assert.deepEqual(turnsSince(at), [["Studio", false, ""]], "replied to");
  at = turns.length;
  await say(off, kim, "<@everyone> we're done here");
  assert.deepEqual(turnsSince(at), [["Studio", false, ""], ["Chorus", false, ""]], "everyone");

  for (const joinIn of [false, true]) {
    const alone = await chatOf([pat], { botsJoinIn: joinIn });
    at = turns.length;
    assert.deepEqual(await say(alone, pat, "Does anyone know a good plumber?"), ["Studio here.", "Chorus here."], `alone, ${joinIn ? "on" : "off"}: every bot (R3)`);
    assert.deepEqual(turnsSince(at), [["Studio", false, ""], ["Chorus", false, ""]], "none of which may pass");
  }
  assert.equal(calls.decisions.length, 0, "no bot decided anything");
  assert.equal(calls.judged.length, 0, "no judge");
});

test("on, a paused home decides nothing: a message that calls no bot gets nothing, a call the paused line as before", async (context) => {
  const { meter, pat, kim, calls, turns, chatOf, send, ask, knex } = await setup(context);
  const chat = await chatOf([pat, kim]);
  meter.pausedMessage = async () => "This home is paused.";
  const quiet = await send(chat, kim, "Anyone know a good plumber?");
  assert.deepEqual(await ask(chat, kim, quiet.id), []);
  assert.equal(await knex("messages").where({ conversation_id: chat }).andWhere("id", ">", quiet.id).first(), undefined, "not even the paused line");
  const called = await send(chat, kim, "Studio, are you there?");
  await ask(chat, kim, called.id);
  const lines = await knex("messages").where({ conversation_id: chat, kind: "event" }).andWhere("id", ">", called.id);
  assert.deepEqual(lines.map((line) => line.body.text), ["This home is paused."], "Studio, called, says the home is paused, once");
  assert.equal(calls.decisions.length, 0, "and Chorus decided nothing");
  assert.equal(turns.length, 0);
});

test("on, a decision that fails or answers in another shape stays quiet, and says so in the log without the conversation", async (context) => {
  const warn = context.mock.method(console, "warn", () => {});
  const { pat, kim, studio, chorus, calls, steer, turns, chatOf, say } = await setup(context);
  const chat = await chatOf([pat, kim]);
  for (const [answer, text] of [
    [new Error("The provider is down"), "What time is it in Tokyo?"],
    ["Sure, I'd answer that!", "Anyone fancy a coffee?"],
    ["{\"bot\": \"Studio\"}", "Who's got the keys?"]
  ]) {
    steer.decide = () => answer;
    assert.deepEqual(await say(chat, kim, text), []);
  }
  assert.equal(calls.decisions.length, 6, "each bot decided on each message");
  assert.equal(turns.length, 0, "and none took a turn");
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("stayed quiet"));
  const both = (why) => [studio, chorus].map((bot) => `Bot ${bot} stayed quiet in chat ${chat}: ${why}`);
  assert.deepEqual(lines, [
    ...both("its decision failed: The provider is down"),
    ...both("its decision came back in another shape."),
    ...both("its decision came back in another shape.")
  ]);
  assert.ok(!lines.some((line) => /Tokyo|coffee|keys/u.test(line)), "never with the conversation");
});

test("on, a message for a bot that is busy waits, and the bot decides on it once it's free", async (context) => {
  const { reply, drain, as, pat, kim, calls, turns, steer, chatOf, send } = await setup(context);
  const chat = await chatOf([pat, kim]);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  steer.reply = async (bot, prompt) => (prompt ? `${bot.name} here.` : held.then(() => `${bot.name} here.`));
  steer.decide = (bot, read) => (bot === "Studio" && />> \[Pat\]: .*rain/u.test(read) ? "REPLY" : "PASS");
  const called = await send(chat, kim, "Studio, can you plan Saturday?");
  const first = reply(chat, { afterMessageId: called.id }, undefined, as(kim));
  while (!turns.length) await new Promise((resolve) => setImmediate(resolve));

  const asked = await send(chat, pat, "Does anyone know if it'll rain on Saturday?");
  assert.equal((await reply(chat, { afterMessageId: asked.id }, undefined, as(pat))).pending, true, "Studio is still busy");
  release();
  await first;
  await drain();
  assert.deepEqual(turns.map((turn) => [turn.bot, turn.mayPass]), [["Studio", false], ["Studio", true]], "freed, Studio takes it up");
  assert.match(turns[1].prompt, /^\(The message "Does anyone know if it'll rain on Saturday\?" arrived while you were busy with the one before, so it hasn't been answered yet\. Nobody called you by name in it/u);
  assert.equal(turns[1].who.userId, pat, "for Pat, who wrote it");
  assert.equal(calls.decisions.filter((decision) => decision.bot === "Studio").length, 1, "having decided on it once, when it was free");
});

test("on, a call that comes while the bot decides on an earlier message is answered once it passes", async (context) => {
  const { reply, drain, as, pat, kim, calls, turns, steer, chatOf, send } = await setup(context);
  const chat = await chatOf([pat, kim]);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  // Studio's decision on Kim's chatter, the first, waits for the test; every other passes at once.
  steer.decide = () => (calls.decisions.length === 1 ? held.then(() => "PASS") : "PASS");
  const chatter = await send(chat, kim, "Lunch at one, Pat?");
  const first = reply(chat, { afterMessageId: chatter.id }, undefined, as(kim));
  for (let waited = 0; !calls.decisions.length && waited < 1000; waited += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls.decisions.map((decision) => decision.bot), ["Studio"], "Studio is deciding on Kim's chatter");

  const called = await send(chat, pat, "Studio, what's next?");
  assert.equal((await reply(chat, { afterMessageId: called.id }, undefined, as(pat))).pending, true, "Studio is deciding");
  release();
  await first;
  await drain();
  assert.deepEqual(turns.map((turn) => [turn.bot, turn.mayPass, turn.who.userId]), [["Studio", false, pat]], "having passed, Studio answers the call");
  assert.match(turns[0].prompt, /^\(The message "Studio, what's next\?" arrived while you were busy with the one before, so it hasn't been answered yet\. Answer it now\.\)$/u);
});

test("on, the reply path's statements are the same for a chat of 4 messages as for one of 40", async (context) => {
  const { knex, homeId, pat, kim, calls, chatOf, send, ask, drain } = await setup(context);
  const chatWith = async (count) => {
    const chat = await chatOf([pat, kim]);
    await seedMessages(knex, {
      homeId,
      chatId: chat,
      rows: Array.from({ length: count }, (_, at) => ({ userId: at % 2 ? pat : kim, body: { text: `Line ${at} of the chat`, authorName: at % 2 ? "Pat" : "Kim" } }))
    });
    return chat;
  };
  // Only the reply's statements: what the message itself left running (its bots' memories noticing it, D-113) ends first.
  const counted = async (chat) => {
    const message = await send(chat, pat, "Sounds good to me");
    await drain();
    return queriesDuring(knex, () => ask(chat, pat, message.id));
  };
  const short = await counted(await chatWith(3));
  const long = await counted(await chatWith(39));
  assert.equal(calls.decisions.length, 4, "both bots decided in both chats");
  assert.equal(long, short, "the same statements whatever the chat's length");
});

test("a decision reads a fraction of what a turn reads: no tools, a dozen lines, a word out", async (context) => {
  const { knex, homeId, pat, kim, calls, steer, chatOf, say } = await setup(context, { realTurns: true });
  const chat = await chatOf([pat, kim]);
  // A room that has talked a while: twenty lines before.
  await seedMessages(knex, {
    homeId,
    chatId: chat,
    rows: Array.from({ length: 20 }, (_, at) => ({ userId: at % 2 ? pat : kim, body: { text: `Line ${at}: the artwork for the spring fair needs a decision soon`, authorName: at % 2 ? "Pat" : "Kim" } }))
  });
  steer.turnText = () => "Question 4 of 6. What must never appear on the poster? Tell me which of those is wrong.";
  steer.decide = () => "PASS";
  assert.deepEqual(await say(chat, pat, "Studio, run me through the poster questionnaire"), [
    "Question 4 of 6. What must never appear on the poster? Tell me which of those is wrong."
  ]);
  const turn = calls.turns.find((call) => call.tools.length);
  assert.ok(turn, "Studio's turn called the model with its tools");
  const passed = calls.decisions.find((decision) => decision.bot === "Chorus");
  const measured = `Chorus' PASS decision read ${passed.tokens} tokens; Studio's turn read ${turn.tokens} (its prompt and tools, 4 characters a token, as the agent loop counts them).`;
  context.diagnostic(measured);
  console.log(measured);
  assert.deepEqual(passed.tools, [], "a decision has none");
  assert.ok(passed.tokens * 10 < turn.tokens, measured);
});

test("only the chat's maker and the home's owners and admins switch it, true or false, never in a direct chat", async (context) => {
  const { knex, chats, homeId, pat, kim, lee, studio, owner, as, chatOf } = await setup(context);
  const chat = await chatOf([pat, kim, lee], { madeBy: kim, botsJoinIn: false });
  const joinIn = async (chatId) => (await knex("conversations").where({ id: chatId }).first()).bots_join_in;

  await assert.rejects(chats.change(chat, { botsJoinIn: true }, as(lee)), { statusCode: 403, code: "bots_chat_manage_forbidden" }, "another member: refused");
  assert.equal(await joinIn(chat), false, "and nothing changed");
  await assert.rejects(chats.change(chat, { botsJoinIn: "yes" }, as(kim)), { statusCode: 400, code: "bots_join_in_invalid" }, "only true or false");

  const on = await chats.change(chat, { botsJoinIn: true }, as(kim));
  assert.equal(on.chat.botsJoinIn, true, "its maker switches it on, and the chat says so");
  assert.equal(on.chat.title, null, "a change of the switch alone leaves the title");
  assert.equal((await chats.change(chat, { botsJoinIn: false }, owner)).chat.botsJoinIn, false, "an owner switches it off");
  assert.equal(await joinIn(chat), false);
  assert.equal((await chats.change(chat, { title: "Plans" }, as(kim))).chat.botsJoinIn, false, "a rename leaves the switch");

  const { id: direct } = await seedChat(knex, { homeId, direct: { userId: pat, botId: studio }, bots: [studio] });
  await assert.rejects(chats.change(direct, { botsJoinIn: true }, owner), { statusCode: 409 }, "a direct chat has one person");
  assert.equal((await chats.get(chat, as(lee))).chat.botsJoinIn, false, "everyone in it reads the setting");
});

// Last: the migration changes every chat in this file's own copy of the test database.
test("a new chat starts on, and the migration turns it on for every chat made before (D-129)", async (context) => {
  const { knex, chats, pat, kim, studio, as, chatOf } = await setup(context);
  const room = await chatOf([pat, kim], { botsJoinIn: false });
  const alone = await chatOf([pat], { botsJoinIn: false });
  await require(MIGRATION).up(knex);
  const joinIn = async (chatId) => (await knex("conversations").where({ id: chatId }).first()).bots_join_in;
  assert.deepEqual([await joinIn(room), await joinIn(alone)], [true, true], "every chat made before is on");

  const { chat: made } = await chats.create({ title: "Artwork", people: [kim], bots: [studio] }, as(pat));
  assert.equal(made.botsJoinIn, true, "a room made as the app makes one starts on");
  assert.equal(await joinIn(made.id), true);
});
