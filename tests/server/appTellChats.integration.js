import assert from "node:assert/strict";
import test from "node:test";
import { createAppMessages } from "../../packages/bots/src/server/appMessages.js";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// An app's script telling a person something (D-147), the bots' side, on the test database: it lands in that person's
// own chat with the app's bot, made the first time and the same chat after, as the bot's message, unread for them and
// heard by their open pages; their answer is an ordinary message there. appsTell.integration.js has the apps' side.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a script's message to a person lands in their own chat with the app's bot, the same chat each time, unread for them", async (context) => {
  const heard = [];
  // The app's side of its bot's turn: an app gone from the home, so the bot replies as in any chat.
  const apps = { appBots: { forTurn: async () => null } };
  const kit = await startChatTurns(context, { reply: async (bot) => ({ text: `${bot.name} here.`, transcript: [] }), apps });
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [coach] = await botsOf(kit, homeId, pat, ["Coach"]);
  const notices = { publishEach: async (topic, keys, event) => heard.push({ topic, keys, event }) };
  const messages = createAppMessages({ records: kit.records, integrations: {}, env: { APP_ENV: "test" }, systemContext: kit.systemContext, notices });
  const call = { context: kit.systemContext("an app's job").forWorkspace(homeId) };
  const tell = (text) => messages.tellPerson(call, { appId: "a_learn", title: "Learn to program", botId: coach, userId: kim, text });

  const first = await tell("Your course is ready: 9 lessons.");
  const second = await tell("Lesson 4 is ready.");
  assert.equal(second, first, "the same chat");
  const chat = await kit.knex("conversations").where({ id: first }).first("kind", "bot_app_id", "made_by", "title");
  assert.deepEqual(chat, { kind: "private", bot_app_id: "a_learn", made_by: kim, title: "Learn to program" });
  const said = await kit.knex("messages").where({ conversation_id: first }).orderBy("id").select("role", "author_bot_id", "body");
  assert.deepEqual(said.map((row) => [row.role, String(row.author_bot_id), row.body.text]), [
    ["bot", coach, "Your course is ready: 9 lessons."],
    ["bot", coach, "Lesson 4 is ready."]
  ]);
  assert.equal((await kit.chats.get(first, memberOptions({ userId: kim, homeId }))).chat.place.unread, true, "unread for Kim");
  // The app's chat button shows it: Kim's chat has news; Pat, who has no chat with the app's bot, has none.
  assert.deepEqual(await kit.records.chats.appBotChatNews({ appId: "a_learn" }, memberOptions({ userId: kim, homeId })), { chatId: first, unread: true });
  assert.equal(await kit.records.chats.appBotChatNews({ appId: "a_learn" }, memberOptions({ userId: pat, homeId })), null);
  assert.deepEqual(heard.at(-1), { topic: "bots", keys: [kim], event: { type: "messages", chatId: first } }, "Kim's open pages hear of it");
  await assert.rejects(kit.chats.get(first, memberOptions({ userId: pat, homeId })), (error) => error.statusCode === 404, "Pat can't open Kim's");

  // Kim answers there: an ordinary message to the bot, which replies.
  const sent = await kit.turns.chat.sendMessage(first, { text: "Thanks! What's in lesson 4?" }, memberOptions({ userId: kim, homeId }));
  const replied = await kit.turns.chat.reply(first, { afterMessageId: sent.messages.at(-1).id }, undefined, memberOptions({ userId: kim, homeId }));
  await kit.drain();
  assert.equal(replied.messages.at(-1).body.text, "Coach here.");
});
