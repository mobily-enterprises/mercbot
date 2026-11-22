import assert from "node:assert/strict";
import test from "node:test";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";

// Reactions on people's messages as on the bots' (D-114, B3): anyone in a chat reacts to another person's message or a
// bot's with one of the quick reactions, one each, which they change or take away, and several people reacting at once
// each keep theirs. Nobody reacts to their own message or to Mercbot's lines, with a reaction that isn't one of the
// quick ones, to a message of another chat, or in a chat they aren't in (the chat routes' guard answers a chat the
// caller can't open with a 404 first, botsRouteGuard.test.js). Against the disposable test database.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("people react to each other's messages, one reaction each, and none is lost when they react at once", async (context) => {
  const kit = await startChatTurns(context);
  const { knex, turns } = kit;
  const { homeId, people } = await homeOfPeople(kit, ["Anna", "Ben", "Carla", "Dario", "Eva", "Finn"]);
  const [anna, ben, carla, dario, eva] = people;
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const as = (person) => kit.as(person, homeId);
  const kitchen = (await seedChat(knex, { homeId, kind: "public", title: "Kitchen", people: [anna, ben, carla, dario, eva], bots: [chef] })).id;
  const asked = await seedMessage(knex, { homeId, chatId: kitchen, userId: anna, body: { text: "Oak or walnut?", authorName: "Anna" } });
  const answered = await seedMessage(knex, { homeId, chatId: kitchen, botId: chef, body: { text: "Oak.", authorName: "Chef" } });
  const react = (person, messageId, emoji) => turns.chat.react(kitchen, messageId, emoji, as(person));
  const reactionsOf = async (messageId) => (await knex("messages").where({ id: messageId }).first("body")).body.reactions || {};

  // Four people at once on Anna's message, each with their own.
  const picks = [[ben, "👍"], [carla, "❤️"], [dario, "🎉"], [eva, "👀"]];
  const answers = await Promise.all(picks.map(([person, emoji]) => react(person, asked, emoji)));
  assert.deepEqual(answers.map((answer) => answer.messages[0].id), picks.map(() => asked), "each answers the message");
  assert.deepEqual(await reactionsOf(asked), Object.fromEntries(picks.map(([person, emoji]) => [`user:${person}`, emoji])), "every one stays");
  // Ben changes his, then takes it away; the others stay as they were.
  await react(ben, asked, "😂");
  assert.equal((await reactionsOf(asked))[`user:${ben}`], "😂");
  const taken = await react(ben, asked, null);
  assert.deepEqual(taken.messages[0].body.reactions, { [`user:${carla}`]: "❤️", [`user:${dario}`]: "🎉", [`user:${eva}`]: "👀" });
  // A bot's own reaction (describeWork's) stays beside the people's; and Anna reacts to Chef's answer as before.
  await knex("messages").where({ id: asked }).update({ body: knex.raw("jsonb_set(body, array['reactions', ?]::text[], to_jsonb(?::text))", [`bot:${chef}`, "🔥"]) });
  await react(carla, asked, "🙌");
  assert.deepEqual([(await reactionsOf(asked))[`bot:${chef}`], (await reactionsOf(asked))[`user:${carla}`]], ["🔥", "🙌"]);
  await react(anna, answered, "🙏");
  assert.deepEqual(await reactionsOf(answered), { [`user:${anna}`]: "🙏" });
});

test("nobody reacts to their own message, to Mercbot's, with another reaction, elsewhere, or from outside the chat", async (context) => {
  const kit = await startChatTurns(context);
  const { knex, turns } = kit;
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const as = (person) => kit.as(person, homeId);
  const kitchen = (await seedChat(knex, { homeId, kind: "public", title: "Kitchen", people: [anna, ben] })).id;
  const plans = (await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna, ben] })).id;
  const mine = await seedMessage(knex, { homeId, chatId: kitchen, userId: anna, body: { text: "Mine", authorName: "Anna" } });
  const line = await seedMessage(knex, { homeId, chatId: kitchen, kind: "event", body: { text: "Ben joined the chat." } });
  const elsewhere = await seedMessage(knex, { homeId, chatId: plans, userId: ben, body: { text: "In Plans", authorName: "Ben" } });
  const react = (person, chatId, messageId, emoji) => turns.chat.react(chatId, messageId, emoji, as(person));

  const refused = [
    [() => react(anna, kitchen, mine, "👍"), { statusCode: 400, code: "bots_reaction_not_allowed" }, "her own message"],
    [() => react(ben, kitchen, line, "👍"), { statusCode: 400, code: "bots_reaction_not_allowed" }, "Mercbot's line"],
    [() => react(ben, kitchen, mine, "🦄"), { statusCode: 400, code: "bots_reaction_unknown" }, "a reaction that isn't a quick one"],
    [() => react(ben, kitchen, elsewhere, "👍"), { statusCode: 404, code: "bots_message_not_found" }, "a message of another chat"],
    [() => react(ben, kitchen, "x1", "👍"), { statusCode: 404, code: "bots_message_not_found" }, "an id that isn't one"],
    [() => react(carla, kitchen, mine, "👍"), { statusCode: 403, code: "bots_chat_join_first" }, "Carla, reading a public chat she isn't in"],
    [() => react(carla, plans, elsewhere, "👍"), { statusCode: 403, code: "bots_chat_join_first" }, "Carla, in a private chat she can't open"]
  ];
  for (const [attempt, refusal, why] of refused) await assert.rejects(attempt(), refusal, why);
  const bodies = await knex("messages").whereIn("id", [mine, line, elsewhere]).pluck("body");
  assert.deepEqual(bodies.map((body) => body.reactions ?? null), [null, null, null], "nothing was kept");
  // Ben's reaction on Anna's message is his to make.
  assert.deepEqual((await react(ben, kitchen, mine, "👍")).messages[0].body.reactions, { [`user:${ben}`]: "👍" });
});
