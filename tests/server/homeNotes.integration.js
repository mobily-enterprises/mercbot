import assert from "node:assert/strict";
import test from "node:test";
import { noteRefusal } from "../../packages/bots/src/server/botActions.js";
import { memberOptions } from "../support/botRecords.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// What everyone in a home is told (D-113; B2's test 5): a note is written only from the always-ask card its person
// said yes to, never with contact or card details or a password; its author and the home's owners and admins remove
// it, nobody else; and a removed note is gone from every bot's next turn. A stand-in for the model; no provider.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const ADMIN = ["workspace.settings.update"];

/** A home of Anna (its owner), Ben and Carla, with Chef in Family (public, all three); each turn's stand-in asks to tell. */
async function notesHome(context) {
  const turns = [];
  let telling = null;
  const kit = await startChatTurns(context, {
    writeMemory: async () => "",
    reply: async (_bot, _history, tools, state) => {
      const told = telling ? await tools.tellEveryone.execute({ text: telling }) : null;
      telling = null;
      turns.push({ state, told });
      return { text: "Noted.", transcript: [] };
    }
  });
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const family = await seedChat(kit.knex, { homeId, title: "Family", people: [anna, ben, carla], bots: [chef] });
  const as = (person, permissions = []) => memberOptions({ userId: person, homeId, role: person === anna ? "owner" : "member", permissions });
  /** A turn of Chef in `chatId`, asked by `person`, which asks to tell everyone `text` when given. */
  const ask = async (person, chatId, text = null) => {
    telling = text;
    const sent = await kit.turns.chat.sendMessage(chatId, { text: "Chef?" }, as(person));
    await kit.turns.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as(person));
    await kit.drain();
    return turns.at(-1);
  };
  const cardIn = (chatId) => kit.knex("messages").where({ conversation_id: chatId, kind: "choice" }).orderBy("id", "desc").first();
  /** `person` asks Chef in `chatId` to tell everyone `text`, and says yes on the card. */
  const tell = async (person, chatId, text) => {
    await ask(person, chatId, text);
    const card = await cardIn(chatId);
    await kit.turns.chat.answerChoice(chatId, String(card.id), ["Go ahead"], as(person));
    return card;
  };
  return { kit, homeId, anna, ben, carla, chef, family, as, ask, cardIn, tell };
}

test("a note is written only from the card its person said yes to, never with contact details or passwords", async (context) => {
  const f = await notesHome(context);
  const notes = () => f.kit.knex("home_notes").where({ workspace_id: f.homeId }).orderBy("id");

  // The tool refuses before any card: an email address, nine or more digits, a password.
  for (const text of ["Write to Anna at anna@example.com", "The card is 4111 1111 1111 1111", "The wifi password is hunter2plus"]) {
    const turn = await f.ask(f.anna, f.family.id, text);
    assert.match(turn.told.error, /never go(es)? in a note for everyone/u, `refused: ${text}`);
  }
  assert.equal(await f.cardIn(f.family.id), undefined, "no card was made");
  // A date with its dashes isn't a long number.
  assert.equal(noteRefusal("The party is on 2026-12-24 at 18:00"), null);

  // A card answered "Don't do it" writes nothing.
  await f.ask(f.anna, f.family.id, "We're away the first week of August");
  const declined = await f.cardIn(f.family.id);
  assert.equal(declined.body.action.id, "tell_everyone");
  assert.equal(declined.body.for.id, String(f.anna), "the card is for the person who asked");
  await f.kit.turns.chat.answerChoice(f.family.id, String(declined.id), ["Don't do it"], f.as(f.anna));
  assert.deepEqual(await notes(), [], "nothing told");

  // Without a yes on its own card, nothing is written: no card, another kind of card, a card not answered, a card of
  // someone else's, one whose words break a rule.
  const records = f.kit.records.homeNotes;
  assert.deepEqual(await records.addFromCard("999999999", noteRefusal, f.as(f.anna)), { refused: "There's no card for that note." });
  const other = await seedMessage(f.kit.knex, {
    homeId: f.homeId, chatId: f.family.id, kind: "choice", botId: f.chef,
    body: { purpose: "approval", question: "Send it?", options: ["Go ahead", "Don't do it"], chosen: "Go ahead", for: { id: String(f.anna) }, action: { id: "send_email", args: { text: "Hi" } } }
  });
  assert.deepEqual(await records.addFromCard(String(other), noteRefusal, f.as(f.anna)), { refused: "There's no card for that note." });
  const card = (body) => seedMessage(f.kit.knex, {
    homeId: f.homeId, chatId: f.family.id, kind: "choice", botId: f.chef,
    body: { purpose: "approval", question: "Tell everyone?", options: ["Go ahead", "Don't do it"], for: { id: String(f.anna) }, action: { id: "tell_everyone", args: { text: "Dinner at eight" } }, ...body }
  });
  assert.deepEqual(await records.addFromCard(String(await card({})), noteRefusal, f.as(f.anna)), { refused: "That card wasn't said yes to." });
  const yes = await card({ chosen: "Go ahead" });
  assert.deepEqual(await records.addFromCard(String(yes), noteRefusal, f.as(f.ben)), { refused: "Only the person the card is for can say yes to it." });
  const blank = await card({ chosen: "Go ahead", action: { id: "tell_everyone", args: { text: "   " } } });
  assert.deepEqual(await records.addFromCard(String(blank), noteRefusal, f.as(f.anna)), { refused: "There's nothing to tell." });
  const email = await card({ chosen: "Go ahead", action: { id: "tell_everyone", args: { text: "Mail ben@example.com" } } });
  assert.match((await records.addFromCard(String(email), noteRefusal, f.as(f.anna))).refused, /contact or card details/u);
  assert.deepEqual(await notes(), [], "none of those wrote a note");

  // Said yes on its own card: one note, as its person, through its bot, and once however often the card is read.
  const told = await f.tell(f.anna, f.family.id, "We're away the first week of August");
  const [note] = await notes();
  assert.equal(note.text, "We're away the first week of August");
  assert.equal(String(note.by_user_id), String(f.anna));
  assert.equal(String(note.via_bot_id), String(f.chef));
  assert.equal(String(note.card_id), String(told.id));
  await records.addFromCard(String(told.id), noteRefusal, f.as(f.anna));
  assert.equal((await notes()).length, 1, "one note a card");
  const event = await f.kit.knex("messages").where({ conversation_id: f.family.id, kind: "event" }).orderBy("id", "desc").first();
  assert.equal(event.body.text, "Told everyone in Turns test");
});

test("its author and the home's owners and admins remove a note, nobody else, and the next turn no longer reads it", async (context) => {
  const f = await notesHome(context);
  await f.tell(f.ben, f.family.id, "Ben is allergic to peanuts");
  await f.tell(f.ben, f.family.id, "Ben's bike is in the shed");
  const [allergy, bike] = (await f.kit.memory.listNotes({}, f.as(f.ben))).notes.reverse();
  assert.equal(allergy.text, "Ben is allergic to peanuts");
  assert.deepEqual(allergy.by, { id: String(f.ben), name: "Ben" });
  assert.deepEqual(allergy.viaBot, { id: String(f.chef), name: "Chef" });
  assert.equal(allergy.canRemove, true, "its author may remove it");
  assert.equal((await f.kit.memory.listNotes({}, f.as(f.carla))).notes[0].canRemove, false, "someone else may not");
  assert.equal((await f.kit.memory.listNotes({}, f.as(f.anna, ADMIN))).notes[0].canRemove, true, "the home's owners and admins may");

  // Every bot's turn reads the notes, in any chat.
  const before = await f.ask(f.carla, f.family.id);
  assert.match(before.state, /"Ben is allergic to peanuts" \(Ben, via Chef\)/u);

  await assert.rejects(f.kit.memory.removeNote(allergy.id, f.as(f.carla)), { statusCode: 403, code: "bots_note_remove_forbidden" });
  assert.deepEqual(await f.kit.memory.removeNote(allergy.id, f.as(f.anna, ADMIN)), { removed: true }, "an admin removes it");
  assert.deepEqual(await f.kit.memory.removeNote(bike.id, f.as(f.ben)), { removed: true }, "its author removes it");
  await assert.rejects(f.kit.memory.removeNote(bike.id, f.as(f.ben)), { statusCode: 404, code: "bots_note_not_found" });
  const kept = await f.kit.knex("home_notes").where({ id: allergy.id }).first();
  assert.equal(String(kept.removed_by), String(f.anna), "kept, with who removed it");

  // Another home's note is not this home's to remove or read.
  const away = await homeOfPeople(f.kit, ["Dora"]);
  const [farNote] = await f.kit.knex("home_notes").insert({ workspace_id: away.homeId, text: "Dora's note", by_user_id: away.people[0] }).returning("id");
  await assert.rejects(f.kit.memory.removeNote(String(farNote.id), f.as(f.anna, ADMIN)), { statusCode: 404, code: "bots_note_not_found" });
  assert.deepEqual((await f.kit.memory.listNotes({}, f.as(f.anna))).notes, [], "this home's notes are all removed, and Dora's isn't listed");

  const after = await f.ask(f.carla, f.family.id);
  assert.ok(!after.state.includes("peanuts") && !after.state.includes("bike"), "the next turn doesn't read a removed note");
  assert.match(after.state, /Notes for everyone in this home: none yet/u);
});

test("listing a home's notes costs the same for a few as for a page of them", async (context) => {
  const f = await notesHome(context);
  const seed = (count) => f.kit.knex("home_notes").insert(Array.from({ length: count }, (_, index) => ({
    workspace_id: f.homeId, text: `Note ${index}`, by_user_id: index % 2 ? f.ben : f.anna, via_bot_id: f.chef
  })));
  await seed(3);
  let listed = null;
  const few = await queriesDuring(f.kit.knex, async () => { listed = await f.kit.memory.listNotes({}, f.as(f.ben)); });
  assert.equal(listed.notes.length, 3);
  await seed(45);
  const many = await queriesDuring(f.kit.knex, async () => { listed = await f.kit.memory.listNotes({}, f.as(f.ben)); });
  assert.equal(listed.notes.length, 48);
  assert.equal(many, few, `${few} statements for 3 notes, ${many} for 48`);
  // Past a page, the rest follow from `next`.
  await seed(10);
  const first = await f.kit.memory.listNotes({}, f.as(f.ben));
  assert.equal(first.notes.length, 50);
  const rest = await f.kit.memory.listNotes({ after: first.next }, f.as(f.ben));
  assert.equal(rest.notes.length, 8);
  assert.equal(rest.next, null);
});
