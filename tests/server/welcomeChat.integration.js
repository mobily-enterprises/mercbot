import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DESCRIBE, JUST_ME, NO_BOTS, SHOW_TEAMS, WITH_OTHERS } from "../../packages/bots/src/server/onboarding.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// The welcome chat (D-112, plan 5.2): a person's first visit makes their direct chat with the home's main bot, and a new
// home's main bot with it, once; its script names the bot, asks what the home is for (Add bots, D-109) and whether
// anyone else will use it (the everyone chat), moving on when the person types instead; and a bot's first chat with a
// person greets them, with its template's greeting when it has one.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const stepOf = async (chatId) => (await knex("conversations").where({ id: chatId }).first()).onboarding_step;
const kindsIn = async (chatId) => (await knex("messages").where({ conversation_id: chatId }).orderBy("id")).map((row) => row.kind);
/** The chat's latest card, as a turn answering it has it (records.messages). */
const cardIn = (kit, chatId, options) => kit.records.messages.latestOfKind(chatId, "choice", options);
/** A card answered as a turn does (chatTurns.js answerChoice): its chosen set, then the script's hook, in one transaction. */
async function answer(kit, chatId, picks, options) {
  return kit.records.chats.withTransaction(options, async (txOptions) => {
    const chat = await kit.records.chats.lock(chatId, txOptions);
    const card = await cardIn(kit, chatId, txOptions);
    await kit.records.messages.setBody(card.id, { ...card.body, chosen: picks[0] }, txOptions);
    return kit.onboarding.choiceAnswered(chat, card, picks, txOptions);
  });
}

test("a first visit makes the home's main bot and the person's welcome chat once, however many visits at once", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, ben, as } = await seedHome(knex, context);

  const [first, second] = await Promise.all([kit.onboarding.welcome(as("anna")), kit.onboarding.welcome(as("anna"))]);
  assert.equal(first.chat.id, second.chat.id, "two first visits at once make one chat");
  const bots = await knex("bots").where({ workspace_id: homeId });
  assert.equal(bots.length, 1, "and one main bot");
  const [main] = bots;
  assert.deepEqual(
    { name: main.name, isMain: main.is_main, madeBy: String(main.made_by), template: main.library_template },
    { name: "Mercbot", isMain: true, madeBy: anna, template: "general" }
  );
  assert.equal(first.chat.kind, "public", "a welcome chat is Public, as every new chat is (D15)");
  assert.equal(first.chat.directBotId, String(main.id));
  assert.deepEqual(first.chat.people.map((person) => person.userId), [anna], "Anna's own, with no one else");
  assert.equal(first.chat.onboardingStep, "start");
  assert.deepEqual(await kindsIn(first.chat.id), ["timestamp"], "it opens with one timestamp");

  const again = await kit.onboarding.welcome(as("anna"));
  assert.equal(again.chat.id, first.chat.id, "it's the person's one welcome chat");
  assert.deepEqual(await kindsIn(first.chat.id), ["timestamp"], "and a later visit writes nothing");
  const created = kit.calls.told.filter((notice) => notice.event.type === "bot");
  assert.equal(created.length, 1, "the home hears of its new bot once");
  assert.deepEqual({ ...created[0].event, keys: created[0].keys.sort() }, { type: "bot", botId: String(main.id), change: "created", keys: [anna, ben].sort() });
});

test("someone new in a home that has its main bot is greeted by it in a welcome chat of their own", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, ben, as } = await seedHome(knex, context);
  const annas = await kit.onboarding.welcome(as("anna"));

  const bens = await kit.onboarding.welcome(as("ben"));
  assert.notEqual(bens.chat.id, annas.chat.id);
  assert.equal(bens.chat.directBotId, annas.chat.directBotId, "with the home's main bot");
  assert.deepEqual(bens.chat.people.map((person) => person.userId), [ben]);
  assert.equal(bens.chat.onboardingStep, "intro-greet", "the bot greets him, and isn't named again");
  assert.equal((await knex("bots").where({ workspace_id: homeId })).length, 1, "no other bot is made");

  // With no AI (a paused home's way), the greeting and first question are the script's own.
  const greeted = await kit.onboarding.advance(bens.chat.id, "intro-greet", { displayName: "ben rossi" }, as("ben"));
  assert.match(greeted.messages[0].body.text, /^Hi Ben, I'm Mercbot\./u);
  assert.equal(greeted.messages[0].authorBotId, annas.chat.directBotId, "the bot's own message");
  assert.equal(greeted.chat.onboardingStep, "intro-ask");
  const asked = await kit.onboarding.advance(bens.chat.id, "intro-ask", {}, as("ben"));
  assert.equal(asked.messages[0].body.purpose, "first-task");
  assert.equal(asked.chat.onboardingStep, null);
});

test("the script names the bot, asks what the home is for, then whether anyone else will use it, making the everyone chat", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, ben, as } = await seedHome(knex, context, { name: "Rossi family" });
  const asAnna = as("anna");
  const { chat } = await kit.onboarding.welcome(asAnna);
  const anne = { displayName: "anna rossi" };

  const started = await kit.onboarding.advance(chat.id, "start", anne, asAnna);
  assert.deepEqual(started.messages.map((message) => message.kind), ["text", "choice"]);
  assert.match(started.messages[0].body.text, /Anna/u);
  assert.equal(started.messages[1].body.purpose, "bot-name");
  assert.equal(started.chat.onboardingStep, "ask-name");
  assert.deepEqual((await kit.onboarding.advance(chat.id, "start", anne, asAnna)).messages, [], "a step runs once");
  assert.deepEqual((await kit.onboarding.advance(chat.id, "confirm", anne, asAnna)).messages, [], "and only when it's the chat's");

  await assert.rejects(kit.onboarding.chooseName(chat.id, "Nobody", asAnna), { statusCode: 409, code: "bots_choice_closed" });
  const name = started.messages[1].body.options[0];
  const chosen = await kit.onboarding.chooseName(chat.id, name, asAnna);
  assert.equal(chosen.messages[0].body.chosen, name);
  assert.equal(chosen.chat.onboardingStep, "confirm");
  await assert.rejects(kit.onboarding.chooseName(chat.id, name, asAnna), { statusCode: 409 }, "a name is chosen once");
  assert.equal((await kit.onboarding.advance(chat.id, "confirm", anne, asAnna)).chat.onboardingStep, "rename");

  const renamed = await kit.onboarding.advance(chat.id, "rename", anne, asAnna);
  assert.equal(renamed.messages[0].body.text, `Renamed to ${name}`);
  assert.equal((await knex("bots").where({ id: chat.directBotId }).first()).name, name, "renamed for everyone in the home");
  assert.ok(kit.calls.told.some((notice) => notice.event.type === "bot" && notice.event.change === "changed"));
  const homeFor = renamed.messages[1].body;
  assert.equal(homeFor.purpose, "home-for", "a home with no bot but its main one is asked what it's for");
  assert.deepEqual(homeFor.options, [DESCRIBE, SHOW_TEAMS, NO_BOTS]);
  assert.equal(renamed.chat.onboardingStep, "home-for");

  assert.deepEqual(await answer(kit, chat.id, [DESCRIBE], asAnna), { addBots: "describe" }, "the page opens Add bots on Describe");
  assert.equal(await stepOf(chat.id), "people-offer");
  const offered = await kit.onboarding.advance(chat.id, "people-offer", anne, asAnna);
  assert.deepEqual(offered.messages[0].body.options, [JUST_ME, WITH_OTHERS]);
  assert.equal(offered.chat.onboardingStep, "home-people");

  assert.deepEqual(await answer(kit, chat.id, [WITH_OTHERS], asAnna), {});
  assert.equal(await stepOf(chat.id), "about");
  const everyone = await knex("conversations").where({ workspace_id: homeId, everyone: true });
  assert.equal(everyone.length, 1, "the home's everyone chat is made");
  assert.deepEqual({ kind: everyone[0].kind, title: everyone[0].title }, { kind: "public", title: "Rossi family" });
  const members = (await knex("chat_people").where({ conversation_id: everyone[0].id })).map((row) => String(row.user_id)).sort();
  assert.deepEqual(members, [anna, ben].sort(), "with everyone in the home");
  const bots = (await knex("chat_bots").where({ conversation_id: everyone[0].id })).map((row) => String(row.bot_id));
  assert.deepEqual(bots, [chat.directBotId], "and the main bot");
  assert.equal((await kit.onboarding.advance(chat.id, "about", anne, asAnna)).chat.onboardingStep, "connect");
});

test("what the home is for is asked only while it has no other bot, and whether others will use it only of its owners", async (context) => {
  const kit = await startSurfaces(knex, context);
  // Ben, a member, is the first to visit a home that has Chef: no bots are offered, and no people question is his.
  const bens = await seedHome(knex, context);
  await bens.bot("Chef");
  const { chat } = await kit.onboarding.welcome(bens.as("ben"));
  await knex("conversations").where({ id: chat.id }).update({ onboarding_step: "rename" });
  await knex("messages").insert({ workspace_id: bens.homeId, conversation_id: chat.id, role: "bot", author_bot_id: chat.directBotId, kind: "choice", body: { purpose: "bot-name", options: ["Juno"], chosen: "Juno" } });
  const renamed = await kit.onboarding.advance(chat.id, "rename", { displayName: "Ben" }, bens.as("ben"));
  assert.deepEqual(renamed.messages.map((message) => message.kind), ["event"], "no card for him");
  assert.equal(renamed.chat.onboardingStep, "about");

  // Anna, its owner, in a home with Pulse: straight to whether anyone else will use it.
  const annas = await seedHome(knex, context);
  await annas.bot("Pulse");
  const welcome = await kit.onboarding.welcome(annas.as("anna"));
  await knex("conversations").where({ id: welcome.chat.id }).update({ onboarding_step: "rename" });
  await knex("messages").insert({ workspace_id: annas.homeId, conversation_id: welcome.chat.id, role: "bot", author_bot_id: welcome.chat.directBotId, kind: "choice", body: { purpose: "bot-name", options: ["Iris"], chosen: "Iris" } });
  const asked = await kit.onboarding.advance(welcome.chat.id, "rename", { displayName: "Anna" }, annas.as("anna"));
  assert.equal(asked.messages[1].body.purpose, "home-people");
  assert.equal(asked.chat.onboardingStep, "home-people");
  assert.deepEqual(await answer(kit, welcome.chat.id, [JUST_ME], annas.as("anna")), {});
  assert.equal(await stepOf(welcome.chat.id), "about");
  assert.equal((await knex("conversations").where({ workspace_id: annas.homeId, everyone: true })).length, 0, "Just me makes nothing");
});

test("typing instead of answering moves the script on, and Not now opens nothing", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, as } = await seedHome(knex, context);
  const asAnna = as("anna");
  const { chat } = await kit.onboarding.welcome(asAnna);
  const typed = async (step) => {
    await knex("conversations").where({ id: chat.id }).update({ onboarding_step: step });
    const row = await kit.records.chats.get(chat.id, asAnna);
    assert.deepEqual(await kit.onboarding.afterMessage(row, asAnna), {});
    return stepOf(chat.id);
  };
  assert.equal(await typed("ask-name"), "about", "the bot keeps its name");
  assert.equal(await typed("home-for"), "about", "no bots are offered");
  assert.equal(await typed("home-people"), "about", "no everyone chat is made");
  assert.equal(await typed("await-nudge"), null, "the Gmail nudge isn't needed");
  assert.equal(await typed("connect"), "connect", "a step that waits for no answer stays");

  await knex("conversations").where({ id: chat.id }).update({ onboarding_step: "home-for" });
  await knex("messages").insert({ workspace_id: homeId, conversation_id: chat.id, role: "bot", author_bot_id: chat.directBotId, kind: "choice", body: { purpose: "home-for", options: [DESCRIBE, SHOW_TEAMS, NO_BOTS], chosen: null } });
  assert.deepEqual(await answer(kit, chat.id, [NO_BOTS], asAnna), { addBots: null });
  assert.equal(await stepOf(chat.id), "people-offer");
});

test("a bot on one of the templates greets with its template's greeting the first time someone opens a chat with it", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, ben, as, bot } = await seedHome(knex, context);
  const streak = await bot("Streaky", { library_template: "habit-tracker" });
  const chat = await seedChat(knex, { homeId, direct: { userId: ben, botId: streak }, onboardingStep: "intro-greet" });

  const greeted = await kit.onboarding.advance(chat.id, "intro-greet", { displayName: "Ben" }, as("ben"));
  assert.equal(greeted.messages.length, 1);
  assert.match(greeted.messages[0].body.text, /^Hi Ben, I'm Streaky\./u, "its template's greeting, as the bot it now is");
  assert.equal(greeted.chat.onboardingStep, null, "its template's setup questions follow from the bot itself");
});
