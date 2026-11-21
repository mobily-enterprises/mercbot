import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createBotLibrary } from "../../packages/bots/src/server/botLibrary.js";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// A bot's Library and the search palette on chats (D-112, R11): what a bot made in every chat the person can open and
// nothing from the others, however old a pin; a page deleted by anyone who can open its chat, its cards marked wherever
// its file shows; and search across the chats the person can open that aren't archived, each result naming its chat.
// The file store is a recording double (surfaceKit.mjs): which place a page is removed from is checked here, the
// store's own handling of that place with the files.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const FILLERS = 400;

/** Anna and Ben's home: Chef in a public Kitchen of both, in Anna's private Surprise, and in Ben's direct chat. */
async function kitchen(context, options) {
  const kit = await startSurfaces(knex, context, options);
  const home = await seedHome(knex, context);
  const { homeId, anna, ben, bot } = home;
  const chef = await bot("Chef");
  const kitchenChat = await seedChat(knex, { homeId, title: "Kitchen", people: [anna, ben], bots: [chef] });
  const secret = await seedChat(knex, { homeId, kind: "private", title: "Surprise", people: [anna], bots: [chef] });
  const bens = await seedChat(knex, { homeId, direct: { userId: ben, botId: chef } });
  /** Things `botId` made in `chat`, oldest first, and their ids. */
  const made = async (chat, list, botId = chef) => (await knex("messages").insert(list.map(([kind, body]) => ({
    workspace_id: homeId, conversation_id: chat.id, author_bot_id: botId, role: "bot", kind, body: JSON.stringify(body)
  }))).returning("id")).map((row) => String(row.id));
  const fillers = (tag) => Array.from({ length: FILLERS }, (_, index) => ["page", { path: `/files/chat/Pages/${tag}-${index}.md`, title: `Filler ${index}`, summary: "" }]);
  return { kit, ...home, chef, kitchenChat, secret, bens, made, fillers };
}

test("a bot's Library is what it made in the chats the person can open, one entry per path, newest first", async (context) => {
  const { kit, homeId, as, bot, chef, kitchenChat, secret, bens, made } = await kitchen(context);
  const [report] = await made(kitchenChat, [["files", { files: [{ path: "/files/chat/report.xlsx", name: "report.xlsx", size: 4000 }] }]]);
  const [party] = await made(secret, [["page", { path: "/files/chat/Pages/party.md", title: "Party plan", summary: "" }]]);
  const [, guide] = await made(kitchenChat, [
    ["page", { path: "/files/chat/Pages/guide.md", title: "Guide", summary: "Old" }],
    ["page", { path: "/files/chat/Pages/guide.md", title: "Guide", summary: "New" }]
  ]);
  const [chart] = await made(bens, [["chart", { path: "/files/chat/Charts/spend.png", title: "Spend", caption: "" }]]);
  // Another bot's, and Chef's own words: neither is in Chef's Library.
  await made(kitchenChat, [["page", { path: "/files/chat/Pages/other.md", title: "Other's", summary: "" }]], await bot("Other"));
  await seedMessage(knex, { homeId, chatId: kitchenChat.id, botId: chef, body: { text: "Here you go" } });

  const forAnna = (await kit.library.library(chef, as("anna"))).items;
  assert.deepEqual(forAnna.map((item) => [item.kind, item.name, item.messageId]), [
    ["chart", "Spend", chart], ["page", "Guide", guide], ["page", "Party plan", party], ["file", "report.xlsx", report]
  ]);
  assert.equal(forAnna[1].summary, "New", "an updated page shows once, newest");
  assert.deepEqual([forAnna[0].botId, forAnna[0].chatId, forAnna[2].chatId], [chef, bens.id, secret.id], "each names its chat, which it opens");
  const forBen = (await kit.library.library(chef, as("ben"))).items;
  assert.deepEqual(forBen.map((item) => item.messageId), [chart, guide, report], "never Anna's private chat's");
  await assert.rejects(kit.library.library("999999999", as("anna")), { statusCode: 404 });
});

test("Pinned keeps a pin older than the Library's newest 400 things, and only the pinned part of it", async (context) => {
  const { kit, as, chef, kitchenChat, made, fillers } = await kitchen(context);
  const [guide, files, pictures] = await made(kitchenChat, [
    ["page", { path: "/files/chat/Pages/pinned.md", title: "Pinned guide", summary: "", pinned: true }],
    ["files", { files: [{ path: "/files/chat/kept.xlsx", name: "kept.xlsx", size: 1, pinned: true }, { path: "/files/chat/loose.xlsx", name: "loose.xlsx", size: 1 }] }],
    ["pictures", { images: [{ path: "/files/chat/Pictures/pinned.png", title: "Pinned picture", caption: "", pinned: true }] }],
    ["chart", { path: "/files/chat/Charts/loose.png", title: "Unpinned chart", caption: "" }],
    ...fillers("pin")
  ]);
  const { items } = await kit.library.library(chef, as("ben"));
  assert.deepEqual(items.filter((item) => item.pinned).map((item) => [item.name, item.messageId]), [
    ["Pinned picture", pictures], ["kept.xlsx", files], ["Pinned guide", guide]
  ]);
  assert.equal(items.length, FILLERS + 3, "the newest 400, then only the older pins");

  // Anyone who can open its chat unpins one; the answer is the Library again.
  const after = await kit.library.pinItem(chef, { messageId: guide, path: "/files/chat/Pages/pinned.md", pinned: false }, as("ben"));
  assert.deepEqual(after.items.filter((item) => item.pinned).map((item) => item.name), ["Pinned picture", "kept.xlsx"]);
  const again = await kit.library.pinItem(chef, { messageId: files, path: "/files/chat/loose.xlsx", pinned: true }, as("ben"));
  assert.deepEqual(again.items.filter((item) => item.pinned).map((item) => item.name), ["Pinned picture", "kept.xlsx", "loose.xlsx"], "a card's one file");
});

test("pinning refuses what's in a chat the person can't open, another bot's, and what isn't made", async (context) => {
  const { kit, homeId, as, bot, chef, kitchenChat, secret, made } = await kitchen(context);
  const [party] = await made(secret, [["page", { path: "/files/chat/Pages/party.md", title: "Party", summary: "" }]]);
  const [others] = await made(kitchenChat, [["page", { path: "/files/chat/Pages/o.md", title: "O", summary: "" }]], await bot("Other"));
  const words = await seedMessage(knex, { homeId, chatId: kitchenChat.id, botId: chef, body: { text: "Hi" } });
  for (const messageId of [party, others, words, "1; drop"]) {
    await assert.rejects(kit.library.pinItem(chef, { messageId, path: "/files/chat/Pages/party.md", pinned: true }, as("ben")), { statusCode: 404, code: "bots_library_entry_not_found" });
  }
  assert.equal((await kit.library.pinItem(chef, { messageId: party, path: "/files/chat/Pages/party.md", pinned: true }, as("anna"))).items[0].pinned, true);
});

test("deleting a page removes its file from its chat's place, widened, and it is listed and found no more", async (context) => {
  const { kit, homeId, as, chef, kitchenChat, secret, made } = await kitchen(context);
  const pagePath = "/files/chat/Pages/plan.md";
  const [first, picture, newest, kept] = await made(kitchenChat, [
    ["page", { path: pagePath, title: "Gone plan", summary: "First" }],
    ["pictures", { images: [{ path: "/files/chat/Pictures/cake.png", title: "Gone cake", caption: "A cake" }] }],
    ["page", { path: pagePath, title: "Gone plan", summary: "Updated", pinned: true }],
    ["page", { path: "/files/chat/Pages/kept.md", title: "Gone kept", summary: "" }]
  ]);
  const [party] = await made(secret, [["page", { path: "/files/chat/Pages/party.md", title: "Party", summary: "" }]]);
  await assert.rejects(kit.library.deletePage(chef, party, as("ben")), { statusCode: 404, code: "bots_library_page_not_found" }, "a private chat he can't open");

  const answer = await kit.library.deletePage(chef, newest, as("ben"));
  assert.deepEqual(answer.items.filter((item) => item.chatId === kitchenChat.id).map((item) => item.messageId), [kept, picture], "gone from the Library, pinned or not");
  assert.deepEqual(answer.messages.map((message) => [message.id, message.body.removed]).sort(), [[first, true], [newest, true]], "every card of it in this chat says so");
  const place = { homeId, chatId: kitchenChat.id, chatKind: "public", botId: chef, kind: "chat", widened: true };
  assert.deepEqual(kit.calls.files, [
    { remove: pagePath, place },
    { pathChanged: { homeId, botId: chef, from: pagePath, to: null } }
  ], "its chat's place, reaching the bot's and the home's folders, and its versions and link go too");
  assert.deepEqual((await kit.library.search("Gone", as("ben"))).files.map((file) => file.name), ["Gone kept", "Gone cake"], "search finds it no more");

  await assert.rejects(kit.library.deletePage(chef, newest, as("ben")), { statusCode: 404, code: "bots_library_page_not_found" }, "deleted once");
  await assert.rejects(kit.library.deletePage(chef, picture, as("ben")), { statusCode: 404 }, "only pages are deleted here");
  await assert.rejects(kit.library.deletePage(chef, "1; drop", as("ben")), { statusCode: 404 });
});

test("a page in the bot's folder is marked in every chat the bot made it in; the shared folder's across the home only", async (context) => {
  const { kit, anna, as, bot, chef, kitchenChat, secret, bens, made } = await kitchen(context);
  const botCard = { path: "/files/bot/Pages/plan.html", title: "Plan", summary: "" };
  const other = await bot("Other");
  const [here] = await made(kitchenChat, [["page", botCard]]);
  const [inSecret] = await made(secret, [["page", botCard]]);
  const [inBens] = await made(bens, [["page", botCard]]);
  const [othersCard] = await made(kitchenChat, [["page", botCard]], other);
  const answer = await kit.library.deletePage(chef, here, as("anna"));
  assert.deepEqual(answer.messages.map((message) => message.id), [here], "it answers the cards in this chat");
  const marked = async (ids) => (await knex("messages").whereIn("id", ids).orderBy("id")).map((row) => [String(row.id), row.body.removed === true]);
  assert.deepEqual(await marked([here, inSecret, inBens, othersCard]), [[here, true], [inSecret, true], [inBens, true], [othersCard, false]],
    "another bot's card names another bot's file");

  const sharedCard = { path: "/files/shared/Pages/rota.html", title: "Rota", summary: "" };
  const [mine] = await made(kitchenChat, [["page", sharedCard]]);
  const [othersShared] = await made(kitchenChat, [["page", sharedCard]], other);
  const elsewhere = await seedHome(knex, context, { name: "Elsewhere" });
  const stranger = await elsewhere.bot("Stranger");
  const theirChat = await seedChat(knex, { homeId: elsewhere.homeId, title: "Theirs", people: [anna], bots: [stranger] });
  const [anotherHome] = (await knex("messages").insert({
    workspace_id: elsewhere.homeId, conversation_id: theirChat.id, author_bot_id: stranger, role: "bot", kind: "page", body: JSON.stringify(sharedCard)
  }).returning("id")).map((row) => String(row.id));
  await kit.library.deletePage(chef, mine, as("ben"));
  assert.deepEqual(await marked([mine, othersShared, anotherHome]), [[mine, true], [othersShared, true], [anotherHome, false]]);
});

test("a pin that lands after a delete keeps the card's Deleted mark", async (context) => {
  const { kit, as, chef, kitchenChat, made } = await kitchen(context);
  const [page] = await made(kitchenChat, [["page", { path: "/files/chat/Pages/race.md", title: "Race", summary: "" }]]);
  const { records } = kit;
  const raced = createBotLibrary({
    records: {
      ...records,
      messages: {
        ...records.messages,
        async messageById(...read) {
          const message = await records.messages.messageById(...read);
          await records.messages.markPageRemoved({ conversationId: kitchenChat.id }, message.body.path, kitchenChat.id, as("anna"));
          return message;
        }
      }
    },
    apps: { apps: { searchViews: async () => [] } },
    files: { store: null }
  });
  await raced.pinItem(chef, { messageId: page, path: "/files/chat/Pages/race.md", pinned: true }, as("anna"));
  const { body } = await knex("messages").where({ id: page }).first();
  assert.deepEqual([body.pinned, body.removed], [true, true]);
});

// Search (D-36, D-46) on chats: the chats the person can open that aren't archived; a private chat only for its people,
// never another home's; each hit names its chat (a direct chat by its bot, and its person's name when it's someone else's).
test("search finds messages, made things and views in the chats the person can open, each naming its chat", async (context) => {
  const views = [{ name: "zqx tracker", slug: "zqx-tracker" }];
  const { kit, homeId, anna, ben, as, chef, kitchenChat, secret, bens, made } = await kitchen(context, { views });
  const word = "zqx";
  const said = {
    kitchen: await seedMessage(knex, { homeId, chatId: kitchenChat.id, userId: anna, body: { text: `The kitchen's ${word}` } }),
    secret: await seedMessage(knex, { homeId, chatId: secret.id, userId: anna, body: { text: `The surprise ${word}` } }),
    bens: await seedMessage(knex, { homeId, chatId: bens.id, botId: chef, body: { text: `Ben's ${word}` } })
  };
  const archived = await seedChat(knex, { homeId, title: "Old", people: [anna, ben], bots: [chef] });
  await knex("conversations").where({ id: archived.id }).update({ archived_at: new Date() });
  await seedMessage(knex, { homeId, chatId: archived.id, userId: anna, body: { text: `An archived ${word}` } });
  const elsewhere = await seedHome(knex, context, { name: "Elsewhere" });
  const theirs = await seedChat(knex, { homeId: elsewhere.homeId, title: "Theirs", people: [anna], bots: [await elsewhere.bot("Stranger")] });
  await seedMessage(knex, { homeId: elsewhere.homeId, chatId: theirs.id, userId: anna, body: { text: `Another home's ${word}` } });
  const [report] = await made(secret, [["files", { files: [{ path: "/files/chat/zqx-report.xlsx", name: "zqx report.xlsx", size: 4 }] }]]);

  const forAnna = await kit.library.search(word, as("anna"));
  const hits = (result) => result.messages.map((message) => message.id).sort();
  assert.deepEqual(hits(forAnna), [said.kitchen, said.secret, said.bens].sort(), "never an archived chat or another home's");
  const kitchenHit = forAnna.messages.find((message) => message.id === said.kitchen);
  assert.deepEqual(kitchenHit, {
    id: said.kitchen, chatId: kitchenChat.id, chatName: "Kitchen", chatKind: "public", role: "user", authorName: "you",
    text: `The kitchen's ${word}`, createdAt: kitchenHit.createdAt
  });
  assert.match(forAnna.messages.find((message) => message.id === said.bens).chatName, /^Chef and (?!you$)./u, "Ben's direct chat, by its person");
  assert.equal(forAnna.messages.find((message) => message.id === said.bens).authorName, "Chef");
  assert.deepEqual(forAnna.files.map((file) => [file.kind, file.name]), [["view", "zqx tracker"], ["file", "zqx report.xlsx"]], "views first");
  assert.deepEqual([forAnna.files[1].messageId, forAnna.files[1].botName, forAnna.files[1].chatName], [report, "Chef", "Surprise"]);

  const forBen = await kit.library.search(word, as("ben"));
  assert.deepEqual(hits(forBen), [said.kitchen, said.bens].sort(), "never Anna's private chat's");
  assert.equal(forBen.messages.find((message) => message.id === said.bens).chatName, "Chef", "his own direct chat, by its bot");
  assert.notEqual(forBen.messages.find((message) => message.id === said.kitchen).authorName, "you");
  assert.deepEqual(forBen.files.map((file) => file.kind), ["view"], "nor its files");
});

test("the palette reads the routines in the chats the person can open as it opens, and each query reads none", async (context) => {
  const { kit, homeId, anna, as, chef, kitchenChat, secret } = await kitchen(context);
  const routine = async (chat, name, enabled) => String((await knex("bot_routines").insert({
    workspace_id: homeId, chat_bot_id: chat.chatBotIds.get(chef), name, schedule: "Every day at 08:00", made_by: anna, enabled
  }).returning("id"))[0].id);
  const news = await routine(kitchenChat, "Morning news", true);
  const party = await routine(secret, "Party countdown", false);
  const opened = await kit.library.search("", as("anna"));
  assert.deepEqual(opened.routines, [
    { id: news, name: "Morning news", schedule: "Every day at 08:00", botId: chef, botName: "Chef", chatId: kitchenChat.id, chatName: "Kitchen" },
    { id: party, name: "Party countdown", schedule: "Paused", botId: chef, botName: "Chef", chatId: secret.id, chatName: "Surprise" }
  ]);
  assert.deepEqual((await kit.library.search("", as("ben"))).routines.map((entry) => entry.id), [news], "never a private chat's he isn't in");
  let typed;
  const routineReads = await statementsDuring(knex, async () => { typed = await kit.library.search("Morning", as("anna")); }, /bot_routines/u);
  assert.deepEqual(typed.routines, []);
  assert.equal(routineReads.length, 0, "typing doesn't read the routines again");
});

test("search reads the same statements finding 2 things as finding its most, in a home of 5 chats or of 30", async (context) => {
  const { kit, homeId, anna, ben, as, chef, made } = await kitchen(context);
  const grow = async (count) => {
    for (let index = 0; index < count; index++) {
      const chat = await seedChat(knex, { homeId, title: `Chat ${index}`, people: [anna, ben], bots: [chef] });
      await seedMessage(knex, { homeId, chatId: chat.id, userId: ben, body: { text: `qzk ${index}` } });
      await made(chat, [["page", { path: `/files/chat/Pages/qzk-${index}.md`, title: `qzk ${index}`, summary: "" }]]);
    }
  };
  await grow(2);
  const count = () => queriesDuring(knex, () => kit.library.search("qzk", as("anna")));
  const few = await count();
  await grow(25);
  assert.equal(await count(), few);
});
