import assert from "node:assert/strict";
import test from "node:test";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { MEMORY_LIMITS } from "../../packages/bots/src/server/botMemory.js";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// What a bot remembers reaches its other chats (D-113; B2's test 2): Chef in Kitchen answers from what was said in
// Garden, through its digest, through "since then" for what came after it, and through recall for an exact line; and
// recall everywhere finds a public chat Chef isn't in. Before B2 a turn in Kitchen knew nothing of Garden. Stand-ins
// for the model and the digest's writer; no provider is called.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a bot in one chat answers from another: its digest, since then, recall, and recall everywhere", async (context) => {
  const turns = [];
  let tooling = null;
  const kit = await startChatTurns(context, {
    // The digest's writer keeps every line it's handed, so what reached it reaches the turns.
    writeMemory: async (_system, content) => content.split("\n").filter((line) => line.startsWith("[")).join("\n"),
    reply: async (_bot, history, tools, state) => {
      const results = tooling ? await tooling(tools) : {};
      turns.push({ history: JSON.stringify(history), state, results });
      return { text: "Noted.", transcript: [] };
    }
  });
  const { homeId, people: [anna, ben] } = await homeOfPeople(kit, ["Anna", "Ben"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const garden = await seedChat(kit.knex, { homeId, title: "Garden", people: [anna, ben], bots: [chef] });
  const kitchen = await seedChat(kit.knex, { homeId, title: "Kitchen", people: [anna, ben], bots: [chef] });
  const attic = await seedChat(kit.knex, { homeId, title: "Attic", people: [ben] });
  await seedMessage(kit.knex, { homeId, chatId: garden.id, userId: anna, body: { text: "The tomatoes go in on the fourteenth", authorName: "Anna" } });
  await seedMessage(kit.knex, { homeId, chatId: attic.id, userId: ben, body: { text: "The ladder is behind the boiler", authorName: "Ben" } });

  const ask = async (text) => {
    const options = kit.as(anna, homeId);
    const sent = await kit.turns.chat.sendMessage(kitchen.id, { text }, options);
    await kit.turns.chat.reply(kitchen.id, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
    await kit.drain();
    return turns.at(-1);
  };

  // Chef's digest is made from Garden and Kitchen.
  await kit.records.memory.ask([{ botId: chef, minutes: 0 }], {}, { context: kit.systemContext("memory reach").forWorkspace(homeId) });
  assert.equal(await kit.memory.runner.runOne(), true);

  // Then, in Garden, a line after the digest.
  await seedMessage(kit.knex, { homeId, chatId: garden.id, userId: ben, body: { text: "Ben bought the stakes yesterday", authorName: "Ben" } });

  tooling = async (tools) => ({
    exact: await tools.recall.execute({ words: "tomatoes fourteenth" }),
    elsewhere: await tools.recall.execute({ words: "ladder boiler" }),
    everywhere: await tools.recall.execute({ words: "ladder boiler", everywhere: true }),
    around: await tools.readChat.execute({ chat: "Garden" })
  });
  // In a chat of two people, a bot answers when it is named.
  const turn = await ask("Chef, when do the tomatoes go in?");
  assert.ok(!turn.history.includes("fourteenth"), "Garden isn't in Kitchen's history");
  // The memory is the state note's last part, after the chat's own state (D-113): everything before it stays cached.
  assert.ok(turn.state.indexOf("- Notes for everyone in this home") > turn.state.indexOf("- Your routines in this chat"), "after the chat's state");
  assert.match(turn.state.split("\n").at(-1), /Ben bought the stakes yesterday/u, "since then ends it");
  assert.match(turn.state, /<<memory>>[\s\S]*The tomatoes go in on the fourteenth[\s\S]*<<end of memory>>/u, "the digest has Garden's line");
  assert.match(turn.state, /Since then[^\n]*\n\[Garden · Ben · [^\]]+\]: Ben bought the stakes yesterday/u, "since then has Garden's newer line");
  assert.match(turn.results.exact.found, /\[Garden · Anna · [^\]]+ · line \d+\]: The tomatoes go in on the fourteenth/u, "recall finds the exact line");
  assert.match(turn.results.elsewhere.found, /^Nothing matched/u, "recall searches the bot's own chats unless asked");
  assert.match(turn.results.everywhere.found, /\[Attic · Ben · [^\]]+\]: The ladder is behind the boiler/u, "everywhere finds a public chat Chef isn't in");
  assert.match(turn.results.around.found, /The tomatoes go in[\s\S]*Ben bought the stakes/u, "read_chat reads Garden by its name");
});

test("\"since then\" costs the same for a few chats as for many, and names only counts past its chats", async (context) => {
  const kit = await startChatTurns(context, { writeMemory: async () => "" });
  const { homeId, people: [anna, ben] } = await homeOfPeople(kit, ["Anna", "Ben"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const kitchen = await seedChat(kit.knex, { homeId, title: "Kitchen", people: [anna, ben], bots: [chef] });
  const reader = { context: kit.records.readers.forBot({ homeId, botId: chef, chatId: kitchen.id, askerId: anna }) };
  const limits = MEMORY_LIMITS.since;
  let made = { chats: 0, lines: 0 };
  const addChats = async (count, lines) => {
    made = { chats: made.chats + count, lines: made.lines + count * lines };
    for (let index = 0; index < count; index += 1) {
      const chat = await seedChat(kit.knex, { homeId, title: `Chat ${index}`, people: [anna, ben], bots: [chef] });
      for (let line = 0; line < lines; line += 1) {
        await seedMessage(kit.knex, { homeId, chatId: chat.id, userId: ben, body: { text: `Line ${line} of chat ${index}`, authorName: "Ben" } });
      }
    }
  };
  let since = null;
  const counted = () => queriesDuring(kit.knex, async () => { since = await kit.records.memory.sinceThen(chef, kitchen.id, { covers: {} }, limits, reader); });

  await addChats(2, 3);
  const few = await counted();
  assert.equal(since.chats.length, 2);
  assert.deepEqual(since.chats.map((chat) => chat.lines.length), [3, 3]);
  await addChats(limits.chats - 2, 12);
  const full = await counted();
  assert.equal(since.chats.length, limits.chats);
  assert.ok(since.chats.every((chat) => chat.lines.length <= limits.lines), "at most its lines a chat");
  assert.equal(full, few, `${few} statements for 2 chats, ${full} for ${limits.chats}`);
  assert.deepEqual(since.rest, { chats: 0, lines: 0 });

  // Past its chats, the rest are counted, in a bounded number of statements however many there are.
  const rest = () => ({ chats: made.chats - limits.chats, lines: made.lines - since.chats.reduce((sum, chat) => sum + chat.total, 0) });
  await addChats(2, 2);
  const past = await counted();
  assert.deepEqual(since.rest, rest());
  assert.equal(since.rest.chats, 2);
  await addChats(20, 2);
  const farPast = await counted();
  assert.deepEqual(since.rest, rest());
  assert.equal(since.rest.chats, 22);
  assert.equal(farPast, past, `${past} statements with 2 more chats, ${farPast} with 22`);
});
