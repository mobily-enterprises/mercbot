import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { createChatMembers } from "../../packages/bots/src/server/chatMembers.js";
import { startBotsService } from "../support/botDoubles.mjs";
import { memberOptions, startChatRecords } from "../support/botRecords.mjs";
import { seedMessage } from "../support/chatFixtures.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// A chat's members (D-112, R2) through records.chats: who a chat starts with and its kind (Public unless Private was
// chosen, D15), adding and removing people and bots, a direct chat taking no one else, the last person out of a
// private chat deleting it, unread for the others, and the home's everyone chat following who joins and leaves; then the
// chat routes' service over them (chatMembers.js): who may add, remove, rename, archive and delete, who is told, what a
// deleted chat's computers and files are asked to go, and a change of the home's people (homeChanged), with what
// someone who left made there paused (the bots service's homeChanged).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// One connection pool for the file, closed after every test's own cleanup has run.
const knex = await connectTestDatabase();
after(() => knex.destroy());

/** A home with Anna (owner) and Ben, Carla not in it yet, and two bots. */
async function home(knex, context) {
  const [anna, ben, carla] = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.ok(carla, "the test database needs three users");
  const [row] = await knex("workspaces").insert({ slug: `members-${randomBytes(5).toString("hex")}`, name: "Rossi", owner_user_id: anna, is_personal: false }).returning("id");
  const homeId = String(row.id);
  context.after(() => knex("workspaces").where({ id: homeId }).del());
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: anna, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: ben, role_sid: "member", status: "active" }
  ]);
  const bot = async (name, columns = {}) => String((await knex("bots").insert({ workspace_id: homeId, made_by: anna, name, color: "#1E86FC", ...columns }).returning("id"))[0].id);
  return { homeId, anna, ben, carla, chef: await bot("Chef"), pulse: await bot("Pulse", { archived_at: new Date() }) };
}

const peopleIn = async (records, chatId, options) => (await records.chats.people(chatId, options)).map((person) => person.user_id).sort((a, b) => a - b);

test("a new chat is Public unless Private is chosen, starts with its maker, and takes only the home's people", async (context) => {
  const { records } = await startChatRecords(knex, context);
  const { homeId, anna, ben, carla, chef, pulse } = await home(knex, context);
  const asAnna = memberOptions({ userId: anna, homeId });

  const kitchen = await records.chats.create({ title: "Kitchen", people: [ben], bots: [chef] }, asAnna);
  assert.equal(kitchen.kind, "public", "Public by default (D15), whoever is in it");
  const solo = await records.chats.create({ title: "Just me and Chef", bots: [chef] }, asAnna);
  assert.equal(solo.kind, "public", "a chat of one person and one bot too");
  assert.deepEqual(await peopleIn(records, kitchen.id, asAnna), [anna, ben].sort((a, b) => a - b), "the maker is in it");
  assert.deepEqual((await records.chats.bots(kitchen.id, asAnna)).map((bot) => bot.bot_id), [chef]);
  const secret = await records.chats.create({ kind: "private", title: "Surprise", bots: [chef] }, asAnna);
  assert.equal(secret.kind, "private");
  await assert.rejects(records.chats.create({ kind: "group" }, asAnna), { statusCode: 400 });
  await assert.rejects(records.chats.create({ people: [carla] }, asAnna), { statusCode: 404 }, "Carla isn't in the home");
  await assert.rejects(records.chats.create({ bots: [pulse] }, asAnna), { statusCode: 409 }, "an archived bot joins no chat");
});

test("people and bots are added and removed; a direct chat takes no one else; the last person out deletes a private chat", async (context) => {
  const { records } = await startChatRecords(knex, context);
  const { homeId, anna, ben, carla, chef, pulse } = await home(knex, context);
  const asAnna = memberOptions({ userId: anna, homeId });
  const asBen = memberOptions({ userId: ben, homeId });

  const plans = await records.chats.create({ kind: "private", title: "Plans", bots: [chef] }, asAnna);
  await assert.rejects(records.chats.addPerson(plans.id, ben, asBen), { statusCode: 404 }, "Ben can't add himself to a private chat he can't open");
  assert.equal(await records.chats.addPerson(plans.id, ben, asAnna), true);
  assert.equal(await records.chats.addPerson(plans.id, ben, asAnna), false, "adding someone twice adds them once");
  await assert.rejects(records.chats.addPerson(plans.id, carla, asAnna), { statusCode: 404 });
  await assert.rejects(records.chats.addBot(plans.id, pulse, asAnna), { statusCode: 409 });
  const seat = await records.chats.addBot(plans.id, chef, asAnna);
  assert.equal(seat.bot_id, chef, "adding a bot that's in it answers its seat");

  // A direct chat is one person's with one bot, Public (D15), made once; looking for it makes nothing.
  const chatsBefore = Number((await knex("conversations").where({ workspace_id: homeId }).count("id as n").first()).n);
  assert.equal(await records.chats.directWith(chef, asAnna), null);
  assert.equal(Number((await knex("conversations").where({ workspace_id: homeId }).count("id as n").first()).n), chatsBefore, "looking made nothing");
  const direct = await records.chats.direct(chef, asAnna);
  assert.equal(direct.kind, "public");
  assert.equal((await records.chats.direct(chef, asAnna)).id, direct.id);
  assert.equal((await records.chats.directWith(chef, asAnna)).id, direct.id);
  assert.equal(await records.chats.directWith(chef, asBen), null, "Anna's, not Ben's");
  await assert.rejects(records.chats.addPerson(direct.id, ben, asAnna), { statusCode: 409 });
  await assert.rejects(records.chats.rename(direct.id, "Mine", asAnna), { statusCode: 409 });

  // Unread: Anna's message is news for Ben, not for her; Ben reading clears it.
  await records.chats.markRead(plans.id, null, asBen);
  await records.messages.append(plans.id, [{ role: "user", kind: "text", body: { text: "oak or pine?" } }], asAnna);
  assert.equal((await records.chats.place(plans.id, asBen)).unread, true);
  assert.equal((await records.chats.place(plans.id, asAnna)).unread, false);

  // A card's body takes a patch (a request's state, a to-do list), keeping the rest of it.
  const card = await seedMessage(knex, { homeId, chatId: plans.id, kind: "bot_request", botId: chef, body: { status: "asked", brief: "menu" } });
  await records.work.patchCards([card], { status: "answered" }, asAnna);
  assert.deepEqual((await knex("messages").where({ id: card }).first("body")).body, { status: "answered", brief: "menu" });

  // Removing a bot takes its seat; the last person out of a private chat deletes it.
  assert.equal(await records.chats.removeBot(plans.id, chef, asAnna), true);
  assert.equal(await records.chats.removePerson(plans.id, ben, asAnna), false);
  assert.equal(await records.chats.removePerson(plans.id, anna, asAnna), true);
  assert.equal(await knex("conversations").where({ id: plans.id }).first("id"), undefined);
  // A public chat stays when its people leave: everyone in the home can still open it.
  const garden = await records.chats.create({ title: "Garden" }, asAnna);
  assert.equal(await records.chats.removePerson(garden.id, anna, asAnna), false);
  assert.ok(await records.chats.find(garden.id, asBen));
});

test("the everyone chat has every member; joining and leaving the home follow it, and leaving tidies up", async (context) => {
  const { records } = await startChatRecords(knex, context);
  const { homeId, anna, ben, carla, chef } = await home(knex, context);
  const asAnna = memberOptions({ userId: anna, homeId });
  const asBen = memberOptions({ userId: ben, homeId });

  const family = await records.chats.makeEveryoneChat({ title: "Rossi", bots: [chef] }, asAnna);
  assert.equal(family.everyone, true);
  assert.equal((await records.chats.makeEveryoneChat({ title: "Again" }, asAnna)).id, family.id, "one per home");
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna, ben].sort((a, b) => a - b));

  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: carla, role_sid: "member", status: "active" });
  assert.equal(await records.chats.personJoined(carla, asAnna), true);
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna, ben, carla].sort((a, b) => a - b));

  // Ben's own private chat goes with him, a shared one stays; his words stay. (What he made pauses before, with its
  // line: the home-change test below.)
  const bensOwn = await records.chats.create({ kind: "private", title: "Ben's", bots: [chef] }, asBen);
  const bensSeat = await records.chats.chatBotOf(chef, bensOwn.id, asBen);
  const shared = await records.chats.create({ kind: "private", title: "Shared", people: [anna], bots: [chef] }, asBen);
  await records.messages.append(shared.id, [{ role: "user", kind: "text", body: { text: "from Ben" } }], asBen);
  const { left, deleted } = await records.chats.personLeft(ben, asAnna);
  assert.deepEqual(deleted, [{ chatId: bensOwn.id, chatBotIds: [bensSeat.id] }], "deleted with its bots' seats, for their computers");
  assert.deepEqual(left.sort((a, b) => a - b), [family.id, shared.id].sort((a, b) => a - b));
  assert.deepEqual(await peopleIn(records, shared.id, asAnna), [anna]);
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna, carla].sort((a, b) => a - b));
  assert.equal((await records.messages.timeline(shared.id, {}, asAnna)).messages[0].body.text, "from Ben");
});

/**
 * The chat routes' service on the records, with what it tells people, what it asks the computers to remove and the
 * seats whose work an archive asks the turns to pause (workPause.js).
 */
function chatService({ records, systemContext }) {
  const heard = [];
  const removed = [];
  const paused = [];
  const forgot = [];
  const chats = createChatMembers({
    records,
    systemContext,
    notices: { publishEach: async (_topic, keys, event) => heard.push({ keys: [...keys].sort((a, b) => a - b), ...event }) },
    computer: { chatRemoved: async (chat) => removed.push(chat) },
    pauseWork: async (seats, line) => { paused.push({ seats: seats.map((seat) => ({ ...seat })), text: line.text }); },
    forget: async (botIds) => { forgot.push([...botIds]); }
  });
  return { chats, heard, removed, paused, forgot };
}

test("the chat routes' service: anyone in a chat adds, its maker and the home's owners and admins manage, everyone in it hears", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { records } = parts;
  const { homeId, anna, ben, carla, chef } = await home(knex, context);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: carla, role_sid: "member", status: "active" });
  const { chats, heard, removed, paused, forgot } = chatService(parts);
  const asAnna = memberOptions({ userId: anna, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  const asBen = memberOptions({ userId: ben, homeId });
  const asCarla = memberOptions({ userId: carla, homeId });
  const both = [anna, ben].sort((a, b) => a - b);

  // Ben starts Kitchen with Anna: Public (D15), and both hear of it.
  const { chat: kitchen } = await chats.create({ title: "Kitchen", people: [anna], bots: [chef] }, asBen);
  assert.equal(kitchen.kind, "public");
  assert.deepEqual(kitchen.people.map((person) => person.userId).sort((a, b) => a - b), both);
  assert.deepEqual(kitchen.bots.map((bot) => bot.botId), [chef]);
  assert.deepEqual(heard.pop(), { keys: both, type: "chat", chatId: kitchen.id, change: "created" });

  // Carla isn't in it: she reads it (public) but adds no one until she joins.
  assert.equal((await chats.get(kitchen.id, asCarla)).chat.place, null);
  await assert.rejects(chats.addPerson(kitchen.id, carla, asCarla), { statusCode: 403, code: "bots_chat_join_first" });
  assert.ok((await chats.join(kitchen.id, asCarla)).chat.place, "joined, she has a place in it");
  assert.deepEqual(heard.pop().keys, [anna, ben, carla].sort((a, b) => a - b));

  // Only its maker (Ben) and the home's owners and admins (Anna) manage it.
  await assert.rejects(chats.rename(kitchen.id, "Mine", asCarla), { statusCode: 403, code: "bots_chat_manage_forbidden" });
  await assert.rejects(chats.removePerson(kitchen.id, ben, asCarla), { statusCode: 403 });
  assert.equal((await chats.rename(kitchen.id, "Kitchen reno", asAnna)).chat.title, "Kitchen reno");
  assert.equal((await chats.rename(kitchen.id, "Kitchen 2", asBen)).chat.title, "Kitchen 2");
  assert.equal((await chats.removePerson(kitchen.id, carla, asAnna)).chat.people.length, 2);
  assert.deepEqual(heard.at(-2), { keys: [carla], type: "chat", chatId: kitchen.id, change: "members" }, "who was taken out hears too");
  // Archived (a Public chat, by an owner), its bots' work there pauses, once, and it takes no members; unarchived, its
  // work stays paused, to be resumed there.
  const kitchenSeat = kitchen.bots[0].chatBotId;
  await chats.archive(kitchen.id, asAnna);
  await chats.archive(kitchen.id, asAnna);
  assert.deepEqual(paused, [{ seats: [{ id: kitchenSeat, chatId: kitchen.id }], text: "Paused while archived" }], "its bot's work, once");
  await assert.rejects(chats.addBot(kitchen.id, chef, asBen), { statusCode: 409, code: "bots_chat_archived" });
  await chats.unarchive(kitchen.id, asBen);
  assert.equal(paused.length, 1, "unarchived, its work stays paused");
  // Anyone leaves; a public chat stays readable to who left it.
  assert.equal((await chats.leave(kitchen.id, asBen)).chat.place, null);
  assert.equal(removed.length, 0, "leaving a public chat removes nothing");

  // A private chat is a 404 to anyone outside it, joining included.
  const { chat: secret } = await chats.create({ kind: "private", title: "Surprise", people: [anna], bots: [chef] }, asBen);
  await assert.rejects(chats.get(secret.id, asCarla), { statusCode: 404 });
  await assert.rejects(chats.join(secret.id, asCarla), { statusCode: 404 });
  // A Private chat isn't archived for everyone, even by an owner: each of its people hides it for themselves (plan 5.1).
  // Deleted, its people hear and its computers and files go; leaving the last person deletes a private chat the same way.
  const secretSeat = secret.bots[0].chatBotId;
  await assert.rejects(chats.archive(secret.id, asAnna), {
    statusCode: 409, code: "bots_chat_private_archive", message: "A private chat is hidden for yourself, not archived for everyone."
  });
  assert.equal(paused.length, 1, "nothing of its work paused");
  assert.equal((await chats.changePlace(secret.id, { hidden: true }, asBen)).chat.place.hidden, true, "Ben hides it for himself");
  assert.equal((await chats.get(secret.id, asAnna)).chat.place.hidden, false, "and Anna still sees it");
  await assert.rejects(chats.remove(secret.id, asCarla), { statusCode: 404 });
  assert.deepEqual(await chats.remove(secret.id, asAnna), { deleted: true });
  assert.deepEqual(heard.pop(), { keys: both, type: "chat", chatId: secret.id, change: "deleted" });
  assert.deepEqual(removed.pop(), { homeId, chatId: secret.id, chatBotIds: [secretSeat] });
  const { chat: alone } = await chats.create({ kind: "private", title: "Notes", bots: [chef] }, asCarla);
  assert.deepEqual(await chats.leave(alone.id, asCarla), { deleted: true });
  assert.deepEqual(removed.pop(), { homeId, chatId: alone.id, chatBotIds: [alone.bots[0].chatBotId] });
  // A private chat was never in a bot's memory; a deleted public chat's bots forget it (D-113, O23).
  assert.deepEqual(forgot, [], "deleting a private chat forgets nothing");
  const [heardBefore, removedBefore] = [heard.length, removed.length];
  const { chat: garden } = await chats.create({ title: "Garden", bots: [chef] }, asBen);
  assert.deepEqual(await chats.remove(garden.id, asAnna), { deleted: true });
  assert.deepEqual(forgot, [[chef]], "its bots forget a deleted public chat");
  heard.length = heardBefore;
  removed.length = removedBefore;

  // The list: the chats Ben is in, each with its people, bots, latest message and his place; and a direct chat.
  await records.messages.append(kitchen.id, [{ role: "user", kind: "text", body: { text: "oak it is" } }], asAnna);
  const { chat: withChef } = await chats.direct(chef, asBen);
  assert.equal(withChef.directBotId, chef);
  assert.equal(withChef.onboardingStep, "intro-greet", "made at his first [Message], where the bot introduces itself");
  assert.equal((await chats.direct(chef, asBen)).chat.id, withChef.id, "and made once");
  const { chats: listed } = await chats.list({}, asAnna);
  const row = listed.find((chat) => chat.id === kitchen.id);
  assert.equal(row.latest.preview, "oak it is");
  assert.equal(row.latest.authorUserId, anna);
  assert.equal(row.place.unread, false);
  assert.equal((await chats.list({}, asBen)).chats.some((chat) => chat.id === withChef.id), true);
});

test("a change of the home's people: who joins is in the everyone chat, pinned first; who leaves is out, their own chats gone", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { records } = parts;
  const { homeId, anna, ben, carla, chef } = await home(knex, context);
  const { chats, heard, removed } = chatService(parts);
  const asAnna = memberOptions({ userId: anna, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  const asBen = memberOptions({ userId: ben, homeId });
  const family = await records.chats.makeEveryoneChat({ title: "Rossi", bots: [chef] }, asAnna);
  assert.deepEqual(await chats.homeChanged(homeId), { joined: [], departed: [] }, "nothing to do: everyone is seated");

  // Carla joins the home: she's in the everyone chat, and its people hear.
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: carla, role_sid: "member", status: "active" });
  assert.deepEqual(await chats.homeChanged(homeId), { joined: [carla], departed: [] });
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna, ben, carla].sort((a, b) => a - b));
  assert.deepEqual(heard.pop(), { keys: [anna, ben, carla].sort((a, b) => a - b), type: "chat", chatId: family.id, change: "members" });

  // The everyone chat is pinned for everyone, first in the list (O9): pinning doesn't move it, and no one leaves it.
  await records.messages.append((await chats.create({ title: "Newer" }, asAnna)).chat.id, [{ role: "user", kind: "text", body: { text: "hi" } }], asAnna);
  assert.equal((await chats.list({}, asAnna)).chats[0].id, family.id);
  assert.equal((await chats.changePlace(family.id, { pinned: true }, asAnna)).chat.place.pinPosition, null);
  await assert.rejects(chats.leave(family.id, asBen), { statusCode: 409, code: "bots_chat_everyone" });
  await assert.rejects(chats.removePerson(family.id, ben, asAnna), { statusCode: 409, code: "bots_chat_everyone" });

  // Ben is removed from the home: out of every chat; his own private chat goes, with its computers and files.
  const { chat: bensOwn } = await chats.create({ kind: "private", title: "Ben's", bots: [chef] }, asBen);
  await knex("workspace_memberships").where({ workspace_id: homeId, user_id: ben }).del();
  heard.length = 0;
  assert.deepEqual(await chats.homeChanged(homeId), { joined: [], departed: [ben] });
  assert.deepEqual(removed, [{ homeId, chatId: bensOwn.id, chatBotIds: [bensOwn.bots[0].chatBotId] }]);
  assert.equal(await knex("conversations").where({ id: bensOwn.id }).first("id"), undefined);
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna, carla].sort((a, b) => a - b));
  assert.deepEqual(heard, [
    { keys: [ben], type: "chat", chatId: bensOwn.id, change: "deleted" },
    { keys: [anna, ben, carla].sort((a, b) => a - b), type: "chat", chatId: family.id, change: "members" }
  ]);
  assert.deepEqual(await chats.homeChanged(homeId), { joined: [], departed: [] }, "and once is enough");
});

test("leaving the home pauses the routines and watches the person made there, with a line; a failure leaves it all to the next change", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { records, systemContext } = parts;
  const { homeId, anna, ben, chef } = await home(knex, context);
  const elsewhere = await home(knex, context);
  const asAnna = memberOptions({ userId: anna, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  const family = await records.chats.makeEveryoneChat({ title: "Rossi", bots: [chef] }, asAnna);
  const seat = await records.chats.chatBotOf(chef, family.id, asAnna);
  const there = await records.chats.makeEveryoneChat({ title: "Elsewhere", bots: [elsewhere.chef] }, memberOptions({ userId: anna, homeId: elsewhere.homeId, role: "owner" }));
  const otherSeat = await records.chats.chatBotOf(elsewhere.chef, there.id, memberOptions({ userId: anna, homeId: elsewhere.homeId }));
  const routine = (workspaceId, chatBotId) => ({ workspace_id: workspaceId, chat_bot_id: chatBotId, made_by: ben, name: "Ben's routine", schedule: "every day", instructions: "x", enabled: true });
  await knex("bot_routines").insert([routine(homeId, seat.id), routine(elsewhere.homeId, otherSeat.id)]);
  const asked = [];
  let fails = 1;
  const bots = startBotsService(context, {
    records,
    systemContext,
    profiles: { findById: async (userId) => (String(userId) === ben ? { displayName: "Ben" } : null) },
    apps: {
      watches: {
        pauseIn: async (where) => {
          asked.push(where);
          if (fails-- > 0) throw new Error("the watches are down");
          return [{ chatBotId: String(seat.id), name: "Prices" }];
        }
      }
    }
  });
  const enabled = async (chatBotId) => (await knex("bot_routines").where({ chat_bot_id: chatBotId }).first("enabled")).enabled;
  const lines = async () => (await knex("messages").where({ conversation_id: family.id, kind: "event" }).orderBy("id")).map((row) => row.body);

  await knex("workspace_memberships").where({ workspace_id: homeId, user_id: ben }).del();
  await assert.rejects(bots.homeChanged(homeId), /the watches are down/);
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna, ben].sort((a, b) => a - b), "still seated, to leave next time");
  assert.equal(await enabled(seat.id), true, "nothing paused without its line");
  assert.deepEqual(await lines(), []);

  assert.deepEqual(await bots.homeChanged(homeId), { joined: [], departed: [ben] });
  assert.deepEqual(asked, [{ createdBy: ben, homeId }, { createdBy: ben, homeId }]);
  assert.equal(await enabled(seat.id), false);
  assert.equal(await enabled(otherSeat.id), true, "what he made in another home runs on");
  assert.deepEqual(await peopleIn(records, family.id, asAnna), [anna]);
  assert.deepEqual(await lines(), [{
    text: "Paused: its maker left",
    icon: "routine",
    detail: 'Ben left the home, so the routine "Ben\'s routine", watch "Prices" they made paused.'
  }]);
});

test("the chat list is read a page at a time in its queries: every chat once, each page read alike", async (context) => {
  const parts = await startChatRecords(knex, context);
  const { records } = parts;
  const { homeId, anna, ben } = await home(knex, context);
  const { chats } = chatService(parts);
  const asAnna = memberOptions({ userId: anna, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  const family = await records.chats.makeEveryoneChat({ title: "Rossi", bots: [] }, asAnna);
  /** `count` more chats Anna and Ben are in, written straight to the tables; one in ten hidden by Anna, one archived. */
  const more = async (count) => {
    const ids = (await knex("conversations")
      .insert(Array.from({ length: count }, (_, index) => ({
        workspace_id: homeId,
        kind: "public",
        title: `Chat ${index}`,
        made_by: anna,
        ...(index === 3 ? { archived_at: new Date() } : {})
      })))
      .returning("id")).map((row) => String(row.id));
    await knex("chat_people").insert(ids.flatMap((id, index) => [
      { workspace_id: homeId, conversation_id: id, user_id: anna, hidden: index % 10 === 0 },
      { workspace_id: homeId, conversation_id: id, user_id: ben }
    ]));
  };
  /** Every page of Anna's list as the page reads it (hidden and archived ones too), and the statements of each. */
  const everyPage = async () => {
    const ids = [];
    const statements = [];
    let after = null;
    do {
      let page;
      statements.push(await queriesDuring(knex, async () => { page = await chats.list({ hidden: true, archived: true, after }, asAnna); }));
      ids.push(...page.chats.map((chat) => chat.id));
      after = page.next;
    } while (after);
    return { ids, statements };
  };

  await more(20);
  const few = await everyPage();
  assert.equal(few.ids.length, 21);
  assert.equal(few.ids[0], family.id);
  assert.equal(few.statements.length, 1, "one page");
  const shown = (await chats.list({}, asAnna)).chats;
  assert.equal(shown.length, 21 - 2 - 1, "without hidden (2) and archived (1) ones, in the query too");

  // Past the 500 the list used to stop at: six pages of 100, each read like the one page above.
  await more(520);
  const many = await everyPage();
  assert.equal(many.ids.length, 541, "no chat left out");
  assert.equal(new Set(many.ids).size, 541, "none twice");
  assert.equal(many.ids.at(-41), family.id, "the everyone chat, the oldest, first in its page (O9)");
  assert.deepEqual(many.statements, Array(6).fill(few.statements[0]), "each page read alike");
});
