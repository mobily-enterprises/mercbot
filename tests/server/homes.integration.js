import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { buildMailTools } from "../../packages/bots/src/server/mailTools.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { separateHome, testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts, startBotRecords } from "../support/botRecords.mjs";
import { startIntegrations } from "../support/ownedHandles.mjs";
import { seedChat } from "../support/chatFixtures.mjs";


/** A member's call options in the home, as their request's would be; owners and admins manage it. */
function inHome(userId, homeId, { manages = false } = {}) {
  return requestContextOptions({
    user: { id: userId },
    workspace: { id: homeId },
    membership: { roleSid: manages ? "owner" : "member" },
    permissions: manages ? ["workspace.settings.update"] : []
  });
}

// Homes (D-36, D-112): everyone in a home sees its bots, each person has their own direct chat with one, and a chat of
// several people is theirs together, with one computer for each bot in it.
async function setup(context) {
  const knex = await connectTestDatabase();
  const pat = (await knex("users").first()).id;
  const stamp = Date.now();
  const [kim] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
  }).returning("id");
  const homeId = await testHome(knex, pat);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: kim.id, role_sid: "member", status: "active" });
  const [outside] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `sam-${stamp}`, email: `sam-${stamp}@example.com`, username: `sam${stamp}`, display_name: "Sam"
  }).returning("id");
  // Sam's own home: the routes let a person call only in a home they belong to (JSKIT checks it).
  const [elsewhere] = await knex("workspaces").insert({ slug: `sam-${stamp}`, name: "Sam's home", owner_user_id: outside.id, is_personal: true }).returning("id");
  await knex("workspace_memberships").insert({ workspace_id: elsewhere.id, user_id: outside.id, role_sid: "owner", status: "active" });
  const bot = await testBot(knex, pat, { name: `Shared ${stamp}` });
  // The chats a test makes, deleted with the rest.
  const made = [];
  // A home of the test's own for its accounts, which no other test file connects any in.
  const accountsHome = await separateHome(knex, pat, [kim.id]);
  context.after(async () => {
    await knex("workspaces").where({ id: accountsHome }).del();
    await knex("conversations").where({ workspace_id: homeId }).whereIn("id", made).del();
    await knex("conversations").where({ direct_bot_id: bot.id }).del();
    await knex("bots").where({ id: bot.id }).del();
    await knex("workspace_memberships").where({ workspace_id: elsewhere.id }).del();
    await knex("workspaces").where({ id: elsewhere.id }).del();
    await knex("users").whereIn("id", [kim.id, outside.id]).del();
    await knex.destroy();
  });
  const records = await startBotRecords(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, records, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "Noted.", transcript: [] }) }));
  /** A member's request in the home (or in another home of theirs), as the bots routes make its options. */
  const as = (userId, home = homeId) => memberOptions({ userId, homeId: home });
  /** A chat in the home, with `people` and the bot (seedChat's fields), deleted afterwards: its id. */
  const chatOf = async (fields) => {
    const { id } = await seedChat(knex, { homeId, ...fields });
    made.push(id);
    return String(id);
  };
  return { knex, records, bots, as, homeId, accountsHome, elsewhere: elsewhere.id, pat, kim: kim.id, outside: outside.id, bot, chatOf, made };
}

// A direct chat is the chat a bot's [Message] reopens, one per person and bot, and Private: only its person opens it
// and finds its words.
test("two people in a home share its bots, and each has their own direct chat with one, Private, theirs alone", async (context) => {
  const { knex, bots, as, pat, kim, bot, chatOf } = await setup(context);
  const tag = `words-${Date.now()}`;
  // testBot's chat is Pat's direct chat with the bot.
  const patsChat = String(bot.conversation_id);
  await bots.chat.sendMessage(patsChat, { text: `Pat's ${tag}` }, as(pat));

  assert.ok((await bots.listBots(as(kim))).bots.some((entry) => entry.id === String(bot.id)), "Kim sees the home's bot");
  const { chat: kims } = await bots.chats.direct(bot.id, as(kim));
  assert.notEqual(kims.id, patsChat, "Kim's direct chat with it is her own");
  assert.equal(kims.onboardingStep, "intro-greet", "and the bot will introduce itself to Kim there");
  assert.equal((await bots.chats.direct(bot.id, as(kim))).chat.id, kims.id, "made once, then opened");
  assert.deepEqual((await bots.chat.messages(kims.id, {}, as(kim))).messages.filter((message) => message.kind === "text"), [], "nothing from Pat's");
  const directs = (await knex("conversations").where({ direct_bot_id: bot.id }).pluck("direct_user_id")).map(String).sort();
  assert.deepEqual(directs, [pat, kim].map(String).sort(), "one direct chat each");

  // Pat's is Private: Kim can't open it nor find its words, and it isn't in her list nor among the rooms she isn't in.
  await assert.rejects(bots.chats.get(patsChat, as(kim)), { statusCode: 404 }, "Kim can't open Pat's direct chat");
  await assert.rejects(bots.chat.messages(patsChat, {}, as(kim)), { statusCode: 404 });
  assert.equal((await bots.search(tag, as(kim))).messages.length, 0, "search never finds it for her");
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1, "Pat finds his own words");
  assert.ok(!(await bots.chats.list({}, as(kim))).chats.some((entry) => entry.id === patsChat));
  assert.ok(!(await bots.chats.publicRooms({}, as(kim))).chats.some((entry) => entry.id === patsChat), "a direct chat is never a room to visit");

  // In a chat of both, each one's place is their own: Kim's pin isn't Pat's.
  const both = await chatOf({ title: "Both", people: [pat, kim], bots: [bot.id] });
  await bots.chats.changePlace(both, { pinned: true }, as(kim));
  assert.notEqual((await bots.chats.get(both, as(kim))).chat.place.pinPosition, null);
  assert.equal((await bots.chats.get(both, as(pat))).chat.place.pinPosition, null, "pins are each person's own");
});

test("someone outside the home can't reach its chats, and a private chat is its people's own", async (context) => {
  const { bots, as, elsewhere, pat, kim, outside, bot, made } = await setup(context);
  await assert.rejects(bots.chat.messages(bot.conversation_id, {}, as(outside, elsewhere)), (error) => error.statusCode === 404);
  const { chat: weekend } = await bots.chats.create({ kind: "private", title: "Plan the weekend", bots: [String(bot.id)] }, as(pat));
  made.push(weekend.id);
  assert.ok((await bots.chats.list({}, as(pat))).chats.some((entry) => entry.id === weekend.id));
  assert.ok(!(await bots.chats.list({}, as(kim))).chats.some((entry) => entry.id === weekend.id), "Kim isn't in Pat's private chat");
  assert.ok(!(await bots.chats.publicRooms({}, as(kim))).chats.some((entry) => entry.id === weekend.id), "nor is it among the rooms she isn't in");
  await assert.rejects(bots.chat.messages(weekend.id, {}, as(kim)), (error) => error.statusCode === 404);
});

// Every account is its home's (D-111): anyone in the home adds one, everyone's bots use every one in any chat, and
// it's changed or removed by the person who added it or the home's owners and admins.
test("every account of a home is everyone's in it, in any chat, and changed by who added it or an owner or admin", async (context) => {
  const { knex, accountsHome: homeId, pat, kim, outside } = await setup(context);
  const catalogue = [{ id: "gmail", name: "Gmail" }];
  const { integrations } = await startIntegrations(knex, context, { catalogue });
  const owner = inHome(pat, homeId, { manages: true });
  const member = inHome(kim, homeId);

  const { accountId } = await integrations.addAccount("gmail", "family", owner);
  const { accountId: kims } = await integrations.addAccount("gmail", "", member);

  for (const [who, options] of [["Kim", member], ["Pat", owner]]) {
    const listed = (await integrations.list(options)).plugins[0].accounts;
    assert.deepEqual(listed.map((account) => account.id).sort(), [accountId, kims].sort(), `${who} sees every account of the home`);
    assert.ok(listed.every((account) => !("home" in account)), "no account is anyone's own");
    // A bot's turn reaches the same, in a room as in the person's own chat: the call is the same either way.
    assert.deepEqual((await integrations.reachableAccounts(options)).map((account) => account.id).sort(), [accountId, kims].sort(), `${who}'s bots use every one`);
  }
  const elsewhere = (await integrations.reachableAccounts(inHome(outside, -1))).map((account) => account.id);
  assert.ok(!elsewhere.map(String).includes(accountId), "another home never reaches it");

  // Kim, a member, didn't add Pat's: she can't rename or remove it. Pat, the owner, can change Kim's.
  const refused = /Only the person who added this account and the home's owners and admins can change it/u;
  await assert.rejects(integrations.renameAccount(accountId, "ours", member), refused);
  await assert.rejects(integrations.removeAccount(accountId, member), refused);
  await assert.rejects(integrations.choosePace(accountId, "gentle", member), refused);
  await integrations.renameAccount(kims, "Kim's", owner);
  await integrations.renameAccount(kims, "Kim's mail", member);
  await integrations.removeAccount(accountId, owner);

  // One's own account is one's own to remove, connected or not, the only one too (D-110, accountWorkflow.integration.js).
  await knex("plugin_accounts").where({ id: kims }).update({ status: "connected" });
  await integrations.removeAccount(kims, member);
  assert.deepEqual((await integrations.list(member)).plugins[0].accounts, []);
});

// The bot's computer (D-112): one for each bot in each chat, so what a bot signs in to in one person's direct chat
// never reaches another's; a chat of several people has one everyone in it uses.
test("each chat has its own computer with a bot: two direct chats, two computers, and a chat of both one", async (context) => {
  const { knex, as, pat, kim, bot, chatOf } = await setup(context);
  const asked = [];
  const computer = { status: async (computerId) => { asked.push(computerId); return { state: "asleep" }; } };
  const bots = createBotsService(serviceDoubles({ knex, ...await startBotParts(knex, context), computer, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "OK.", transcript: [] }) }));
  const say = async (chatId, person, text) => {
    const sent = await bots.chat.sendMessage(chatId, { text }, as(person));
    await bots.chat.reply(chatId, { afterMessageId: sent.messages.at(-1).id }, undefined, as(person));
  };
  const seatIn = async (chatId) => String((await knex("chat_bots").where({ conversation_id: chatId, bot_id: bot.id }).first("id")).id);
  const kims = await chatOf({ direct: { userId: kim, botId: bot.id } });
  await say(bot.conversation_id, pat, "Hello");
  await say(kims, kim, "Hello");
  assert.deepEqual([...new Set(asked)].sort(), [await seatIn(bot.conversation_id), await seatIn(kims)].sort(), "two direct chats, two computers");

  const both = await chatOf({ title: "Both", people: [pat, kim], bots: [bot.id] });
  asked.length = 0;
  // With two people in it, the bot answers whoever mentions it (R3).
  for (const person of [pat, kim]) await say(both, person, `<@bot:${bot.id}> Hello again`);
  assert.deepEqual([...new Set(asked)], [await seatIn(both)], "a chat's computer is everyone's in it");
});

// Connect apps' Tools: an action switched off for an app in the home; the home's bots skip that
// app for it, and leave the action out when no connected app still offers it.
test("an action switched off for an app is skipped for it, and dropped when no app offers it", async (context) => {
  const { knex, accountsHome: homeId, pat, kim } = await setup(context);
  const catalogue = [
    { id: "gmail", name: "Gmail", actions: [{ id: "send_draft", name: "Send email" }, { id: "search_email", name: "Search mail" }, { id: "mail_drafts.send", name: "Send saved drafts" }] },
    { id: "outlook", name: "Outlook", actions: [{ id: "send_draft", name: "Send email" }, { id: "mail_drafts.send", name: "Send saved drafts" }] }
  ];
  const { integrations } = await startIntegrations(knex, context, { catalogue });
  // The home's owners and admins switch them, for everyone's bots in it.
  const as = inHome(pat, homeId, { manages: true });
  await assert.rejects(integrations.switchAction("gmail", "send_draft", false, inHome(kim, homeId)), /Only the home's owners and admins/u, "not a member");
  await knex("plugin_accounts").insert([
    { user_id: pat, workspace_id: homeId, plugin_id: "gmail", name: "", status: "connected" },
    { user_id: pat, workspace_id: homeId, plugin_id: "outlook", name: "", status: "connected" }
  ]);

  const listed = (await integrations.switchAction("gmail", "send_draft", false, as)).plugins.find((entry) => entry.id === "gmail");
  assert.deepEqual(listed.actions.map((action) => action.enabled), [false, true, true], "the switch shows, and the count drops");
  let switches = await integrations.toolSwitches(as);
  assert.deepEqual(switches.skip.send_draft, ["gmail"]);
  assert.deepEqual(switches.removed, [], "Outlook still sends");

  await integrations.switchAction("outlook", "send_draft", false, as);
  switches = await integrations.toolSwitches(as);
  assert.deepEqual(switches.removed, ["send_draft"], "no connected app sends any more, so the bot isn't offered it");
  assert.deepEqual(switches.turnedOff, ["Send email (Gmail)", "Send email (Outlook)"], "the bot is told what was switched off");
  await integrations.switchAction("gmail", "send_draft", true, as);
  assert.deepEqual((await integrations.toolSwitches(as)).removed, []);
  await assert.rejects(integrations.switchAction("gmail", "nope", false, as), /no such action/u);

  // One action of a grouped tool (D-42): off in every app, the tool no longer offers it.
  await integrations.switchAction("gmail", "mail_drafts.send", false, as);
  await integrations.switchAction("outlook", "mail_drafts.send", false, as);
  const shared = { appFor: () => ({}), attempt: async () => ({}), failed: (error) => ({ error: error.message }), account: () => undefined };
  const mailTools = buildMailTools({ ...shared, removed: (await integrations.toolSwitches(as)).removed });
  assert.deepEqual(mailTools.mailDrafts.inputSchema.shape.action.options, ["list", "read", "create", "update", "delete"]);
  await knex("plugin_actions_off").where({ workspace_id: homeId }).del();
});
