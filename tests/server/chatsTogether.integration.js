import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { createMeter } from "../../packages/account/src/server/meter.js";
import { createHandOverNotes } from "../../packages/bots/src/server/handOverNotes.js";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { FREE_RECORDER, botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// Where the chats rebuild's phases meet, against the disposable test database, each test in a home of its own: what the
// bots remember (D-113), people in chats (D-114) and bots together (D-115, D-129). A discussion's turns read none of the
// memory and ask for no refresh, while a person's turn, and a reply a bot chose to join in with, read it; a message that
// mentions people and a bot calls only that bot, marks only those people and has its public chat's bots notice it; a
// person's mention reads as "@Name" in everything the memory reads, in what a bot reads to decide whether to join in, in
// a discussion's question, in what reaches a working bot and in the prompt that names a message that waited for it; and
// Continue with others' note holds nothing of what the bot remembers. Stand-ins for every model; no provider is called.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// What the digest writer's stand-in answers for every bot, and the state note's line that says a turn remembers.
const MEMORY = "MEMORY-of-Family: dinner at eight on Saturday";
const REMEMBERED = "What you remember of the home's public chats";
const MARKER = /<@person:/u;

/**
 * A home of Anna (its owner), Ben and Carla, with Anna's bots Chef and Pulse; the turns, whose replies say "<Name>
 * here." and keep what each was handed (recall run when `steer.tools` gives words, and read_chat when it names a chat;
 * a turn started while `steer.hold` is a promise waits for it first, saying so through `steer.started`); the digest
 * writer, which keeps its input and answers MEMORY; and each bot's decision whether to join in (D-129), which keeps what
 * it read and answers `deciding.answer(bot)`, PASS unless the test says.
 */
async function setup(context) {
  const meter = {
    ...createMeter({ recorder: FREE_RECORDER }),
    pausedMessage: async () => null,
    estimateNano: async () => 1000,
    spentSince: async () => 0
  };
  const deciding = { answer: () => "PASS", calls: [] };
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const system = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      const user = options.prompt.filter((message) => message.role === "user").flatMap((message) => message.content).map((part) => part.text || "").join("");
      const bot = system.startsWith("You decide whether you reply ") ? /^You are (.+?), one of the bots in it\./mu.exec(system)?.[1] : null;
      if (bot) deciding.calls.push({ bot, system, user });
      return {
        content: [{ type: "text", text: bot ? deciding.answer(bot) : "Noted." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  const turns = [];
  const digests = [];
  const steer = { tools: null, hold: null, started: null };
  const kit = await startChatTurns(context, {
    meter,
    model,
    writeMemory: async (_system, content) => {
      digests.push(content);
      return `## Family\n[Family · Anna] ${MEMORY}`;
    },
    reply: async (bot, history, tools, state, prompt) => {
      const held = steer.hold;
      steer.hold = null;
      if (held) {
        steer.started?.();
        await held;
      }
      const results = {};
      if (steer.tools && tools.recall) {
        results.recall = await tools.recall.execute({ words: steer.tools.words });
        if (steer.tools.chat) results.read = await tools.readChat.execute({ chat: steer.tools.chat });
      }
      turns.push({
        bot: bot.name,
        chatId: String(bot.chat_id),
        history: JSON.stringify(history),
        state: String(state),
        prompt: String(prompt || ""),
        discussion: String(prompt || "").startsWith("(A discussion "),
        results
      });
      return { text: `${bot.name} here.`, transcript: [] };
    }
  });
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const [chef, pulse] = await botsOf(kit, homeId, anna, ["Chef", "Pulse"]);
  const owner = memberOptions({ userId: anna, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  const as = (person) => (person === anna ? owner : kit.as(person, homeId));
  const chat = kit.turns.chat;
  /** A chat of the home, Anna's, as the test shapes it. */
  const chatOf = async (shape) => (await seedChat(kit.knex, { homeId, madeBy: anna, ...shape })).id;
  /** `person` writes `text` and asks for the reply, as a page does; the background work finishes. */
  async function say(chatId, person, text) {
    const sent = (await chat.sendMessage(chatId, { text }, as(person))).messages.at(-1);
    await chat.reply(chatId, { afterMessageId: sent.id }, undefined, as(person));
    await kit.drain();
    return sent;
  }
  /** A refresh of `botId`'s memory, asked for now and run. */
  async function refresh(botId) {
    const inHome = { context: kit.systemContext("the test's refresh").forWorkspace(homeId) };
    await kit.records.roomsMemory.ask([{ botId, minutes: 0 }], {}, inHome);
    assert.equal(await kit.roomsMemory.runner.runOne(), true, "a refresh was due and ran");
  }
  /** The bots among `botIds` whose refresh is asked for, in id order. */
  const asked = async (botIds) => (await kit.knex("rooms_memory_queue").whereIn("bot_id", botIds).orderBy("bot_id").select("bot_id"))
    .map((row) => String(row.bot_id));
  /** A one-round discussion of `question` in `chatId`, proposed and started by `person`, run to its round's end. */
  async function discuss(chatId, person, question) {
    const card = (await chat.discuss(chatId, { question }, as(person))).messages[0];
    await chat.startDiscussion(chatId, card.id, { rounds: 1, timeZone: "UTC" }, as(person));
    await kit.drain();
    return (await kit.knex("messages").where({ id: card.id }).first()).body;
  }
  return { ...kit, meter, deciding, turns, digests, steer, homeId, anna, ben, carla, chef, pulse, as, chat, chatOf, say, refresh, asked, discuss };
}

test("a discussion's turns read none of what the bots remember and ask for no refresh; a person's turn reads it and asks", async (context) => {
  const { knex, homeId, anna, ben, chef, pulse, turns, chatOf, say, refresh, asked, discuss } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben], bots: [chef, pulse] });
  await seedMessage(knex, { homeId, chatId: family, userId: anna, body: { text: "Dinner is at eight on Saturday", authorName: "Anna" } });
  await refresh(chef);
  assert.deepEqual(await asked([chef, pulse]), [], "nothing waits to be remembered");

  await discuss(family, anna, "Pasta or risotto on Saturday?");
  const discussed = turns.filter((turn) => turn.discussion);
  assert.deepEqual(discussed.map((turn) => turn.bot), ["Chef", "Pulse"], "one round: each bot once");
  for (const turn of discussed) {
    assert.ok(!turn.state.includes(REMEMBERED) && !turn.state.includes(MEMORY), `${turn.bot}'s discussion turn reads no memory: ${turn.state}`);
  }
  assert.deepEqual(await asked([chef, pulse]), [], "a discussion's turns ask for no refresh");

  // A person's turn in the same chat reads Chef's memory, and what was said there asks for both bots' refreshes.
  await say(family, anna, `<@bot:${chef}> so which one?`);
  const person = turns.at(-1);
  assert.deepEqual([person.bot, person.discussion], ["Chef", false]);
  assert.ok(person.state.includes(REMEMBERED) && person.state.includes(MEMORY), "a person's turn reads Chef's memory");
  assert.deepEqual(await asked([chef, pulse]), [chef, pulse].sort((a, b) => Number(a) - Number(b)), "and its bots' memories notice it");
});

test("a reply a bot chose to join in with reads what its bot remembers, as any person's turn does", async (context) => {
  const { knex, homeId, anna, ben, chef, pulse, deciding, turns, chatOf, say, refresh } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben], bots: [chef, pulse], botsJoinIn: true });
  await seedMessage(knex, { homeId, chatId: family, userId: anna, body: { text: "Dinner is at eight on Saturday", authorName: "Anna" } });
  await refresh(chef);

  deciding.answer = (bot) => (bot === "Chef" ? "REPLY" : "PASS");
  await say(family, ben, "What should we cook on Saturday?");
  assert.deepEqual(deciding.calls.map((call) => call.bot), ["Chef", "Pulse"], "each bot decided once");
  assert.ok(deciding.calls.every((call) => !call.user.includes(MEMORY) && !call.system.includes(MEMORY)), "reading the chat, not the memory");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Chef"], "Chef joined in; Pulse passed");
  assert.ok(turns[0].state.includes(REMEMBERED) && turns[0].state.includes(MEMORY), "its turn reads its memory");
});

test("a message that mentions people and a bot calls only that bot, marks only those people, and its public chat's bots notice it", async (context) => {
  const { knex, anna, ben, carla, chef, pulse, deciding, turns, chat, as, chatOf, drain, asked } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben, carla], bots: [chef, pulse], botsJoinIn: true });

  // Anna names Ben, herself and Chef: Chef is called, Ben is mentioned, and Anna marks nobody by naming herself.
  const text = `<@person:${ben}> and <@person:${anna}>, <@bot:${chef}> has Saturday's menu`;
  const sent = (await chat.sendMessage(family, { text }, as(anna))).messages.at(-1);
  await drain();
  assert.deepEqual(sent.body.mentions, [{ id: chef, name: "Chef" }], "the bot it calls");
  assert.deepEqual(sent.body.mentionedPeople, [{ id: ben, name: "Ben" }], "the people it marks");
  const places = await knex("chat_people").where({ conversation_id: family }).orderBy("user_id").select("user_id", "mentioned_at");
  assert.deepEqual(places.map((place) => [String(place.user_id), place.mentioned_at !== null]),
    [[anna, false], [ben, true], [carla, false]].sort((a, b) => Number(a[0]) - Number(b[0])), "only Ben has a mention waiting");
  assert.deepEqual(await asked([chef, pulse]), [chef, pulse].sort((a, b) => Number(a) - Number(b)), "both bots of the public chat notice it");

  await chat.reply(family, { afterMessageId: sent.id }, undefined, as(anna));
  await drain();
  assert.deepEqual(deciding.calls.map((call) => call.bot), ["Pulse"], "Chef was called; Pulse, which wasn't, read it and decided");
  assert.deepEqual(turns.map((turn) => turn.bot), ["Chef"], "only Chef answers; Pulse passed");
});

test("a person's mention reads as \"@Name\" in everything the memory reads: since then, recall, read_chat and the digest", async (context) => {
  const { anna, ben, chef, turns, digests, steer, chatOf, say, refresh } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben], bots: [chef] });
  const plans = await chatOf({ kind: "private", title: "Plans", people: [anna, ben], bots: [chef] });
  await say(family, anna, `<@person:${ben}> brings the wine on Saturday`);

  // In Plans, Chef's turn reads Family in "since then", and recall and read_chat reach it.
  steer.tools = { words: "wine", chat: family };
  await say(plans, anna, `<@bot:${chef}> who brings the wine?`);
  const reading = turns.at(-1);
  assert.equal(reading.chatId, plans);
  for (const [where, text] of [["since then", reading.state], ["recall", JSON.stringify(reading.results.recall)], ["read_chat", JSON.stringify(reading.results.read)]]) {
    assert.match(text, /@Ben brings the wine on Saturday/u, `${where} names Ben`);
    assert.doesNotMatch(text, MARKER, `${where} has no person's marker`);
  }

  // The digest is written from the same words.
  await refresh(chef);
  assert.match(digests.at(-1), /@Ben brings the wine on Saturday/u);
  assert.doesNotMatch(digests.at(-1), MARKER);
});

test("a discussion's question and what a bot reads to decide whether to join in read people's mentions as \"@Name\"", async (context) => {
  const { anna, ben, carla, chef, pulse, deciding, turns, chatOf, say, discuss } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben, carla], bots: [chef, pulse], botsJoinIn: true });

  // The composer sends its mentions as markers; the card keeps the words everyone reads.
  const card = await discuss(family, anna, `Should <@person:${ben}> and   <@bot:${chef}> plan Saturday?`);
  assert.equal(card.question, "Should @Ben and @Chef plan Saturday?");
  const discussed = turns.filter((turn) => turn.discussion);
  assert.equal(discussed.length, 2);
  for (const turn of discussed) assert.match(turn.prompt, /"Should @Ben and @Chef plan Saturday\?"/u, `${turn.bot}'s round reads the question`);

  // A message that names only a person calls no bot: each bot decides, and reads who it names.
  await say(family, ben, `<@person:${carla}> are you coming on Saturday?`);
  assert.deepEqual(deciding.calls.map((call) => call.bot), ["Chef", "Pulse"]);
  for (const call of deciding.calls) {
    assert.match(call.user, />> \[Ben\]: @Carla are you coming on Saturday\?/u);
    assert.doesNotMatch(call.user, /@someone|<@person:/u);
  }
});

test("Continue with others' note holds nothing of what the bot remembers", async (context) => {
  const { knex, homeId, anna, ben, chef, meter, records, turns, as, chatOf, say, refresh } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben], bots: [chef] });
  const direct = await chatOf({ direct: { userId: anna, botId: chef } });
  await seedMessage(knex, { homeId, chatId: family, userId: ben, body: { text: "Ben's sister is vegetarian", authorName: "Ben" } });
  await seedMessage(knex, { homeId, chatId: direct, userId: anna, body: { text: "Plan a dinner for six on Saturday", authorName: "Anna" } });
  await refresh(chef);

  // Chef remembers Family in its direct chat with Anna…
  await say(direct, anna, "What do you remember?");
  assert.ok(turns.at(-1).state.includes(MEMORY), "Chef's turn in the direct chat reads its memory");

  // …but the note that carries the direct chat on is written from the direct chat alone.
  const calls = [];
  const notes = createHandOverNotes({ records, meter, write: async (system, messages) => {
    calls.push(messages.map((message) => message.content).join("\n"));
    return "Continuing from my chat with Chef: dinner for six on Saturday.";
  } });
  await notes.handOverNote(direct, as(anna));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^Anna: Plan a dinner for six on Saturday$/mu);
  for (const remembered of [MEMORY, REMEMBERED, "vegetarian"]) assert.ok(!calls[0].includes(remembered), `the note's input has no "${remembered}"`);
});

/**
 * Chef starts answering Anna in Family and is held until Ben has written to it, naming Carla: `tools` says whether the
 * held reply then calls a tool (whose result carries what was written meanwhile) or not (so Ben's message waits for
 * Chef's next reply). Answers the turns once everything is done.
 */
async function busyWhileBenWrites(context, { tools }) {
  const { anna, ben, carla, chef, turns, steer, chat, as, chatOf, drain } = await setup(context);
  const family = await chatOf({ kind: "public", title: "Family", people: [anna, ben, carla], bots: [chef] });
  let release;
  steer.hold = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    steer.started = resolve;
  });
  const asked = (await chat.sendMessage(family, { text: `<@bot:${chef}> plan Saturday's dinner` }, as(anna))).messages.at(-1);
  const first = chat.reply(family, { afterMessageId: asked.id }, undefined, as(anna));
  await started;
  // Recall finds Anna's message, not Ben's: what Chef hears of Ben's comes with the tool's result alone.
  steer.tools = tools ? { words: "dinner" } : null;
  const waiting = (await chat.sendMessage(family, { text: `<@bot:${chef}> <@person:${carla}> is vegetarian` }, as(ben))).messages.at(-1);
  await chat.reply(family, { afterMessageId: waiting.id }, undefined, as(ben));
  release();
  await first;
  await drain();
  return turns;
}

test("what a person writes to a working bot reaches it with a tool's result, its people by name", async (context) => {
  const turns = await busyWhileBenWrites(context, { tools: true });
  const heard = JSON.stringify(turns[0].results);
  assert.match(heard, /@Carla is vegetarian/u, "Ben's words reach Chef's reply with its next tool result");
  assert.doesNotMatch(heard, MARKER);
});

test("a message that waited for a busy bot is named in the prompt of its next reply, its people by name", async (context) => {
  const turns = await busyWhileBenWrites(context, { tools: false });
  assert.equal(turns.length, 2, "Chef answers Anna, then Ben's message once it's free");
  assert.match(turns[1].prompt, /^\(The message "<@bot:\d+> @Carla is vegetarian" arrived while you were busy/u);
  assert.doesNotMatch(turns[1].prompt, MARKER);
});
