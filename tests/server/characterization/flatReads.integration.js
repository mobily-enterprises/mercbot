import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { bootServer, serverQueriesDuring, signUp } from "./http.mjs";
import { forget, insertRows, say, seedBot, seedGroup, seedHome, seedRoom, seedSeat } from "./seed.mjs";

// Reads whose statements don't grow with the rows, counted on the server's own database over HTTP: the list of bots
// sends as many statements with 200 bots as with 10, and an open page's catch-up on a chat (its news, then the one bot
// read again) as many at 200 messages as at 10.

let app;
let knex;
let pat;
let home;

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  home = await seedHome(knex, pat.id);
});

after(async () => {
  await app?.close();
  await forget(knex, [home], [pat]);
  await knex?.destroy();
});

/** `count` plain bots of Pat's, each with Pat's seat and a message from the bot, written in bulk. */
async function plainBots(count, tag) {
  const bots = await insertRows(knex, "bots", Array.from({ length: count }, (_, index) => ({
    user_id: pat.id,
    name: `${tag} ${index + 1}`,
    color: "#1E86FC"
  })), home.id);
  const seats = await insertRows(knex, "bot_conversations", bots.map((bot) => ({ bot_id: bot.id, user_id: pat.id })), home.id);
  await insertRows(knex, "bot_messages", seats.map((seat) => ({
    bot_id: seat.bot_id,
    conversation_id: seat.id,
    kind: "text",
    role: "bot",
    body: { text: `Hello from ${seat.bot_id}` }
  })), home.id);
  return bots;
}

test("the list of bots sends as many statements with 200 bots as with 10", async () => {
  // Ten bots of every kind the list reads: plain ones, a shared bot with a room, and a group chat.
  const plain = await plainBots(8, "Plain");
  const shared = await seedBot(knex, home, pat.id, { name: "Shared", sharing: "shared" });
  await say(knex, await seedRoom(knex, shared, "General", pat.id), "In the room");
  await seedGroup(knex, home, pat.id, [plain[0]]);

  const listed = async (expected) => {
    let answer = null;
    const statements = await serverQueriesDuring(async () => {
      answer = await pat.get(`${home.url}/bots`);
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.bots.length, expected);
    assert.ok(statements > 0, "the server's statements were counted");
    return statements;
  };
  await listed(10); // the first read may warm caches
  const few = await listed(10);
  await plainBots(190, "More");
  const many = await listed(200);
  assert.equal(many, few, `the list took ${many} statements at 200 bots, ${few} at 10`);
});

// Earlier messages written straight to the seat, until it holds `total`.
async function fill(seat, total) {
  const { count } = await knex("bot_messages").where({ conversation_id: seat.id }).count("id as count").first();
  const missing = total - Number(count);
  if (missing <= 0) return;
  await insertRows(knex, "bot_messages", Array.from({ length: missing }, (_, index) => ({
    bot_id: seat.bot_id,
    conversation_id: seat.id,
    kind: "text",
    role: index % 2 ? "bot" : "user",
    body: { text: `Earlier message ${index}` }
  })), home.id);
}

test("a chat's catch-up sends as many statements at 200 messages as at 10", async () => {
  const bot = await seedBot(knex, home, pat.id, { name: "Catcher" });
  const seat = await seedSeat(knex, bot, pat.id);
  const chat = `${home.url}/bots/${bot.id}`;
  const measured = async (total) => {
    await fill(seat, total);
    const opened = await pat.get(`${chat}/messages`);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.messages.length, Math.min(total, 100), "a chat opens on its newest page");
    const { cursor } = opened.body;
    assert.match(cursor, /^\d+$/u, "with a cursor to catch up from");
    const fresh = await say(knex, seat, `News at ${total}`);
    let caught = null;
    let one = null;
    // An open page's news: what changed since its cursor, then the bot as the list shows it.
    const statements = await serverQueriesDuring(async () => {
      caught = await pat.get(`${chat}/messages?since=${cursor}`);
      one = await pat.get(chat);
    });
    assert.equal(caught.status, 200, JSON.stringify(caught.body));
    assert.equal(caught.body.messages.at(-1)?.id, fresh, `the new message arrives last at ${total}`);
    assert.match(caught.body.cursor, /^\d+$/u);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.bot.preview, `News at ${total}`, "the bot's preview is its news");
    assert.ok(statements > 0, "the server's statements were counted");
    return statements;
  };
  await measured(10); // the first read may warm caches
  const few = await measured(11);
  const many = await measured(200);
  assert.equal(many, few, `the catch-up took ${many} statements at 200 messages, ${few} at 11`);
});
