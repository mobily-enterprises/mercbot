import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";

// A whole bot archived and unarchived (D-108), against the disposable test database, with scripted replies in place of
// the model: put away for everyone in the home with its chats kept and read-only, and back where each person had it.
// Who may do it and what's refused, that its work pauses in everyone's conversations and nothing runs, that its
// computers sleep, that groups, other bots, search and teams leave it out, that every open screen hears of it, and that
// the list reads the same number of statements however many bots are archived.
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
 * A home of its own with Pat (its owner, who may change any bot) and Kim (a member), Pat's bot Ledger, which both have
 * opened, a second home with a bot of its own, and a bots service whose replies record each turn (and run `onTurn`),
 * whose news, computers put to sleep and paused watches are recorded, and whose Builder is `builder.id`.
 */
async function setup(context, { pausedWatches = [], onTurn = null } = {}) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const [kimRow] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
  }).returning("id");
  const kim = String(kimRow.id);
  const [home] = await knex("workspaces").insert({ slug: `archive-bots-${stamp}`, name: "Hilltop", owner_user_id: pat, is_personal: false }).returning("id");
  const [elsewhere] = await knex("workspaces")
    .insert({ slug: `archive-bots-other-${stamp}`, name: "Elsewhere", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id);
  const otherHome = String(elsewhere.id);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: kim, role_sid: "member", status: "active" }
  ]);
  await knex("workspace_settings").insert({ workspace_id: homeId });
  context.after(async () => {
    await knex("bots").whereIn("workspace_id", [homeId, otherHome]).del();
    await knex("workspace_settings").where({ workspace_id: homeId }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId }).del();
    await knex("workspaces").whereIn("id", [homeId, otherHome]).del();
    await knex("users").where({ id: kim }).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const turns = [];
  const watchCalls = [];
  const news = [];
  const slept = [];
  const spoke = [];
  const builder = { id: null };
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    notices: {
      publish: async (_topic, userId, event) => { news.push({ userId: String(userId), ...event }); },
      publishEach: async (_topic, userIds, event) => { for (const userId of userIds) news.push({ userId: String(userId), ...event }); },
      subscribe: () => () => {}
    },
    computer: { sleepHome: async (workspaceId, among) => { slept.push({ workspaceId, among }); } },
    apps: {
      apps: { builder: async () => (builder.id ? { id: builder.id, name: "Builder" } : null) },
      watches: {
        pauseIn: async (where) => {
          watchCalls.push(where);
          return pausedWatches.filter((watch) => where.conversationIds.includes(watch.conversationId));
        }
      }
    },
    reply: async (current, history, tools, state) => {
      turns.push({ bot: String(current.id), state, history: history.filter((message) => message.kind === "text").map((message) => message.body.text) });
      return { text: (await onTurn?.(current, tools)) || "Noted.", transcript: [] };
    },
    groupReply: async (bot) => {
      spoke.push(bot.name);
      return `${bot.name} here.`;
    }
  }));
  context.after(() => bots.drain(10000));
  // Pat is the home's owner, so may change any bot (workspace.settings.update); Kim is a member.
  const as = (userId) => memberOptions(userId === pat
    ? { userId, homeId, role: "owner", permissions: ["workspace.settings.update"] }
    : { userId, homeId });
  const makeBot = async (name, fields = {}, workspace = homeId) =>
    (await knex("bots").insert({ user_id: pat, workspace_id: workspace, name: `${name} ${stamp}`, color: "#1E86FC", ...fields }).returning("*"))[0];
  const bot = await makeBot("Ledger");
  await bots.messages(bot.id, null, {}, as(pat));
  await bots.messages(bot.id, null, {}, as(kim));
  const seatOf = async (userId, botId = bot.id) => String((await knex("bot_conversations").where({ bot_id: botId, user_id: userId }).first()).id);
  const listed = async (userId, botId = bot.id) => (await bots.listBots(as(userId))).bots.find((entry) => entry.id === String(botId));
  /** Someone says something to the bot and it answers. */
  const say = async (text, person = pat, botId = bot.id) => {
    await bots.sendMessage(botId, { text }, as(person));
    await bots.replyTo(botId, {}, undefined, as(person));
    await bots.drain(10000);
  };
  const routine = async (conversationId, name) => (await knex("bot_routines").insert({
    workspace_id: homeId, bot_id: bot.id, conversation_id: conversationId, name, schedule: "Every morning", cron: "0 8 * * *",
    timezone: "UTC", instructions: "Say hello", enabled: true, next_run_at: knex.raw("now() + interval '1 hour'")
  }).returning("*"))[0];
  return {
    knex, parts, bots, as, homeId, otherHome, pat, kim, bot, turns, watchCalls, news, slept, spoke, builder, stamp,
    makeBot, seatOf, listed, say, routine
  };
}

test("a bot is archived for everyone, read-only, and unarchived back where each person had it", async (context) => {
  const { bots, as, otherHome, pat, kim, bot, makeBot, listed, say } = await setup(context);
  await say("The budget is 500");
  // Pat pins it; Kim files it in her own section.
  await bots.updateBot(bot.id, { pinned: true }, as(pat));
  const { sections } = await bots.createSection({ name: "Money", botId: bot.id }, as(kim));
  const before = { pat: await listed(pat), kim: await listed(kim) };
  assert.notEqual(before.pat.pinPosition, null, "pinned for Pat");
  assert.equal(before.kim.sectionId, sections[0].id, "in Money for Kim");
  assert.deepEqual([before.pat.canArchive, before.kim.canArchive, before.pat.archivedAt], [true, false, null],
    "an owner may archive any bot; a member who didn't make it may not");

  await assert.rejects(bots.archiveBot(bot.id, as(kim)), refused(403, "bots_archive_forbidden"), "a member, a bot she didn't make");
  const archived = await bots.archiveBot(bot.id, as(pat));
  assert.ok(Date.parse(archived.bot.archivedAt) <= Date.now(), "the answer is the bot as listed, archived");
  assert.equal(archived.bot.archivedBy, "you");
  const forKim = await listed(kim);
  assert.ok(forKim.archivedAt, "archived for Kim too");
  assert.ok(forKim.archivedBy && forKim.archivedBy !== "you", `Kim sees who did it (${forKim.archivedBy})`);
  assert.equal(forKim.sectionId, before.kim.sectionId, "her section is kept, for when it's back");
  await assert.rejects(bots.unarchiveBot(bot.id, as(kim)), refused(403, "bots_archive_forbidden"), "nor may she undo it");

  // Read-only: its chat reads as it was, a message, a reply and a rename are refused, and reading it is not.
  assert.deepEqual(texts(await bots.messages(bot.id, null, {}, as(pat))).slice(-2), ["The budget is 500", "Noted."]);
  const archivedText = new RegExp(`^${bot.name} is archived\\. Unarchive it to continue\\.$`, "u");
  for (const person of [pat, kim]) {
    await assert.rejects(bots.sendMessage(bot.id, { text: "Still there?" }, as(person)),
      (error) => refused(409, "bots_bot_archived")(error) && archivedText.test(error.message), "a message is refused");
    await assert.rejects(bots.replyTo(bot.id, {}, undefined, as(person)), refused(409, "bots_bot_archived"), "and a reply");
  }
  await assert.rejects(bots.updateBot(bot.id, { name: "Renamed" }, as(pat)), refused(409, "bots_bot_archived"), "and a rename");
  await assert.rejects(bots.updateBot(bot.id, { pinned: false }, as(pat)), refused(409, "bots_bot_archived"), "and a pin");
  await bots.updateBot(bot.id, { unread: false }, as(kim));

  // Archiving it again changes nothing; unarchived, it's back for everyone where each had it, and talks again.
  assert.equal((await bots.archiveBot(bot.id, as(pat))).bot.archivedBy, "you");
  const back = await bots.unarchiveBot(bot.id, as(pat));
  assert.equal(back.bot.archivedAt, null);
  assert.equal(back.bot.archivedBy, undefined);
  assert.equal((await listed(pat)).pinPosition, before.pat.pinPosition, "pinned for Pat as before");
  assert.equal((await listed(kim)).sectionId, before.kim.sectionId, "in Money for Kim as before");
  assert.equal((await listed(kim)).archivedAt, null);
  await say("And now?", kim);
  assert.deepEqual(texts(await bots.messages(bot.id, null, {}, as(kim))).slice(-2), ["And now?", "Noted."]);

  // A member archives and unarchives the bot she made; nobody reaches another home's bot.
  const kims = await makeBot("Kim's notes", { user_id: kim });
  assert.equal((await listed(kim, kims.id)).canArchive, true, "its maker may");
  await bots.archiveBot(String(kims.id), as(kim));
  await bots.unarchiveBot(String(kims.id), as(kim));
  const theirs = await makeBot("Theirs", {}, otherHome);
  await assert.rejects(bots.archiveBot(String(theirs.id), as(pat)), refused(404, "bots_bot_not_found"), "another home's bot");
  await assert.rejects(bots.unarchiveBot(String(theirs.id), as(pat)), refused(404, "bots_bot_not_found"));
});

test("the main bot, the Builder and a group chat aren't archived, each saying why", async (context) => {
  const { bots, as, pat, kim, bot, builder, makeBot, listed } = await setup(context);
  const main = await makeBot("Main", { is_main: true });
  await assert.rejects(bots.archiveBot(String(main.id), as(pat)),
    (error) => refused(409, "bots_archive_main")(error) && /is this home's main bot, so it can't be archived\. Make another bot the main bot first\./u.test(error.message));
  await assert.rejects(bots.archiveBot(String(main.id), as(kim)), refused(403, "bots_archive_forbidden"), "who may is decided first");

  builder.id = String(bot.id);
  await assert.rejects(bots.archiveBot(bot.id, as(pat)),
    (error) => refused(409, "bots_archive_builder")(error) && /builds this home's apps, so it can't be archived\. Choose another Builder in Apps first\./u.test(error.message));
  builder.id = null;

  const otto = await makeBot("Otto");
  const { bot: group } = await bots.createGroup({ botIds: [bot.id, String(otto.id)], text: "Plans" }, "Pat", as(pat));
  await assert.rejects(bots.archiveBot(group.id, as(pat)), refused(409, "bots_archive_group"));
  assert.equal((await listed(pat, group.id)).canArchive, false, "a group chat offers no Archive");
  await assert.rejects(bots.archiveBot(group.id, as(kim)), refused(404, "bots_bot_not_found"), "someone not in the group doesn't see it");
  assert.equal((await listed(pat, main.id)).archivedAt, null);
});

test("archiving pauses every person's routines and watches with a line, nothing runs, its computers sleep, and they stay paused", async (context) => {
  const pausedWatches = [];
  const { knex, parts, bots, as, homeId, pat, kim, bot, turns, watchCalls, slept, seatOf, routine } = await setup(context, { pausedWatches });
  const patSeat = await seatOf(pat);
  const kimSeat = await seatOf(kim);
  const mine = await routine(patSeat, "Pat's brief");
  const hers = await routine(kimSeat, "Kim's brief");
  pausedWatches.push({ conversationId: kimSeat, name: "New deals" });

  await bots.archiveBot(bot.id, as(pat));
  for (const id of [mine.id, hers.id]) {
    const paused = await knex("bot_routines").where({ id }).first();
    assert.deepEqual([paused.enabled, paused.next_run_at], [false, null], `${paused.name} paused, though only Pat archived it`);
  }
  assert.deepEqual(watchCalls.map((call) => [call.botId, call.conversationIds.toSorted()]), [[String(bot.id), [patSeat, kimSeat].toSorted()]],
    "its watches pause in every conversation with it");
  const lineIn = (conversationId) => knex("bot_messages").where({ conversation_id: conversationId, kind: "event" }).orderBy("id", "desc").first();
  const kimLine = await lineIn(kimSeat);
  assert.equal(kimLine?.body.text, "Paused while archived");
  assert.equal(kimLine.body.detail,
    `${bot.name} was archived, so its routine "Kim's brief", watch "New deals" paused. They stay paused when it's unarchived: resume them here.`);
  assert.match((await lineIn(patSeat)).body.detail, /its routine "Pat's brief" paused\./u);
  assert.deepEqual(slept.map((call) => [call.workspaceId, call.among.toSorted()]), [[homeId, [patSeat, kimSeat].toSorted()]],
    "its computers are put to sleep, so none counts a computer day");

  // Archived again: nothing more pauses, no second line, nothing more sleeps.
  const lines = await knex("bot_messages").where({ bot_id: bot.id, kind: "event" }).count({ count: "*" }).first();
  await bots.archiveBot(bot.id, as(pat));
  assert.equal((await knex("bot_messages").where({ bot_id: bot.id, kind: "event" }).count({ count: "*" }).first()).count, lines.count);
  assert.equal(watchCalls.length, 1);
  assert.equal(slept.length, 1);

  // Goals, requests and queued replies find no row in any of its conversations; a claimed run ends unrun.
  assert.equal(await parts.records.conversations.rowOf(String(bot.id), patSeat, as(pat)), null);
  assert.equal(await parts.records.conversations.rowOf(String(bot.id), kimSeat, as(kim)), null);
  assert.equal(await parts.records.conversations.rowOf(String(bot.id), null, as(kim)), null, "nor without naming one");
  const asked = turns.length;
  await knex("bot_routines").where({ id: hers.id })
    .update({ enabled: true, run_id: randomUUID(), run_attempts: 1, run_lease_until: knex.raw("now() + interval '10 minutes'") });
  await bots.runRoutine(claimedWork(await knex("bot_routines").where({ id: hers.id }).first()));
  await bots.drain(10000);
  assert.equal(turns.length, asked, "the model isn't asked");
  assert.equal(String((await knex("bot_messages").where({ conversation_id: kimSeat }).orderBy("id", "desc").first()).id), String(kimLine.id),
    "nothing posted");
  assert.equal((await knex("bot_routines").where({ id: hers.id }).first()).run_id, null, "and the run ends");
  await knex("bot_routines").where({ id: hers.id }).update({ enabled: false });

  // Unarchived, work can run again, but what paused waits for someone to resume it.
  await bots.unarchiveBot(bot.id, as(pat));
  assert.equal((await knex("bot_routines").where({ id: mine.id }).first()).enabled, false, "still paused after Unarchive");
  assert.equal((await knex("bot_routines").where({ id: hers.id }).first()).enabled, false);
  assert.ok(await parts.records.conversations.rowOf(String(bot.id), kimSeat, as(kim)), "its conversations run work again");
});

test("groups, other bots, search and teams leave an archived bot out", async (context) => {
  const tag = `budget${randomBytes(3).toString("hex")}`;
  let asked = null;
  const { knex, bots, as, pat, bot, turns, spoke, makeBot, listed, say } = await setup(context, {
    onTurn: async (current, tools) => {
      if (!asked || String(current.id) !== asked.from) return null;
      asked.answer = await tools.askBot.execute({ bot: asked.name, brief: "Work out the totals for this month, please." });
      return "Asked.";
    }
  });
  await knex("bots").where({ id: bot.id }).update({ library_template: "plant-care" });
  const otto = await makeBot("Otto");
  await bots.messages(otto.id, null, {}, as(pat));
  const { bot: group } = await bots.createGroup({ botIds: [bot.id, String(otto.id)], text: "Plans" }, "Pat", as(pat));
  await say(`The ${tag} is 500`);
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "search finds it");
  assert.deepEqual((await bots.teamFor("just-me", as(pat))).bots.find((entry) => entry.slug === "plant-care").inHome, true);

  await bots.archiveBot(bot.id, as(pat));
  assert.deepEqual((await listed(pat, group.id)).members.map((member) => [member.name, Boolean(member.archived)]),
    [[bot.name, true], [otto.name, false]], "it stays in the group, shown as archived");
  spoke.length = 0;
  const sent = await bots.sendMessage(group.id, { text: "Thoughts, <@everyone>?" }, as(pat));
  await bots.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(pat));
  await bots.drain(10000);
  assert.deepEqual(spoke, [otto.name], "only the others answer there");
  spoke.length = 0;
  const named = await bots.sendMessage(group.id, { text: `<@bot:${bot.id}> what's the total?` }, as(pat));
  await bots.replyTo(group.id, { afterMessageId: named.messages[0].id }, undefined, as(pat));
  await bots.drain(10000);
  assert.deepEqual(spoke, [], "named, it still doesn't answer");
  await assert.rejects(bots.createGroup({ botIds: [bot.id, String(otto.id)], text: "Again" }, "Pat", as(pat)), refused(409, "bots_bot_archived"),
    "no new group takes it");
  const { bot: small } = await bots.createGroup({ botIds: [String(otto.id)], text: "Just Otto" }, "Pat", as(pat));
  await assert.rejects(bots.addMember(small.id, bot.id, as(pat)), refused(409, "bots_bot_archived"), "nor does adding it");

  // Another bot isn't offered it, and asking it by name says why.
  asked = { from: String(otto.id), name: bot.name };
  await say("Ask Ledger for the totals", pat, otto.id);
  const ottoTurn = turns.findLast((turn) => turn.bot === String(otto.id));
  assert.match(ottoTurn.state, /The other bots in this home \(message_bot\): none\./u, "Otto's turn doesn't list it");
  assert.match(asked.answer.error, new RegExp(`^${bot.name} is archived, so it can't be asked\\.`, "u"));
  assert.equal(await knex("bot_requests").where({ to_bot_id: bot.id }).first(), undefined, "no request is made");

  // Search doesn't find its chats; a team says it's archived here and doesn't add another.
  assert.equal((await bots.search(tag, as(pat))).messages.length, 0, "search doesn't find an archived bot's chats");
  const plants = (await bots.teamFor("just-me", as(pat))).bots.find((entry) => entry.slug === "plant-care");
  assert.deepEqual([plants.inHome, plants.archivedInHome], [true, true]);
  await assert.rejects(bots.addTeam("just-me", ["plant-care"], "Pat", as(pat)), refused(409, "bots_team_all_in_home"));

  await bots.unarchiveBot(bot.id, as(pat));
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "unarchived, it's found again");
  assert.equal((await bots.teamFor("just-me", as(pat))).bots.find((entry) => entry.slug === "plant-care").archivedInHome, undefined);
  await bots.addMember(small.id, bot.id, as(pat));
});

test("every open screen in the home hears it go and come back, and each group's people hear it there", async (context) => {
  const { bots, as, pat, kim, bot, news, makeBot } = await setup(context);
  const otto = await makeBot("Otto");
  const { bot: group } = await bots.createGroup({ botIds: [bot.id, String(otto.id)], text: "Plans" }, "Pat", as(pat));
  // Archiving posts its lines, so pages read the bot and catch up its chat (messages); unarchiving re-reads it (changed).
  for (const [change, type] of [[bots.archiveBot, "messages"], [bots.unarchiveBot, "changed"]]) {
    news.length = 0;
    await change(bot.id, as(pat));
    const heard = (botId, kind) => news.filter((event) => event.botId === String(botId) && event.type === kind).map((event) => event.userId).toSorted();
    assert.deepEqual(heard(bot.id, type), [pat, kim].toSorted(), `everyone in the home hears ${type}, Kim too`);
    assert.deepEqual(heard(group.id, "changed"), [pat], "the group's people, for its members");
  }
});

test("the list reads the same statements however many bots are archived", async (context) => {
  const { knex, bots, as, pat, kim, bot, makeBot } = await setup(context);
  const kims = await makeBot("Kim's first", { user_id: kim });
  await bots.archiveBot(String(kims.id), as(kim));
  await bots.archiveBot(bot.id, as(pat));
  const listOnce = await queriesDuring(knex, () => bots.listBots(as(pat)));
  const archivedNow = async () => (await bots.listBots(as(pat))).bots.filter((entry) => entry.archivedAt);
  assert.deepEqual((await archivedNow()).map((entry) => entry.archivedBy).toSorted(), ["Kim", "you"]);

  // Ten more, archived by either of them.
  for (let index = 0; index < 10; index += 1) {
    const maker = index % 2 ? kim : pat;
    const more = await makeBot(`More ${index}`, { user_id: maker });
    await bots.messages(more.id, null, {}, as(maker));
    await bots.archiveBot(String(more.id), as(maker));
  }
  assert.equal((await archivedNow()).length, 12);
  assert.equal(await queriesDuring(knex, () => bots.listBots(as(pat))), listOnce, "the list reads no more for them");
});
