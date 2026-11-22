import assert from "node:assert/strict";
import test from "node:test";
import { NOTE_WRITER, createHandOverNotes } from "../../packages/bots/src/server/handOverNotes.js";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";

// "Continue with others…" (D-114, B3): a person's direct chat with a bot goes on in a new chat with more people and bots.
// The direct chat's bot writes a hand-over note from what people see of the direct chat, in one billed call, and the
// person sends it (as they changed it) as their own first message in a new chat New chat makes, Public unless they
// chose Private; the direct chat stays one person's with one bot. The note's model input holds the direct chat's
// messages and nothing the bot's tools read: no reply's transcript, no routine's prompt, no state note, waiting task or
// routine of the bot there, and nothing of any other chat (the glass wall's canary, R12). Only the direct chat's own
// person asks for it; a chat that isn't a direct one, a chat the caller can't open and a bot that's archived are refused,
// and a direct chat with nothing said yet gets an empty note without a model call. Against the disposable test
// database, with a stand-in for the model that keeps what it was given.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const CANARY = /CANARY-[a-z]+-[a-z]+/gu;

/**
 * The Rossi home: Anna, Ben and Carla, Anna's bot Chef, Anna's direct chat with Chef, and Family (public), Plans
 * (private: Anna and Ben) and Secret (private: Anna and Carla), each with Chef and a canary in every place it keeps
 * something: a person's message and the bot's answer (which people see), and the answer's transcript, a routine run's
 * prompt, the bot's state note there, its waiting task and its routine (which they don't).
 */
async function rossiHome(kit) {
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const shapes = {
    direct: { direct: { userId: anna, botId: chef } },
    family: { kind: "public", title: "Family", people: [anna, ben], bots: [chef] },
    plans: { kind: "private", title: "Plans", people: [anna, ben], bots: [chef] },
    secret: { kind: "private", title: "Secret", people: [anna, carla], bots: [chef] }
  };
  const chats = {};
  for (const [name, shape] of Object.entries(shapes)) {
    const chat = await seedChat(kit.knex, { homeId, ...shape });
    const seat = chat.chatBotIds.get(chef);
    const said = (carrier) => `CANARY-${name}-${carrier}`;
    await seedMessage(kit.knex, { homeId, chatId: chat.id, userId: anna, body: { text: `Dinner for six on Saturday ${said("message")}`, authorName: "Anna" } });
    await seedMessage(kit.knex, { homeId, chatId: chat.id, botId: chef, body: {
      text: `Risotto, then ${said("answer")}`,
      authorName: "Chef",
      transcript: [{ role: "tool", content: [{ type: "tool-result", toolName: "read_file", output: { type: "text", value: said("transcript") } }] }]
    } });
    await seedMessage(kit.knex, { homeId, chatId: chat.id, botId: chef, body: { text: "Your morning list is ready.", authorName: "Chef", trigger: said("trigger") } });
    await kit.knex("chat_bots").where({ id: seat }).update({ job_notes: JSON.stringify([said("notes")]), waiting_task: said("waiting") });
    await kit.knex("bot_routines").insert({
      workspace_id: homeId, chat_bot_id: seat, made_by: anna, name: said("routine"), schedule: "Every day at 9:00", cron: "0 9 * * *", timezone: "UTC",
      instructions: said("instructions"), enabled: true
    });
    chats[name] = chat.id;
  }
  return { homeId, anna, ben, carla, chef, chats };
}

/** The hand-over notes on the test's records and meter, with a model that answers `answer` and keeps each call. */
function notesWith(kit, answer = "Continuing from my chat with Chef: dinner for six on Saturday, risotto. Ideas welcome.") {
  const calls = [];
  const notes = createHandOverNotes({
    records: kit.records,
    meter: kit.meter,
    write: async (system, messages) => {
      calls.push({ system, text: messages.map((message) => message.content).join("\n") });
      return answer;
    }
  });
  return { ...notes, calls };
}

test("the direct chat's bot writes the note from what people saw there, and the person sends it in a new chat", async (context) => {
  const kit = await startChatTurns(context);
  const { homeId, anna, ben, chef, chats } = await rossiHome(kit);
  const notes = notesWith(kit);
  const asAnna = kit.as(anna, homeId);

  const { note } = await notes.handOverNote(chats.direct, asAnna);
  assert.equal(note, "Continuing from my chat with Chef: dinner for six on Saturday, risotto. Ideas welcome.");
  assert.equal(notes.calls.length, 1, "one call");
  const [call] = notes.calls;
  assert.ok(call.system.startsWith(NOTE_WRITER), "the note writer's instructions");
  // The canary: only what people see of the direct chat, every line of it, under its author's name.
  assert.deepEqual([...new Set(call.text.match(CANARY))].sort(), ["CANARY-direct-answer", "CANARY-direct-message"]);
  assert.match(call.text, /^Anna: Dinner for six on Saturday CANARY-direct-message$/mu);
  assert.match(call.text, /^Chef: Risotto, then CANARY-direct-answer$/mu);
  assert.match(call.text, /^Chef: Your morning list is ready\.$/mu, "a routine run's line, without the prompt that started it");

  // Anna starts the new chat with Ben and Chef (Public, as New chat makes it unless Private is chosen), and sends the
  // note, as she changed it, as her own first message there.
  const { chat } = await kit.chats.create({ title: "Continue with others", people: [ben], bots: [chef] }, asAnna);
  assert.equal(chat.kind, "public");
  const sent = await kit.turns.chat.sendMessage(chat.id, { text: `${note} Ben, can you bring wine?` }, asAnna);
  const first = sent.messages.at(-1);
  assert.deepEqual([first.role, first.authorUserId, first.body.text], ["user", anna, `${note} Ben, can you bring wine?`]);
  // The direct chat is as it was: Anna's with Chef alone, and it takes no one else.
  const direct = (await kit.chats.get(chats.direct, asAnna)).chat;
  assert.deepEqual([direct.people.map((person) => person.userId), direct.bots.map((bot) => bot.botId)], [[anna], [chef]]);
  await assert.rejects(kit.chats.addPerson(chats.direct, ben, asAnna), { statusCode: 409, code: "bots_chat_direct" });
});

test("only the direct chat's own person asks for its note; any other chat or an archived bot is refused", async (context) => {
  const kit = await startChatTurns(context);
  const { knex } = kit;
  const { homeId, anna, ben, carla, chef, chats } = await rossiHome(kit);
  const notes = notesWith(kit);
  const as = (person) => kit.as(person, homeId);

  const refused = [
    [() => notes.handOverNote(chats.direct, as(ben)), { statusCode: 404, code: "bots_chat_not_found" }, "Ben can't open Anna's direct chat: it's Private, hers"],
    [() => notes.handOverNote(chats.family, as(anna)), { statusCode: 409, code: "bots_chat_not_direct" }, "a chat that isn't a direct one"],
    [() => notes.handOverNote(chats.secret, as(ben)), { statusCode: 404, code: "bots_chat_not_found" }, "a private chat Ben can't open"],
    [() => notes.handOverNote("x1", as(anna)), { statusCode: 404, code: "bots_chat_not_found" }, "an id that isn't one"]
  ];
  for (const [attempt, refusal, why] of refused) await assert.rejects(attempt(), refusal, why);
  // Another home's person can't reach the direct chat either.
  const { homeId: awayId, people: [stranger] } = await homeOfPeople(kit, ["Stranger"]);
  await assert.rejects(notes.handOverNote(chats.direct, kit.as(stranger, awayId)), { statusCode: 404, code: "bots_chat_not_found" });

  // A direct chat with nothing said yet: an empty note, and no call.
  const [pulse] = await botsOf(kit, homeId, carla, ["Pulse"]);
  const quiet = await seedChat(knex, { homeId, direct: { userId: carla, botId: pulse } });
  assert.deepEqual(await notes.handOverNote(quiet.id, as(carla)), { note: "" });

  // An archived bot writes none (D-108).
  await knex("bots").where({ id: chef }).update({ archived_at: new Date() });
  await assert.rejects(notes.handOverNote(chats.direct, as(anna)), { statusCode: 409, code: "bots_bot_archived" });
  assert.equal(notes.calls.length, 0, "no refused or empty note made a call");
});

test("the note's input reads one page of the direct chat, whatever its history", async (context) => {
  const kit = await startChatTurns(context);
  const { knex } = kit;
  const { homeId, anna, chats } = await rossiHome(kit);
  const notes = notesWith(kit);
  const rows = Array.from({ length: 140 }, (_, index) => ({ userId: anna, body: { text: `Line ${index}`, authorName: "Anna" } }));
  await knex("messages").insert(rows.map((row) => ({
    workspace_id: homeId, conversation_id: chats.direct, author_user_id: row.userId, role: "user", kind: "text", body: JSON.stringify(row.body)
  })));
  await notes.handOverNote(chats.direct, kit.as(anna, homeId));
  const lines = notes.calls[0].text.split("\n").slice(1);
  assert.equal(lines.length, 100, "the newest page");
  assert.deepEqual([lines[0], lines.at(-1)], ["Anna: Line 40", "Anna: Line 139"], "oldest first, up to the latest");
  assert.ok(!notes.calls[0].text.includes("CANARY"), "older lines past the page aren't read");
});
