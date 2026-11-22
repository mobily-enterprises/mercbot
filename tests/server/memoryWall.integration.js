import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { createMeter } from "../../packages/account/src/server/meter.js";
import { createHandOverNotes } from "../../packages/bots/src/server/handOverNotes.js";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { FREE_RECORDER, botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// The glass wall's canary for what the bots remember (D-113, D10, D12; B2's test 1). B1's canaries
// (glassWall.integration.js, glassWallPrompts.integration.js) prove the records and the turns' model inputs; this one
// runs every path the memory adds: a digest's refresh, a turn's "since then" and the home's notes, recall (the bot's
// chats, one chat, and everywhere) and read_chat on every chat of the home. Each chat carries a unique string in each
// place a chat keeps something; everything the stand-in models receive (the digest writer's input, each turn's history
// and Current state note) and every tool result may hold only what D12 grants the chat it reads from, and the reading
// chat's own strings are there, so the capture is live. A private chat never reaches a chat with anyone else in it,
// and a chat of one person reads every chat that person is in (R10). The other paths that read through the model's
// reader (D-114's hand-over note, D-115's join-in judge and a discussion's turns) read only their own chat, and none of
// the memory. Stand-ins for every model; no provider is called.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const CANARY = /CANARY-[a-z]+-[a-z]+/gu;
const CARRIERS = ["message", "todo", "notes", "waiting", "routine", "instructions"];
// What a person asked a bot to tell everyone in the home, from Anna's own private chat: the home's, so every chat reads it.
const NOTE = "CANARY-note-everyone";

/**
 * The Rossi home: Anna, Ben and Carla, Anna's bot Chef, and its chats, each with Chef and a canary in every carrier.
 * Family is public; Anna's direct chat with Chef is private and read only from itself; Plans (Anna and Ben), Diary
 * (Anna alone), Secret (Anna and Carla) and Trio (all three) are private. `together`: Anna's bot Pulse is in every chat but the direct one
 * too, and a chat of several people has its bots join in when useful (D-115).
 */
async function rossiHome(kit, { together = false } = {}) {
  const { homeId, people: [anna, ben, carla] } = await homeOfPeople(kit, ["Anna", "Ben", "Carla"]);
  const [chef, pulse] = await botsOf(kit, homeId, anna, together ? ["Chef", "Pulse"] : ["Chef"]);
  const shapes = {
    family: { kind: "public", people: [anna, ben] },
    direct: { direct: { userId: anna, botId: chef } },
    plans: { kind: "private", people: [anna, ben] },
    diary: { kind: "private", people: [anna] },
    secret: { kind: "private", people: [anna, carla] },
    trio: { kind: "private", people: [anna, ben, carla] }
  };
  const chats = {};
  for (const [name, shape] of Object.entries(shapes)) {
    const several = (shape.people ?? []).length > 1;
    const chat = await seedChat(kit.knex, {
      homeId, title: shape.direct ? null : name, bots: shape.direct ? [] : together ? [chef, pulse] : [chef], botsJoinIn: together && several, ...shape
    });
    const seat = chat.chatBotIds.get(chef);
    const people = shape.people ?? [anna];
    const said = (carrier) => `CANARY-${name}-${carrier}`;
    await seedMessage(kit.knex, { homeId, chatId: chat.id, userId: people[0], body: { text: `${said("message")} is what we said`, authorName: "Anna" } });
    await seedMessage(kit.knex, { homeId, chatId: chat.id, kind: "todos", botId: chef, body: { list: seat, items: [{ text: said("todo"), done: false }] } });
    await kit.knex("chat_bots").where({ id: seat }).update({ job_notes: JSON.stringify([said("notes")]), waiting_task: said("waiting") });
    await kit.knex("bot_routines").insert({
      workspace_id: homeId, chat_bot_id: seat, made_by: people[0], name: said("routine"), schedule: "Every day at 9:00", cron: "0 9 * * *", timezone: "UTC",
      instructions: said("instructions"), enabled: false
    });
    chats[name] = { name, id: chat.id, seat, people, kind: shape.kind ?? (shape.direct ? "private" : "public"), direct: Boolean(shape.direct) };
  }
  return { homeId, anna, ben, carla, chef, pulse, chats };
}

/**
 * The chats D12 lets `reading` read: itself, public chats, and for a private chat that isn't a direct one the private
 * chats with all its people; never a direct chat but its own.
 */
const readable = (chats, reading) => Object.values(chats).filter((chat) => chat === reading || (!chat.direct && (chat.kind === "public" ||
  (reading.kind === "private" && !reading.direct && chat.kind === "private" && reading.people.every((person) => chat.people.includes(person))))));
/** Their canaries (and a line written later in one), with the home's note, which everyone in the home is told. */
const granted = (chats, reading) => new Set([NOTE, ...readable(chats, reading).flatMap((chat) => [...CARRIERS, "later"].map((carrier) => `CANARY-${chat.name}-${carrier}`))]);
const canaries = (text) => [...new Set(String(text).match(CANARY) ?? [])].sort();
const messagesOf = (list) => list.filter((canary) => canary.endsWith("-message")).sort();

/**
 * The home with Chef's digest made, and a turn of Chef asked in any chat by its first person: its reply stand-in runs
 * recall three ways and read_chat on every chat of the home, and keeps what it was handed and what each tool answered.
 * A discussion's turn (D-115) is kept as it was handed, with no tools. `together` makes the home rossiHome's together
 * one, with a join-in judge that keeps what it reads and leaves the message to the people, and a meter that prices a
 * discussion.
 */
async function memoryHome(context, { together = false } = {}) {
  const inputs = [];
  let turn = null;
  const kit = await startChatTurns(context, {
    ...(together ? togetherDoubles(inputs) : {}),
    writeMemory: async (system, content) => {
      inputs.push({ path: "digest", text: JSON.stringify({ system, content }) });
      return `## What Chef remembers\n${canaries(content).map((canary) => `[a chat · Anna] ${canary}`).join("\n")}`;
    },
    reply: async (bot, history, tools, state, prompt) => {
      if (String(prompt || "").startsWith("(A discussion ")) {
        inputs.push({ path: "discussion", chatId: String(bot.chat_id), text: JSON.stringify({ history, state, prompt }), state, tools: Object.keys(tools) });
        return { text: `${bot.name}: a point.`, transcript: [] };
      }
      const results = {};
      // Asked once: the card's answer below runs no turn, but a later one must not ask again.
      const tell = turn.tell;
      turn.tell = null;
      if (tell) results.tell = await tools.tellEveryone.execute({ text: tell });
      if (turn.tools) {
        results.recallMine = await tools.recall.execute({ words: "CANARY" });
        results.recallHere = await tools.recall.execute({ words: "CANARY", chat: turn.chat.id });
        results.recallEverywhere = await tools.recall.execute({ words: "CANARY", everywhere: true });
        for (const chat of Object.values(turn.chats)) results[`read ${chat.name}`] = await tools.readChat.execute({ chat: chat.id });
      }
      inputs.push({ path: "turn", chatId: String(bot.chat_id), text: JSON.stringify({ history, state, results }), results, state });
      return { text: "Noted.", transcript: [] };
    }
  });
  const home = await rossiHome(kit, { together });
  const ask = async (chat, { tools = true, tell = null } = {}) => {
    turn = { chat, chats: home.chats, tools, tell };
    const options = kit.as(chat.people[0], home.homeId);
    const sent = await kit.turns.chat.sendMessage(chat.id, { text: "Chef, what do you remember?" }, options);
    await kit.turns.chat.reply(chat.id, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
    await kit.drain();
    return inputs.filter((input) => input.path === "turn").at(-1);
  };
  const refresh = async () => {
    const inHome = { context: kit.systemContext("the memory canary's refresh").forWorkspace(home.homeId) };
    await kit.records.memory.ask([{ botId: home.chef, minutes: 0 }], {}, inHome);
    assert.equal(await kit.memory.runner.runOne(), true, "a refresh was due and ran");
  };
  return { kit, inputs, ask, refresh, ...home };
}

/** The together home's doubles: a judge that keeps what it reads (as a "judge" input) and answers null, and a meter. */
function togetherDoubles(inputs) {
  return {
    meter: { ...createMeter({ recorder: FREE_RECORDER }), pausedMessage: async () => null, estimateNano: async () => 1000, spentSince: async () => 0 },
    model: new MockLanguageModelV4({
      doGenerate: async (options) => {
        const system = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
        const user = options.prompt.filter((message) => message.role === "user").flatMap((message) => message.content).map((part) => part.text || "").join("");
        if (system.startsWith("You decide whether ")) inputs.push({ path: "judge", text: user });
        return {
          content: [{ type: "text", text: "{\"bot\": null}" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: []
        };
      }
    })
  };
}

test("every path the memory adds holds only what D12 grants the chat it reads from", async (context) => {
  const { kit, inputs, ask, refresh, homeId, anna, chats } = await memoryHome(context);

  // Chef's digest is made from the public chats it's in, and only them: it's read in every chat of the bot.
  await refresh();
  const digest = inputs.find((input) => input.path === "digest");
  assert.deepEqual(messagesOf(canaries(digest.text)), ["CANARY-family-message"], "its public chats' lines, never a private one's, nor Anna's chat with it");
  assert.deepEqual(canaries(digest.text).filter((canary) => !canary.startsWith("CANARY-family-")), [], "nothing of a private chat");

  // Anna asks Chef, in her own private chat, to tell everyone something: a card, and once she says yes, a note.
  await ask(chats.diary, { tools: false, tell: NOTE });
  const card = await kit.knex("messages").where({ conversation_id: chats.diary.id, kind: "choice" }).orderBy("id", "desc").first();
  assert.equal(card.body.action.id, "tell_everyone", "the card asks first");
  await kit.turns.chat.answerChoice(chats.diary.id, String(card.id), ["Go ahead"], kit.as(anna, homeId));
  await kit.drain();

  // A new line in Plans after the digest, for "since then".
  await seedMessage(kit.knex, { homeId, chatId: chats.plans.id, userId: anna, body: { text: "CANARY-plans-later is new", authorName: "Anna" } });

  for (const chat of Object.values(chats)) {
    const reading = await ask(chat);
    const allowed = granted(chats, chat);
    const found = canaries(reading.text);
    assert.deepEqual(found.filter((canary) => !allowed.has(canary)), [], `everything a turn in ${chat.name} was handed is D12's to read there`);
    // Live: its own lines are there, and everyone's note.
    assert.ok(found.includes(`CANARY-${chat.name}-message`) && found.includes(NOTE), `a turn in ${chat.name} reads its own chat and the home's note`);
    // Recall everywhere and read_chat reach exactly the chats D12 grants: every one of them, and no other.
    const reached = messagesOf(canaries(JSON.stringify([reading.results.recallEverywhere, ...Object.values(chats).map((other) => reading.results[`read ${other.name}`])])));
    assert.deepEqual(reached, readable(chats, chat).map((other) => `CANARY-${other.name}-message`).sort(), `recall and read_chat from ${chat.name}`);
    // Recall in the bot's own chats and in this chat alone reach no further.
    for (const way of ["recallMine", "recallHere"]) {
      assert.deepEqual(canaries(JSON.stringify(reading.results[way])).filter((canary) => !allowed.has(canary)), [], `${way} from ${chat.name}`);
    }
    // A chat that may not read Plans never hears of its new line in "since then"; one that may, does.
    const mayReadPlans = readable(chats, chat).includes(chats.plans) && chat !== chats.plans;
    assert.equal(reading.state.includes("CANARY-plans-later"), mayReadPlans, `"since then" in ${chat.name} ${mayReadPlans ? "has" : "hasn't"} Plans' new line`);
  }
  // A chat of one person reads every chat that person is in (R10): Diary reads Plans, Secret and Trio.
  const diary = inputs.filter((input) => input.path === "turn" && input.chatId === chats.diary.id).at(-1);
  for (const name of ["plans", "secret", "trio"]) assert.ok(diary.text.includes(`CANARY-${name}-message`), `Diary reads ${name}`);
  // And the public chat reads no private chat at all; no chat but itself reads Anna's chat with Chef.
  const family = inputs.filter((input) => input.path === "turn" && input.chatId === chats.family.id).at(-1);
  assert.deepEqual(canaries(family.text).filter((canary) => /CANARY-(plans|diary|secret|trio|direct)-/u.test(canary)), [], "family reads no private chat");
  for (const chat of Object.values(chats).filter((other) => other !== chats.direct)) {
    const reading = inputs.filter((input) => input.path === "turn" && input.chatId === chat.id).at(-1);
    assert.deepEqual(canaries(reading.text).filter((canary) => canary.startsWith("CANARY-direct-")), [], `${chat.name} never reads Anna's chat with Chef`);
  }
});

test("mutation: readable_from without \"every person of the chat is in it\" leaks private chats into the memory's reads", async (context) => {
  const { kit, ask, chats } = await memoryHome(context);
  const { rows: [{ definition }] } = await kit.knex.raw("select pg_get_functiondef('readable_from(bigint)'::regprocedure) as definition");
  const subset = /AND NOT EXISTS \(\s*SELECT 1 FROM chat_people p\s+WHERE p\.conversation_id = y\.id\s+AND NOT EXISTS \(SELECT 1 FROM chat_people q WHERE q\.conversation_id = x\.id AND q\.user_id = p\.user_id\)\s*\)/u;
  assert.match(definition, subset, "the reading rule's subset condition, as the migration wrote it");
  // This file's own copy of the test database: the function is replaced here, and restored before the test ends.
  try {
    await kit.knex.raw(definition.replace(subset, ""));
    const leaked = await ask(chats.plans);
    const reached = canaries(JSON.stringify([leaked.state, leaked.results]));
    assert.ok(reached.includes("CANARY-diary-message") && reached.includes("CANARY-secret-message"), "private chats Ben can't open reach Plans");
  } finally {
    await kit.knex.raw(definition);
  }
  const held = await ask(chats.plans);
  const reached = canaries(JSON.stringify([held.state, held.results]));
  assert.ok(!reached.includes("CANARY-diary-message") && !reached.includes("CANARY-secret-message"), "restored, the wall holds");
});

test("the join-in judge, a discussion's turns and Continue with others' note read only their own chat, and none of the memory", async (context) => {
  const { kit, inputs, refresh, homeId, anna, chats } = await memoryHome(context, { together: true });
  await refresh();
  const own = (chat) => [...CARRIERS].map((carrier) => `CANARY-${chat.name}-${carrier}`);
  const latest = (path, chat) => inputs.filter((input) => input.path === path && (!chat || input.chatId === chat.id));

  for (const chat of Object.values(chats)) {
    const as = kit.as(chat.people[0], homeId);
    // The judge (D-115), in a chat of several people that calls no bot: it reads that chat's own words, and only them.
    if (chat.people.length > 1) {
      const person = kit.as(chat.people[1], homeId);
      const sent = await kit.turns.chat.sendMessage(chat.id, { text: "Is anyone free on Saturday?" }, person);
      await kit.turns.chat.reply(chat.id, { afterMessageId: sent.messages.at(-1).id }, undefined, person);
      await kit.drain();
      const judged = latest("judge").at(-1);
      assert.ok(judged, `${chat.name}'s message was judged`);
      assert.deepEqual(canaries(judged.text), [`CANARY-${chat.name}-message`], `the judge in ${chat.name} reads its own chat's words, and only them`);
      inputs.splice(inputs.indexOf(judged), 1);
    }
    // A discussion's turns (D-115): what D12 grants the chat, its own words among it, with no tools and no memory.
    if (chat.name !== "direct") {
      const card = (await kit.turns.chat.discuss(chat.id, { question: "What shall we cook on Saturday?" }, as)).messages[0];
      await kit.turns.chat.startDiscussion(chat.id, card.id, { rounds: 1, timeZone: "UTC" }, as);
      await kit.drain();
      const turns = latest("discussion", chat);
      assert.equal(turns.length, 2, `a round in ${chat.name}: Chef and Pulse`);
      const allowed = granted(chats, chat);
      for (const turn of turns) {
        assert.deepEqual(canaries(turn.text).filter((canary) => !allowed.has(canary)), [], `a discussion's turn in ${chat.name} holds only what D12 grants`);
        assert.ok(canaries(turn.text).includes(`CANARY-${chat.name}-message`), `and reads ${chat.name}'s own words`);
        assert.ok(!String(turn.state).includes("What you remember of the home's public chats"), `and none of the memory in ${chat.name}`);
        assert.deepEqual(turn.tools, [], "and has no tools");
      }
    }
  }

  // Continue with others' note (D-114), from Anna's direct chat: what people see of it, and nothing else.
  const calls = [];
  const notes = createHandOverNotes({ records: kit.records, meter: kit.meter, write: async (_system, messages) => {
    calls.push(messages.map((message) => message.content).join("\n"));
    return "Continuing from my chat with Chef.";
  } });
  await notes.handOverNote(chats.direct.id, kit.as(anna, homeId));
  const noted = canaries(calls[0]);
  assert.ok(noted.includes("CANARY-direct-message"), "the note reads the direct chat");
  assert.deepEqual(noted.filter((canary) => !own(chats.direct).includes(canary)), [], "and nothing of another chat, the memory included");
});
