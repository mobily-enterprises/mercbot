import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LIMITS as LIMITS } from "@jskit-ai/agent/server";
import { seedMessages } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";

// A bot's history window, against the disposable test database, each test in a home of its own: a bot invited into a
// room with more than 30 messages reads only the last 30 and what is said after it joined, with a line of Mercbot's
// own saying so (none when there were 30 or fewer); its turns read from there, with a state note saying how much it
// doesn't see; read_further_back moves its start back 100 at a time (200 at most), until it reads the whole chat; a bot
// invited again starts afresh; its memory's digest starts from the same point; and joining a long room makes no model
// call over the history before its start (the stand-in model's calls, at 30 messages and at 2,000, are the same).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// Summaries early enough that 2,000 earlier messages, read from a room's beginning, would need one before a reply.
const limits = { ...LIMITS, compactAt: 4000, summariseNowAt: 4000, keepTurns: 2, keepTokens: 400, minTokens: 50 };
const JOINED = "Ada joined. It reads the last 30 messages; ask it to read further back.";

/**
 * Pat's home with the bot Ada; the turns, whose replies keep what each was handed (its history, state note and tools),
 * stand-ins for the summary and the digest that count their calls, and a room of Pat's with `earlier` messages before
 * Ada is invited (its start line among them).
 */
async function setup(context, { writeMemory } = {}) {
  const seen = [];
  const calls = { summaries: 0, replies: 0 };
  const kit = await startChatTurns(context, {
    compactionLimits: limits,
    summarize: async () => {
      calls.summaries += 1;
      return "SUMMARY";
    },
    writeMemory,
    reply: async (bot, timeline, tools, state) => {
      calls.replies += 1;
      seen.push({ timeline, tools, state });
      return { text: `${bot.name} here.`, transcript: [] };
    }
  });
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  const [ada] = await botsOf(kit, homeId, pat, ["Ada"]);
  const as = memberOptions({ userId: pat, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  /** A room with `earlier` messages in all, its start line first, the rest Pat's "line-N" (from 1). */
  const room = async (title, earlier) => {
    const { chat } = await kit.chats.create({ title }, as);
    const rows = Array.from({ length: earlier - 1 }, (_, index) => ({ userId: pat, body: { text: `line-${String(index + 1).padStart(4, "0")} of ${title}`, authorName: "Pat" } }));
    for (let start = 0; start < rows.length; start += 500) await seedMessages(kit.knex, { homeId, chatId: chat.id, rows: rows.slice(start, start + 500) });
    return chat.id;
  };
  const ids = async (chatId) => (await kit.knex("messages").where({ conversation_id: chatId }).orderBy("id").pluck("id")).map(String);
  const seat = (chatId) => kit.knex("chat_bots").where({ conversation_id: chatId, bot_id: ada }).first();
  const startOf = async (chatId) => {
    const row = await seat(chatId);
    return row.reads_from_message_id == null ? null : String(row.reads_from_message_id);
  };
  /** Pat writes in the room and asks for Ada's reply; what Ada was handed. */
  const ask = async (chatId, text = "Ada, where were we?") => {
    const sent = await kit.turns.chat.sendMessage(chatId, { text }, as);
    await kit.turns.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
    await kit.drain();
    return seen.at(-1);
  };
  return { kit, seen, calls, homeId, pat, ada, as, room, ids, seat, startOf, ask };
}

test("a bot invited into a room reads its last 30 messages and what's said after, and a line says so only when there was more", async (context) => {
  const { kit, ada, as, room, ids, startOf, ask } = await setup(context);

  // 30 messages: Ada reads them all, and no line is written.
  const thirty = await room("Thirty", 30);
  await kit.chats.addBot(thirty, ada, as);
  assert.equal(await startOf(thirty), null);
  assert.equal((await ids(thirty)).length, 30, "no joined line");

  // 31: Ada reads from the 30th newest, and Mercbot's own line says so, marking nothing unread.
  const longer = await room("Longer", 31);
  const before = await ids(longer);
  await kit.chats.markRead(longer, before.at(-1), as);
  await kit.chats.addBot(longer, ada, as);
  assert.equal(await startOf(longer), before.at(-30));
  const line = await kit.knex("messages").where({ conversation_id: longer }).orderBy("id", "desc").first();
  assert.deepEqual(
    { kind: line.kind, role: line.role, author: [line.author_user_id, line.author_bot_id], body: line.body },
    { kind: "event", role: "system", author: [null, null], body: { event: "bot_window", text: JOINED } }
  );
  assert.equal((await kit.chats.get(longer, as)).chat.place.unread, false, "Mercbot's line is no one's news");

  // Its turn reads from there: the joined line and what follows, never the first message; its state note says so.
  const turn = await ask(longer);
  const read = turn.timeline.map((message) => message.id);
  assert.equal(read[0], before.at(-30), "from its start");
  assert.ok(!read.includes(before[0]), "never the room's first message");
  assert.ok(turn.timeline.some((message) => message.body.text === JOINED), "the joined line is in its view");
  assert.match(turn.state, /- You read this chat from \w+, \w+ \d+ at [^:]+:\d+ [AP]M UTC: 1 earlier message isn't in your view\. If someone asks you to read further back, call read_further_back\./u);
  assert.ok(turn.tools.readFurtherBack, "its person's turn has read_further_back");

  // A room it reads whole says nothing of it.
  const whole = await ask(thirty);
  assert.doesNotMatch(whole.state, /You read this chat from/u);
  assert.equal(whole.timeline.length, 31, "all 30 and Pat's message");
});

test("read_further_back moves the start back 100 at a time, 200 at most, until the whole chat; invited again, a bot starts afresh", async (context) => {
  const { kit, ada, as, room, ids, startOf, ask } = await setup(context);
  const chat = await room("Long", 451);
  const all = await ids(chat);
  await kit.chats.addBot(chat, ada, as);
  assert.equal(await startOf(chat), all.at(-30));
  const { tools } = await ask(chat, "Ada, read further back please");
  const further = (input) => tools.readFurtherBack.execute(input);

  // 100 when not told: 421 were before its start.
  assert.match((await further({})).read, /you read 100 earlier messages of this chat too .* 321 earlier messages are still before them/u);
  assert.equal(await startOf(chat), all.at(-130));
  // Never more than 200 in one call.
  assert.match((await further({ messages: 500 })).read, /you read 200 earlier messages .* 121 earlier messages are still before them/u);
  assert.equal(await startOf(chat), all.at(-330));
  await further({ messages: 100 });
  assert.equal(await startOf(chat), all.at(-430));
  // The last 21: the whole chat now, and then nothing more to read.
  assert.match((await further({ messages: 200 })).read, /you read 21 earlier messages .* That's the whole chat now\./u);
  assert.equal(await startOf(chat), null);
  assert.deepEqual(await further({}), { read: "You already read this whole chat." });

  // Its next turn reads the whole chat, with no note.
  const next = await ask(chat);
  assert.equal(next.timeline[0].id, all[0]);
  assert.doesNotMatch(next.state, /You read this chat from/u);

  // Taken out and invited again: a fresh window, the room's last 30 messages then.
  await kit.chats.removeBot(chat, ada, as);
  await kit.chats.addBot(chat, ada, as);
  const now = await ids(chat);
  assert.equal(await startOf(chat), now.at(-31), "the 30 newest before it joined, then its joined line");
  assert.equal((await kit.knex("messages").where({ conversation_id: chat }).orderBy("id", "desc").first()).body.text, JOINED);
});

test("a bot's memory of a room it joined late starts from its start, not the room's beginning", async (context) => {
  const written = [];
  const { kit, homeId, ada, as, room, ids } = await setup(context, {
    writeMemory: async (_rules, content) => {
      written.push(content);
      return "## Garden\n- remembered";
    }
  });
  const garden = await room("Garden", 61);
  const all = await ids(garden);
  await kit.chats.addBot(garden, ada, as);
  const home = { context: kit.systemContext("the bot window's memory").forWorkspace(homeId) };
  await kit.records.memory.ask([{ botId: ada, minutes: 0 }], {}, home);
  assert.equal(await kit.memory.runner.runOne(), true, "a refresh was due and ran");
  const content = written.at(-1);
  assert.equal(all.length, 61);
  assert.match(content, /line-0031 of Garden/u, "the 30th newest, its first line");
  assert.match(content, /line-0060 of Garden/u);
  assert.doesNotMatch(content, /line-0030 of Garden/u, "nothing before its start");
  assert.doesNotMatch(content, /line-0001 of Garden/u);
});

test("joining a long room makes no model call over the history before its start: the same calls at 30 messages and at 2,000", async (context) => {
  const { kit, calls, ada, as, room, startOf, ask } = await setup(context);
  const measured = async (title, earlier) => {
    const chat = await room(title, earlier);
    await kit.chats.addBot(chat, ada, as);
    const before = { ...calls };
    await ask(chat);
    // The background check for whether it now needs a summary, as after every reply.
    await kit.turns.compaction.consider(chat);
    await kit.drain();
    const queued = Boolean(await kit.knex("agent_summary_queue").where({ conversation_id: chat }).first());
    return { replies: calls.replies - before.replies, summaries: calls.summaries - before.summaries, queued, start: await startOf(chat) };
  };
  const short = await measured("Short", 30);
  const long = await measured("Long", 2000);
  assert.equal(short.start, null);
  assert.notEqual(long.start, null);
  assert.deepEqual({ ...long, start: null }, { ...short, start: null }, "the same model calls at 2,000 earlier messages as at 30");
  assert.deepEqual(long, { replies: 1, summaries: 0, queued: false, start: long.start }, "one reply, and no summary of what it doesn't read, nor one queued");
});
