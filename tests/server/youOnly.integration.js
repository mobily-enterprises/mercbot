import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { registerRoutes as registerComputerRoutes } from "../../packages/computer/src/server/registerRoutes.js";
import { registerRoutes as registerFileRoutes } from "../../packages/files/src/server/registerRoutes.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";

// A Shared bot keeps each person's own chat as its last tab, "You only" (D-99), against the disposable test database,
// with scripted replies in place of the model: nobody else reads it, nothing in it goes where others read, its files
// and computer are the person's own, leaving Shared pauses what the hidden tabs would run, and search and requests
// land in the right tab.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const texts = (page) => page.messages.filter((message) => message.kind === "text").map((message) => message.body.text);

/**
 * A home of its own with Pat (its owner, who makes the bots) and Kim (a member), the bot Ledger, the bots' records and
 * background parts, and a bots service whose replies record what each turn was given and run `act` (the reply's own
 * tools) first. `pausedWatches` is what the Apps' watches answer when a bot leaving Shared pauses those of its rooms.
 */
async function setup(context, { pausedWatches = [], act = null } = {}) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const [kimRow] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
  }).returning("id");
  const kim = String(kimRow.id);
  const [home] = await knex("workspaces").insert({ slug: `you-only-${stamp}`, name: "Hilltop", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: kim, role_sid: "member", status: "active" }
  ]);
  await knex("workspace_settings").insert({ workspace_id: homeId });
  context.after(async () => {
    await knex("bots").where({ workspace_id: homeId }).del();
    await knex("workspace_settings").where({ workspace_id: homeId }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId }).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").where({ id: kim }).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const turns = [];
  const watchCalls = [];
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    requestLimits: { retryMs: 200, resumeMs: 200, nextTurnMs: 200 },
    apps: {
      watches: {
        pauseIn: async (where) => {
          watchCalls.push(where);
          return pausedWatches.filter((watch) => where.conversationIds.includes(watch.conversationId));
        }
      }
    },
    reply: async (current, history, tools, state, prompt) => {
      turns.push({ bot: String(current.id), state, prompt, history: history.filter((message) => message.kind === "text").map((message) => message.body.text) });
      if (act) await act(current, tools);
      return { text: "Noted.", transcript: [] };
    }
  }));
  context.after(() => bots.drain(10000));
  const as = (userId) => memberOptions({ userId, homeId });
  /** A bot of the home Pat made, its name made unique. */
  const makeBot = async (name, fields = {}) =>
    (await knex("bots").insert({ user_id: pat, workspace_id: homeId, name: `${name} ${stamp}`, color: "#1E86FC", ...fields }).returning("*"))[0];
  const bot = await makeBot("Ledger");
  const seatOf = async (userId, botId = bot.id) => String((await knex("bot_conversations").where({ bot_id: botId, user_id: userId }).first()).id);
  const listed = async (userId, botId = bot.id) => (await bots.listBots(as(userId))).bots.find((entry) => entry.id === String(botId));
  /** Someone says something in `room` and the bot answers there. */
  const say = async (text, room, person = pat, botId = bot.id) => {
    await bots.sendMessage(botId, { text, room }, as(person));
    await bots.replyTo(botId, { room }, undefined, as(person));
    await bots.drain(10000);
  };
  return { knex, parts, bots, as, homeId, pat, kim, bot, turns, watchCalls, makeBot, seatOf, listed, say };
}

test("a Shared bot keeps each person's own chat as its last tab, You only, which only they read and nothing leaves", async (context) => {
  const { bots, as, pat, kim, bot, turns, seatOf, listed, say } = await setup(context);
  await say("Pat's private word", undefined);
  const patSeat = await seatOf(pat);

  const switched = await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const pats = await listed(pat);
  assert.deepEqual(pats.rooms.map((room) => [room.title, Boolean(room.own)]), [["General", false], ["You only", true]], "General, then You only last");
  assert.equal(pats.rooms.at(-1).id, patSeat, "You only is Pat's own conversation");
  assert.equal(switched.roomId, pats.rooms[0].id, "making it Shared opens General");
  assert.deepEqual(texts(await bots.messages(bot.id, null, {}, as(pat))), [], "General has nothing private");
  assert.deepEqual(texts(await bots.messages(bot.id, patSeat, {}, as(pat))), ["Pat's private word", "Noted."], "You only is the chat Pat had");

  // Kim has her own, and asking for Pat's gives her a shared tab, never Pat's chat.
  assert.deepEqual(texts(await bots.messages(bot.id, patSeat, {}, as(kim))), [], "Kim never reads Pat's You only");
  const kimSeat = await seatOf(kim);
  assert.notEqual(kimSeat, patSeat);
  assert.equal((await listed(kim)).rooms.at(-1).id, kimSeat, "Kim's last tab is her own conversation");
  await assert.rejects(bots.renameRoom(bot.id, patSeat, { title: "Mine" }, as(pat)), /isn't there/u, "You only has no other name");

  // The tab is remembered; the bot answers there as in a private chat, knowing the shared tabs by name only.
  assert.equal((await bots.updateBot(bot.id, { roomId: patSeat, unread: false }, as(pat))).roomId, patSeat);
  assert.equal((await listed(pat)).roomId, patSeat, "You only stays open");
  await say("Just between us", patSeat);
  const own = turns.at(-1);
  assert.ok(own.history.includes("Pat's private word") && own.history.includes("Just between us"), "its own history");
  assert.match(own.state, /"You only" tab: nobody else sees it/u);
  assert.match(own.state, /shared conversations \("General"\)/u, "the shared tabs, by name");
  assert.match(own.state, /What you remember about the person/u, "and what a private chat knows");
  assert.deepEqual(texts(await bots.messages(bot.id, null, {}, as(pat))).slice(-1), ["Noted."], "it answered in You only");

  // A tab made from You only starts empty: nothing said there goes where others read.
  const { room: plans } = await bots.createRoom(bot.id, { title: "Plans", from: patSeat }, as(pat));
  assert.equal(plans.parentId, null);
  await say("Shall we plan?", plans.id);
  const shared = turns.at(-1);
  assert.deepEqual(shared.history.map((line) => line.replace(/^.*?: /u, "")), ["Shall we plan?"], "the new tab knows nothing of You only");
  assert.match(shared.state, /their own "You only" tab/u, "and the shared tab points people to their own");
  assert.doesNotMatch(shared.state, /What you remember about the person/u, "nor anything of anyone's own");
  assert.deepEqual((await listed(kim)).rooms.map((room) => room.title), ["General", "Plans", "You only"], "Kim sees the shared tabs and her own");
});

test("a shared tab never reads what the person's group chats said; their own chat does", async (context) => {
  const { knex, bots, as, homeId, pat, bot, turns, makeBot, seatOf, listed, say } = await setup(context);
  await say("Hello", undefined);
  const patSeat = await seatOf(pat);
  // Pat is in a group chat with Ledger: what's said there is Pat's own.
  const group = await makeBot("Weekend", { kind: "group" });
  await knex("bot_group_members").insert({ workspace_id: homeId, group_id: group.id, bot_id: bot.id, position: 0 });
  await knex("bot_group_people").insert({ workspace_id: homeId, group_id: group.id, user_id: pat });
  const [groupRoom] = await knex("bot_conversations")
    .insert({ workspace_id: homeId, bot_id: group.id, title: "Group", last_activity_at: knex.fn.now() }).returning("id");
  await knex("bot_messages").insert({
    workspace_id: homeId, bot_id: group.id, conversation_id: groupRoom.id, kind: "text", role: "user", body: { text: "Pat's surprise party plan", from: { name: "Pat" } }
  });
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  await say("What's new?", (await listed(pat)).rooms[0].id);
  assert.doesNotMatch(turns.at(-1).state, /surprise party/u, "General, which everyone reads, never gets Pat's group chat");
  await say("What's new with me?", patSeat);
  assert.match(turns.at(-1).state, /Group chats you're in .*Pat's surprise party plan/u, "You only does, as a private chat did");
});

test("each tab of a Shared bot is unread on its own, and the list reads no more for its tabs", async (context) => {
  const { knex, bots, as, pat, kim, bot, makeBot, seatOf, listed, say } = await setup(context);
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const patSeat = await seatOf(pat);
  const general = (await listed(pat)).rooms[0].id;
  await bots.updateBot(bot.id, { roomId: general, unread: false }, as(pat));
  await say("For me", patSeat);
  await bots.sendMessage(bot.id, { text: "For everyone", room: general }, as(kim));
  const tab = async (id) => (await listed(pat)).rooms.find((room) => room.id === id);
  assert.equal((await tab(patSeat)).unread, true, "the bot's answer in You only is new");
  assert.equal((await tab(general)).unread, true, "and so is Kim's message in General");

  // Reading General leaves You only new, and the bot's dot shows while any tab has news.
  await bots.updateBot(bot.id, { roomId: general, unread: false }, as(pat));
  assert.equal((await tab(general)).unread, false);
  assert.equal((await tab(patSeat)).unread, true, "reading one tab doesn't read another");
  assert.equal((await listed(pat)).unread, true);
  await bots.updateBot(bot.id, { roomId: patSeat, unread: false }, as(pat));
  assert.equal((await tab(patSeat)).unread, false);
  assert.equal((await listed(pat)).unread, false);
  // Marking a shared tab unread makes its latest message new again.
  await bots.updateBot(bot.id, { roomId: general, unread: true }, as(pat));
  assert.equal((await tab(general)).unread, true);

  // The person's own conversation comes with the rows the list reads anyway: the same statements for 1 Shared bot as
  // for 9, each with several tabs.
  const once = await queriesDuring(knex, () => bots.listBots(as(pat)));
  for (let index = 0; index < 8; index += 1) {
    const more = await makeBot(`Shared ${index}`, { sharing: "shared" });
    await bots.messages(more.id, null, {}, as(pat));
    await bots.createRoom(more.id, { title: "Second" }, as(pat));
  }
  assert.equal((await bots.listBots(as(pat))).bots.filter((entry) => entry.rooms?.length === 3).length, 8, "each has General, Second and You only");
  assert.equal(await queriesDuring(knex, () => bots.listBots(as(pat))), once, "the list's reads don't grow with bots or tabs");
});

test("leaving Shared hides the shared tabs: their work pauses, You only is the chat again, and nothing runs or is found there", async (context) => {
  const pausedWatches = [];
  const { knex, parts, bots, as, homeId, pat, kim, bot, turns, watchCalls, seatOf, listed, say } = await setup(context, { pausedWatches });
  await say("Pat's private word", undefined);
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const patSeat = await seatOf(pat);
  const general = (await listed(pat)).rooms[0].id;
  const tag = `budget${randomBytes(3).toString("hex")}`;
  await bots.sendMessage(bot.id, { text: `The ${tag} is 500`, room: general }, as(kim));
  const routine = async (conversationId, name) => (await knex("bot_routines").insert({
    workspace_id: homeId, bot_id: bot.id, conversation_id: conversationId, name, schedule: "Every morning", cron: "0 8 * * *",
    timezone: "UTC", instructions: "Say hello", enabled: true, next_run_at: knex.raw("now() + interval '1 hour'")
  }).returning("*"))[0];
  const inGeneral = await routine(general, "Morning brief");
  const inSeat = await routine(patSeat, "My own brief");
  pausedWatches.push({ conversationId: general, name: "New deals" });
  const routinesFound = async () => (await bots.search("", as(pat))).routines.filter((entry) => entry.botId === String(bot.id));

  await bots.updateBot(bot.id, { sharing: "mixed" }, as(pat));
  const paused = await knex("bot_routines").where({ id: inGeneral.id }).first();
  assert.equal(paused.enabled, false, "General's routine paused");
  assert.equal(paused.next_run_at, null);
  assert.equal((await knex("bot_routines").where({ id: inSeat.id }).first()).enabled, true, "Pat's own routine runs on");
  assert.deepEqual(watchCalls.map((call) => [call.botId, call.conversationIds]), [[String(bot.id), [general]]], "the hidden tabs' watches pause");
  const line = await knex("bot_messages").where({ conversation_id: general, kind: "event" }).orderBy("id", "desc").first();
  assert.equal(line?.body.text, "Paused while hidden");
  assert.match(line.body.detail, /routine "Morning brief", watch "New deals" paused/u, "General says what paused");

  const pats = await listed(pat);
  assert.equal(pats.rooms, null, "no tabs while it isn't Shared");
  assert.equal(pats.roomId, null);
  assert.deepEqual(texts(await bots.messages(bot.id, null, {}, as(pat))), ["Pat's private word", "Noted."], "You only is Pat's chat again");
  assert.deepEqual(texts(await bots.messages(bot.id, general, {}, as(pat))), ["Pat's private word", "Noted."], "a hidden tab can't be opened");
  assert.equal((await bots.search(tag, as(pat))).messages.length, 0, "search doesn't find hidden tabs");
  assert.deepEqual((await routinesFound()).map((entry) => entry.name), ["My own brief"], "nor their routines");
  // Goals and requests find no row there, so nothing runs: a goal stops at its next round.
  assert.equal(await parts.records.conversations.rowOf(String(bot.id), general, as(pat)), null);
  assert.ok(await parts.records.conversations.rowOf(String(bot.id), patSeat, as(pat)), "Pat's own conversation is still there");
  // A run of General's routine claimed before it paused ends unrun.
  const asked = turns.length;
  await knex("bot_routines").where({ id: inGeneral.id }).update({ run_id: randomUUID(), run_attempts: 1, run_lease_until: knex.raw("now() + interval '10 minutes'") });
  await bots.runRoutine(claimedWork(await knex("bot_routines").where({ id: inGeneral.id }).first()));
  await bots.drain(10000);
  assert.equal(turns.length, asked, "the model isn't asked");
  assert.equal(String((await knex("bot_messages").where({ conversation_id: general }).orderBy("id", "desc").first()).id), String(line.id), "nothing is posted there");
  assert.equal((await knex("bot_routines").where({ id: inGeneral.id }).first()).run_id, null, "and the run ends, so no server takes it over");

  // Shared again: the tabs are back, and their paused work stays paused until someone resumes it there. Search finds
  // them again, each result naming its tab.
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  assert.deepEqual((await listed(pat)).rooms.map((room) => room.title), ["General", "You only"]);
  assert.equal((await knex("bot_routines").where({ id: inGeneral.id }).first()).enabled, false);
  assert.deepEqual((await bots.search(tag, as(pat))).messages.map((message) => message.roomId), [general], "search finds General, naming the tab");
  assert.deepEqual((await routinesFound()).map((entry) => [entry.name, entry.roomId, entry.schedule]).sort(),
    [["Morning brief", general, "Paused"], ["My own brief", patSeat, "Every morning"]], "and its routines, each with its tab");
});

test("files and the computer follow the conversation: a shared tab's are everyone's, You only's the person's own", async (context) => {
  const { parts, bots, as, homeId, pat, kim, bot, makeBot, seatOf, listed } = await setup(context);
  const { records } = parts;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "you-only-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const patSeat = await seatOf(pat);
  const general = (await listed(pat)).rooms[0].id;
  await bots.messages(bot.id, null, {}, as(kim));
  const kimSeat = await seatOf(kim);

  // A turn's place: You only's is Pat's own folder, General's the bot's everyone folder.
  const ownRow = await records.conversations.ownedBot(String(bot.id), as(pat), { room: patSeat });
  const roomRow = await records.conversations.ownedBot(String(bot.id), as(pat), { room: general });
  assert.deepEqual(store.placeFor(ownRow, pat), { homeId, botId: String(bot.id), userId: pat }, "You only's files are Pat's");
  assert.deepEqual(store.placeFor(roomRow, pat), { homeId, botId: String(bot.id), everyone: true }, "General's are everyone's");

  const put = async (place, name) => {
    const real = await store.resolve(place, `/files/mine/${name}`);
    await fs.mkdir(path.dirname(real), { recursive: true });
    await fs.writeFile(real, name);
  };
  await put({ homeId, botId: String(bot.id), everyone: true }, "for-everyone.txt");
  await put({ homeId, botId: String(bot.id), userId: pat }, "just-pat.txt");
  await put({ homeId, botId: String(bot.id), userId: kim }, "just-kim.txt");

  const routes = new Map();
  const http = { router: { register: (method, route, _options, handler) => routes.set(`${method} ${route}`, handler) } };
  registerFileRoutes(http, { files: { store, apps: {}, storage: {}, pages: {} }, directory: records.directory, uploads: {} });
  registerComputerRoutes(http, { computer: { status: async (computerId) => ({ computerId }) }, files: { store }, directory: records.directory, meter: {}, streams: new Set() });
  const call = async (key, query, person, botId) => {
    const answer = {};
    const reply = {
      code(status) {
        answer.status = status;
        return reply;
      },
      send(body) {
        answer.body = body;
        return reply;
      },
      header: () => reply
    };
    await routes.get(key)({ params: { botId: String(botId) }, query, workspace: { id: homeId }, user: { id: person }, callOptions: async () => as(person) }, reply);
    return answer;
  };
  /** The names in /files/mine as the file browser lists them, or the refusal's status. */
  const names = async (query, person = pat) => {
    const answer = await call("GET /api/w/:workspaceSlug/bots/:botId/files", { folder: "/files/mine", ...query }, person, bot.id);
    return answer.status ?? answer.body.entries.map((entry) => path.posix.basename(entry.path));
  };
  const computer = async (query) => {
    const answer = await call("GET /api/w/:workspaceSlug/bots/:botId/computer", query, pat, bot.id);
    return answer.status ?? answer.body.computerId;
  };

  assert.deepEqual(await names({ room: patSeat }), ["just-pat.txt"], "You only's /files/mine is Pat's own");
  assert.deepEqual(await names({ room: general }), ["for-everyone.txt"], "General's is the bot's everyone folder");
  assert.equal(await names({ room: kimSeat }), 404, "another person's conversation is refused");
  assert.deepEqual(await names({ room: kimSeat }, kim), ["just-kim.txt"], "which is Kim's own to her");
  const other = await makeBot("Other", { sharing: "shared" });
  await bots.messages(other.id, null, {}, as(pat));
  const otherRoom = (await listed(pat, other.id)).rooms[0].id;
  assert.equal(await names({ room: otherRoom }), 404, "another bot's tab is refused");
  assert.equal(await names({ room: "not-a-tab" }), 404);
  await bots.updateBot(bot.id, { roomId: patSeat }, as(pat));
  assert.deepEqual(await names({}), ["just-pat.txt"], "without ?room=, the tab Pat has open");

  assert.equal(await computer({ room: patSeat }), patSeat, "You only's computer is Pat's own");
  assert.equal(await computer({ room: general }), general, "General's is the tab's");
  assert.equal(await computer({ room: kimSeat }), 404, "another person's is refused");
  assert.equal(await computer({ room: otherRoom }), 404, "and another bot's tab");
  assert.equal(await computer({}), patSeat, "else the tab Pat has open");

  // Not Shared: a hidden tab is refused, and Pat's own conversation is the bot's place.
  await bots.updateBot(bot.id, { sharing: "private" }, as(pat));
  assert.equal(await names({ room: general }), 404, "a hidden tab's files are refused");
  assert.equal(await computer({ room: general }), 404, "and its computer");
  assert.deepEqual(await names({}), ["just-pat.txt"]);
  assert.equal(await computer({}), patSeat);
  assert.deepEqual(await names({ room: patSeat }), ["just-pat.txt"], "naming Pat's own conversation still works");
});

test("a request from You only goes to the other bot's private chat; one from a shared tab to its shared tab", async (context) => {
  let target = null;
  // Each asking bot asks once; its later turns (the Helper's answer coming back) only answer.
  const asking = new Set();
  const { knex, bots, as, pat, bot, makeBot, seatOf, listed, say } = await setup(context, {
    act: async (current, tools) => {
      if (target && String(current.id) !== String(target.id) && !asking.has(String(current.id))) {
        asking.add(String(current.id));
        const asked = await tools.askBot.execute({ bot: target.name, brief: "Check the plan, please." });
        assert.equal(asked.status, "asked", JSON.stringify(asked));
      }
    }
  });
  target = await makeBot("Helper", { sharing: "shared" });
  await bots.messages(target.id, null, {}, as(pat));
  const helperGeneral = (await listed(pat, target.id)).rooms[0].id;
  const helperSeat = await seatOf(pat, target.id);
  await bots.updateBot(target.id, { roomId: helperGeneral }, as(pat));
  // Pat has the Helper's General open, and asks from Ledger's You only and from another Shared bot's General.
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const ledgerSeat = await seatOf(pat);
  const planner = await makeBot("Planner", { sharing: "shared" });
  await bots.messages(planner.id, null, {}, as(pat));
  const plannerGeneral = (await listed(pat, planner.id)).rooms[0].id;
  const landedIn = async (from) => String((await knex("bot_requests").where({ from_bot_id: from.id, to_bot_id: target.id }).first()).to_conversation_id);

  await say("Ask Helper", ledgerSeat);
  assert.equal(await landedIn(bot), helperSeat, "from You only, the Helper's private chat with Pat");
  await say("Ask Helper too", plannerGeneral, pat, planner.id);
  assert.equal(await landedIn(planner), helperGeneral, "from a shared tab, the Helper's shared tab");
});
