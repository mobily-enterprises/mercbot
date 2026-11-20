import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";

// A conversation archived and resumed (D-101), against the disposable test database, with scripted replies in place of
// the model: a Shared bot's shared tab, hidden for everyone in the home, and a person's own You only, hidden for them.
// Who may do it, what's refused, that nothing runs, is written or is found there, that leaving Shared un-archives You
// only, and that the list and the archived list read the same number of statements however many there are.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const texts = (page) => page.messages.filter((message) => message.kind === "text").map((message) => message.body.text);

/** A refusal with this status and code. */
const refused = (status, code) => (error) => {
  assert.equal(error.statusCode, status, `${error.code}: ${error.message}`);
  assert.equal(error.code, code);
  return true;
};

/**
 * A home of its own with Pat (its owner, who may change any bot) and Kim (a member), the Shared bot Ledger with General,
 * a second home with a Shared bot and a tab of its own, and a bots service whose replies record each turn. The Apps'
 * watches pause those `pausedWatches` names, as a tab is archived.
 */
async function setup(context, { pausedWatches = [] } = {}) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const [kimRow] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
  }).returning("id");
  const kim = String(kimRow.id);
  const [home] = await knex("workspaces").insert({ slug: `archive-${stamp}`, name: "Hilltop", owner_user_id: pat, is_personal: false }).returning("id");
  const [elsewhere] = await knex("workspaces")
    .insert({ slug: `archive-other-${stamp}`, name: "Elsewhere", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id);
  const otherHome = String(elsewhere.id);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: kim, role_sid: "member", status: "active" }
  ]);
  await knex("workspace_settings").insert({ workspace_id: homeId });
  context.after(async () => {
    await knex("bots").whereIn("workspace_id", [homeId, otherHome]).del();
    await knex("apps").where({ workspace_id: homeId }).del();
    await knex("workspace_settings").where({ workspace_id: homeId }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId }).del();
    await knex("workspaces").whereIn("id", [homeId, otherHome]).del();
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
    apps: {
      watches: {
        pauseIn: async (where) => {
          watchCalls.push(where);
          return pausedWatches.filter((watch) => where.conversationIds.includes(watch.conversationId));
        }
      }
    },
    reply: async (current, history, _tools, state) => {
      turns.push({ bot: String(current.id), state, history: history.filter((message) => message.kind === "text").map((message) => message.body.text) });
      return { text: "Noted.", transcript: [] };
    }
  }));
  context.after(() => bots.drain(10000));
  // Pat is the home's owner, so may change any bot (workspace.settings.update); Kim is a member.
  const as = (userId) => memberOptions(userId === pat
    ? { userId, homeId, role: "owner", permissions: ["workspace.settings.update"] }
    : { userId, homeId });
  const makeBot = async (name, fields = {}, workspace = homeId) =>
    (await knex("bots").insert({ user_id: pat, workspace_id: workspace, name: `${name} ${stamp}`, color: "#1E86FC", ...fields }).returning("*"))[0];
  const bot = await makeBot("Ledger", { sharing: "shared" });
  await bots.messages(bot.id, null, {}, as(pat));
  await bots.messages(bot.id, null, {}, as(kim));
  const seatOf = async (userId, botId = bot.id) => String((await knex("bot_conversations").where({ bot_id: botId, user_id: userId }).first()).id);
  const listed = async (userId, botId = bot.id) => (await bots.listBots(as(userId))).bots.find((entry) => entry.id === String(botId));
  const general = (await listed(pat)).rooms[0].id;
  /** Someone says something in `room` and the bot answers there. */
  const say = async (text, room, person = pat, botId = bot.id) => {
    await bots.sendMessage(botId, { text, room }, as(person));
    await bots.replyTo(botId, { room }, undefined, as(person));
    await bots.drain(10000);
  };
  const titles = async (userId) => (await listed(userId)).rooms.map((room) => room.title);
  const archivedFor = async (userId, botId = bot.id) => (await bots.archivedConversations(String(botId), as(userId))).conversations;
  const routine = async (conversationId, name) => (await knex("bot_routines").insert({
    workspace_id: homeId, bot_id: bot.id, conversation_id: conversationId, name, schedule: "Every morning", cron: "0 8 * * *",
    timezone: "UTC", instructions: "Say hello", enabled: true, next_run_at: knex.raw("now() + interval '1 hour'")
  }).returning("*"))[0];
  return {
    knex, parts, bots, as, homeId, otherHome, pat, kim, bot, general, turns, watchCalls, makeBot, seatOf, listed, say, titles, archivedFor, routine
  };
}

test("a shared tab and You only are archived and resumed: hidden for whom they should be, back as they were", async (context) => {
  const { bots, as, pat, kim, bot, general, seatOf, listed, say, titles, archivedFor } = await setup(context);
  const { room: plans } = await bots.createRoom(bot.id, { title: "Plans", from: general }, as(kim));
  await say("Kim's plan", plans.id, kim);
  await bots.updateBot(bot.id, { roomId: plans.id, unread: false }, as(pat));
  assert.equal((await listed(pat)).rooms.find((room) => room.title === "Plans").canArchive, true, "an owner may archive any shared tab");
  assert.deepEqual((await listed(kim)).rooms.map((room) => [room.title, room.canArchive]), [["General", false], ["Plans", true], ["You only", true]],
    "Kim may archive the tab she started and her own You only, never General");

  // Kim archives Plans: it goes for everyone, and Pat, who had it open, lands on General.
  const archived = await bots.archiveRoom(bot.id, plans.id, as(kim));
  assert.deepEqual(archived.bot.rooms.map((room) => room.title), ["General", "You only"], "the answer is the bot as listed");
  assert.equal(archived.bot.archived, 1);
  assert.deepEqual(await titles(pat), ["General", "You only"], "gone for Pat too");
  assert.equal((await listed(pat)).roomId, general, "Pat had it open and lands on General");
  assert.equal((await listed(pat)).archived, 1, "Archived (1)");
  assert.deepEqual(texts(await bots.messages(bot.id, plans.id, {}, as(pat))), [], "asking for it opens General");
  const forPat = await archivedFor(pat);
  assert.deepEqual(forPat.map((entry) => [entry.id, entry.title, entry.own, entry.archivedBy, entry.canResume]), [[plans.id, "Plans", false, "Kim", true]]);
  assert.ok(Date.parse(forPat[0].archivedAt) <= Date.now());
  assert.deepEqual((await archivedFor(kim)).map((entry) => [entry.archivedBy, entry.canResume]), [["you", true]], "Kim sees it was her");

  // Archiving it again changes nothing; Kim resumes it: back in its place with its messages, and open for her.
  await bots.archiveRoom(bot.id, plans.id, as(kim));
  const resumed = await bots.resumeRoom(bot.id, plans.id, as(kim));
  assert.deepEqual(resumed.bot.rooms.map((room) => room.title), ["General", "Plans", "You only"], "back in its old place");
  assert.equal(resumed.bot.roomId, plans.id, "and open for whoever resumed it");
  assert.equal(resumed.bot.archived, 0);
  assert.deepEqual(texts(await bots.messages(bot.id, plans.id, {}, as(pat))).map((line) => line.replace(/^.*?: /u, "")), ["Kim's plan", "Noted."]);
  assert.equal((await listed(pat)).rooms.find((room) => room.id === plans.id).unread, false, "Pat's read point there is as it was");
  assert.deepEqual(await archivedFor(pat), []);

  // Pat archives You only: hidden for Pat alone, who lands on General; Kim's own is untouched and she never sees Pat's.
  const patSeat = await seatOf(pat);
  await bots.updateBot(bot.id, { roomId: patSeat }, as(pat));
  await say("Just between us", patSeat);
  const own = await bots.archiveRoom(bot.id, patSeat, as(pat));
  assert.deepEqual(own.bot.rooms.map((room) => room.title), ["General", "Plans"], "no You only for Pat");
  assert.equal(own.bot.roomId, general);
  assert.equal(own.bot.archived, 1);
  assert.deepEqual(await titles(kim), ["General", "Plans", "You only"], "Kim keeps hers");
  assert.equal((await listed(kim)).archived, 0, "and sees nothing of Pat's");
  assert.deepEqual(await archivedFor(kim), []);
  assert.deepEqual((await archivedFor(pat)).map((entry) => [entry.id, entry.title, entry.own, entry.archivedBy]), [[patSeat, "You only", true, "you"]]);
  assert.deepEqual(texts(await bots.messages(bot.id, patSeat, {}, as(pat))).slice(-1), [], "asking for it opens General");
  const back = await bots.resumeRoom(bot.id, patSeat, as(pat));
  assert.deepEqual(back.bot.rooms.map((room) => room.title), ["General", "Plans", "You only"]);
  assert.equal(back.bot.roomId, patSeat, "You only opens");
  assert.deepEqual(texts(await bots.messages(bot.id, patSeat, {}, as(pat))).slice(-2), ["Just between us", "Noted."], "as it was");
});

test("each refusal: someone else's tab or You only, General, an app's tab, another home's ids, a bot that isn't Shared", async (context) => {
  const { knex, bots, as, homeId, otherHome, pat, kim, bot, general, seatOf, makeBot, archivedFor } = await setup(context);
  const { room: budget } = await bots.createRoom(bot.id, { title: "Budget", from: general }, as(pat));
  const { room: ideas } = await bots.createRoom(bot.id, { title: "Ideas", from: general }, as(kim));

  await assert.rejects(bots.archiveRoom(bot.id, budget.id, as(kim)), refused(403, "bots_archive_forbidden"), "a member, a tab she didn't start");
  await bots.archiveRoom(bot.id, budget.id, as(pat));
  await assert.rejects(bots.resumeRoom(bot.id, budget.id, as(kim)), refused(403, "bots_archive_forbidden"), "nor undo an owner's archive");
  assert.deepEqual((await archivedFor(kim)).map((entry) => [entry.title, entry.canResume]), [["Budget", false]], "she sees it, without Resume");
  // An owner archived the tab Kim started: she started it, so she may resume it, as may the owner.
  await bots.archiveRoom(bot.id, ideas.id, as(pat));
  await bots.resumeRoom(bot.id, ideas.id, as(kim));

  const patSeat = await seatOf(pat);
  await assert.rejects(bots.archiveRoom(bot.id, patSeat, as(kim)), refused(404, "bots_conversation_not_found"), "another person's You only");
  await bots.archiveRoom(bot.id, patSeat, as(pat));
  await assert.rejects(bots.resumeRoom(bot.id, patSeat, as(kim)), refused(404, "bots_conversation_not_found"), "nor resume it");
  await assert.rejects(bots.archiveRoom(bot.id, general, as(pat)), refused(409, "bots_archive_first"), "General, even for an owner");
  const appId = `a_archive${randomBytes(4).toString("hex")}`;
  await knex("apps").insert({ id: appId, workspace_id: homeId, slug: `stock-${appId}`, name: "Stock", icon: "apps", color: "#1E5BD8" });
  const [appRoom] = await knex("bot_conversations")
    .insert({ workspace_id: homeId, bot_id: bot.id, title: "Stock app", app_id: appId, created_by: pat })
    .returning("id");
  await assert.rejects(bots.archiveRoom(bot.id, String(appRoom.id), as(pat)), refused(409, "bots_archive_app_conversation"), "an app's tab");

  // Another home's bot, and another home's tab named with this home's bot.
  const theirs = await makeBot("Theirs", { sharing: "shared" }, otherHome);
  const [theirRoom] = await knex("bot_conversations").insert({ workspace_id: otherHome, bot_id: theirs.id, title: "General" }).returning("id");
  await knex("bot_conversations").insert({ workspace_id: otherHome, bot_id: theirs.id, title: "Secret" });
  await assert.rejects(bots.archiveRoom(String(theirs.id), String(theirRoom.id), as(pat)), refused(404, "bots_bot_not_found"));
  await assert.rejects(bots.archiveRoom(bot.id, String(theirRoom.id), as(pat)), refused(404, "bots_conversation_not_found"));
  await assert.rejects(bots.resumeRoom(bot.id, "not-a-tab", as(pat)), refused(404, "bots_conversation_not_found"));
  const other = await makeBot("Other", { sharing: "shared" });
  await bots.messages(other.id, null, {}, as(pat));
  await assert.rejects(bots.archiveRoom(String(other.id), budget.id, as(pat)), refused(404, "bots_conversation_not_found"), "another bot's tab");

  const diary = await makeBot("Diary");
  await bots.messages(diary.id, null, {}, as(pat));
  await assert.rejects(bots.archiveRoom(String(diary.id), await seatOf(pat, diary.id), as(pat)), refused(409, "bots_archive_shared_only"),
    "a Mixed bot's chat is its only one");
  assert.deepEqual((await bots.archivedConversations(String(diary.id), as(pat))).conversations, []);
});

test("nobody writes, replies or finds anything in an archived conversation, and it doesn't make the bot new", async (context) => {
  const { parts, bots, as, pat, kim, bot, general, seatOf, listed, say } = await setup(context);
  const { room: plans } = await bots.createRoom(bot.id, { title: "Plans", from: general }, as(kim));
  const tag = `budget${randomBytes(3).toString("hex")}`;
  await say(`The ${tag} is 500`, plans.id, kim);
  const patSeat = await seatOf(pat);
  const mine = `mine${randomBytes(3).toString("hex")}`;
  await say(`My ${mine} note`, patSeat);
  await bots.updateBot(bot.id, { roomId: general, unread: false }, as(pat));
  assert.equal((await listed(pat)).unread, true, "Plans has news for Pat");
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "search finds it");
  assert.equal((await bots.search(mine, as(pat))).messages.length, 1);

  await bots.archiveRoom(bot.id, plans.id, as(kim));
  await bots.archiveRoom(bot.id, patSeat, as(pat));
  assert.equal((await listed(pat)).unread, false, "an archived tab's news doesn't make the bot new");
  const archivedText = /This conversation is archived\. Resume it to continue\./u;
  for (const [room, person] of [[plans.id, pat], [plans.id, kim], [patSeat, pat]]) {
    await assert.rejects(bots.sendMessage(bot.id, { text: "Still there?", room }, as(person)),
      (error) => refused(409, "bots_conversation_archived")(error) && archivedText.test(error.message), "a message is refused");
    await assert.rejects(bots.replyTo(bot.id, { room }, undefined, as(person)), refused(409, "bots_conversation_archived"), "and a reply");
  }
  assert.equal((await bots.search(tag, as(pat))).messages.length, 0, "search doesn't find an archived tab");
  assert.equal((await bots.search(mine, as(pat))).messages.length, 0, "nor an archived You only");
  // The files and computer routes find a tab through the directory, which never answers an archived one.
  assert.equal(await parts.records.directory.roomOf(bot.id, plans.id, as(kim)), null, "no files or computer named by it");
  assert.equal(String((await parts.records.directory.roomOf(bot.id, null, as(kim))).id), general, "the first is General");

  await bots.resumeRoom(bot.id, plans.id, as(pat));
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "resumed, it's found again");
  assert.ok(await parts.records.directory.roomOf(bot.id, plans.id, as(kim)), "and its files and computer are there again");
  await bots.sendMessage(bot.id, { text: "Back again", room: plans.id }, as(pat));
});

test("archiving pauses a conversation's routines and watches with a line, nothing runs there, and they stay paused after Resume", async (context) => {
  const pausedWatches = [];
  const { knex, parts, bots, as, pat, kim, bot, general, turns, watchCalls, seatOf, routine } = await setup(context, { pausedWatches });
  const { room: plans } = await bots.createRoom(bot.id, { title: "Plans", from: general }, as(kim));
  const patSeat = await seatOf(pat);
  const inPlans = await routine(plans.id, "Morning brief");
  const inGeneral = await routine(general, "Rota check");
  const inSeat = await routine(patSeat, "My own brief");
  pausedWatches.push({ conversationId: plans.id, name: "New deals" });

  await bots.archiveRoom(bot.id, plans.id, as(kim));
  const paused = await knex("bot_routines").where({ id: inPlans.id }).first();
  assert.equal(paused.enabled, false, "its routine paused");
  assert.equal(paused.next_run_at, null);
  assert.equal((await knex("bot_routines").where({ id: inGeneral.id }).first()).enabled, true, "General's runs on");
  assert.deepEqual(watchCalls.map((call) => [call.botId, call.conversationIds]), [[String(bot.id), [plans.id]]], "its watches pause");
  const line = await knex("bot_messages").where({ conversation_id: plans.id, kind: "event" }).orderBy("id", "desc").first();
  assert.equal(line?.body.text, "Paused while archived");
  assert.match(line.body.detail, /routine "Morning brief", watch "New deals" paused\. They stay paused when it's resumed: resume them here\./u);

  // Goals, requests and queued replies find no row there, so a goal stops at its next round; a claimed run ends unrun.
  assert.equal(await parts.records.conversations.rowOf(String(bot.id), plans.id, as(pat)), null);
  const asked = turns.length;
  await knex("bot_routines").where({ id: inPlans.id }).update({ run_id: randomUUID(), run_attempts: 1, run_lease_until: knex.raw("now() + interval '10 minutes'") });
  await bots.runRoutine(claimedWork(await knex("bot_routines").where({ id: inPlans.id }).first()));
  await bots.drain(10000);
  assert.equal(turns.length, asked, "the model isn't asked");
  assert.equal(String((await knex("bot_messages").where({ conversation_id: plans.id }).orderBy("id", "desc").first()).id), String(line.id), "nothing posted");
  assert.equal((await knex("bot_routines").where({ id: inPlans.id }).first()).run_id, null, "and the run ends");

  // You only the same, for its person.
  await bots.archiveRoom(bot.id, patSeat, as(pat));
  assert.equal((await knex("bot_routines").where({ id: inSeat.id }).first()).enabled, false, "Pat's own routine pauses with it");
  assert.equal(await parts.records.conversations.rowOf(String(bot.id), patSeat, as(pat)), null, "nothing runs in it");

  // Resumed, the conversations are back and work can run again, but what paused waits to be resumed there.
  await bots.resumeRoom(bot.id, plans.id, as(kim));
  await bots.resumeRoom(bot.id, patSeat, as(pat));
  assert.equal((await knex("bot_routines").where({ id: inPlans.id }).first()).enabled, false, "still paused after Resume");
  assert.equal((await knex("bot_routines").where({ id: inSeat.id }).first()).enabled, false);
  assert.ok(await parts.records.conversations.rowOf(String(bot.id), plans.id, as(pat)), "Plans runs work again");
  assert.ok(await parts.records.conversations.rowOf(String(bot.id), patSeat, as(pat)));
});

test("leaving Shared makes an archived You only the person's chat again; archived shared tabs stay archived", async (context) => {
  const { knex, bots, as, pat, kim, bot, general, seatOf, listed, say, archivedFor } = await setup(context);
  const { room: plans } = await bots.createRoom(bot.id, { title: "Plans", from: general }, as(pat));
  const patSeat = await seatOf(pat);
  const kimSeat = await seatOf(kim);
  await say("Pat's own word", patSeat);
  await bots.archiveRoom(bot.id, patSeat, as(pat));
  await bots.archiveRoom(bot.id, kimSeat, as(kim));
  await bots.archiveRoom(bot.id, plans.id, as(pat));

  await bots.updateBot(bot.id, { sharing: "mixed" }, as(pat));
  const archivedAt = async (id) => (await knex("bot_conversations").where({ id }).first()).archived_at;
  assert.equal(await archivedAt(patSeat), null, "Pat's You only is his chat again");
  assert.equal(await archivedAt(kimSeat), null, "and Kim's hers, though Pat made the change");
  assert.ok(await archivedAt(plans.id), "the shared tab stays archived");
  assert.deepEqual(texts(await bots.messages(bot.id, null, {}, as(pat))), ["Pat's own word", "Noted."], "Pat's chat");
  await say("Still mine", undefined);

  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  assert.deepEqual((await listed(pat)).rooms.map((room) => room.title), ["General", "You only"], "Plans is still archived");
  assert.equal((await listed(pat)).archived, 1);
  assert.deepEqual((await archivedFor(pat)).map((entry) => entry.title), ["Plans"]);
});

test("the list and the archived list read the same statements however many conversations are archived", async (context) => {
  const { knex, bots, as, pat, kim, bot, general, seatOf, makeBot, archivedFor } = await setup(context);
  const { room: first } = await bots.createRoom(bot.id, { title: "First", from: general }, as(kim));
  await bots.archiveRoom(bot.id, first.id, as(kim));
  const listOnce = await queriesDuring(knex, () => bots.listBots(as(pat)));
  const archivedOnce = await queriesDuring(knex, () => archivedFor(pat));
  assert.equal((await archivedFor(pat)).length, 1);

  // Eight more archived tabs here, Pat's own You only, and four more Shared bots with archived tabs of their own.
  for (let index = 0; index < 8; index += 1) {
    const { room } = await bots.createRoom(bot.id, { title: `Tab ${index}`, from: general }, as(kim));
    await bots.archiveRoom(bot.id, room.id, as(kim));
  }
  await bots.archiveRoom(bot.id, await seatOf(pat), as(pat));
  for (let index = 0; index < 4; index += 1) {
    const more = await makeBot(`Shared ${index}`, { sharing: "shared" });
    await bots.messages(more.id, null, {}, as(kim));
    const { room } = await bots.createRoom(more.id, { title: "Old" }, as(kim));
    await bots.archiveRoom(String(more.id), room.id, as(kim));
  }
  assert.equal((await archivedFor(pat)).length, 10);
  assert.equal((await bots.listBots(as(pat))).bots.find((entry) => entry.id === String(bot.id)).archived, 10);
  assert.equal(await queriesDuring(knex, () => bots.listBots(as(pat))), listOnce, "the list reads no more for them");
  assert.equal(await queriesDuring(knex, () => archivedFor(pat)), archivedOnce, "nor does the archived list");
});
