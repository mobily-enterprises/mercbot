import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { plansDuring, queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";
import { seedChat, seedMessage, seedMessages } from "../support/chatFixtures.mjs";

// Open pages catch up on a chat instead of reading it again (D-15, D-112), against the disposable test
// database: news reads only what was written or changed since the page's cursor, including a
// message whose transaction committed after a later one's, and what a notice costs (the catch-up,
// the one chat's row, the chat list, a reply in a chat of two bots) doesn't grow with the chat.
//
// The cursor is a transaction horizon for the whole PostgreSQL server, so another test file's
// transaction running at the same moment may hold it back and a catch-up then also resends some
// older messages; the page merges by id, so these checks ask that what's new is there, never that
// nothing else is.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context) {
  const knex = await connectTestDatabase();
  const [owner] = await knex("users").orderBy("id").limit(1).pluck("id");
  assert.ok(owner, "the test database needs a user");
  const homeId = await testHome(knex, owner);
  const tag = Date.now().toString(36);
  const made = [];
  const service = createBotsService(serviceDoubles({
    knex,
    records: await startBotRecords(knex, context),
    approvals: { decide: async () => "allow" },
    reply: async (bot) => ({ text: `${bot.name} here.`, transcript: [] })
  }));
  const bot = async (name) => {
    const row = await testBot(knex, owner, { name: `${name} ${tag}` });
    made.push(row.id);
    return row;
  };
  context.after(async () => {
    await knex("bots").whereIn("id", made).del();
    await knex.destroy();
  });
  /** The person's request in the home, as the bots routes make its options. */
  const as = (userId) => memberOptions({ userId, homeId });
  return { knex, homeId, owner: String(owner), as, service, bot, made, tag };
}

// Earlier messages, written straight to the chat, until it holds `total`: the bot's and the person's in turn.
async function fill(knex, { botId, chatId, personId }, total) {
  const { count } = await knex("messages").where({ conversation_id: chatId }).count("id as count").first();
  const missing = total - Number(count);
  if (missing <= 0) return;
  const { workspace_id: homeId } = await knex("conversations").where({ id: chatId }).first("workspace_id");
  const rows = Array.from({ length: missing }, (_, index) => ({
    body: { text: `Earlier message ${index}` },
    ...(index % 2 ? { botId } : { userId: personId })
  }));
  await seedMessages(knex, { homeId, chatId, rows });
}

/** The bot's direct chat with the owner, as fill reads it. */
const inChat = (row, owner) => ({ botId: row.id, chatId: row.conversation_id, personId: owner });

const say = (knex, row, text) => seedMessage(knex, { homeId: row.workspace_id, chatId: row.conversation_id, body: { text }, botId: row.id });

test("a catch-up reads what's new, and costs the same at 10 messages as at 200", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Catcher");
  const measured = async (total) => {
    await fill(knex, inChat(row, owner), total);
    const { messages: newest, cursor } = await service.chat.messages(row.conversation_id, {}, as(owner));
    assert.equal(newest.length, Math.min(total, 100), "without a cursor, the chat's newest page");
    assert.match(cursor, /^\d+$/u, "and a cursor to catch up from");
    const fresh = await say(knex, row, `News at ${total}`);
    let caught = null;
    const count = await queriesDuring(knex, async () => {
      caught = await service.chat.messages(row.conversation_id, { since: cursor }, as(owner));
    });
    assert.ok(caught.messages.some((message) => message.id === fresh), `the new message arrives at ${total}`);
    assert.equal(caught.messages.at(-1).id, fresh, "in order, last");
    assert.match(caught.cursor, /^\d+$/u);
    return count;
  };
  await measured(10); // the first read may warm caches
  const few = await measured(10 + 1);
  const many = await measured(200);
  assert.equal(many, few, `a catch-up at 200 messages took ${many} queries, at 10 ${few}`);
});

test("a chat opens on its newest 100 messages and older ones come a page at a time, each once, in order", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Pager");
  await fill(knex, inChat(row, owner), 250);
  const everything = (await knex("messages").where({ conversation_id: row.conversation_id }).orderBy("id").pluck("id")).map(String);
  const opened = await service.chat.messages(row.conversation_id, {}, as(owner));
  assert.deepEqual(opened.messages.map((message) => message.id), everything.slice(-100), "the newest 100, oldest first");
  assert.equal(opened.more, true, "and older ones are left");
  assert.match(opened.cursor, /^\d+$/u, "with a cursor to catch up from");

  // Scrolling back: each page is the one before the oldest message shown.
  let shown = opened.messages.map((message) => message.id);
  let more = opened.more;
  const pages = [];
  while (more) {
    const page = await service.chat.messages(row.conversation_id, { before: shown[0] }, as(owner));
    assert.equal(page.cursor, undefined, "an older page says nothing about news");
    pages.push(page.messages.length);
    shown = [...page.messages.map((message) => message.id), ...shown];
    more = page.more;
  }
  assert.deepEqual(pages, [100, 50]);
  assert.deepEqual(shown, everything, "every message once, in order, across both page boundaries");

  // A message written while the person reads back comes with the catch-up, and no page holds it.
  const fresh = await say(knex, row, "Written meanwhile");
  const caught = await service.chat.messages(row.conversation_id, { since: opened.cursor }, as(owner));
  assert.equal(caught.messages.at(-1)?.id, fresh, "the catch-up brings it, last");
  assert.deepEqual((await service.chat.messages(row.conversation_id, { before: shown[0] }, as(owner))).messages, []);

  // Exactly a page: nothing older is announced, so the page never asks for an empty one.
  const exact = await bot("Exact");
  await fill(knex, inChat(exact, owner), 100);
  const full = await service.chat.messages(exact.conversation_id, {}, as(owner));
  assert.deepEqual([full.messages.length, full.more], [100, false]);

  for (const before of ["", "0", "12a", "1e3", "-4", "123456789012345678901"]) {
    await assert.rejects(service.chat.messages(row.conversation_id, { before }, as(owner)), (error) => error.code === "bots_before_invalid", JSON.stringify(before));
  }
  await assert.rejects(service.chat.messages(row.conversation_id, { before: shown[0], since: opened.cursor }, as(owner)), (error) => error.code === "bots_before_invalid", "a page or a catch-up, not both");
});

test("opening a chat costs the same at 10 messages as at 300, and reads only its newest page", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Opener");
  const measured = async (total) => {
    await fill(knex, inChat(row, owner), total);
    // The planner sees the chat at its size, as a server's statistics would show it.
    await knex.raw("analyze messages");
    let opened = null;
    const plans = await plansDuring(knex, async () => {
      opened = await service.chat.messages(row.conversation_id, {}, as(owner));
    });
    assert.equal(opened.messages.length, Math.min(total, 100));
    const page = plans.filter((plan) => /from "messages"/u.test(plan.sql));
    assert.equal(page.length, 1, "one read of the messages");
    return { statements: plans.length, rowsRead: page[0].rowsRead, plan: page[0].plan };
  };
  await measured(10); // the first read may warm caches
  const few = await measured(10 + 1);
  const many = await measured(300);
  assert.equal(many.statements, few.statements, `opening at 300 messages took ${many.statements} reads, at 11 ${few.statements}`);
  // A page is 100 messages and one more says whether older ones are left; the chat's own row is read once
  // for its visibility check, at any size.
  assert.ok(many.rowsRead <= 102, `opening at 300 messages read ${many.rowsRead} rows; a page is 100, one more says whether older ones are left, and the chat's own row is checked once: ${JSON.stringify(many.plan)}`);
});

test("a message changed after the cursor comes back with the catch-up", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Changer");
  await fill(knex, inChat(row, owner), 20);
  const older = await knex("messages").where({ conversation_id: row.conversation_id }).orderBy("id").first();
  const { cursor } = await service.chat.messages(row.conversation_id, {}, as(owner));
  // As a card's answer does: the row is updated in place, and keeps its id.
  await knex("messages").where({ id: older.id }).update({ body: { ...older.body, text: "Changed since" } });
  const { messages } = await service.chat.messages(row.conversation_id, { since: cursor }, as(owner));
  const changed = messages.find((message) => message.id === String(older.id));
  assert.ok(changed, "the changed older message is sent again");
  assert.equal(changed.body.text, "Changed since");
});

test("a message whose transaction commits after a later one's still arrives", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Latecomer");
  await fill(knex, inChat(row, owner), 5);
  const { cursor: start } = await service.chat.messages(row.conversation_id, {}, as(owner));
  const trx = await knex.transaction();
  try {
    // Its id is taken now, before the next message's, but it commits after that one is read.
    const [{ id: lateId }] = await trx("messages")
      .insert({ workspace_id: row.workspace_id, author_bot_id: row.id, conversation_id: row.conversation_id, kind: "text", role: "bot", body: { text: "Late" } })
      .returning("id");
    const later = await say(knex, row, "Later");
    assert.ok(Number(later) > Number(lateId), "the committed message has the higher id");
    const first = await service.chat.messages(row.conversation_id, { since: start }, as(owner));
    assert.ok(first.messages.some((message) => message.id === later), "the committed one arrives");
    assert.ok(!first.messages.some((message) => message.id === String(lateId)), "the uncommitted one can't yet");
    await trx.commit();
    const second = await service.chat.messages(row.conversation_id, { since: first.cursor }, as(owner));
    assert.ok(second.messages.some((message) => message.id === String(lateId)), "after its commit, the next catch-up brings it");
  } finally {
    if (!trx.isCompleted()) await trx.rollback();
  }
});

test("a cursor that isn't a transaction id is refused", async (context) => {
  const { as, owner, service, bot } = await setup(context);
  const row = await bot("Strict");
  for (const since of ["", "abc", "-1", "1.5", "1; select 1", "99999999999999999999", 12]) {
    await assert.rejects(service.chat.messages(row.conversation_id, { since }, as(owner)), (error) => error.code === "bots_cursor_invalid", String(since));
  }
});

test("one chat's row and the chat list cost the same at 10 messages as at 200", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Lister");
  const measured = async (total) => {
    await fill(knex, inChat(row, owner), total);
    const latest = `Latest at ${total}`;
    await say(knex, row, latest);
    let listed = null;
    let list = null;
    const one = await queriesDuring(knex, async () => {
      listed = (await service.chats.get(row.conversation_id, as(owner))).chat;
    });
    const all = await queriesDuring(knex, async () => {
      list = await service.chats.list({}, as(owner));
    });
    assert.equal(listed.latest?.preview, latest, "the chat's preview is its latest message");
    assert.deepEqual(list.chats.find((entry) => entry.id === listed.id), listed, "the same as the list shows it");
    return { one, all };
  };
  await measured(10);
  const few = await measured(10 + 2);
  const many = await measured(200);
  assert.deepEqual(many, few, `at 200 messages: ${JSON.stringify(many)} queries, at 10: ${JSON.stringify(few)}`);
  // A well-formed id no chat has (the route guard refuses ids like "0" before any read).
  await assert.rejects(service.chats.get("999999999", as(owner)), (error) => error.statusCode === 404);
});

test("a reply in a chat of two bots costs the same after 10 earlier messages as after 200", async (context) => {
  const { knex, homeId, as, owner, service, bot } = await setup(context);
  const scout = await bot("Scout");
  const otto = await bot("Otto");
  const { id: chatId } = await seedChat(knex, { homeId, title: "Let's plan", people: [owner], bots: [scout.id, otto.id] });
  context.after(() => knex("conversations").where({ id: chatId }).del());
  const measured = async (total) => {
    await fill(knex, { botId: scout.id, chatId, personId: owner }, total);
    const sent = await service.chat.sendMessage(chatId, { text: `Plans at ${total}?`, clientId: `plans-${total}-${Date.now()}` }, as(owner));
    const statements = await statementsDuring(knex, async () => {
      await service.chat.reply(chatId, { afterMessageId: sent.messages[0].id }, undefined, as(owner));
      await service.drain(10000);
    }, /./u);
    return statements.map((statement) => statement.sql.replace(/\s+/gu, " "));
  };
  await measured(10);
  const few = await measured(14);
  const many = await measured(200);
  // The statements one side sent more often than the other, to say where a difference comes from.
  const tally = (list) => list.reduce((counts, sql) => counts.set(sql, (counts.get(sql) || 0) + 1), new Map());
  const [fewCounts, manyCounts] = [tally(few), tally(many)];
  const differing = [...new Set([...fewCounts.keys(), ...manyCounts.keys()])]
    .filter((sql) => fewCounts.get(sql) !== manyCounts.get(sql))
    .map((sql) => `${fewCounts.get(sql) || 0} -> ${manyCounts.get(sql) || 0}: ${sql.slice(0, 160)}`);
  assert.equal(many.length, few.length, `a reply of two bots after 200 messages took ${many.length} queries, after 10 ${few.length}:\n${differing.join("\n")}`);
});
