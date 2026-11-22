import assert from "node:assert/strict";
import test from "node:test";
import { commonKnowledgeRefusal } from "../../packages/bots/src/server/botActions.js";
import { memberOptions } from "../support/botRecords.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// The home's common knowledge (D-113; B2's test 5): an entry is written only from the always-ask card its person said
// yes to, never with contact or card details or a password; its author and the home's owners and admins remove it,
// nobody else; and a removed entry is gone from every bot's next turn. A stand-in for the model; no provider.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const ADMIN = ["workspace.settings.update"];

/** A home of Anna (its owner), Ben and Carla, with Chef in Family (public, all three); each turn's stand-in asks to share. */
async function commonKnowledgeHome(context) {
  const turns = [];
  let telling = null;
  const kit = await startChatTurns(context, {
    writeMemory: async () => "",
    reply: async (_bot, _history, tools, state) => {
      const told = telling ? await tools.shareCommonKnowledge.execute({ text: telling }) : null;
      telling = null;
      turns.push({ state, told });
      return { text: "Noted.", transcript: [] };
    }
  });
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const family = await seedChat(kit.knex, { homeId, title: "Family", people: [anna, ben, carla], bots: [chef] });
  const as = (person, permissions = []) => memberOptions({ userId: person, homeId, role: person === anna ? "owner" : "member", permissions });
  /** A turn of Chef in `chatId`, asked by `person`, which asks to share `text` with every bot when given. */
  const ask = async (person, chatId, text = null) => {
    telling = text;
    const sent = await kit.turns.chat.sendMessage(chatId, { text: "Chef?" }, as(person));
    await kit.turns.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as(person));
    await kit.drain();
    return turns.at(-1);
  };
  const cardIn = (chatId) => kit.knex("messages").where({ conversation_id: chatId, kind: "choice" }).orderBy("id", "desc").first();
  /** `person` asks Chef in `chatId` to tell every bot `text`, and says yes on the card. */
  const tell = async (person, chatId, text) => {
    await ask(person, chatId, text);
    const card = await cardIn(chatId);
    await kit.turns.chat.answerChoice(chatId, String(card.id), ["Go ahead"], as(person));
    return card;
  };
  return { kit, homeId, anna, ben, carla, chef, family, as, ask, cardIn, tell };
}

test("common knowledge is written only from the card its person said yes to, never with contact details or passwords", async (context) => {
  const f = await commonKnowledgeHome(context);
  const entries = () => f.kit.knex("common_knowledge").where({ workspace_id: f.homeId }).orderBy("id");

  // The tool refuses before any card: an email address, nine or more digits, a password.
  for (const text of ["Write to Anna at anna@example.com", "The card is 4111 1111 1111 1111", "The wifi password is hunter2plus"]) {
    const turn = await f.ask(f.anna, f.family.id, text);
    assert.match(turn.told.error, /never go(es)? in the home's common knowledge/u, `refused: ${text}`);
  }
  assert.equal(await f.cardIn(f.family.id), undefined, "no card was made");
  // A date with its dashes isn't a long number.
  assert.equal(commonKnowledgeRefusal("The party is on 2026-12-24 at 18:00"), null);

  // A card answered "Don't do it" writes nothing.
  await f.ask(f.anna, f.family.id, "We're away the first week of August");
  const declined = await f.cardIn(f.family.id);
  assert.equal(declined.body.action.id, "share_common_knowledge");
  assert.equal(declined.body.for.id, String(f.anna), "the card is for the person who asked");
  await f.kit.turns.chat.answerChoice(f.family.id, String(declined.id), ["Don't do it"], f.as(f.anna));
  assert.deepEqual(await entries(), [], "nothing added");

  // Without a yes on its own card, nothing is written: no card, another kind of card, a card not answered, a card of
  // someone else's, one whose words break a rule.
  const records = f.kit.records.commonKnowledge;
  assert.deepEqual(await records.addFromCard("999999999", commonKnowledgeRefusal, f.as(f.anna)), { refused: "There's no card for that." });
  const other = await seedMessage(f.kit.knex, {
    homeId: f.homeId, chatId: f.family.id, kind: "choice", botId: f.chef,
    body: { purpose: "approval", question: "Send it?", options: ["Go ahead", "Don't do it"], chosen: "Go ahead", for: { id: String(f.anna) }, action: { id: "send_email", args: { text: "Hi" } } }
  });
  assert.deepEqual(await records.addFromCard(String(other), commonKnowledgeRefusal, f.as(f.anna)), { refused: "There's no card for that." });
  const card = (body) => seedMessage(f.kit.knex, {
    homeId: f.homeId, chatId: f.family.id, kind: "choice", botId: f.chef,
    body: { purpose: "approval", question: "Tell every bot?", options: ["Go ahead", "Don't do it"], for: { id: String(f.anna) }, action: { id: "share_common_knowledge", args: { text: "Dinner at eight" } }, ...body }
  });
  assert.deepEqual(await records.addFromCard(String(await card({})), commonKnowledgeRefusal, f.as(f.anna)), { refused: "That card wasn't said yes to." });
  const yes = await card({ chosen: "Go ahead" });
  assert.deepEqual(await records.addFromCard(String(yes), commonKnowledgeRefusal, f.as(f.ben)), { refused: "Only the person the card is for can say yes to it." });
  const blank = await card({ chosen: "Go ahead", action: { id: "share_common_knowledge", args: { text: "   " } } });
  assert.deepEqual(await records.addFromCard(String(blank), commonKnowledgeRefusal, f.as(f.anna)), { refused: "There's nothing to add." });
  const email = await card({ chosen: "Go ahead", action: { id: "share_common_knowledge", args: { text: "Mail ben@example.com" } } });
  assert.match((await records.addFromCard(String(email), commonKnowledgeRefusal, f.as(f.anna))).refused, /contact or card details/u);
  assert.deepEqual(await entries(), [], "none of those wrote an entry");

  // Said yes on its own card: one entry, as its person, through its bot, and once however often the card is read.
  const told = await f.tell(f.anna, f.family.id, "We're away the first week of August");
  const [entry] = await entries();
  assert.equal(entry.text, "We're away the first week of August");
  assert.equal(String(entry.by_user_id), String(f.anna));
  assert.equal(String(entry.via_bot_id), String(f.chef));
  assert.equal(String(entry.card_id), String(told.id));
  await records.addFromCard(String(told.id), commonKnowledgeRefusal, f.as(f.anna));
  assert.equal((await entries()).length, 1, "one entry a card");
  const event = await f.kit.knex("messages").where({ conversation_id: f.family.id, kind: "event" }).orderBy("id", "desc").first();
  assert.equal(event.body.text, "Added to Turns test's common knowledge");
});

test("its author and the home's owners and admins remove an entry, nobody else, and the next turn no longer reads it", async (context) => {
  const f = await commonKnowledgeHome(context);
  await f.tell(f.ben, f.family.id, "Ben is allergic to peanuts");
  await f.tell(f.ben, f.family.id, "Ben's bike is in the shed");
  const [allergy, bike] = (await f.kit.commonKnowledge.list({}, f.as(f.ben))).entries.reverse();
  assert.equal(allergy.text, "Ben is allergic to peanuts");
  assert.deepEqual(allergy.by, { id: String(f.ben), name: "Ben" });
  assert.deepEqual(allergy.viaBot, { id: String(f.chef), name: "Chef" });
  assert.equal(allergy.canRemove, true, "its author may remove it");
  assert.equal((await f.kit.commonKnowledge.list({}, f.as(f.carla))).entries[0].canRemove, false, "someone else may not");
  assert.equal((await f.kit.commonKnowledge.list({}, f.as(f.anna, ADMIN))).entries[0].canRemove, true, "the home's owners and admins may");

  // Every bot's turn reads the home's common knowledge, in any chat.
  const before = await f.ask(f.carla, f.family.id);
  assert.match(before.state, /"Ben is allergic to peanuts" \(Ben, via Chef\)/u);

  await assert.rejects(f.kit.commonKnowledge.remove(allergy.id, f.as(f.carla)), { statusCode: 403, code: "bots_common_knowledge_remove_forbidden" });
  assert.deepEqual(await f.kit.commonKnowledge.remove(allergy.id, f.as(f.anna, ADMIN)), { removed: true }, "an admin removes it");
  assert.deepEqual(await f.kit.commonKnowledge.remove(bike.id, f.as(f.ben)), { removed: true }, "its author removes it");
  await assert.rejects(f.kit.commonKnowledge.remove(bike.id, f.as(f.ben)), { statusCode: 404, code: "bots_common_knowledge_not_found" });
  const kept = await f.kit.knex("common_knowledge").where({ id: allergy.id }).first();
  assert.equal(String(kept.removed_by), String(f.anna), "kept, with who removed it");

  // Another home's entry is not this home's to remove or read.
  const away = await homeOfPeople(f.kit, ["Dora"]);
  const [farEntry] = await f.kit.knex("common_knowledge").insert({ workspace_id: away.homeId, text: "Dora's entry", by_user_id: away.people[0] }).returning("id");
  await assert.rejects(f.kit.commonKnowledge.remove(String(farEntry.id), f.as(f.anna, ADMIN)), { statusCode: 404, code: "bots_common_knowledge_not_found" });
  assert.deepEqual((await f.kit.commonKnowledge.list({}, f.as(f.anna))).entries, [], "this home's entries are all removed, and Dora's isn't listed");

  const after = await f.ask(f.carla, f.family.id);
  assert.ok(!after.state.includes("peanuts") && !after.state.includes("bike"), "the next turn doesn't read a removed entry");
  assert.match(after.state, /The home's common knowledge: none yet/u);
});

test("listing a home's common knowledge costs the same for a few entries as for a page of them", async (context) => {
  const f = await commonKnowledgeHome(context);
  const seed = (count) => f.kit.knex("common_knowledge").insert(Array.from({ length: count }, (_, index) => ({
    workspace_id: f.homeId, text: `Entry ${index}`, by_user_id: index % 2 ? f.ben : f.anna, via_bot_id: f.chef
  })));
  await seed(3);
  let listed = null;
  const few = await queriesDuring(f.kit.knex, async () => { listed = await f.kit.commonKnowledge.list({}, f.as(f.ben)); });
  assert.equal(listed.entries.length, 3);
  await seed(45);
  const many = await queriesDuring(f.kit.knex, async () => { listed = await f.kit.commonKnowledge.list({}, f.as(f.ben)); });
  assert.equal(listed.entries.length, 48);
  assert.equal(many, few, `${few} statements for 3 entries, ${many} for 48`);
  // Past a page, the rest follow from `next`.
  await seed(10);
  const first = await f.kit.commonKnowledge.list({}, f.as(f.ben));
  assert.equal(first.entries.length, 50);
  const rest = await f.kit.commonKnowledge.list({ after: first.next }, f.as(f.ben));
  assert.equal(rest.entries.length, 8);
  assert.equal(rest.next, null);
});

test("every turn, in any chat, reads the newest 30 entries, newest first, and says the older ones are in Settings", async (context) => {
  const f = await commonKnowledgeHome(context);
  // Entry 0 is the oldest, Entry 34 the newest.
  for (let index = 0; index < 35; index += 1) {
    await f.kit.knex("common_knowledge").insert({ workspace_id: f.homeId, text: `Entry ${index} here`, by_user_id: f.anna, via_bot_id: f.chef });
  }
  const ledger = await seedChat(f.kit.knex, { homeId: f.homeId, kind: "private", title: "Ledger", people: [f.ben], bots: [f.chef] });
  for (const chatId of [f.family.id, ledger.id]) {
    const { state } = await f.ask(f.ben, chatId);
    const read = [...state.matchAll(/"Entry (\d+) here"/gu)].map(([, index]) => Number(index));
    assert.deepEqual(read, Array.from({ length: 30 }, (_, at) => 34 - at), `the newest 30, newest first, in chat ${chatId}`);
    assert.match(state, /Older entries are in Settings, under Bots' common knowledge\./u);
    assert.match(state, /\(Anna, via Chef\)/u, "who asked, through which bot");
  }
});
