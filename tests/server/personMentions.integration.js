import assert from "node:assert/strict";
import test from "node:test";
import { previewOf } from "../../packages/bots/src/server/botRows.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// @-mentioning people in chats (D-114, B3): a person's message that mentions another person of the chat
// (<@person:ID>) keeps them on the message by name, and the mention waits for them as the chat list's "@" (their
// place's `mentioned`) until they read the chat; a later mention keeps the first one's time. Only the chat's other
// people are mentioned: the author, someone of the home who isn't in the chat, anyone of another home and an id that
// is no one mark nobody and read as "@someone". The writes are one UPDATE whoever is mentioned, and the chat list reads
// the "@" with its places. Against the disposable test database; no bot is asked to answer.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A home of Anna, Ben, Carla and Dario, Anna's bot Chef, and the turns. */
async function setup(context) {
  const kit = await startChatTurns(context);
  const { homeId, people: [anna, ben, carla, dario] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla", "Dario"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const as = (person) => kit.as(person, homeId);
  /** `person` writes `text` in a chat; the message as stored. */
  async function say(chatId, person, text) {
    const sent = await kit.turns.chat.sendMessage(chatId, { text }, as(person));
    return sent.messages.at(-1);
  }
  const place = async (chatId, person) => (await kit.chats.get(chatId, as(person))).chat.place;
  const mentionedAt = async (chatId, person) =>
    (await kit.knex("chat_people").where({ conversation_id: chatId, user_id: person }).first("mentioned_at"))?.mentioned_at ?? null;
  return { ...kit, homeId, anna, ben, carla, dario, chef, as, say, place, mentionedAt };
}

test("a person mentioned in a chat has it waiting as the chat's \"@\" until they read it", async (context) => {
  const { knex, chats, homeId, anna, ben, carla, chef, as, say, place, mentionedAt } = await setup(context);
  const kitchen = (await seedChat(knex, { homeId, kind: "public", title: "Kitchen", people: [anna, ben, carla], bots: [chef] })).id;
  const plans = (await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna, ben] })).id;

  const asked = await say(kitchen, anna, `<@person:${ben}> oak or walnut?`);
  assert.deepEqual(asked.body.mentionedPeople, [{ id: ben, name: "Ben" }], "kept on the message by name");
  assert.equal(previewOf({ kind: "text", body: asked.body }), "@Ben oak or walnut?", "and it reads with the name");
  assert.deepEqual([(await place(kitchen, ben)).mentioned, (await place(kitchen, anna)).mentioned, (await place(kitchen, carla)).mentioned],
    [true, false, false], "only Ben has it waiting: not the author, not someone else in the chat");
  const listed = (await chats.list({}, as(ben))).chats;
  assert.deepEqual(listed.map((chat) => [chat.id, chat.place.mentioned]).sort(), [[kitchen, true], [plans, false]].sort(), "his chat list shows it");

  // A later mention keeps the first one's time: the "@" has waited since then.
  const first = await mentionedAt(kitchen, ben);
  assert.ok(first instanceof Date);
  const again = await say(kitchen, carla, `<@person:${ben}> and the handles?`);
  assert.equal((await mentionedAt(kitchen, ben)).getTime(), first.getTime());

  // Reading the chat clears it, as it clears unread; marking it read from the list does too.
  await chats.markRead(kitchen, again.id, as(ben));
  assert.deepEqual([(await place(kitchen, ben)).mentioned, await mentionedAt(kitchen, ben)], [false, null]);
  await say(kitchen, anna, `Still waiting, <@person:${ben}>`);
  assert.equal((await place(kitchen, ben)).mentioned, true);
  assert.equal((await chats.changePlace(kitchen, { unread: false }, as(ben))).chat.place.mentioned, false);
  // Marking a chat unread again doesn't make a mention up.
  assert.equal((await chats.changePlace(kitchen, { unread: true }, as(ben))).chat.place.mentioned, false);

  // In a private chat the same, for its people.
  await say(plans, ben, `<@person:${anna}> Saturday?`);
  assert.equal((await place(plans, anna)).mentioned, true);
});

test("only the chat's other people are mentioned: no one else is marked, or named", async (context) => {
  const { knex, cleanup, chats, homeId, anna, ben, carla, dario, chef, as, say, place } = await setup(context);
  const kitchen = (await seedChat(knex, { homeId, kind: "public", title: "Kitchen", people: [anna, ben], bots: [chef] })).id;
  const secret = (await seedChat(knex, { homeId, kind: "private", title: "Surprise", people: [anna, ben] })).id;
  const { people: [stranger] } = await homeOfPeople({ knex, cleanup }, ["Stranger"]);

  // Each breaking input on its own: herself, Carla (in the home, not in the chat), someone of another home, no one.
  for (const [who, why] of [[anna, "the author herself"], [carla, "someone of the home not in the chat"], [stranger, "someone of another home"], ["987654321", "an id that is no one"]]) {
    const sent = await say(kitchen, anna, `<@person:${who}> look`);
    assert.equal(sent.body.mentionedPeople, undefined, why);
    assert.equal(previewOf({ kind: "text", body: sent.body }), "@someone look", `${why} reads as @someone`);
  }
  assert.equal((await place(kitchen, anna)).mentioned, false, "Anna isn't marked by her own mention");
  assert.equal((await place(kitchen, carla)), null, "Carla has no place in Kitchen, so nothing waits for her there");
  const [carlaRows, strangerRows] = await Promise.all([carla, stranger].map((person) => knex("chat_people").where({ user_id: person, workspace_id: homeId })));
  assert.deepEqual([carlaRows, strangerRows], [[], []], "and no one was added to the chat by a mention");

  // A private chat's mention of someone not in it neither marks them nor lets them see it.
  await say(secret, anna, `<@person:${carla}> is coming`);
  await assert.rejects(chats.get(secret, as(carla)), { statusCode: 404 });
  assert.deepEqual((await chats.list({}, as(carla))).chats.map((chat) => chat.id), []);

  // Someone reading a public chat they aren't in writes nothing there, mentions included (403 join first).
  await assert.rejects(say(kitchen, dario, `<@person:${anna}> hi`), { statusCode: 403, code: "bots_chat_join_first" });
  assert.equal((await place(kitchen, anna)).mentioned, false);
});

test("a mention's writes are one statement whoever is named, and the list reads the \"@\" with its places", async (context) => {
  const { knex, chats, homeId, anna, ben, carla, dario, as, say, place } = await setup(context);
  const pair = (await seedChat(knex, { homeId, kind: "public", title: "Two", people: [anna, ben] })).id;
  const four = (await seedChat(knex, { homeId, kind: "public", title: "Four", people: [anna, ben, carla, dario] })).id;
  await say(pair, anna, "warm up");
  await say(four, anna, "warm up");
  const marking = { matching: /update "chat_people"[\s\S]*"mentioned_at"/iu };
  const one = await queriesDuring(knex, () => say(pair, anna, `<@person:${ben}> one`));
  let updates = 0;
  const three = await queriesDuring(knex, async () => {
    updates = await queriesDuring(knex, () => say(four, anna, `<@person:${ben}> <@person:${carla}> <@person:${dario}> three`), marking);
  });
  assert.equal(three, one, "mentioning three people costs what mentioning one does");
  assert.equal(updates, 1, "one UPDATE marks all three");
  assert.deepEqual(await Promise.all([ben, carla, dario].map(async (person) => (await place(four, person)).mentioned)), [true, true, true]);

  // The list reads the same statements with a mention waiting as without one.
  const quiet = await queriesDuring(knex, () => chats.list({}, as(anna)));
  const mentioned = await queriesDuring(knex, () => chats.list({}, as(ben)));
  assert.equal(mentioned, quiet);
});
