import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { statementsDuring } from "../support/queryCount.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";
import { createBotLibrary } from "../../packages/bots/src/server/botLibrary.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { testBot } from "./testHome.js";

// The Library and the search palette in a chat that has made more than the Library's newest
// 400 things: search finds an old made thing by its name, Pinned keeps an old pin, and the palette's typing reads only
// what matches the words.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const FILLERS = 400;

async function setup(context) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: `Librarian ${Date.now().toString(36)}` });
  // The bot's files, in a folder of the test's own.
  const filesRoot = await mkdtemp(path.join(os.tmpdir(), "mercbot-library-"));
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
    await rm(filesRoot, { recursive: true, force: true });
  });
  const store = createFileStore({ fallback: filesRoot, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const records = await startBotRecords(knex, context);
  // What a deleted page told the pages (its versions and link go with it, D-74).
  const pathChanges = [];
  /** The Library as `row` sees the bot: a person's own conversation with it, or a shared bot's room. */
  const libraryOf = (row) => createBotLibrary({
    records,
    conversations: { ownedSingleBot: async () => row },
    apps: { apps: { searchViews: async () => [] } },
    files: { store, pages: { pathChanged: async (change) => pathChanges.push(change) } }
  });
  const library = libraryOf(bot);
  /** Messages the bot made, oldest first, and their ids; in the person's own conversation unless `conversationId` says. */
  const made = async (list, conversationId = bot.conversation_id) => (await knex("bot_messages").insert(list.map(([kind, body]) => ({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind, role: "bot", body
  }))).returning("id")).map((row) => String(row.id));
  const fillers = (tag) => Array.from({ length: FILLERS }, (_, index) => ["page", { path: `/files/mine/Pages/${tag}-${index}.md`, title: `Filler ${index}`, summary: "" }]);
  /** A file in the person's own folder with the bot (or `row`'s), and where it really is. */
  async function saved(virtualPath, row = bot) {
    const real = await store.resolve(store.placeFor(row, row.user_id), virtualPath);
    await mkdir(path.dirname(real), { recursive: true });
    await writeFile(real, "# A page\n");
    return real;
  }
  return { knex, bot, records, library, libraryOf, made, fillers, saved, pathChanges, userId, mine: memberOptions({ userId, homeId: bot.workspace_id }) };
}

test("search finds a made thing by name however old, one entry per path, newest first", async (context) => {
  const { library, made, fillers, mine } = await setup(context);
  const tag = `old${Date.now().toString(36)}`;
  const [report, cake] = await made([
    ["files", { files: [{ path: `/files/mine/${tag}-report.xlsx`, name: `${tag} report.xlsx`, size: 4000 }, { path: "/files/mine/other.csv", name: "other.csv", size: 10 }] }],
    ["pictures", { images: [{ path: `/files/mine/Pictures/${tag}.png`, title: `${tag} cake`, caption: "A cake" }] }],
    ...fillers(tag)
  ]);
  const [, guide] = await made([
    ["page", { path: `/files/mine/Pages/${tag}.md`, title: `${tag} guide`, summary: "Old" }],
    ["page", { path: `/files/mine/Pages/${tag}.md`, title: `${tag} guide`, summary: "New" }],
    ["view", { path: `${tag}-view`, title: `${tag} view`, summary: "A view is found among the home's apps" }]
  ]);
  const { files } = await library.search(tag, mine);
  assert.deepEqual(files.map((file) => [file.kind, file.name, file.messageId]), [
    ["page", `${tag} guide`, guide],
    ["picture", `${tag} cake`, cake],
    ["file", `${tag} report.xlsx`, report]
  ]);
  assert.equal(files[0].summary, "New", "an updated page shows once, newest");
  assert.equal(files[2].size, 4000);
  assert.ok(files.every((file) => file.botName), "each names its bot");
});

test("search answers at most five made things, the newest", async (context) => {
  const { library, made, mine } = await setup(context);
  const tag = `five${Date.now().toString(36)}`;
  const ids = await made(Array.from({ length: 7 }, (_, index) => ["chart", { path: `/files/mine/Charts/${tag}-${index}.png`, title: `${tag} chart ${index}`, caption: "" }]));
  const { files } = await library.search(tag, mine);
  assert.deepEqual(files.map((file) => file.messageId), ids.slice(-5).reverse());
});

test("Pinned keeps a pin older than the Library's newest 400 things, and only the pinned part of it", async (context) => {
  const { library, made, fillers, mine, bot } = await setup(context);
  const tag = `pin${Date.now().toString(36)}`;
  const [guide, files, pictures] = await made([
    ["page", { path: `/files/mine/Pages/${tag}.md`, title: "Pinned guide", summary: "", pinned: true }],
    ["files", { files: [{ path: `/files/mine/${tag}-kept.xlsx`, name: "kept.xlsx", size: 1, pinned: true }, { path: `/files/mine/${tag}-loose.xlsx`, name: "loose.xlsx", size: 1 }] }],
    ["pictures", { images: [{ path: `/files/mine/Pictures/${tag}.png`, title: "Pinned picture", caption: "", pinned: true }] }],
    ["chart", { path: `/files/mine/Charts/${tag}.png`, title: "Unpinned chart", caption: "" }],
    ...fillers(tag)
  ]);
  const { items } = await library.library(bot.id, mine);
  assert.deepEqual(items.filter((item) => item.pinned).map((item) => [item.name, item.messageId]), [
    ["Pinned picture", pictures],
    ["kept.xlsx", files],
    ["Pinned guide", guide]
  ]);
  assert.equal(items.length, FILLERS + 3, "the newest 400, then only the older pins");

  // Unpinning one takes it out; the answer is the Library again.
  const after = await library.pinItem(bot.id, { messageId: guide, path: `/files/mine/Pages/${tag}.md`, pinned: false }, mine);
  assert.deepEqual(after.items.filter((item) => item.pinned).map((item) => item.name), ["Pinned picture", "kept.xlsx"]);
});

test("the palette reads the routines as it opens, and each query reads none", async (context) => {
  const { knex, library, bot, mine } = await setup(context);
  const [routine] = await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: bot.conversation_id, name: "Morning news", schedule: "Every day at 08:00"
  }).returning("id");
  const opened = await library.search("", mine);
  assert.ok(opened.routines.some((entry) => entry.id === String(routine.id) && entry.name === "Morning news"));
  let typed;
  const routineReads = await statementsDuring(knex, async () => {
    typed = await library.search("Morning", mine);
  }, /bot_routines/u);
  assert.deepEqual(typed.routines, []);
  assert.equal(routineReads.length, 0, "typing doesn't read the routines again");
});

test("deleting a page from the Library deletes its file, and it is listed, found and opened no more", async (context) => {
  const { library, made, saved, pathChanges, mine, bot } = await setup(context);
  const tag = `gone${Date.now().toString(36)}`;
  const pagePath = `/files/mine/Pages/${tag}.md`;
  const real = await saved(pagePath);
  const [first, picture, newest, kept] = await made([
    ["page", { path: pagePath, title: `${tag} plan`, summary: "First" }],
    ["pictures", { images: [{ path: `/files/mine/Pictures/${tag}.png`, title: `${tag} cake`, caption: "A cake" }] }],
    ["page", { path: pagePath, title: `${tag} plan`, summary: "Updated", pinned: true }],
    ["page", { path: `/files/mine/Pages/${tag}-kept.md`, title: `${tag} kept`, summary: "" }]
  ]);

  const answer = await library.deletePage(bot.id, newest, mine);
  assert.deepEqual(answer.items.map((item) => item.messageId), [kept, picture], "the page is gone from the Library, pinned or not");
  assert.deepEqual(answer.messages.map((message) => [message.id, message.body.removed]).sort(), [[first, true], [newest, true]], "every card of it says so");
  assert.equal(await stat(real).catch(() => null), null, "its file is deleted");
  assert.deepEqual(pathChanges, [{ homeId: String(bot.workspace_id), botId: String(bot.id), from: pagePath, to: null }], "its versions and link go too");
  assert.deepEqual((await library.search(tag, mine)).files.map((file) => file.name), [`${tag} kept`, `${tag} cake`], "search finds it no more");

  await assert.rejects(library.deletePage(bot.id, newest, mine), { statusCode: 404, code: "bots_library_page_not_found" }, "deleted once");
  await assert.rejects(library.deletePage(bot.id, picture, mine), { statusCode: 404 }, "only pages are deleted here");
  await assert.rejects(library.deletePage(bot.id, "1; drop", mine), { statusCode: 404 });

  // A page whose file is already gone is still taken out of the Library.
  const after = await library.deletePage(bot.id, kept, mine);
  assert.deepEqual(after.items.map((item) => item.messageId), [picture]);
});

// Who may delete a page (D-36, D-66): the pages of a person's own chat with a bot are theirs, so someone else in the
// home, whose own chat with the same bot is another conversation, can't reach them; a shared bot's room is everyone's,
// so anyone in the home deletes its pages.
test("a page in someone's own chat is theirs to delete; a shared bot's is anyone's in the home", async (context) => {
  const { knex, bot, library, libraryOf, made, saved, userId, mine } = await setup(context);
  const colleague = (await knex("users").whereNot({ id: userId }).orderBy("id").first()).id;
  const theirs = memberOptions({ userId: colleague, homeId: bot.workspace_id });
  const tag = `own${Date.now().toString(36)}`;
  const pagePath = `/files/mine/Pages/${tag}.md`;
  const real = await saved(pagePath);
  const [page] = await made([["page", { path: pagePath, title: `${tag} plan`, summary: "" }]]);
  const [seat] = await knex("bot_conversations").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, user_id: colleague }).returning("*");

  const colleagueSees = libraryOf({ ...bot, user_id: colleague, conversation_id: seat.id });
  await assert.rejects(colleagueSees.deletePage(bot.id, page, theirs), { statusCode: 404, code: "bots_library_page_not_found" });
  assert.ok(await stat(real), "the file stays");
  assert.deepEqual((await library.library(bot.id, mine)).items.map((item) => item.messageId), [page], "and so does the page");

  const [room] = await knex("bot_conversations").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, title: "General" }).returning("*");
  const shared = { ...bot, sharing: "shared", user_id: colleague, conversation_id: room.id };
  const roomPath = `/files/mine/Pages/${tag}-room.md`;
  const roomFile = await saved(roomPath, shared);
  const [roomPage] = await made([["page", { path: roomPath, title: `${tag} room plan`, summary: "" }]], room.id);
  const answer = await libraryOf(shared).deletePage(bot.id, roomPage, theirs);
  assert.deepEqual(answer.messages.map((message) => [message.id, message.body.removed]), [[roomPage, true]]);
  assert.equal(await stat(roomFile).catch(() => null), null, "the shared bot's file is deleted");
});

// A deleted page's cards wherever the same file shows (D-66, D-74): a page in the bot's folder is the bot's, so its
// cards in a colleague's chat with the bot and where the bot spoke in a group say Deleted too; another bot's card
// naming the same path is about another file and stays. The answer is the cards in the chat the person is looking at.
test("deleting a page in the bot's folder marks its cards in every chat and group the bot made them in", async (context) => {
  const { knex, bot, library, made, saved, userId, mine } = await setup(context);
  const colleague = (await knex("users").whereNot({ id: userId }).orderBy("id").first()).id;
  const tag = `everywhere${Date.now().toString(36)}`;
  const pagePath = `/files/bot/Pages/${tag}.html`;
  await saved(pagePath);
  const card = { path: pagePath, title: `${tag} plan`, summary: "" };
  const [seat] = await knex("bot_conversations").insert({ workspace_id: bot.workspace_id, bot_id: bot.id, user_id: colleague }).returning("*");
  const group = await testBot(knex, userId, { name: `Group ${tag}`, kind: "group" });
  const other = await testBot(knex, userId, { name: `Other ${tag}` });
  const said = (row, body) => ({ workspace_id: bot.workspace_id, bot_id: row.id, conversation_id: row.conversation_id, kind: "page", role: "bot", body });
  const [here] = await made([["page", card]]);
  const [colleagues] = await made([["page", card]], seat.id);
  const [grouped, othersInGroup, othersOwn] = (await knex("bot_messages").insert([
    said(group, { ...card, speaker: { id: String(bot.id), name: bot.name } }),
    said(group, { ...card, speaker: { id: String(other.id), name: other.name } }),
    said(other, card)
  ]).returning("id")).map((row) => String(row.id));

  const answer = await library.deletePage(bot.id, here, mine);
  assert.deepEqual(answer.messages.map((message) => [message.id, message.body.removed]), [[here, true]], "it answers the cards in this chat");
  const marked = async (ids) => (await knex("bot_messages").whereIn("id", ids).orderBy("id")).map((row) => [String(row.id), row.body.removed === true]);
  assert.deepEqual(await marked([here, colleagues, grouped, othersInGroup, othersOwn]), [
    [here, true], [colleagues, true], [grouped, true], [othersInGroup, false], [othersOwn, false]
  ]);
  await knex("bots").whereIn("id", [group.id, other.id]).del();
});

// A pin racing a delete: the delete marks the card while the pin is between reading it and writing it. The
// pin merges only its own field into the card, so the card still says Deleted.
test("a pin that lands after a delete keeps the card's Deleted mark", async (context) => {
  const { knex, bot, records, made, mine } = await setup(context);
  const tag = `race${Date.now().toString(36)}`;
  const [page] = await made([["page", { path: `/files/mine/Pages/${tag}.md`, title: `${tag} plan`, summary: "" }]]);
  const raced = createBotLibrary({
    records: {
      ...records,
      messages: {
        ...records.messages,
        async messageIn(...read) {
          const message = await records.messages.messageIn(...read);
          await records.messages.markPageRemoved({ conversationId: bot.conversation_id }, message.body.path, bot.conversation_id, mine);
          return message;
        }
      }
    },
    conversations: { ownedSingleBot: async () => bot },
    apps: { apps: { searchViews: async () => [] } },
    files: { store: null }
  });
  await raced.pinItem(bot.id, { messageId: page, path: `/files/mine/Pages/${tag}.md`, pinned: true }, mine);
  const { body } = await knex("bot_messages").where({ id: page }).first();
  assert.deepEqual([body.pinned, body.removed], [true, true]);
});

// The mark is written in the home's own context (D-66), since the person deleting may not see the others' chats: a
// page in the home's shared folder is every bot's in the home, so all its cards there say Deleted, and a card in
// another home naming the same path is about another home's file and stays as it is.
test("deleting a page in the home's shared folder marks its cards across the home, and no other home's", async (context) => {
  const { knex, bot, library, made, saved, userId, mine } = await setup(context);
  const tag = `shared${Date.now().toString(36)}`;
  const pagePath = `/files/shared/Pages/${tag}.html`;
  await saved(pagePath);
  const card = { path: pagePath, title: `${tag} plan`, summary: "" };
  const other = await testBot(knex, userId, { name: `Other ${tag}` });
  const [elsewhere] = await knex("workspaces").insert({ slug: `elsewhere-${tag}`, name: "Elsewhere", owner_user_id: userId, is_personal: false }).returning("id");
  const [stranger] = await knex("bots").insert({ user_id: userId, workspace_id: elsewhere.id, name: `Stranger ${tag}`, color: "#1E86FC" }).returning("*");
  const [seat] = await knex("bot_conversations").insert({ workspace_id: elsewhere.id, bot_id: stranger.id, user_id: userId }).returning("*");
  const [here] = await made([["page", card]]);
  const [othersCard, anotherHome] = (await knex("bot_messages").insert([
    { workspace_id: bot.workspace_id, bot_id: other.id, conversation_id: other.conversation_id, kind: "page", role: "bot", body: card },
    { workspace_id: elsewhere.id, bot_id: stranger.id, conversation_id: seat.id, kind: "page", role: "bot", body: card }
  ]).returning("id")).map((row) => String(row.id));

  await library.deletePage(bot.id, here, mine);
  const marked = (await knex("bot_messages").whereIn("id", [here, othersCard, anotherHome]).orderBy("id")).map((row) => [String(row.id), row.body.removed === true]);
  assert.deepEqual(marked, [[here, true], [othersCard, true], [anotherHome, false]]);
});
