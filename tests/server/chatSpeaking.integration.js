import assert from "node:assert/strict";
import test from "node:test";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "./turnKit.mjs";

// Who speaks in a chat (D-112, R3): with one person every bot answers in order, or only those @-mentioned; with
// several people a bot speaks only when it's named, @-mentioned, replied to or everyone is; a bot another bot mentions
// gets one follow-up turn, where PASS stays quiet; a chat with no bot makes no model call. Each bot reads the others'
// messages under their names (R5). Against the disposable test database, a scripted reply in place of the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/**
 * A home of Pat and Kim with Pat's bots Ada and Bo, and the turns, whose model is `answer(bot, timeline, prompt,
 * options)`: every call is kept in `calls`.
 */
async function setup(context, answer = (bot) => ({ text: `${bot.name} here.` })) {
  const calls = [];
  const kit = await startChatTurns(context, {
    reply: async (bot, timeline, _tools, _state, prompt, options) => {
      calls.push({ bot: bot.name, asker: bot.user_id, prompt, followUp: Boolean(options.followUp), timeline });
      return { transcript: [], ...(await answer(bot, timeline, prompt, options)) };
    }
  });
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [ada, bo] = await botsOf(kit, homeId, pat, ["Ada", "Bo"]);
  const chatWith = async (people) => (await seedChat(kit.knex, { homeId, people, bots: [ada, bo] })).id;
  /** `person` says `text` (with `extra` such as replyTo) and the bots answer; what they posted. */
  async function say(chatId, person, text, extra = {}) {
    const options = kit.as(person, homeId);
    const sent = await kit.turns.chat.sendMessage(chatId, { text, ...extra }, options);
    const answer = await kit.turns.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
    await kit.drain();
    return answer.pending ? [] : answer.messages.filter((message) => message.role === "bot" && message.kind === "text");
  }
  const spoke = (calls, from = 0) => calls.slice(from).map((call) => call.bot);
  return { ...kit, homeId, pat, kim, ada, bo, chatWith, say, calls, spoke };
}

test("with one person every bot answers in order, or only the bots mentioned", async (context) => {
  const { pat, ada, bo, chatWith, say, calls, spoke } = await setup(context);
  const chat = await chatWith([pat]);

  const both = await say(chat, pat, "Morning, what's on today?");
  assert.deepEqual(spoke(calls), ["Ada", "Bo"], "each bot its own turn, in the chat's order");
  assert.deepEqual(both.map((message) => [message.authorBotId, message.body.text]), [[ada, "Ada here."], [bo, "Bo here."]]);
  assert.ok(calls.every((call) => call.asker === pat), "each works for the person who wrote");

  const before = calls.length;
  const one = await say(chat, pat, `<@bot:${bo}> just you this time`);
  assert.deepEqual(spoke(calls, before), ["Bo"], "only the bot @-mentioned");
  assert.deepEqual(one.map((message) => message.authorBotId), [bo]);

  // Bo's turn read Ada's earlier reply as Ada's, and the person's under their name.
  const read = calls.at(-1).timeline;
  assert.ok(read.some((message) => message.authorBotId === ada && message.authorName === "Ada" && message.body.text === "Ada here."));
  assert.ok(read.some((message) => message.authorUserId === pat && message.authorName === "Pat"));
});

test("with several people a bot speaks only when named, mentioned, replied to or everyone is", async (context) => {
  const { pat, kim, ada, bo, chatWith, say, calls, spoke } = await setup(context);
  const chat = await chatWith([pat, kim]);

  assert.deepEqual(await say(chat, kim, "Pat, lunch at one?"), [], "people talking to each other");
  assert.equal(calls.length, 0, "make no model call");

  let at = calls.length;
  const named = await say(chat, kim, "ada, can you find a table for two?");
  assert.deepEqual(spoke(calls, at), ["Ada"], "named as a word, in any case");
  assert.equal(calls.at(-1).asker, kim, "and it works for Kim, who asked");
  assert.deepEqual(named.map((message) => message.authorBotId), [ada]);

  at = calls.length;
  await say(chat, pat, `Could <@bot:${bo}> check the weather?`);
  assert.deepEqual(spoke(calls, at), ["Bo"], "@-mentioned");
  assert.equal(calls.at(-1).asker, pat);

  at = calls.length;
  await say(chat, kim, "Thanks!", { replyTo: { id: named[0].id } });
  assert.deepEqual(spoke(calls, at), ["Ada"], "replied to");

  at = calls.length;
  await say(chat, kim, "<@everyone> we're done here");
  assert.deepEqual(spoke(calls, at), ["Ada", "Bo"], "everyone");
});

test("a bot another bot mentions gets one follow-up turn, and PASS posts nothing", async (context) => {
  let boAnswer = { text: "PASS", passed: true };
  const { pat, ada, bo, chatWith, say, calls } = await setup(context, (bot, _timeline, _prompt, options) => {
    if (bot.name === "Ada") return { text: "I'll leave the forecast to @Bo." };
    assert.equal(options.followUp, true, "Bo speaks only in the follow-up round here");
    return boAnswer;
  });
  const chat = await chatWith([pat]);

  const quiet = await say(chat, pat, `<@bot:${ada}> plan the picnic`);
  assert.deepEqual(calls.map((call) => [call.bot, call.followUp]), [["Ada", false], ["Bo", true]]);
  assert.match(calls[1].prompt, /Another bot just mentioned you/u);
  assert.deepEqual(quiet.map((message) => message.authorBotId), [ada], "Bo passed: nothing of his");
  assert.equal(quiet[0].body.text, `I'll leave the forecast to <@bot:${bo}>.`, "Ada's @Bo is stored as his mention");

  boAnswer = { text: "Sunny all afternoon." };
  const spoken = await say(chat, pat, `<@bot:${ada}> and the drinks?`);
  assert.deepEqual(spoken.map((message) => [message.authorBotId, message.body.text]).at(-1), [bo, "Sunny all afternoon."]);
  assert.equal(calls.length, 4, "one follow-up round, not a loop");
});

test("an archived bot never speaks, even to everyone or by name", async (context) => {
  const { knex, pat, kim, bo, chatWith, say, calls, spoke } = await setup(context);
  const chat = await chatWith([pat, kim]);
  await knex("bots").where({ id: bo }).update({ archived_at: knex.fn.now() });
  await say(chat, kim, "<@everyone> anyone free?");
  assert.deepEqual(spoke(calls), ["Ada"]);
  const at = calls.length;
  assert.deepEqual(await say(chat, kim, `Bo, are you there? <@bot:${bo}>`), []);
  assert.equal(calls.length, at, "no model call for it");
});

test("a chat with no bot makes no model call", async (context) => {
  const { knex, homeId, pat, kim, say, calls } = await setup(context);
  const { id: chat } = await seedChat(knex, { homeId, people: [pat, kim] });
  assert.deepEqual(await say(chat, pat, "Just us here"), []);
  assert.equal(calls.length, 0);
});

test("find in chat answers only the chat's people, then refuses a place that is no message and words too long", async (context) => {
  const { knex, turns, as, homeId, pat, kim, ada } = await setup(context);
  const { id: theirs } = await seedChat(knex, { homeId, kind: "private", people: [pat], bots: [ada] });
  const find = (input, person = pat) => turns.chat.findOlder(theirs, input, as(person, homeId));
  await assert.rejects(find({ q: "x", before: "nope" }, kim), { statusCode: 404 }, "someone outside a private chat learns nothing of it");
  await assert.rejects(find({ q: "x", before: "nope" }), { statusCode: 400, code: "bots_before_invalid" });
  await assert.rejects(find({ q: "x".repeat(201), before: "1" }), { statusCode: 400, code: "bots_find_too_long" });
  assert.deepEqual(await find({ q: "", before: "1" }), { count: 0, newest: null, oldest: null }, "no words, nothing found");
});
