import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createFileTransfer } from "../../packages/files/src/server/fileTransfer.js";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";

// A bot's transfer_file (D-120): copying or moving a file to another place is always a card for the person the bot works
// for, and nothing changes until they say yes; then it's the same transfer as the file browser's, as them and
// confirmed. Nobody else answers the card. move_file only moves and renames inside one folder. A stand-in for the
// model; no provider.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("transfer_file asks on a card, changes nothing until its person says yes, and is answered by nobody else", async (context) => {
  const volume = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-transfer-card-"));
  context.after(() => fs.rm(volume, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: volume, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // The transfer is built on the turns' own records once they're started.
  const real = {};
  const transfer = {
    places: (...args) => real.transfer.places(...args),
    chatNamed: (...args) => real.transfer.chatNamed(...args),
    transfer: (...args) => real.transfer.transfer(...args)
  };
  const pages = { pathChanged: async () => {}, copied: async () => {} };
  // What each turn's stand-in model calls, and what the tool answered.
  let calls = [];
  const answers = [];
  const kit = await startChatTurns(context, {
    files: { store, pages, transfer },
    reply: async (_bot, _history, tools) => {
      for (const [tool, input] of calls) answers.push(await tools[tool].execute(input));
      calls = [];
      return { text: "Asked.", transcript: [] };
    }
  });
  real.transfer = createFileTransfer({ files: { store, pages, media: { on: false } }, records: kit.records });
  const { homeId, people: [anna, ben] } = await homeOfPeople(kit, ["Anna", "Ben"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const plans = await seedChat(kit.knex, { homeId, kind: "private", title: "Plans", people: [anna, ben], bots: [chef] });
  const lobby = await seedChat(kit.knex, { homeId, kind: "public", title: "Lobby", people: [ben] });
  const as = (person) => memberOptions({ userId: person, homeId });
  const chatPlace = (chatId) => store.widened(store.placeFor({ homeId, chatId }));
  const read = async (chatId, at) => fs.readFile(await store.resolve(chatPlace(chatId), at, { reading: true }), "utf8").catch(() => null);
  const planFile = await store.resolve(chatPlace(plans.id), "/files/chat/plan.txt");
  await fs.mkdir(path.dirname(planFile), { recursive: true });
  await fs.writeFile(planFile, "Rome in May");
  /** Anna asks Chef in Plans, whose turn calls `tools`; the newest card there. */
  const ask = async (tools) => {
    calls = tools;
    const sent = await kit.turns.chat.sendMessage(plans.id, { text: "Chef?" }, as(anna));
    await kit.turns.chat.reply(plans.id, { afterMessageId: sent.messages.at(-1).id }, undefined, as(anna));
    await kit.drain();
    return kit.knex("messages").where({ conversation_id: plans.id, kind: "choice" }).orderBy("id", "desc").first();
  };

  // move_file stays inside one folder: to another it points at transfer_file, and nothing moves.
  await ask([["moveFile", { from: "/files/chat/plan.txt", to: "/files/shared/plan.txt" }]]);
  assert.match(answers.at(-1).error, /use transfer_file/u);
  assert.equal(await read(plans.id, "/files/chat/plan.txt"), "Rome in May");

  // A move to the home's files: a card for Anna, and nothing moved yet.
  const card = await ask([["transferFile", { mode: "move", from: { path: "/files/chat/plan.txt" }, to: { folder: "/files/shared" } }]]);
  assert.equal(answers.at(-1).status, "waiting_for_approval");
  assert.deepEqual([card.body.action.id, card.body.question, card.body.for.id], ["transfer_file", "Move plan.txt from this chat to Home files?", anna]);
  assert.equal(await read(plans.id, "/files/chat/plan.txt"), "Rome in May", "nothing changes until the yes");
  assert.equal(await read(plans.id, "/files/shared/plan.txt"), null);

  // Ben is in the chat, but the card is Anna's.
  await assert.rejects(kit.turns.chat.answerChoice(plans.id, String(card.id), ["Go ahead"], as(ben)), { statusCode: 403, code: "bots_waiting_for_other" });
  assert.equal(await read(plans.id, "/files/chat/plan.txt"), "Rome in May");

  // Anna's yes moves it, though Plans is private: the card asked her where it goes.
  await kit.turns.chat.answerChoice(plans.id, String(card.id), ["Go ahead"], as(anna));
  assert.deepEqual([await read(plans.id, "/files/chat/plan.txt"), await read(plans.id, "/files/shared/plan.txt")], [null, "Rome in May"]);
  const said = await kit.knex("messages").where({ conversation_id: plans.id, kind: "event" }).orderBy("id", "desc").first();
  assert.deepEqual([said.body.text, said.body.detail], ["Moved", "plan.txt is now in Home files, at /files/shared/plan.txt."]);

  // A copy into a room by its name, a room Anna can open though she isn't in it; "Don't do it" copies nothing.
  const declined = await ask([["transferFile", { mode: "copy", from: { path: "/files/shared/plan.txt" }, to: { folder: "/files/chat", room: "lobby" } }]]);
  assert.equal(declined.body.question, "Copy plan.txt from Home files to \"lobby\"?");
  await kit.turns.chat.answerChoice(plans.id, String(declined.id), ["Don't do it"], as(anna));
  assert.equal(await read(lobby.id, "/files/chat/plan.txt"), null);
  const copy = await ask([["transferFile", { mode: "copy", from: { path: "/files/shared/plan.txt" }, to: { folder: "/files/chat", room: "Lobby" } }]]);
  await kit.turns.chat.answerChoice(plans.id, String(copy.id), ["Go ahead"], as(anna));
  assert.deepEqual([await read(lobby.id, "/files/chat/plan.txt"), await read(plans.id, "/files/shared/plan.txt")], ["Rome in May", "Rome in May"]);

  // A room nobody can name here is said on the yes, and nothing is copied.
  const nowhere = await ask([["transferFile", { mode: "copy", from: { path: "/files/shared/plan.txt" }, to: { folder: "/files/chat", room: "Attic" } }]]);
  await kit.turns.chat.answerChoice(plans.id, String(nowhere.id), ["Go ahead"], as(anna));
  const refused = await kit.knex("messages").where({ conversation_id: plans.id, kind: "event" }).orderBy("id", "desc").first();
  assert.deepEqual([refused.body.text, refused.body.detail], ["That didn't work", "There's no room or chat called \"Attic\" here."]);
  // And a file that isn't there gets no card at all.
  const before = (await ask([["transferFile", { mode: "copy", from: { path: "/files/chat/none.txt" }, to: { folder: "/files/shared" } }]])).id;
  assert.match(answers.at(-1).error, /isn't there/u);
  assert.equal(before, nowhere.id, "no new card");
});
