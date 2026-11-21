import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { seedChat, seedMessage, seedMessages } from "../../support/chatFixtures.mjs";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { bootServer, serverQueriesDuring, signUp } from "./http.mjs";
import { forget, insertRows, seedBot, seedHome } from "./seed.mjs";

// Reads whose statements don't grow with the rows, counted on the server's own database over HTTP (D-112): the Team
// list and the chat list send as many statements with 200 bots in 200 chats as with 10, and an open page's catch-up on
// a chat (its news, then the chat read again) as many at 200 messages as at 12.

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

/** `count` bots of Pat's, each in a Public chat of its own with Pat and a message from the bot there, written in bulk. */
async function botsInChats(count, tag) {
  const bots = await insertRows(knex, "bots", Array.from({ length: count }, (_, index) => ({
    made_by: pat.id,
    name: `${tag} ${index + 1}`,
    color: "#1E86FC"
  })), home.id);
  const chats = await insertRows(knex, "conversations", bots.map((bot) => ({ kind: "public", title: bot.name, made_by: pat.id })), home.id);
  await insertRows(knex, "chat_people", chats.map((chat) => ({ conversation_id: chat.id, user_id: pat.id })), home.id);
  await insertRows(knex, "chat_bots", chats.map((chat, index) => ({ conversation_id: chat.id, bot_id: bots[index].id, position: 0 })), home.id);
  await insertRows(knex, "messages", chats.map((chat, index) => ({
    conversation_id: chat.id,
    author_bot_id: bots[index].id,
    role: "bot",
    kind: "text",
    body: JSON.stringify({ text: `Hello from ${bots[index].name}` })
  })), home.id);
}

/** How many statements the server sent for Pat's GET of `path`, whose `list` must hold `expected` rows. */
async function counted(path, list, expected) {
  let answer = null;
  const statements = await serverQueriesDuring(async () => {
    answer = await pat.get(`${home.url}${path}`);
  });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body[list].length, expected, `${path} lists ${expected}`);
  assert.ok(statements > 0, "the server's statements were counted");
  return statements;
}

test("the Team list and the chat list send as many statements with 200 bots in 200 chats as with 10", async () => {
  await botsInChats(10, "Few");
  await counted("/bots", "bots", 10); // the first read may warm caches
  const few = { bots: await counted("/bots", "bots", 10), chats: await counted("/chats", "chats", 10) };
  await botsInChats(190, "More");
  // The chat list answers a page of 100 (chatRepository.js), read like the page of 10.
  const many = { bots: await counted("/bots", "bots", 200), chats: await counted("/chats", "chats", 100) };
  assert.deepEqual(many, few, `200 bots in 200 chats took ${JSON.stringify(many)} statements, 10 took ${JSON.stringify(few)}`);
});

test("a chat's catch-up sends as many statements at 200 messages as at 11", async () => {
  const bot = String((await seedBot(knex, home, pat.id, { name: "Catcher" })).id);
  const { id: chatId } = await seedChat(knex, { homeId: home.id, title: "Catching up", people: [pat.id], bots: [bot] });
  const chat = `${home.url}/chats/${chatId}`;
  let held = 0;
  const measured = async (total) => {
    // Earlier messages written straight to the chat, until it holds `total`.
    const rows = Array.from({ length: total - held }, (_, index) => ({
      body: { text: `Earlier ${index}` },
      ...(index % 2 ? { botId: bot } : { userId: pat.id })
    }));
    if (rows.length) await seedMessages(knex, { homeId: home.id, chatId, rows });
    held = total;
    const opened = await pat.get(`${chat}/messages`);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.messages.length, Math.min(total, 100), "a chat opens on its newest page");
    const { cursor } = opened.body;
    assert.match(cursor, /^\d+$/u, "with a cursor to catch up from");
    const fresh = await seedMessage(knex, { homeId: home.id, chatId, body: { text: `News at ${total}` }, botId: bot });
    held += 1;
    let caught = null;
    let one = null;
    // An open page's news: what changed since its cursor, then the chat as the list shows it.
    const statements = await serverQueriesDuring(async () => {
      caught = await pat.get(`${chat}/messages?since=${cursor}`);
      one = await pat.get(chat);
    });
    assert.equal(caught.status, 200, JSON.stringify(caught.body));
    assert.equal(caught.body.messages.at(-1)?.id, fresh, `the new message arrives last at ${total}`);
    assert.match(caught.body.cursor, /^\d+$/u);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.chat.latest?.preview, `News at ${total}`, "the chat's preview is its news");
    assert.ok(statements > 0, "the server's statements were counted");
    return statements;
  };
  await measured(10); // the first read may warm caches
  const few = await measured(12);
  const many = await measured(200);
  assert.equal(many, few, `the catch-up took ${many} statements at 200 messages, ${few} at 12`);
});
