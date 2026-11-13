import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { plansDuring, queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// Open pages catch up on a chat instead of reading it again (D-15), against the disposable test
// database: news reads only what was written or changed since the page's cursor, including a
// message whose transaction committed after a later one's, and what a notice costs (the catch-up,
// the one bot's row, the list, a group's reply) doesn't grow with the chat.
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
    reply: async () => ({ text: "ok", transcript: [] }),
    groupReply: async (bot) => `${bot.name} here.`
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
  return { knex, owner: String(owner), as, service, bot, made, tag };
}

// Earlier messages, written straight to the conversation, until it holds `total`.
async function fill(knex, botId, conversationId, total) {
  const { count } = await knex("bot_messages").where({ conversation_id: conversationId }).count("id as count").first();
  const missing = total - Number(count);
  if (missing <= 0) return;
  const { workspace_id: workspaceId } = await knex("bot_conversations").where({ id: conversationId }).first("workspace_id");
  await knex("bot_messages").insert(Array.from({ length: missing }, (_, index) => ({
    workspace_id: workspaceId,
    bot_id: botId,
    conversation_id: conversationId,
    kind: "text",
    role: index % 2 ? "bot" : "user",
    body: { text: `Earlier message ${index}` }
  })));
}

const say = async (knex, row, text, role = "bot") =>
  String((await knex("bot_messages").insert({ workspace_id: row.workspace_id, bot_id: row.id, conversation_id: row.conversation_id, kind: "text", role, body: { text } })
    .returning("id"))[0].id);

test("a catch-up reads what's new, and costs the same at 10 messages as at 200", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Catcher");
  const measured = async (total) => {
    await fill(knex, row.id, row.conversation_id, total);
    const { messages: newest, cursor } = await service.messages(row.id, null, {}, as(owner));
    assert.equal(newest.length, Math.min(total, 100), "without a cursor, the chat's newest page");
    assert.match(cursor, /^\d+$/u, "and a cursor to catch up from");
    const fresh = await say(knex, row, `News at ${total}`);
    let caught = null;
    const count = await queriesDuring(knex, async () => {
      caught = await service.messages(row.id, null, { since: cursor }, as(owner));
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
  await fill(knex, row.id, row.conversation_id, 250);
  const everything = (await knex("bot_messages").where({ conversation_id: row.conversation_id }).orderBy("id").pluck("id")).map(String);
  const opened = await service.messages(row.id, null, {}, as(owner));
  assert.deepEqual(opened.messages.map((message) => message.id), everything.slice(-100), "the newest 100, oldest first");
  assert.equal(opened.more, true, "and older ones are left");
  assert.match(opened.cursor, /^\d+$/u, "with a cursor to catch up from");

  // Scrolling back: each page is the one before the oldest message shown.
  let shown = opened.messages.map((message) => message.id);
  let more = opened.more;
  const pages = [];
  while (more) {
    const page = await service.messages(row.id, null, { before: shown[0] }, as(owner));
    assert.equal(page.cursor, undefined, "an older page says nothing about news");
    pages.push(page.messages.length);
    shown = [...page.messages.map((message) => message.id), ...shown];
    more = page.more;
  }
  assert.deepEqual(pages, [100, 50]);
  assert.deepEqual(shown, everything, "every message once, in order, across both page boundaries");

  // A message written while the person reads back comes with the catch-up, and no page holds it.
  const fresh = await say(knex, row, "Written meanwhile");
  const caught = await service.messages(row.id, null, { since: opened.cursor }, as(owner));
  assert.equal(caught.messages.at(-1)?.id, fresh, "the catch-up brings it, last");
  assert.deepEqual((await service.messages(row.id, null, { before: shown[0] }, as(owner))).messages, []);

  // Exactly a page: nothing older is announced, so the page never asks for an empty one.
  const exact = await bot("Exact");
  await fill(knex, exact.id, exact.conversation_id, 100);
  const full = await service.messages(exact.id, null, {}, as(owner));
  assert.deepEqual([full.messages.length, full.more], [100, false]);

  for (const before of ["", "0", "12a", "1e3", "-4", "123456789012345678901"]) {
    await assert.rejects(service.messages(row.id, null, { before }, as(owner)), (error) => error.code === "bots_before_invalid", JSON.stringify(before));
  }
  await assert.rejects(service.messages(row.id, null, { before: shown[0], since: opened.cursor }, as(owner)), (error) => error.code === "bots_before_invalid", "a page or a catch-up, not both");
});

test("opening a chat costs the same at 10 messages as at 300, and reads only its newest page", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Opener");
  const measured = async (total) => {
    await fill(knex, row.id, row.conversation_id, total);
    // The planner sees the chat at its size, as a server's statistics would show it.
    await knex.raw("analyze bot_messages");
    let opened = null;
    const plans = await plansDuring(knex, async () => {
      opened = await service.messages(row.id, null, {}, as(owner));
    });
    assert.equal(opened.messages.length, Math.min(total, 100));
    const page = plans.filter((plan) => /from "bot_messages"/u.test(plan.sql));
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
  await fill(knex, row.id, row.conversation_id, 20);
  const older = await knex("bot_messages").where({ conversation_id: row.conversation_id }).orderBy("id").first();
  const { cursor } = await service.messages(row.id, null, {}, as(owner));
  // As a card's answer does: the row is updated in place, and keeps its id.
  await knex("bot_messages").where({ id: older.id }).update({ body: { ...older.body, text: "Changed since" } });
  const { messages } = await service.messages(row.id, null, { since: cursor }, as(owner));
  const changed = messages.find((message) => message.id === String(older.id));
  assert.ok(changed, "the changed older message is sent again");
  assert.equal(changed.body.text, "Changed since");
});

test("a message whose transaction commits after a later one's still arrives", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Latecomer");
  await fill(knex, row.id, row.conversation_id, 5);
  const { cursor: start } = await service.messages(row.id, null, {}, as(owner));
  const trx = await knex.transaction();
  try {
    // Its id is taken now, before the next message's, but it commits after that one is read.
    const [{ id: lateId }] = await trx("bot_messages")
      .insert({ workspace_id: row.workspace_id, bot_id: row.id, conversation_id: row.conversation_id, kind: "text", role: "bot", body: { text: "Late" } })
      .returning("id");
    const later = await say(knex, row, "Later");
    assert.ok(Number(later) > Number(lateId), "the committed message has the higher id");
    const first = await service.messages(row.id, null, { since: start }, as(owner));
    assert.ok(first.messages.some((message) => message.id === later), "the committed one arrives");
    assert.ok(!first.messages.some((message) => message.id === String(lateId)), "the uncommitted one can't yet");
    await trx.commit();
    const second = await service.messages(row.id, null, { since: first.cursor }, as(owner));
    assert.ok(second.messages.some((message) => message.id === String(lateId)), "after its commit, the next catch-up brings it");
  } finally {
    if (!trx.isCompleted()) await trx.rollback();
  }
});

test("a cursor that isn't a transaction id is refused", async (context) => {
  const { as, owner, service, bot } = await setup(context);
  const row = await bot("Strict");
  for (const since of ["", "abc", "-1", "1.5", "1; select 1", "99999999999999999999", 12]) {
    await assert.rejects(service.messages(row.id, null, { since }, as(owner)), (error) => error.code === "bots_cursor_invalid", String(since));
  }
});

test("one bot's row and the list cost the same at 10 messages as at 200", async (context) => {
  const { knex, as, owner, service, bot } = await setup(context);
  const row = await bot("Lister");
  const measured = async (total) => {
    await fill(knex, row.id, row.conversation_id, total);
    const latest = `Latest at ${total}`;
    await say(knex, row, latest);
    let listed = null;
    let list = null;
    const one = await queriesDuring(knex, async () => {
      listed = await service.listedBot(row.id, as(owner));
    });
    const all = await queriesDuring(knex, async () => {
      list = await service.listBots(as(owner));
    });
    assert.equal(listed.preview, latest, "the bot's preview is its latest message");
    assert.deepEqual(list.bots.find((entry) => entry.id === listed.id), listed, "the same as the list shows it");
    return { one, all };
  };
  await measured(10);
  const few = await measured(10 + 2);
  const many = await measured(200);
  assert.deepEqual(many, few, `at 200 messages: ${JSON.stringify(many)} queries, at 10: ${JSON.stringify(few)}`);
  // A well-formed id no bot has (the route guard refuses ids like "0" before any read).
  await assert.rejects(service.listedBot("999999999", as(owner)), /not found/iu);
});

test("a group's reply costs the same after 10 earlier messages as after 200", async (context) => {
  const { knex, as, owner, service, bot, made } = await setup(context);
  const scout = await bot("Scout");
  const otto = await bot("Otto");
  const { bot: group } = await service.createGroup({ botIds: [scout.id, otto.id], text: "Let's plan" }, "Owner", as(owner));
  made.push(group.id);
  await service.drain(10000);
  const room = await knex("bot_conversations").where({ bot_id: group.id }).whereNull("user_id").whereNull("group_id").first();
  const measured = async (total) => {
    await fill(knex, group.id, room.id, total);
    const sent = await service.sendMessage(group.id, { text: `Plans at ${total}?`, clientId: `plans-${total}-${Date.now()}` }, as(owner));
    const statements = await statementsDuring(knex, async () => {
      await service.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(owner));
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
  assert.equal(many.length, few.length, `a group reply after 200 messages took ${many.length} queries, after 10 ${few.length}:\n${differing.join("\n")}`);
});
