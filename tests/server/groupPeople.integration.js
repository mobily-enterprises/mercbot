import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords, startBotRecordsForChecks } from "../support/botRecords.mjs";

// Groups with several people (D-46, step 2), against the disposable test database: people join and
// leave, everyone in a group sees one conversation with their own unread, news reaches only them,
// bots answer only when named once there are several people, and nobody else finds the group.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context) {
  const knex = await connectTestDatabase();
  const [owner, other] = await knex("users").orderBy("id").limit(2).pluck("id");
  assert.ok(owner && other, "the test database needs two users");
  const homeId = await testHome(knex, owner);
  const joined = !await knex("workspace_memberships").where({ workspace_id: homeId, user_id: other }).first();
  if (joined) await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: other, role_sid: "member", status: "active" });
  const tag = Date.now().toString(36);
  const scout = await testBot(knex, owner, { name: `Scout ${tag}` });
  const otto = await testBot(knex, owner, { name: `Otto ${tag}` });
  const news = [];
  const spoke = [];
  const records = await startBotRecords(knex, context);
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    notices: {
      publish: async (_topic, userId, event) => { news.push({ userId: String(userId), ...event }); },
      publishEach: async (_topic, userIds, event) => { for (const userId of userIds) news.push({ userId: String(userId), ...event }); },
      subscribe: () => () => {}
    },
    reply: async () => ({ text: "ok", transcript: [] }),
    groupReply: async (bot) => { spoke.push(bot.name); return `${bot.name} here.`; }
  }));
  const groups = [];
  context.after(async () => {
    await knex("bots").whereIn("id", [scout.id, otto.id, ...groups]).del();
    if (joined) await knex("workspace_memberships").where({ workspace_id: homeId, user_id: other }).del();
    await knex.destroy();
  });
  /** A member's request in the home, as the bots routes make its options. */
  const as = (userId) => memberOptions({ userId, homeId });
  const makeGroup = async () => {
    const { bot } = await service.createGroup({ botIds: [scout.id, otto.id], text: "Let's plan" }, "Owner", as(owner));
    groups.push(bot.id);
    return bot;
  };
  return { knex, owner: String(owner), other: String(other), homeId, as, scout, otto, service, news, spoke, makeGroup, tag };
}

test("work done for someone sees only their groups, and work for the whole home sees every group", async (context) => {
  const { knex, owner, other, homeId, makeGroup } = await setup(context);
  const group = await makeGroup();
  const { handles, systemContext } = await startBotRecordsForChecks(knex, context);
  const system = systemContext("read a home's group chats as its jobs do");
  // As the reply and request runners derive theirs: the person's scope in the home, acting for them.
  const forPerson = (person) => ({ context: system.forWorkspaceUser(homeId, person, { actorId: person }) });
  const finds = async (options) => Boolean(await handles.bots.get(group.id, {}, { ...options, missing: "skip" }));
  assert.equal(await finds(forPerson(owner)), true, "a job for someone in the group finds it");
  assert.equal(await finds(forPerson(other)), false, "a job for someone not in it doesn't");
  assert.equal(await finds({ context: system.forWorkspace(homeId) }), true, "a job for the whole home finds it");
});

test("people join a group, see one conversation, and only they hear its news", async (context) => {
  const { as, owner, other, service, news, makeGroup } = await setup(context);
  const group = await makeGroup();
  assert.deepEqual(group.people.map((person) => person.id), [owner]);
  assert.ok(!(await service.listBots(as(other))).bots.some((bot) => bot.id === group.id), "someone not in it doesn't see it");
  await assert.rejects(service.messages(group.id, null, {}, as(other)), /not found/iu);

  news.length = 0;
  const added = await service.addPerson(group.id, other, as(owner));
  assert.deepEqual(added.bot.people.map((person) => person.id), [owner, other]);
  assert.ok(news.some((event) => event.userId === other && event.type === "changed"), "the new person hears about it");
  const theirs = (await service.listBots(as(other))).bots.find((bot) => bot.id === group.id);
  assert.ok(theirs, "now they see it");
  assert.equal(theirs.rooms, null, "a group has no tabs");

  const { messages: mine } = await service.messages(group.id, null, {}, as(owner));
  const { messages: seen } = await service.messages(group.id, null, {}, as(other));
  assert.deepEqual(seen.map((message) => message.id), mine.map((message) => message.id), "one conversation for both");
  assert.match(seen.at(-1).body.text, / added /u, "a line says who was added");

  news.length = 0;
  const sent = await service.sendMessage(group.id, { text: "Hello everyone", clientId: `hi-${Date.now()}` }, as(other));
  assert.equal(sent.messages[0].body.from.id, other, "each message says who wrote it");
  await service.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(other));
  await service.drain(10000);
  const told = new Set(news.map((event) => event.userId));
  assert.deepEqual([...told].sort(), [owner, other].sort(), "news only for the group's people");
  assert.equal((await service.listBots(as(owner))).bots.find((bot) => bot.id === group.id).unread, true, "unread for the other person");
  assert.equal((await service.listBots(as(other))).bots.find((bot) => bot.id === group.id).unread, false, "not for the one who wrote it");

  const found = await service.search("Hello everyone", as(owner));
  assert.ok(found.messages.some((message) => message.conversationId === group.id), "people in the group find it in search");
  await service.removePerson(group.id, other, {}, as(other));
  const after = await service.search("Hello everyone", as(other));
  assert.ok(!after.messages.some((message) => message.conversationId === group.id), "after leaving, search doesn't find it");
});

test("who may remove people, and the last one out ends the group", async (context) => {
  const { knex, as, owner, other, service, news, makeGroup } = await setup(context);
  const group = await makeGroup();
  await service.addPerson(group.id, other, as(owner));
  await assert.rejects(service.removePerson(group.id, owner, {}, as(other)), /Only the person who made this group/u, "a member can't remove the maker");
  await assert.rejects(service.deleteBot(group.id, as(other)), /Only the person who made this group can delete it/u);
  news.length = 0;
  const removed = await service.removePerson(group.id, other, {}, as(owner));
  assert.deepEqual(removed.bot.people.map((person) => person.id), [owner]);
  assert.ok(news.some((event) => event.userId === other && event.type === "removed"), "the removed person hears it");
  await service.addPerson(group.id, other, as(owner));
  const managed = await service.removePerson(group.id, owner, { manages: true }, as(other)).catch((error) => error);
  assert.match(String(managed.message || ""), /can leave it, but not be removed/u, "even an admin can't remove the maker");
  await service.removePerson(group.id, owner, {}, as(owner));
  assert.ok(await knex("bots").where({ id: group.id }).first(), "the group goes on with the other person");
  const ended = await service.removePerson(group.id, other, {}, as(other));
  assert.equal(ended.deleted, group.id, "the last one out ends it");
  assert.equal(await knex("bots").where({ id: group.id }).first(), undefined);
});

test("alone, every bot answers; with several people, only the bots someone names", async (context) => {
  const { as, owner, other, scout, otto, service, spoke, makeGroup } = await setup(context);
  const group = await makeGroup();
  const turn = async (userId, text) => {
    spoke.length = 0;
    const sent = await service.sendMessage(group.id, { text, clientId: `t-${Date.now()}-${Math.random()}` }, as(userId));
    await service.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await service.drain(10000);
    return [...spoke];
  };
  assert.deepEqual((await turn(owner, "Ideas for the weekend?")).sort(), [scout.name, otto.name].sort());
  await service.addPerson(group.id, other, as(owner));
  assert.deepEqual(await turn(other, "Shall we just talk first?"), [], "people can talk among themselves");
  assert.deepEqual(await turn(other, `What do you think, <@bot:${otto.id}>?`), [otto.name]);
  assert.deepEqual((await turn(owner, "Thoughts, <@everyone>?")).sort(), [scout.name, otto.name].sort());
});

test("existing groups were converted with their messages, maker and settings", async (context) => {
  const { knex } = await setup(context);
  const groups = await knex("bots").where({ kind: "group" }).select("id", "user_id");
  for (const group of groups.slice(0, 20)) {
    const room = await knex("bot_conversations").where({ bot_id: group.id }).whereNull("user_id").whereNull("group_id");
    assert.equal(room.length, 1, `group ${group.id} has one room`);
    const seat = await knex("bot_conversations").where({ bot_id: group.id, user_id: group.user_id }).first();
    assert.ok(seat, `group ${group.id} keeps a seat for its maker`);
    assert.equal(String(seat.room_id), String(room[0].id));
    assert.ok(await knex("bot_group_people").where({ group_id: group.id, user_id: group.user_id }).first(), "its maker is in it");
    assert.equal(Number((await knex("bot_messages").where({ conversation_id: seat.id }).count("* as n").first()).n), 0, "no messages were left behind on the seat");
  }
});

test("only the group's own home's people and bots can join it", async (context) => {
  const { knex, as, owner, service, makeGroup } = await setup(context);
  const group = await makeGroup();
  const elsewhere = (await knex("workspaces").insert({ slug: `elsewhere-${Date.now()}`, name: "Elsewhere", owner_user_id: owner, is_personal: false }).returning("id"))[0].id;
  await knex("workspace_memberships").insert({ workspace_id: elsewhere, user_id: owner, role_sid: "owner", status: "active" });
  const [stranger] = await knex("bots").insert({ user_id: owner, workspace_id: elsewhere, name: "Stranger", color: "#1E86FC" }).returning("*");
  await assert.rejects(service.addMember(group.id, stranger.id, as(owner)), /not found/iu, "a bot from another home can't join");
  const outsider = (await knex("users").whereNotIn("id", knex("workspace_memberships").where({ workspace_id: group.workspaceId || (await knex("bots").where({ id: group.id }).first()).workspace_id }).select("user_id")).first("id"))?.id;
  if (outsider) await assert.rejects(service.addPerson(group.id, outsider, as(owner)), /isn't in this home/u, "nor someone outside the home");
  await knex("bots").where({ id: stranger.id }).del();
  await knex("workspace_memberships").where({ workspace_id: elsewhere }).del();
  await knex("workspaces").where({ id: elsewhere }).del();
});

test("bots use their tools in a group: nothing personal with others there, cards for the asker only", async (context) => {
  const knex = await connectTestDatabase();
  const [owner, other] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  const homeId = await testHome(knex, owner);
  const joined = !await knex("workspace_memberships").where({ workspace_id: homeId, user_id: other }).first();
  if (joined) await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: other, role_sid: "member", status: "active" });
  const helper = await testBot(knex, owner, { name: `Helper ${Date.now().toString(36)}` });
  const seen = [];
  const as = (userId) => memberOptions({ userId, homeId });
  const service = createBotsService(serviceDoubles({
    knex,
    records: await startBotRecords(knex, context),
    approvals: { decide: async () => "ask" },
    reply: async () => ({ text: "ok", transcript: [] }),
    groupReply: async (bot, { tools, state, people }) => {
      seen.push({ tools: Object.keys(tools), state, people });
      if (tools.createRoutine) {
        await tools.createRoutine.execute({ acknowledgement: "Setting it up", name: "Plant check", schedule: "Every day at 9:00 (UTC)", cron: "0 9 * * *", timezone: "UTC", instructions: "Check the plants." });
      }
      return `${bot.name} on it.`;
    }
  }));
  const { bot: group } = await service.createGroup({ botIds: [helper.id], text: "Hello" }, "Owner", as(owner));
  await service.addPerson(group.id, other, as(owner));
  const sent = await service.sendMessage(group.id, { text: `<@bot:${helper.id}> set up a daily plant check`, clientId: `tool-${Date.now()}` }, as(other));
  await service.replyTo(group.id, { afterMessageId: sent.messages[0].id }, undefined, as(other));
  await service.drain(10000);

  const turn = seen.at(-1);
  assert.ok(turn.tools.includes("createRoutine") && turn.tools.length > 2, "the bot has its full tools");
  assert.ok(!turn.tools.includes("remember"), "but nothing personal with others in the group");
  assert.match(turn.state, /group chat/u, "and knows it's in a group chat");
  const seat = await knex("bot_conversations").where({ bot_id: helper.id, group_id: group.id }).first();
  assert.ok(seat && seat.user_id === null, "it has its own computer for this group");
  assert.ok(!(await service.listBots(as(owner))).bots.find((bot) => bot.id === String(helper.id)).rooms, "which is never a tab");

  const card = (await service.messages(group.id, null, {}, as(other))).messages.find((message) => message.kind === "choice");
  assert.equal(card.body.for.id, other, "the approval is for the person who asked");
  assert.equal(card.body.speaker.id, String(helper.id));
  await assert.rejects(service.answerChoice(group.id, card.id, [card.body.options[0]], as(owner)), /waiting for/u, "nobody else can answer it");
  await service.answerChoice(group.id, card.id, [card.body.options[0]], as(other));
  const routine = await knex("bot_routines").where({ bot_id: helper.id, name: "Plant check" }).first();
  const theirs = await knex("bot_conversations").where({ bot_id: helper.id, user_id: other }).first();
  assert.equal(String(routine.conversation_id), String(theirs.id), "the routine runs in the asker's own chat with the bot");

  await knex("bots").whereIn("id", [helper.id, group.id]).del();
  if (joined) await knex("workspace_memberships").where({ workspace_id: homeId, user_id: other }).del();
  await knex.destroy();
});
