import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { createMeter, currentWork } from "../../packages/account/src/server/meter.js";
import { queriesDuring } from "../support/queryCount.mjs";
import { seedChat, seedMessages } from "../support/chatFixtures.mjs";
import { FREE_RECORDER, botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// Bots join in when useful (D-115), against the disposable test database, each test in a home of its own: in a chat of
// several people with the chat's setting on, a person's message that calls no bot goes through one judging call (here a
// stand-in model that answers what the test says and records what it was asked, and for whom), which names at most one
// bot: that bot answers, metered as its own turn; a null leaves nothing, marked so nothing takes it up again; a call is
// always answered unjudged; off, or with one person, nothing is judged; only the chat's maker and the home's owners and
// admins switch it; a judge that fails stays quiet; two pages at once still let only one bot in; and the statements
// don't grow with the chat.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];

/** What one judging call was given: its instructions, the conversation, its options and whose work it ran in. */
function judgeOf(options, meter) {
  const system = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const user = options.prompt.filter((message) => message.role === "user").flatMap((message) => message.content)
    .map((part) => part.text || "").join("");
  return { system, user, providerOptions: options.providerOptions, maxOutputTokens: options.maxOutputTokens, who: meter.currentMeter(), work: currentWork() };
}

/**
 * A home of Pat (its owner), Kim and Lee, with Pat's bots Ada and Bo; the turns, whose replies say "<Name> here." and
 * record whose work they ran as; and the judge the test steers (`judging.answer`: its text, an Error to fail, or a
 * function of the call's number answering either). `news` is every event sent to open pages.
 */
async function setup(context) {
  const meter = { ...createMeter({ recorder: FREE_RECORDER }), pausedMessage: async () => null };
  const judging = { answer: "{\"bot\": null}", calls: [] };
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const call = judgeOf(options, meter);
      const judgement = call.system.startsWith("You decide whether ");
      if (judgement) judging.calls.push(call);
      const answer = typeof judging.answer === "function" ? await judging.answer(judging.calls.length) : judging.answer;
      if (judgement && answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: judgement ? answer : "Noted." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  const turns = [];
  const news = [];
  // What a bot says: "<Name> here.", unless the test steers it (a promise holds it busy).
  const steer = { reply: async (bot) => `${bot.name} here.` };
  const kit = await startChatTurns(context, {
    meter,
    model,
    notices: { publishEach: async (_topic, _people, event) => news.push(event) },
    reply: async (bot, _timeline, _tools, _state, prompt) => {
      turns.push({ bot: bot.name, prompt, who: meter.currentMeter(), work: currentWork() });
      return { text: await steer.reply(bot, prompt), transcript: [] };
    }
  });
  const { homeId, people: [pat, kim, lee] } = await homeOfPeople(kit, ["Pat", "Kim", "Lee"]);
  const [ada, bo] = await botsOf(kit, homeId, pat, ["Ada", "Bo"]);
  const owner = memberOptions({ userId: pat, homeId, role: "owner", permissions: MANAGE });
  const as = (person) => (person === pat ? owner : kit.as(person, homeId));
  const chatOf = async (people, extra = {}) => (await seedChat(kit.knex, { homeId, people, bots: [ada, bo], botsJoinIn: true, ...extra })).id;
  /** `person` says `text` (with `extra` such as replyTo); the message sent. */
  const send = async (chatId, person, text, extra = {}) => (await kit.turns.chat.sendMessage(chatId, { text, ...extra }, as(person))).messages.at(-1);
  /** The page asks for the reply, and the background work finishes; the bots' texts it answered with. */
  async function ask(chatId, person, afterMessageId) {
    const answer = await kit.turns.chat.reply(chatId, { afterMessageId }, undefined, as(person));
    await kit.drain();
    return answer.pending ? [] : answer.messages.filter((message) => message.role === "bot" && message.kind === "text").map((message) => message.body.text);
  }
  const say = async (chatId, person, text, extra) => ask(chatId, person, (await send(chatId, person, text, extra)).id);
  const bodyOf = async (messageId) => (await kit.knex("messages").where({ id: messageId }).first()).body;
  const reply = kit.turns.chat.reply;
  return { ...kit, meter, judging, turns, steer, news, homeId, pat, kim, lee, ada, bo, owner, as, chatOf, send, ask, say, bodyOf, reply };
}

test("on, a message that calls no bot is judged once; the one bot it names answers, as its own turn", async (context) => {
  const { homeId, pat, kim, bo, judging, turns, chatOf, send, ask, say, bodyOf } = await setup(context);
  const chat = await chatOf([pat, kim]);
  await say(chat, kim, "Morning, everyone");
  assert.deepEqual([judging.calls.length, turns.length], [1, 0], "people greeting each other: judged, and nobody joins");

  judging.answer = "```json\n{\"bot\": \"bo\"}\n```";
  const asked = await send(chat, pat, "Does anyone know when the hardware shop opens on Sundays?");
  assert.deepEqual(await ask(chat, pat, asked.id), ["Bo here."], "the bot named, in any case and in a code fence, answers");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Bo"], "only that one: never more than one per message");
  assert.deepEqual(turns[0].who, { userId: pat, botId: bo, workspaceId: homeId, work: "chat" }, "its turn on its own ticket, for Pat");

  assert.equal(judging.calls.length, 2, "one judging call per message");
  const judged = judging.calls[1];
  assert.deepEqual(judged.who, { userId: pat, botId: null, workspaceId: homeId, work: "chat" }, "the judge is Pat's chat work, no bot's");
  assert.equal(judged.work, "chat");
  assert.equal(judged.providerOptions?.deepseek?.thinking?.type, "disabled", "without reasoning");
  assert.ok(judged.maxOutputTokens <= 40, "a few tokens out");
  assert.match(judged.system, /^You decide whether one of the bots in a shared conversation should answer the latest message, and which one\./u);
  assert.match(judged.system, /^- Ada: An all-round helper/mu, "each bot with its job, its template's description or else the general one");
  assert.match(judged.system, /^- Bo: An all-round helper/mu);
  assert.match(judged.system, /When unsure, answer null\.$/u);
  assert.deepEqual(judged.user.split("\n"), [
    "The conversation, oldest first; decide on the last message:",
    "[Kim]: Morning, everyone",
    "[Pat]: Does anyone know when the hardware shop opens on Sundays?"
  ], "the chat's text messages, oldest first, each under its author's name, the one decided on last");
  assert.equal((await bodyOf(asked.id)).judged, bo, "the judgement is kept on the message");
});

test("a null judgement posts nothing and sends no working line; the message is marked, and nothing judges or takes it up again", async (context) => {
  const { pat, kim, judging, turns, news, chatOf, send, ask, say, bodyOf } = await setup(context);
  const chat = await chatOf([pat, kim]);
  news.length = 0;
  const chatter = await send(chat, kim, "Yes, see you at seven.");
  const before = news.length;
  assert.deepEqual(await ask(chat, kim, chatter.id), []);
  assert.deepEqual([judging.calls.length, turns.length], [1, 0]);
  assert.ok(!news.slice(before).some((event) => event.type === "working"), "no bot was shown working");
  assert.equal((await bodyOf(chatter.id)).judged, "quiet");

  // The page asks again (D-19), and a bot freed later looks for what's waiting: neither judges it again.
  assert.deepEqual(await ask(chat, kim, chatter.id), []);
  await say(chat, pat, "Ada, what's the forecast?");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada"], "a call later is answered, and the quiet message isn't taken up");
  assert.equal(judging.calls.length, 1, "never judged twice");
});

test("a call is always answered, never judged: the name, an @-mention, a reply to the bot, everyone", async (context) => {
  const { knex, pat, kim, ada, bo, judging, turns, chatOf, say } = await setup(context);
  const chat = await chatOf([pat, kim]);
  judging.answer = "{\"bot\": \"Bo\"}";
  await say(chat, kim, "ada, can you find a table for two?");
  await say(chat, kim, `Could <@bot:${bo}> check the weather?`);
  await say(chat, pat, "<@everyone> morning");
  const adaSaid = await knex("messages").where({ conversation_id: chat, author_bot_id: ada }).orderBy("id").first();
  await say(chat, kim, "and for Saturday?", { replyTo: { id: String(adaSaid.id) } });
  assert.equal(judging.calls.length, 0, "no judging call");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada", "Bo", "Ada", "Bo", "Ada"], "the bots called, and only they");
});

test("off, or with one person in the chat, nothing is judged: a call is answered, and alone every bot answers", async (context) => {
  const { pat, kim, judging, turns, chatOf, say } = await setup(context);
  const off = await chatOf([pat, kim], { botsJoinIn: false });
  judging.answer = "{\"bot\": \"Ada\"}";
  assert.deepEqual(await say(off, kim, "Does anyone know a good plumber?"), [], "off: a message that calls no bot is left to the people");
  assert.deepEqual(await say(off, kim, "Bo, does anyone know a good plumber?"), ["Bo here."]);

  const alone = await chatOf([pat]);
  assert.deepEqual(await say(alone, pat, "Does anyone know a good plumber?"), ["Ada here.", "Bo here."], "one person: every bot, unjudged (R3)");
  assert.equal(judging.calls.length, 0, "no judging call in either");
  assert.equal(turns.length, 3);
});

test("only the chat's maker and the home's owners and admins switch it, true or false, never in a direct chat", async (context) => {
  const { knex, chats, homeId, pat, kim, lee, ada, owner, as, chatOf } = await setup(context);
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

  const { id: direct } = await seedChat(knex, { homeId, direct: { userId: pat, botId: ada }, bots: [ada] });
  await assert.rejects(chats.change(direct, { botsJoinIn: true }, owner), { statusCode: 409 }, "a direct chat has one person");
  assert.equal((await chats.get(chat, as(lee))).chat.botsJoinIn, false, "everyone in it reads the setting");
});

test("a judge that fails, answers in another shape or names no bot of the chat stays quiet, and says so in the log", async (context) => {
  const warn = context.mock.method(console, "warn", () => {});
  const { pat, kim, judging, turns, chatOf, send, ask, bodyOf } = await setup(context);
  const chat = await chatOf([pat, kim]);
  const quiet = [];
  for (const [answer, text] of [
    [new Error("The provider is down"), "What time is it in Tokyo?"],
    ["Sure, I'd answer that!", "Anyone fancy a coffee?"],
    ["{\"bot\": \"Zed\"}", "Who's got the keys?"]
  ]) {
    judging.answer = answer;
    const message = await send(chat, kim, text);
    assert.deepEqual(await ask(chat, kim, message.id), []);
    quiet.push((await bodyOf(message.id)).judged);
  }
  assert.equal(turns.length, 0, "nothing ran");
  assert.deepEqual(quiet, ["quiet", "quiet", "quiet"]);
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("stayed quiet"));
  assert.deepEqual(lines, [
    `Chat ${chat}'s bots stayed quiet: their judgement failed: The provider is down`,
    `Chat ${chat}'s bots stayed quiet: their judgement came back in another shape.`,
    `Chat ${chat}'s bots stayed quiet: their judgement came back in another shape.`
  ]);
  assert.ok(!lines.some((line) => /Tokyo|coffee|keys/u.test(line)), "never with the conversation");
});

test("a paused home judges nothing, and a burst of three messages gets one judgement, on the latest", async (context) => {
  const { meter, pat, kim, ada, judging, turns, chatOf, send, ask, bodyOf } = await setup(context);
  const chat = await chatOf([pat, kim]);
  meter.pausedMessage = async () => "This home is paused.";
  const paused = await send(chat, kim, "Anyone know a good plumber?");
  await ask(chat, kim, paused.id);
  assert.equal(judging.calls.length, 0, "paused: no judging call");
  assert.equal((await bodyOf(paused.id)).judged, undefined, "and no mark");

  meter.pausedMessage = async () => null;
  judging.answer = "{\"bot\": \"Ada\"}";
  const first = await send(chat, kim, "Right, plans for Saturday");
  await send(chat, pat, "I can do the morning");
  const latest = await send(chat, kim, "What's the forecast for Saturday? Anyone?");
  assert.deepEqual(await ask(chat, kim, first.id), ["Ada here."]);
  assert.equal(judging.calls.length, 1, "one judgement");
  assert.match(judging.calls[0].user, /\[Kim\]: What's the forecast for Saturday\? Anyone\?$/u, "on the latest");
  assert.equal((await bodyOf(latest.id)).judged, ada);
  assert.equal(turns.length, 1, "and nothing is left to take up");
});

test("two pages asking at once: of two judgements the first kept stands, so only one bot joins in", async (context) => {
  const { reply, drain, as, pat, kim, bo, judging, turns, chatOf, send, bodyOf } = await setup(context);
  const chat = await chatOf([pat, kim]);
  // The first judgement (Ada) is slow; the second (Bo) is kept first, and the first then reads it.
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  judging.answer = async (number) => {
    if (number === 1) {
      await slow;
      return "{\"bot\": \"Ada\"}";
    }
    return "{\"bot\": \"Bo\"}";
  };
  const asked = await send(chat, kim, "Does anyone know when the pool opens?");
  const texts = (answer) => answer.messages.filter((message) => message.role === "bot").map((message) => message.body.text);
  const first = reply(chat, { afterMessageId: asked.id }, undefined, as(kim));
  while (judging.calls.length < 1) await new Promise((resolve) => setImmediate(resolve));
  const second = await reply(chat, { afterMessageId: asked.id }, undefined, as(pat));
  assert.deepEqual(texts(second), ["Bo here."], "the second page's judgement, kept first, lets Bo in");
  release();
  assert.deepEqual(texts(await first), ["Bo here."], "the first page reads the mark that stands and finds it answered");
  await drain();
  assert.equal(judging.calls.length, 2, "both pages judged");
  assert.equal((await bodyOf(asked.id)).judged, bo, "the mark kept first stands");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Bo"], "and only Bo joined in: Ada never ran");
});

test("the reply path's statements are the same for a chat of 4 messages as for one of 40", async (context) => {
  const { knex, homeId, pat, kim, judging, chatOf, send, ask } = await setup(context);
  const chatWith = async (count) => {
    const chat = await chatOf([pat, kim]);
    await seedMessages(knex, {
      homeId,
      chatId: chat,
      rows: Array.from({ length: count }, (_, at) => ({ userId: at % 2 ? pat : kim, body: { text: `Line ${at} of the chat`, authorName: at % 2 ? "Pat" : "Kim", judged: "quiet" } }))
    });
    return chat;
  };
  const counted = async (chat) => {
    const message = await send(chat, pat, "Sounds good to me");
    return queriesDuring(knex, () => ask(chat, pat, message.id));
  };
  const short = await counted(await chatWith(3));
  const long = await counted(await chatWith(39));
  assert.equal(judging.calls.length, 2, "both judged");
  assert.equal(long, short, "the same statements whatever the chat's length");
});

test("a message judged for a bot that is busy waits, and the bot answers it once it's free", async (context) => {
  const { reply, drain, as, pat, kim, ada, judging, turns, steer, chatOf, send, bodyOf } = await setup(context);
  const chat = await chatOf([pat, kim]);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  steer.reply = (bot, prompt) => (prompt ? `${bot.name} here.` : held.then(() => `${bot.name} here.`));
  const called = await send(chat, kim, "Ada, can you plan Saturday?");
  const first = reply(chat, { afterMessageId: called.id }, undefined, as(kim));
  while (!turns.length) await new Promise((resolve) => setImmediate(resolve));

  judging.answer = "{\"bot\": \"Ada\"}";
  const asked = await send(chat, pat, "Does anyone know if it'll rain on Saturday?");
  assert.equal((await reply(chat, { afterMessageId: asked.id }, undefined, as(pat))).pending, true, "Ada is still busy");
  assert.equal((await bodyOf(asked.id)).judged, ada, "judged for Ada");
  release();
  await first;
  await drain();
  assert.deepEqual(turns.map((turn) => turn.bot), ["Ada", "Ada"], "freed, Ada takes up the message judged for her");
  assert.match(turns[1].prompt, /^\(The message "Does anyone know if it'll rain on Saturday\?" arrived while you were busy/u);
  assert.equal(turns[1].who.userId, pat, "for Pat, who wrote it");
  assert.equal(judging.calls.length, 1, "judged once");
});
