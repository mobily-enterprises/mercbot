import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { FilesError, createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createFileTransfer } from "../../packages/files/src/server/fileTransfer.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { pageKeyOf, readPage } from "../../packages/files/src/server/pageDocument.js";
import { createPages } from "../../packages/files/src/server/pages.js";
import { registerRoutes } from "../../packages/files/src/server/registerRoutes.js";
import { memberOptions } from "../support/botRecords.mjs";
import { PICTURE } from "../support/browser.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Copy to… and Move to… (D-120) as a person's request reaches them, on the bots' records and the test database: the
// places a person can open, copying and moving between the home's files, a bot's and a chat's in every direction, from
// one room to another, names already taken, a page that moves or is copied, pictures queued for a copy's check, and every
// refusal: a place they can't open, a file that isn't there, onto itself, into an archived chat, while the home's files
// move storage, and a private chat's file going wider without their yes.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** The files routes as FilesFeature registers them, called as `userId` in home `homeId`. */
function filesRoutes(files) {
  const routes = new Map();
  const http = { router: { register: (method, url, _options, handler) => routes.set(`${method} ${url.replace("/api/w/:workspaceSlug/files", "")}`, handler) } };
  registerRoutes(http, { files, records: null, uploads: null });
  return async function call(method, route, { homeId, userId, query = {}, body = undefined }) {
    const reply = {
      statusCode: 200,
      body: undefined,
      code(status) {
        this.statusCode = status;
        return this;
      },
      send(sent) {
        this.body = sent;
        return this;
      },
      header() {
        return this;
      }
    };
    const request = { params: { workspaceSlug: `home-${homeId}` }, query, body, workspace: { id: homeId }, user: { id: userId }, callOptions: async () => memberOptions({ userId, homeId }) };
    await routes.get(`${method} ${route}`)(request, reply);
    return { status: reply.statusCode, body: reply.body };
  };
}

/** A home of Anna (owner) and Ben, two bots, and the chats the tests move files between; everything removed after. */
async function transferHome(context) {
  const knex = await connectTestDatabase();
  const [anna, ben] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  assert.ok(ben, "the test database needs two users");
  const homes = [];
  const home = async (name, people) => {
    const [row] = await knex("workspaces").insert({ slug: `${name}-${randomBytes(5).toString("hex")}`, name, owner_user_id: people[0], is_personal: false }).returning("id");
    homes.push(String(row.id));
    await knex("workspace_memberships").insert(people.map((id, index) => ({ workspace_id: row.id, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
    return String(row.id);
  };
  const bot = async (homeId, name, extra = {}) => String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC", ...extra }).returning("id"))[0].id);
  const volume = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-transfer-"));
  context.after(async () => {
    await knex("media_checks").whereIn("workspace_id", homes).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
    await fs.rm(volume, { recursive: true, force: true });
  });
  const { records, features } = await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS });
  const { resources, systemContext } = features["mercbot.files"];
  // While `moving.on`, the home's files are being moved to other storage (D-80): only reading is let through.
  const moving = { on: false };
  const ownStorage = async (_homeId, { reading }) => {
    if (moving.on && !reading) throw new FilesError(409, "This home's files are being moved.", { code: "files_storage_moving" });
    return null;
  };
  const store = createFileStore({ root: "", fallback: volume, ownStorage, settle: async () => {}, explain: async () => {} });
  const pages = createPages({ store, resources, systemContext, env: { AUTH_LOCAL_SESSION_SECRET: "transfer-test-secret-0123456789abcdef" }, insecure: true });
  // The copy's checker allows everything; what matters is what's queued for it.
  const checker = { check: async () => ({ verdict: "allow" }), checkText: async () => ({ verdict: "allow" }) };
  const media = createMediaChecks({ guard: createMediaGuard(checker), mediaChecks: resources.mediaChecks, systemContext, store });
  const files = { store, pages, media, apps: null, storage: null };
  const call = filesRoutes({ ...files, transfer: createFileTransfer({ files, records }) });

  const homeId = await home("Rossi", [anna, ben]);
  const [tripbot, chef] = [await bot(homeId, "Tripbot"), await bot(homeId, "Chef")];
  const family = await seedChat(knex, { homeId, kind: "public", title: "Family", people: [anna, ben], bots: [tripbot] });
  // Anna's private room, and another with Ben in it too.
  const plans = await seedChat(knex, { homeId, kind: "private", title: "Plans", people: [anna] });
  const duo = await seedChat(knex, { homeId, kind: "private", title: "Duo", people: [anna, ben] });
  /** A file at `virtualPath` of a place (the store's), with `text` in it. */
  const put = async (place, virtualPath, text = virtualPath) => {
    const real = await store.resolve(store.widened(place), virtualPath);
    await fs.mkdir(path.dirname(real), { recursive: true });
    await fs.writeFile(real, text);
    return real;
  };
  /** The text of a file of a place, or null when it isn't there. */
  const read = async (place, virtualPath) => fs.readFile(await store.resolve(place, virtualPath, { reading: true }), "utf8").catch(() => null);
  const places = {
    home: store.homePlace(homeId),
    bot: (botId) => store.botPlace({ homeId, botId }),
    chat: (chatId) => store.placeFor({ homeId, chatId })
  };
  /** Anna's (or `userId`'s) transfer. */
  const transfer = (body, userId = anna) => call("POST", "/transfer", { homeId, userId, body });
  return { knex, records, anna, ben, home, bot, homeId, tripbot, chef, family, plans, duo, put, read, places, transfer, call, moving, store, pages };
}

const said = (answer) => [answer.status, answer.body?.code];

test("files copy and move between the home's, a bot's and a chat's files, every way, and between rooms", async (context) => {
  const f = await transferHome(context);
  const home = { kind: "home" };
  const bot = { kind: "bot", botId: f.tripbot };
  const family = { kind: "chat", chatId: f.family.id };
  const hops = [
    [home, "/files/shared", f.places.home, bot, "/files/bot", f.places.bot(f.tripbot)],
    [bot, "/files/bot", f.places.bot(f.tripbot), family, "/files/chat", f.places.chat(f.family.id)],
    [family, "/files/chat", f.places.chat(f.family.id), home, "/files/shared", f.places.home],
    [home, "/files/shared", f.places.home, family, "/files/chat", f.places.chat(f.family.id)],
    [family, "/files/chat", f.places.chat(f.family.id), bot, "/files/bot", f.places.bot(f.tripbot)],
    [bot, "/files/bot", f.places.bot(f.tripbot), home, "/files/shared", f.places.home]
  ];
  for (const [index, [from, fromRoot, fromPlace, to, toRoot, toPlace]] of hops.entries()) {
    for (const mode of ["copy", "move"]) {
      const name = `${mode}-${index}.txt`;
      await f.put(fromPlace, `${fromRoot}/${name}`, `${mode} ${index}`);
      const answer = await f.transfer({ mode, from: { place: from, path: `${fromRoot}/${name}` }, to: { place: to, folder: toRoot } });
      assert.deepEqual([answer.status, answer.body], [200, { path: `${toRoot}/${name}` }], `${mode} ${from.kind} → ${to.kind}`);
      assert.equal(await f.read(toPlace, `${toRoot}/${name}`), `${mode} ${index}`, "it arrived");
      assert.equal(await f.read(fromPlace, `${fromRoot}/${name}`), mode === "copy" ? `${mode} ${index}` : null, "a copy keeps the original, a move doesn't");
    }
  }

  // A whole folder, into a folder of a public room Anna isn't in (she can open it), sub-folders and all.
  const lobby = await seedChat(f.knex, { homeId: f.homeId, kind: "public", title: "Lobby", people: [f.ben] });
  await f.put(f.places.chat(f.family.id), "/files/chat/Trip/days/monday.txt", "Rome");
  await f.put(f.places.chat(f.family.id), "/files/chat/Trip/budget.txt", "300");
  await f.put(f.places.chat(lobby.id), "/files/chat/Shared/.keep", "");
  const folder = await f.transfer({ mode: "move", from: { place: family, path: "/files/chat/Trip" }, to: { place: { kind: "chat", chatId: lobby.id }, folder: "/files/chat/Shared" } });
  assert.deepEqual([folder.status, folder.body], [200, { path: "/files/chat/Shared/Trip" }]);
  assert.deepEqual(await Promise.all(["/files/chat/Shared/Trip/days/monday.txt", "/files/chat/Shared/Trip/budget.txt"].map((at) => f.read(f.places.chat(lobby.id), at))), ["Rome", "300"]);
  assert.equal(await f.read(f.places.chat(f.family.id), "/files/chat/Trip/budget.txt"), null);

  // Private to private: Plans (Anna's alone) to another room of hers alone needs no yes.
  const notes = await seedChat(f.knex, { homeId: f.homeId, kind: "private", title: "Notes", people: [f.anna] });
  await f.put(f.places.chat(f.plans.id), "/files/chat/idea.txt", "idea");
  const narrow = await f.transfer({ mode: "copy", from: { place: { kind: "chat", chatId: f.plans.id }, path: "/files/chat/idea.txt" }, to: { place: { kind: "chat", chatId: notes.id }, folder: "/files/chat" } });
  assert.deepEqual([narrow.status, narrow.body], [200, { path: "/files/chat/idea.txt" }]);

  // A folder that isn't there yet is made: "Add from files…" copies into a chat's Uploads before it has any.
  await f.put(f.places.home, "/files/shared/photo.txt", "photo");
  const intoUploads = await f.transfer({ mode: "copy", from: { place: home, path: "/files/shared/photo.txt" }, to: { place: { kind: "chat", chatId: notes.id }, folder: "/files/chat/Uploads" } });
  assert.deepEqual([intoUploads.status, intoUploads.body], [200, { path: "/files/chat/Uploads/photo.txt" }]);
  assert.equal(await f.read(f.places.chat(notes.id), "/files/chat/Uploads/photo.txt"), "photo");

  // A name already taken there gets a number, before its extension, each time.
  await f.put(f.places.home, "/files/shared/report.pdf", "one");
  for (const expected of ["/files/chat/report.pdf", "/files/chat/report (2).pdf", "/files/chat/report (3).pdf"]) {
    const copied = await f.transfer({ mode: "copy", from: { place: home, path: "/files/shared/report.pdf" }, to: { place: family, folder: "/files/chat" } });
    assert.deepEqual(copied.body, { path: expected });
  }
});

test("a private chat's file goes wider only with a yes, and every other refusal says why", async (context) => {
  const f = await transferHome(context);
  const plans = { kind: "chat", chatId: f.plans.id };
  await f.put(f.places.chat(f.plans.id), "/files/chat/plan.txt", "Rome in May");
  const from = { place: plans, path: "/files/chat/plan.txt" };

  // Out of Anna's private room to wherever someone who can't open it could see it: asked first, naming the place.
  const wider = [
    [{ kind: "home" }, "/files/shared", "Home files"],
    [{ kind: "bot", botId: f.tripbot }, "/files/bot", "Tripbot's files"],
    [{ kind: "chat", chatId: f.family.id }, "/files/chat", "Family"],
    [{ kind: "chat", chatId: f.duo.id }, "/files/chat", "Duo"]
  ];
  for (const [place, folder, words] of wider) {
    const asked = await f.transfer({ mode: "copy", from, to: { place, folder } });
    assert.deepEqual([asked.status, asked.body], [409, {
      error: `Everyone who can open ${words} will see this file. Continue?`,
      code: "files_wider_needs_confirm",
      params: { place: words }
    }], words);
    assert.equal((await f.transfer({ mode: "copy", from, to: { place, folder }, confirmed: "yes" })).status, 409, "only true confirms");
  }
  assert.equal(await f.read(f.places.home, "/files/shared/plan.txt"), null, "nothing was copied");
  const yes = await f.transfer({ mode: "copy", from, to: { place: { kind: "home" }, folder: "/files/shared" }, confirmed: true });
  assert.deepEqual([yes.status, yes.body], [200, { path: "/files/shared/plan.txt" }]);

  // A chat with a bot and a chat between two people are private too.
  const withBot = await seedChat(f.knex, { homeId: f.homeId, direct: { userId: f.anna, botId: f.tripbot } });
  await f.put(f.places.chat(withBot.id), "/files/chat/ticket.txt", "ticket");
  const fromBotChat = await f.transfer({ mode: "move", from: { place: { kind: "chat", chatId: withBot.id }, path: "/files/chat/ticket.txt" }, to: { place: { kind: "chat", chatId: f.family.id }, folder: "/files/chat" } });
  assert.deepEqual([fromBotChat.status, fromBotChat.body.params], [409, { place: "Family" }]);
  assert.equal(await f.read(f.places.chat(withBot.id), "/files/chat/ticket.txt"), "ticket", "nothing moved");

  // A place Ben can't open, another home's bot and a bot or chat id that isn't one are the same 404.
  const away = await f.home("Away", [f.anna]);
  const awayBot = await f.bot(away, "Away");
  const notHere = [
    [{ mode: "copy", from, to: { place: { kind: "home" }, folder: "/files/shared" }, confirmed: true }, f.ben, "Ben's copy out of Anna's room"],
    [{ mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/plan.txt" }, to: { place: plans, folder: "/files/chat" } }, f.ben, "Ben's copy into it"],
    [{ mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/plan.txt" }, to: { place: { kind: "bot", botId: awayBot }, folder: "/files/bot" } }, f.anna, "another home's bot"],
    [{ mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/plan.txt" }, to: { place: { kind: "chat", chatId: "1e3" }, folder: "/files/chat" } }, f.anna, "a chat id that isn't one"]
  ];
  for (const [body, userId, why] of notHere) assert.deepEqual(said(await f.transfer(body, userId)), [404, "files_place_not_found"], why);
  const gone = await f.transfer({ mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/nothing.txt" }, to: { place: plans, folder: "/files/chat" } });
  assert.deepEqual(said(gone), [404, "files_file_gone"], "a file that isn't there");
  const outside = await f.transfer({ mode: "copy", from: { place: { kind: "home" }, path: "/files/chat/plan.txt" }, to: { place: plans, folder: "/files/chat" } });
  assert.deepEqual(said(outside), [400, "files_path_outside"], "a path outside the place's own folder");
  const mismatched = [
    { mode: "copy", from: { place: { kind: "bot", botId: f.tripbot }, path: "/files/shared/plan.txt" }, to: { place: plans, folder: "/files/chat" } },
    { mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/plan.txt" }, to: { place: { kind: "bot", botId: f.tripbot }, folder: "/files/shared" } },
    { mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/plan.txt" }, to: { place: { kind: "home" }, folder: "/files/chat" } }
  ];
  for (const body of mismatched) assert.deepEqual(said(await f.transfer(body)), [400, "files_path_outside"], "a path whose folder isn't the place's kind");

  // Onto itself: a move into the folder it's in, and a folder into itself or one of its own folders.
  const home = { kind: "home" };
  await f.put(f.places.home, "/files/shared/Team/Inner/notes.txt", "notes");
  const same = [
    { mode: "move", from: { place: home, path: "/files/shared/plan.txt" }, to: { place: home, folder: "/files/shared" } },
    { mode: "move", from: { place: home, path: "/files/shared/Team" }, to: { place: home, folder: "/files/shared/Team" } },
    { mode: "move", from: { place: home, path: "/files/shared/Team" }, to: { place: home, folder: "/files/shared/Team/Inner" } },
    { mode: "copy", from: { place: home, path: "/files/shared/Team" }, to: { place: home, folder: "/files/shared/Team/Inner" } }
  ];
  for (const body of same) assert.deepEqual(said(await f.transfer(body)), [409, "files_transfer_same"], `${body.mode} ${body.from.path} → ${body.to.folder}`);
  // A copy beside the original is a copy, numbered.
  assert.deepEqual((await f.transfer({ mode: "copy", from: { place: home, path: "/files/shared/plan.txt" }, to: { place: home, folder: "/files/shared" } })).body, { path: "/files/shared/plan (2).txt" });

  // An archived chat takes nothing in, and gives nothing up to a move.
  await f.knex("conversations").where({ id: f.family.id }).update({ archived_at: f.knex.fn.now() });
  await f.put(f.places.chat(f.family.id), "/files/chat/old.txt", "old");
  const family = { kind: "chat", chatId: f.family.id };
  assert.deepEqual(said(await f.transfer({ mode: "copy", from: { place: home, path: "/files/shared/plan.txt" }, to: { place: family, folder: "/files/chat" } })), [409, "bots_chat_archived"]);
  assert.deepEqual(said(await f.transfer({ mode: "move", from: { place: family, path: "/files/chat/old.txt" }, to: { place: home, folder: "/files/shared" } })), [409, "bots_chat_archived"]);
  assert.equal((await f.transfer({ mode: "copy", from: { place: family, path: "/files/chat/old.txt" }, to: { place: home, folder: "/files/shared" } })).status, 200, "a copy out of it is fine");

  // While the home's files are being moved to other storage, nothing is copied or moved (D-80).
  f.moving.on = true;
  assert.deepEqual(said(await f.transfer({ mode: "copy", from: { place: home, path: "/files/shared/plan.txt" }, to: { place: { kind: "bot", botId: f.chef }, folder: "/files/bot" } })), [409, "files_storage_moving"]);
  f.moving.on = false;
  assert.equal(await f.read(f.places.bot(f.chef), "/files/bot/plan.txt"), null);
});

test("a path that climbs out of its place, or a link a bot planted in its files, reaches nothing outside the place", async (context) => {
  const f = await transferHome(context);
  const home = { kind: "home" };
  const tripbot = { kind: "bot", botId: f.tripbot };
  await f.put(f.places.home, "/files/shared/plan.txt", "plan");
  await f.put(f.places.chat(f.plans.id), "/files/chat/private.txt", "Anna's private room");

  // A path with "..", to leave the place's own folder: refused before anything is read or written.
  const climbing = [
    { mode: "copy", from: { place: home, path: "/files/shared/../chat/private.txt" }, to: { place: home, folder: "/files/shared" } },
    { mode: "copy", from: { place: home, path: "/files/shared/plan.txt" }, to: { place: home, folder: "/files/shared/.." } },
    { mode: "copy", from: { place: home, path: "/files/shared/plan.txt" }, to: { place: tripbot, folder: "/files/bot/../shared" } }
  ];
  for (const body of climbing) assert.deepEqual(said(await f.transfer(body)), [400, "files_path_outside"], `${body.from.path} → ${body.to.folder}`);

  // Another home's private file, and links to it that a bot's commands could make in the bot's own files (the app's
  // sandbox lets a bot make links): the link itself, a folder that is a link, and a link inside a folder that's copied.
  const away = await f.home("Away", [f.ben]);
  const secret = await f.put(f.store.homePlace(away), "/files/shared/secret.txt", "another home's secret");
  const botFile = await f.put(f.places.bot(f.tripbot), "/files/bot/notes.txt", "notes");
  const botRoot = path.dirname(botFile);
  await fs.symlink(secret, path.join(botRoot, "secret.txt"));
  await fs.symlink(path.dirname(secret), path.join(botRoot, "Away"));
  await fs.mkdir(path.join(botRoot, "Bundle"));
  await fs.writeFile(path.join(botRoot, "Bundle", "mine.txt"), "mine");
  await fs.symlink(secret, path.join(botRoot, "Bundle", "secret.txt"));

  const linked = await f.transfer({ mode: "copy", from: { place: tripbot, path: "/files/bot/secret.txt" }, to: { place: home, folder: "/files/shared" } });
  assert.deepEqual(said(linked), [404, "files_file_gone"], "a link is no file of the place");
  const through = await f.transfer({ mode: "copy", from: { place: tripbot, path: "/files/bot/Away/secret.txt" }, to: { place: home, folder: "/files/shared" } });
  assert.deepEqual(said(through), [400, "files_path_outside"], "a folder that's a link leads outside the place");
  const moved = await f.transfer({ mode: "move", from: { place: tripbot, path: "/files/bot/Away" }, to: { place: home, folder: "/files/shared" } });
  assert.deepEqual(said(moved), [404, "files_file_gone"], "a link to a folder isn't moved either");
  const bundle = await f.transfer({ mode: "copy", from: { place: tripbot, path: "/files/bot/Bundle" }, to: { place: home, folder: "/files/shared" } });
  assert.deepEqual([bundle.status, bundle.body], [200, { path: "/files/shared/Bundle" }]);
  assert.equal(await f.read(f.places.home, "/files/shared/Bundle/mine.txt"), "mine");
  assert.equal(await f.read(f.places.home, "/files/shared/Bundle/secret.txt"), null, "a link inside a copied folder is left out");
  assert.equal(await f.read(f.places.home, "/files/shared/secret.txt"), null);
  assert.equal(await fs.readFile(secret, "utf8"), "another home's secret", "the other home's file is untouched");
});

test("a moved page keeps its versions and link, a copied page is a page of its own, and pictures wait for a check", async (context) => {
  const f = await transferHome(context);
  const saved = await f.pages.save({ place: f.places.bot(f.tripbot), title: "Party", slug: "party", content: "<h1>Party</h1><p>Saturday.</p>" });
  const versions = () => f.knex("page_versions").whereIn("bot_id", [f.tripbot, f.chef]).orderBy("id").select("bot_id", "path", "page_key");
  const [first] = await versions();
  assert.deepEqual([String(first.bot_id), first.path], [f.tripbot, saved.path]);

  // Moved into Chef's pages, the page is Chef's, with its versions and its key.
  await f.put(f.places.bot(f.chef), "/files/bot/Pages/.keep", "");
  const moved = await f.transfer({
    mode: "move",
    from: { place: { kind: "bot", botId: f.tripbot }, path: saved.path },
    to: { place: { kind: "bot", botId: f.chef }, folder: "/files/bot/Pages" }
  });
  assert.deepEqual(moved.body, { path: "/files/bot/Pages/party.html" });
  assert.deepEqual((await versions()).map((row) => [String(row.bot_id), row.path, row.page_key]), [[f.chef, "/files/bot/Pages/party.html", first.page_key]]);
  const keyAt = async (place, at) => pageKeyOf(readPage(await f.read(place, at)));
  assert.equal(await keyAt(f.places.bot(f.chef), "/files/bot/Pages/party.html"), first.page_key);

  // Copied into the home's pages, it's a new page: a key of its own, and no versions copied.
  const copied = await f.transfer({
    mode: "copy",
    from: { place: { kind: "bot", botId: f.chef }, path: "/files/bot/Pages/party.html" },
    to: { place: { kind: "home" }, folder: "/files/shared" }
  });
  assert.equal(copied.status, 200);
  await f.put(f.places.home, "/files/shared/Pages/.keep", "");
  const intoPages = await f.transfer({ mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/party.html" }, to: { place: { kind: "home" }, folder: "/files/shared/Pages" } });
  assert.deepEqual(intoPages.body, { path: "/files/shared/Pages/party.html" });
  const copyKey = await keyAt(f.places.home, "/files/shared/Pages/party.html");
  assert.ok(copyKey && copyKey !== first.page_key, "the copy has a key of its own");
  assert.equal(await keyAt(f.places.chat(f.family.id), "/files/shared/party.html"), first.page_key, "a copy outside Pages isn't a page, and is left as it is");
  assert.equal((await versions()).length, 1, "no versions were copied");

  // A picture copied, or moved inside a folder, waits for the copy's check where it arrived, by whoever moved it.
  await f.put(f.places.home, "/files/shared/cat.png", PICTURE);
  await f.put(f.places.home, "/files/shared/Album/dog.png", PICTURE);
  await f.put(f.places.home, "/files/shared/Album/list.txt", "not a picture");
  const family = { kind: "chat", chatId: f.family.id };
  assert.equal((await f.transfer({ mode: "copy", from: { place: { kind: "home" }, path: "/files/shared/cat.png" }, to: { place: family, folder: "/files/chat" } })).status, 200);
  assert.equal((await f.transfer({ mode: "move", from: { place: { kind: "home" }, path: "/files/shared/Album" }, to: { place: family, folder: "/files/chat" } })).status, 200);
  const queued = await f.knex("media_checks").where({ workspace_id: f.homeId }).orderBy("path").select("origin", "path", "user_id", "conversation_id");
  assert.deepEqual(queued.map((row) => [row.origin, row.path, String(row.user_id), String(row.conversation_id)]), [
    ["saved_file", "/files/chat/Album/dog.png", f.anna, f.family.id],
    ["saved_file", "/files/chat/cat.png", f.anna, f.family.id]
  ]);
});

test("the places a person can open, read in the same few statements at 3 chats and at 300", async (context) => {
  const f = await transferHome(context);
  const places = async (userId = f.anna) => (await f.call("GET", "/places", { homeId: f.homeId, userId })).body.places;
  // Ben's chat with Anna, a chat of Anna's with Tripbot, a public room Anna isn't in, an archived one, Ben's private
  // room, and an archived bot.
  const [low, high] = [f.anna, f.ben].sort((a, b) => Number(a) - Number(b));
  const [pair] = await f.knex("conversations").insert({ workspace_id: f.homeId, kind: "private", direct_user_id: low, direct_person_id: high, made_by: f.anna }).returning("id");
  await f.knex("chat_people").insert([f.anna, f.ben].map((userId) => ({ conversation_id: pair.id, workspace_id: f.homeId, user_id: userId })));
  const withBot = await seedChat(f.knex, { homeId: f.homeId, direct: { userId: f.anna, botId: f.tripbot } });
  const lobby = await seedChat(f.knex, { homeId: f.homeId, kind: "public", title: "Lobby", people: [f.ben] });
  const old = await seedChat(f.knex, { homeId: f.homeId, kind: "public", title: "Old", people: [f.anna] });
  await f.knex("conversations").where({ id: old.id }).update({ archived_at: f.knex.fn.now() });
  const bens = await seedChat(f.knex, { homeId: f.homeId, kind: "private", title: "Ben's", people: [f.ben] });
  await f.bot(f.homeId, "Retired", { archived_at: f.knex.fn.now() });
  await f.knex("bots").where({ id: f.chef }).update({ is_main: true });
  const benName = (await f.records.chats.names([f.ben], memberOptions({ userId: f.anna, homeId: f.homeId }))).get(f.ben);

  const seen = await places();
  assert.deepEqual(seen.filter((place) => place.kind !== "chat"), [
    { kind: "home", label: "Home files" },
    { kind: "bot", botId: f.tripbot, name: "Tripbot", color: "#1E86FC", shape: seen[1].shape, main: false },
    { kind: "bot", botId: f.chef, name: "Chef", color: "#1E86FC", shape: seen[2].shape, main: true }
  ], "the home and its bots that aren't archived, the main bot marked");
  const chats = (list) => list.filter((place) => place.kind === "chat").map(({ chatId, title, private: closed, direct, archived }) => [chatId, title, closed, direct, archived]);
  assert.deepEqual(chats(seen), [
    [old.id, "Old", false, null, true],
    [lobby.id, "Lobby", false, null, false],
    [withBot.id, "Tripbot", true, "bot", false],
    [String(pair.id), benName, true, "person", false],
    [f.duo.id, "Duo", true, null, false],
    [f.plans.id, "Plans", true, null, false],
    [f.family.id, "Family", false, null, false]
  ], "every chat Anna can open, newest first, as she sees it; never Ben's own room");
  assert.ok(!chats(await places(f.ben)).some(([chatId]) => [f.plans.id, withBot.id].includes(chatId)), "nor Anna's private ones for Ben");
  assert.ok(chats(await places(f.ben)).some(([chatId]) => chatId === bens.id));

  const small = await queriesDuring(f.knex, () => places());
  const rooms = Array.from({ length: 300 }, (_, index) => ({ workspace_id: f.homeId, kind: "public", title: `Room ${index}`, made_by: f.anna }));
  const made = await f.knex("conversations").insert(rooms).returning("id");
  await f.knex("chat_people").insert(made.slice(0, 150).map((row) => ({ conversation_id: row.id, workspace_id: f.homeId, user_id: f.anna })));
  let large = null;
  const counted = await queriesDuring(f.knex, async () => {
    large = await places();
  });
  assert.equal(chats(large).length, chats(seen).length + 300);
  assert.equal(counted, small, "the same statements at 300 more chats");
});
