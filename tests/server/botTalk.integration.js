import assert from "node:assert/strict";
import test from "node:test";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// Bots talking to each other in a chat (R3, D-124): a bot that's in the chat is never asked privately (ask_bot,
// message_bot, a pass), only mentioned, and a bot another bot @-mentions answers it there, round after round. After 5
// replies from one bot to another with no person writing, the bot that would have answered says once, plainly, "We
// need you to go on: …", with no model call; anything a person writes in the chat, to anyone, lets them carry on.
// Against the disposable test database, a scripted reply in place of the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A home of Pat and Kim with Pat's bots Ada, Bo and Cy; `answer(bot, tools, prompt, options)` is the model. */
async function setup(context, answer) {
  const calls = [];
  const kit = await startChatTurns(context, {
    reply: async (bot, _timeline, tools, _state, prompt, options) => {
      calls.push({ bot: bot.name, prompt, followUp: Boolean(options.followUp) });
      return { transcript: [], ...(await answer(bot, tools, prompt, options)) };
    }
  });
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [ada, bo, cy] = await botsOf(kit, homeId, pat, ["Ada", "Bo", "Cy"]);
  /** `person` says `text` in `chatId` and the bots answer. */
  async function say(chatId, person, text) {
    const options = kit.as(person, homeId);
    const sent = await kit.turns.chat.sendMessage(chatId, { text }, options);
    await kit.turns.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
    await kit.drain();
  }
  const botLines = (chatId) => kit.knex("messages").where({ conversation_id: chatId, role: "bot", kind: "text" }).orderBy("id");
  return { ...kit, homeId, pat, kim, ada, bo, cy, calls, say, botLines };
}

test("a bot that's in the chat is mentioned, never asked privately; one that isn't is asked as before", async (context) => {
  const answers = [];
  let asks = [];
  const { knex, homeId, pat, bo, ada, say } = await setup(context, async (bot, tools) => {
    for (const [tool, input] of asks) answers.push(await tools[tool].execute(input));
    asks = [];
    return { text: "Done." };
  });
  const { id: chat } = await seedChat(knex, { homeId, people: [pat], bots: [ada, bo] });

  asks = [["askBot", { bot: "Bo", brief: "Add up the receipts." }], ["messageBot", { bot: "bo", task: "Build the cats table." }]];
  await say(chat, pat, `<@bot:${ada}> get Bo on it`);
  assert.deepEqual(answers.map((answer) => answer.error), [
    "Bo is in this chat: mention it (@Bo) so it answers here.",
    "Bo is in this chat: mention it (@Bo) so it answers here."
  ]);
  assert.equal((await knex("bot_requests").where({ conversation_id: chat })).length, 0, "no request, no card");

  // Cy isn't in the chat: asked privately, as before.
  asks = [["askBot", { bot: "Cy", brief: "Find the vet's opening hours." }]];
  await say(chat, pat, `<@bot:${ada}> and ask Cy`);
  assert.equal(answers.at(-1).status, "asked");
  assert.equal((await knex("bot_requests").where({ conversation_id: chat })).length, 1);
});

test("a bot's @-mention makes the mentioned bot answer it in the chat", async (context) => {
  const { knex, homeId, pat, ada, bo, calls, say, botLines } = await setup(context, (bot) =>
    (bot.name === "Ada" ? { text: "@Bo, can you check the forecast?" } : { text: "Sunny all afternoon." }));
  const { id: chat } = await seedChat(knex, { homeId, people: [pat], bots: [ada, bo] });

  await say(chat, pat, `<@bot:${ada}> plan the picnic`);
  assert.deepEqual(calls.map((call) => [call.bot, call.followUp]), [["Ada", false], ["Bo", true]]);
  assert.match(calls[1].prompt, /^\(Ada just mentioned you here\./u);
  const lines = await botLines(chat);
  assert.deepEqual(lines.map((line) => [String(line.author_bot_id), line.body.text, line.body.answersBot ?? null]), [
    [ada, `<@bot:${bo}>, can you check the forecast?`, null],
    [bo, "Sunny all afternoon.", ada]
  ], "Bo's answer is there in the chat, a reply to Ada");
});

test("after 5 bot-to-bot replies the next bot says plainly, once, that a person is needed; any person's message resets it", async (context) => {
  const { knex, homeId, pat, kim, ada, bo, calls, say, botLines, turns, as, drain } = await setup(context, (bot) =>
    (bot.name === "Ada" ? { text: "@Bo, what about drinks?" } : { text: "Lemonade. @Ada, shall we add cake?" }));
  const { id: chat } = await seedChat(knex, { homeId, people: [pat, kim], bots: [ada, bo] });
  const handedBack = async () => (await botLines(chat)).filter((line) => line.body.handBack);
  /** Ada's card for Pat, answered: after it, Ada speaks again, with no new message from a person. */
  async function afterCard() {
    await seedMessage(knex, { homeId, chatId: chat, kind: "choice", botId: ada, body: { question: "Which park?", options: ["North", "South"], chosen: "North", for: { id: pat, name: "Pat" } } });
    await turns.chat.reply(chat, { afterCard: true }, undefined, as(pat, homeId));
    await drain();
  }

  // Ada answers Pat, then 5 replies between the bots, each a model call; the 6th is the plain line, with none.
  await say(chat, pat, `<@bot:${ada}> plan the picnic`);
  assert.deepEqual(calls.map((call) => call.bot), ["Ada", "Bo", "Ada", "Bo", "Ada", "Bo"]);
  let lines = await botLines(chat);
  assert.equal(lines.filter((line) => line.body.answersBot).length, 5);
  assert.deepEqual([String(lines.at(-1).author_bot_id), lines.at(-1).body.text], [ada, "We need you to go on: shall we add cake?"]);
  assert.equal(lines.at(-1).body.text.includes("<@"), false, "the line mentions no bot, so none answers it");

  // Ada speaks again after a card, mentioning Bo, with still no person writing: Bo doesn't run, and the line isn't repeated.
  await afterCard();
  assert.deepEqual(calls.slice(6).map((call) => call.bot), ["Ada"]);
  assert.equal((await handedBack()).length, 1);

  // Kim writes to Pat, not to the bots: no bot speaks, but the bots may carry on after it.
  await say(chat, kim, "Pat, are you free on Saturday?");
  assert.equal(calls.length, 7, "people talking to each other make no model call");
  await afterCard();
  assert.deepEqual(calls.slice(7).map((call) => call.bot), ["Ada", "Bo", "Ada", "Bo", "Ada", "Bo"]);
  lines = await handedBack();
  assert.equal(lines.length, 2, "a new run of 5 ends with the line again");
});
