import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { claimedWork, memberOptions, startBotParts } from "../support/botRecords.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { seedChat } from "../support/chatFixtures.mjs";

// A chat archived and unarchived (D-101, D-112), against the disposable test database, with scripted replies in place of
// the model: read-only for everyone in it, by its maker or the home's owners and admins, never the everyone chat. Who
// may, what's refused, that nothing is written, runs or is found there, that its routines and watches pause with a line
// and stay paused when it's unarchived, and that the chat list and the archived list read the same number of
// statements however many are archived. Each route refusing an archived chat's writes is botsRouteGuard.test.js's.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A refusal with this status and code. */
const refused = (status, code) => (error) => {
  assert.equal(error.statusCode, status, `${error.code}: ${error.message}`);
  assert.equal(error.code, code);
  return true;
};

/**
 * A home of its own with Pat (its owner, who may change any chat) and Kim (a member), the bot Ledger, a second home, and
 * a bots service whose replies record each turn. The Apps' watches pause those `pausedWatches` name, by their seat.
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
    { workspace_id: homeId, user_id: kim, role_sid: "member", status: "active" },
    { workspace_id: otherHome, user_id: pat, role_sid: "owner", status: "active" }
  ]);
  // The service's background work finishes first, then the test's rows go, then the connection closes.
  let bots = null;
  context.after(async () => {
    await bots?.drain(10000);
    await knex("conversations").whereIn("workspace_id", [homeId, otherHome]).del();
    await knex("bots").whereIn("workspace_id", [homeId, otherHome]).del();
    await knex("workspace_memberships").whereIn("workspace_id", [homeId, otherHome]).del();
    await knex("workspaces").whereIn("id", [homeId, otherHome]).del();
    await knex("users").where({ id: kim }).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const turns = [];
  const watchCalls = [];
  bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    apps: {
      watches: {
        pauseIn: async (where) => {
          watchCalls.push(where);
          return pausedWatches.filter((watch) => (where.chatBotIds || []).includes(watch.chatBotId));
        }
      }
    },
    reply: async (current, history) => {
      turns.push({ bot: String(current.id), history: history.filter((message) => message.kind === "text").map((message) => message.body.text) });
      return { text: "Noted.", transcript: [] };
    }
  }));
  // Pat is the home's owner, so may change any chat (workspace.settings.update); Kim is a member.
  const as = (userId, workspaceId = homeId) => memberOptions(userId === pat
    ? { userId, homeId: workspaceId, role: "owner", permissions: ["workspace.settings.update"] }
    : { userId, homeId: workspaceId });
  const [bot] = await knex("bots").insert({ made_by: pat, workspace_id: homeId, name: `Ledger ${stamp}`, color: "#1E86FC" }).returning("*");
  /** A Public chat `maker` starts with the bot and `people`: its id. */
  const chatBy = async (maker, title, people = []) => (await bots.chats.create({ title, people, bots: [String(bot.id)] }, as(maker))).chat.id;
  const seatIn = async (chatId) => String((await knex("chat_bots").where({ conversation_id: chatId, bot_id: bot.id }).first("id")).id);
  /** Someone says something in the chat and the bot answers there. */
  const say = async (chatId, text, person = pat) => {
    const sent = await bots.chat.sendMessage(chatId, { text }, as(person));
    await bots.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as(person));
    await bots.drain(10000);
  };
  const listed = async (userId, only = {}) => (await bots.chats.list(only, as(userId))).chats.map((chat) => chat.id);
  const archivedIn = async (userId) => (await bots.chats.list({ archived: true }, as(userId))).chats.filter((chat) => chat.archivedAt).map((chat) => chat.id);
  const routine = async (chatId, name, madeBy = kim) => (await knex("bot_routines").insert({
    workspace_id: homeId, chat_bot_id: await seatIn(chatId), made_by: madeBy, name, schedule: "Every morning", cron: "0 8 * * *",
    timezone: "UTC", instructions: "Say hello", enabled: true, next_run_at: knex.raw("now() + interval '1 hour'")
  }).returning("*"))[0];
  return { knex, parts, bots, as, homeId, otherHome, pat, kim, bot, turns, watchCalls, chatBy, seatIn, say, listed, archivedIn, routine };
}

/** The bots routes on the real service and records: one route called as a member's request in the home. */
function routesOf({ bots, parts, homeId }) {
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    { bots, approvals: {}, notices: {}, meter: { track: (_meta, work) => work(), pausedMessage: async () => null }, records: parts.records, streams: new Set() }
  );
  return async (key, params, body, userId) => {
    const answer = {};
    const reply = {
      code(status) {
        answer.status = status;
        return reply;
      },
      send(sent) {
        answer.body = sent;
        return reply;
      }
    };
    const request = {
      method: key.split(" ")[0],
      params: { workspaceSlug: "hilltop", ...params },
      body,
      user: { id: userId },
      workspace: { id: homeId, slug: "hilltop" },
      membership: { roleSid: "member" },
      permissions: []
    };
    request.callOptions = async () => requestContextOptions(request);
    await routes.get(key)(request, reply);
    return answer;
  };
}

test("a chat is archived and unarchived by its maker or an owner: read-only and unfound meanwhile, then back as it was", async (context) => {
  const kit = await setup(context);
  const { bots, as, pat, kim, chatBy, say, listed } = kit;
  const plans = await chatBy(kim, "Plans", [pat]);
  const tag = `budget${randomBytes(3).toString("hex")}`;
  await say(plans, `The ${tag} is 500`, kim);
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "search finds it");

  // Kim started Plans, so she may archive it: it goes from everyone's list to their archived chats.
  const archived = (await bots.chats.archive(plans, as(kim))).chat;
  assert.ok(Date.parse(archived.archivedAt) <= Date.now(), "the answer is the chat, archived");
  for (const person of [pat, kim]) {
    assert.ok(!(await listed(person)).includes(plans), "gone from the list");
    assert.ok((await listed(person, { archived: true })).includes(plans), "among the archived chats");
  }
  assert.equal((await bots.search(tag, as(pat))).messages.length, 0, "search doesn't find an archived chat");
  // Its messages still read; a message there is refused, with words saying why.
  assert.ok((await bots.chat.messages(plans, {}, as(pat))).messages.some((message) => message.body.text === `The ${tag} is 500`));
  const call = routesOf(kit);
  const sent = await call("POST /api/w/:workspaceSlug/chats/:chatId/messages", { chatId: plans }, { text: "Still there?" }, kim);
  assert.deepEqual([sent.status, sent.body?.code, sent.body?.error], [409, "bots_chat_archived", "This chat is archived. Unarchive it to continue."]);

  // Archiving it again changes nothing; Pat, an owner, unarchives it: back in everyone's list, with its messages.
  assert.deepEqual((await bots.chats.archive(plans, as(kim))).chat.archivedAt, archived.archivedAt);
  assert.equal((await bots.chats.unarchive(plans, as(pat))).chat.archivedAt, null);
  for (const person of [pat, kim]) assert.ok((await listed(person)).includes(plans), "back in the list");
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "and found again");
  const again = await call("POST /api/w/:workspaceSlug/chats/:chatId/messages", { chatId: plans }, { text: "Back again" }, kim);
  assert.equal(again.status, 200);
});

test("each refusal: a member's archive of a chat she didn't start, the everyone chat, a private chat, another home's chat", async (context) => {
  const { knex, bots, as, homeId, otherHome, pat, kim, bot, chatBy, listed } = await setup(context);
  const budget = await chatBy(pat, "Budget", [kim]);
  await assert.rejects(bots.chats.archive(budget, as(kim)), refused(403, "bots_chat_manage_forbidden"), "a member, a chat she didn't start");
  await bots.chats.archive(budget, as(pat));
  await assert.rejects(bots.chats.unarchive(budget, as(kim)), refused(403, "bots_chat_manage_forbidden"), "nor unarchive it");
  // An owner archived the chat Kim started: she started it, so she may unarchive it, as may the owner.
  const ideas = await chatBy(kim, "Ideas", [pat]);
  await bots.chats.archive(ideas, as(pat));
  await bots.chats.unarchive(ideas, as(kim));

  // The home's everyone chat, which has every member, is never archived, even by an owner.
  const { id: family } = await seedChat(knex, { homeId, title: "Hilltop", everyone: true, people: [pat, kim], bots: [bot.id] });
  await assert.rejects(bots.chats.archive(String(family), as(pat)), refused(409, "bots_chat_everyone"));
  // A Private chat isn't archived for everyone, even by its maker, an owner (plan 5.1): each of its people hides it for
  // themselves, and it stays in the others' lists.
  const diary = (await bots.chats.create({ kind: "private", title: "Diary", people: [kim], bots: [String(bot.id)] }, as(pat))).chat.id;
  await assert.rejects(bots.chats.archive(diary, as(pat)), {
    statusCode: 409, code: "bots_chat_private_archive", message: "A private chat is hidden for yourself, not archived for everyone."
  });
  await bots.chats.changePlace(diary, { hidden: true }, as(kim));
  assert.ok(!(await listed(kim)).includes(diary), "hidden from Kim's list");
  assert.ok((await listed(kim, { hidden: true })).includes(diary), "among the chats she hid");
  assert.ok((await listed(pat)).includes(diary), "still in Pat's list");
  // Another home's chat is not found from this one, even for Pat, who is in both.
  const { id: theirs } = await seedChat(knex, { homeId: otherHome, title: "Secret", people: [pat] });
  await assert.rejects(bots.chats.archive(String(theirs), as(pat)), refused(404, "bots_chat_not_found"));
  await bots.chats.archive(String(theirs), as(pat, otherHome));
  await assert.rejects(bots.chats.unarchive(String(theirs), as(pat)), refused(404, "bots_chat_not_found"));
  await assert.rejects(bots.chats.archive("not-a-chat", as(pat)), (error) => error.statusCode === 404);
});

test("archiving pauses a chat's routines and watches with a line, nothing runs there, and they stay paused after unarchiving", async (context) => {
  const pausedWatches = [];
  const { knex, bots, as, pat, kim, turns, watchCalls, chatBy, seatIn, routine } = await setup(context, { pausedWatches });
  const plans = await chatBy(kim, "Plans", [pat]);
  const budget = await chatBy(pat, "Budget", [kim]);
  const inPlans = await routine(plans, "Morning brief");
  const inBudget = await routine(budget, "Rota check", pat);
  pausedWatches.push({ chatBotId: await seatIn(plans), name: "New deals" });

  await bots.chats.archive(plans, as(kim));
  const paused = await knex("bot_routines").where({ id: inPlans.id }).first();
  assert.deepEqual([paused.enabled, paused.next_run_at], [false, null], "its routine paused");
  assert.equal((await knex("bot_routines").where({ id: inBudget.id }).first()).enabled, true, "another chat's runs on");
  assert.deepEqual(watchCalls, [{ chatBotIds: [await seatIn(plans)] }], "its watches pause");
  const line = await knex("messages").where({ conversation_id: plans, kind: "event" }).orderBy("id", "desc").first();
  assert.equal(line?.body.text, "Paused while archived");
  assert.match(line.body.detail, /routine "Morning brief", watch "New deals" paused\. They stay paused when it's unarchived: resume them here\./u);

  // A claimed run there ends unrun: the model isn't asked and nothing is posted.
  const asked = turns.length;
  await knex("bot_routines").where({ id: inPlans.id }).update({ run_id: randomUUID(), run_attempts: 1, run_lease_until: knex.raw("now() + interval '10 minutes'") });
  await bots.runRoutine(claimedWork(await knex("bot_routines").where({ id: inPlans.id }).first()));
  await bots.drain(10000);
  assert.equal(turns.length, asked, "the model isn't asked");
  assert.equal(String((await knex("messages").where({ conversation_id: plans }).orderBy("id", "desc").first()).id), String(line.id), "nothing posted");
  assert.equal((await knex("bot_routines").where({ id: inPlans.id }).first()).run_id, null, "and the run ends");
  await assert.rejects(bots.chat.switchRoutine(String(inPlans.id), true, as(kim)), refused(409, "bots_chat_archived"), "nor is it resumed meanwhile");

  // Unarchived, the chat is back, but what paused waits to be resumed there: then it runs again.
  await bots.chats.unarchive(plans, as(kim));
  assert.equal((await knex("bot_routines").where({ id: inPlans.id }).first()).enabled, false, "still paused after unarchiving");
  await bots.chat.switchRoutine(String(inPlans.id), true, as(kim));
  assert.equal((await knex("bot_routines").where({ id: inPlans.id }).first()).enabled, true);
});

test("the chat list and the archived list read the same statements however many chats are archived", async (context) => {
  const { knex, bots, as, homeId, pat, kim, chatBy, archivedIn } = await setup(context);
  await bots.chats.archive(await chatBy(kim, "First", [pat]), as(kim));
  const listOnce = await queriesDuring(knex, () => bots.chats.list({}, as(pat)));
  const archivedOnce = await queriesDuring(knex, () => bots.chats.list({ archived: true }, as(pat)));
  assert.equal((await archivedIn(pat)).length, 1);

  // Thirty more archived chats Pat is in, written straight to the tables.
  const more = (await knex("conversations")
    .insert(Array.from({ length: 30 }, (_, index) => ({ workspace_id: homeId, kind: "public", title: `Old ${index}`, made_by: kim, archived_at: new Date() })))
    .returning("id")).map((row) => String(row.id));
  await knex("chat_people").insert(more.flatMap((id) => [pat, kim].map((userId) => ({ workspace_id: homeId, conversation_id: id, user_id: userId }))));
  assert.equal((await archivedIn(pat)).length, 31);
  assert.equal(await queriesDuring(knex, () => bots.chats.list({}, as(pat))), listOnce, "the list reads no more for them");
  assert.equal(await queriesDuring(knex, () => bots.chats.list({ archived: true }, as(pat))), archivedOnce, "nor does the archived list");
});
