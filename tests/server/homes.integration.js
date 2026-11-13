import assert from "node:assert/strict";
import test from "node:test";
import { planOf, statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { buildMailTools } from "../../packages/bots/src/server/mailTools.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";
import { startIntegrations } from "../support/ownedHandles.mjs";

// The person's own accounts and the home's, as Connect apps reaches them.
const REACH = Object.freeze({ personal: true });

/** A member's call options in the home, as their request's would be; owners and admins manage it. */
function inHome(userId, homeId, { manages = false } = {}) {
  return requestContextOptions({
    user: { id: userId },
    workspace: { id: homeId },
    membership: { roleSid: manages ? "owner" : "member" },
    permissions: manages ? ["workspace.settings.update"] : []
  });
}

// Homes (D-36): everyone in a home sees its bots, and each person talks to them privately.
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
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex("bots").where({ user_id: kim.id }).del();
    await knex("workspace_memberships").where({ workspace_id: elsewhere.id }).del();
    await knex("workspaces").where({ id: elsewhere.id }).del();
    await knex("users").whereIn("id", [kim.id, outside.id]).del();
    await knex.destroy();
  });
  const records = await startBotRecords(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, records, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "Noted.", transcript: [] }) }));
  /** A member's request in the home (or in another home of theirs), as the bots routes make its options. */
  const as = (userId, home = homeId) => memberOptions({ userId, homeId: home });
  return { knex, records, bots, as, homeId, elsewhere: elsewhere.id, pat, kim: kim.id, outside: outside.id, bot };
}

test("two people in a home share its bots but each has a private conversation", async (context) => {
  const { knex, bots, as, pat, kim, bot } = await setup(context);
  const tag = `secret-${Date.now()}`;
  await bots.sendMessage(bot.id, { text: `Pat's ${tag}` }, as(pat));

  const kimsList = await bots.listBots(as(kim));
  const seen = kimsList.bots.find((entry) => entry.id === String(bot.id));
  assert.ok(seen, "Kim sees the home's bot");
  assert.equal(seen.preview, "", "but nothing from Pat's conversation");
  assert.equal(seen.onboardingStep, "intro-greet", "and the bot will introduce itself to Kim");

  assert.deepEqual((await bots.messages(bot.id, null, {}, as(kim))).messages.filter((message) => message.kind === "text"), []);
  await bots.sendMessage(bot.id, { text: "Kim's own note" }, as(kim));
  const patsTexts = (await bots.messages(bot.id, null, {}, as(pat))).messages.filter((message) => message.kind === "text").map((message) => message.body.text);
  assert.deepEqual(patsTexts, [`Pat's ${tag}`]);

  assert.equal((await bots.search(tag, as(kim))).messages.length, 0, "search only finds your own conversations");
  assert.equal((await bots.search(tag, as(pat))).messages.length, 1);

  const patsMessage = (await bots.messages(bot.id, null, {}, as(pat))).messages.find((message) => message.kind === "text");
  await assert.rejects(bots.react(bot.id, patsMessage.id, "👍", as(kim)), /not found/iu, "Kim can't reach Pat's messages by id");

  await bots.updateBot(bot.id, { pinned: true, unread: false }, as(kim));
  assert.equal((await bots.listBots(as(pat))).bots.find((entry) => entry.id === String(bot.id)).pinPosition, null, "pins are each person's own");
  const conversations = await knex("bot_conversations").where({ bot_id: bot.id }).orderBy("user_id");
  assert.equal(conversations.length, 2);
});

test("someone outside the home can't reach its bots, and a group chat is its maker's own", async (context) => {
  const { bots, as, elsewhere, pat, kim, outside, bot } = await setup(context);
  await assert.rejects(bots.messages(bot.id, null, {}, as(outside, elsewhere)), /not found/iu);
  const { bot: group } = await bots.createGroup({ botIds: [String(bot.id)], text: "Plan the weekend" }, "Pat", as(pat));
  assert.ok((await bots.listBots(as(pat))).bots.some((entry) => entry.id === group.id));
  assert.ok(!(await bots.listBots(as(kim))).bots.some((entry) => entry.id === group.id), "Kim doesn't see Pat's group");
  await assert.rejects(bots.messages(group.id, null, {}, as(kim)), /not found/iu);
});

// Shared bots (D-36): everyone in the home talks in the same named conversations, and a new one
// knows what was said in the one it came from up to that moment, but nothing said there afterwards.
test("a shared bot's conversations are everyone's, and a new one starts from what the open one knew", async (context) => {
  const { knex, records, bots, as, pat, kim, bot } = await setup(context);
  const histories = [];
  const shared = createBotsService(serviceDoubles({
    knex, records, approvals: { decide: async () => "allow" },
    reply: async (_bot, history) => {
      histories.push(history.filter((message) => message.kind === "text").map((message) => message.body.text));
      return { text: "Noted.", transcript: [] };
    }
  }));
  await bots.sendMessage(bot.id, { text: "Pat's private word" }, as(pat));
  assert.equal((await bots.updateBot(bot.id, { sharing: "shared" }, as(pat))).sharing, "shared");

  const general = (await bots.listBots(as(kim))).bots.find((entry) => entry.id === String(bot.id));
  assert.deepEqual(general.rooms.map((room) => room.title), ["General"], "a shared bot starts with General");
  assert.equal(general.onboardingStep, null, "and no introduction");
  assert.deepEqual((await bots.messages(bot.id, null, {}, as(kim))).messages, [],"private conversations never show in a room");

  await shared.sendMessage(bot.id, { text: "Budget is 500" }, as(pat));
  await shared.replyTo(bot.id, {}, undefined, as(pat));
  const kimSees = (await bots.listBots(as(kim))).bots.find((entry) => entry.id === String(bot.id));
  assert.equal(kimSees.unread, true, "Kim has news in General");
  const generalTexts = (await bots.messages(bot.id, null, {}, as(kim))).messages.filter((message) => message.kind === "text");
  assert.ok(generalTexts[0].body.from.name, "messages say who wrote them");
  assert.ok(histories[0].includes(`${generalTexts[0].body.from.name}: Budget is 500`), "the bot reads who said it");

  await assert.rejects(bots.createRoom(bot.id, { title: "  " }, as(kim)), /name/u, "every tab has a name");
  const { room: fork } = await bots.createRoom(bot.id, { title: "Plan B" }, as(kim));
  await shared.sendMessage(bot.id, { text: "Actually the budget is 900", room: general.roomId }, as(pat));
  await shared.sendMessage(bot.id, { text: "What's the budget?", room: fork.id }, as(kim));
  await shared.replyTo(bot.id, { room: fork.id }, undefined, as(kim));
  const forkHistory = histories.at(-1);
  assert.ok(forkHistory.some((text) => text.endsWith("Budget is 500")), "the new conversation knows what came before it");
  assert.ok(!forkHistory.some((text) => text.includes("900")), "but not what was said there afterwards");
  assert.ok(!forkHistory.some((text) => text.includes("private")), "nor anyone's private conversation");

  const tabs = (await bots.listBots(as(pat))).bots.find((entry) => entry.id === String(bot.id)).rooms;
  assert.deepEqual(tabs.map((room) => room.title).sort(), ["General", "Plan B"], "everyone sees every tab");
  await bots.renameRoom(bot.id, fork.id, { title: "Plan C" }, as(pat));
  assert.equal((await bots.listBots(as(kim))).bots.find((entry) => entry.id === String(bot.id)).rooms.find((room) => room.id === fork.id).title, "Plan C");

  await bots.updateBot(bot.id, { roomId: fork.id, unread: false }, as(kim));
  assert.equal((await bots.listBots(as(kim))).bots.find((entry) => entry.id === String(bot.id)).roomId, fork.id, "the open tab is remembered");
  assert.equal((await bots.search("Budget is 500", as(kim))).messages.length, 1, "search finds the home's rooms");
});

// Home-wide accounts (D-37): owners and admins add them for everyone in the home; everyone's bots
// may use them, and in a shared conversation they're the only accounts used.
test("a home's account is everyone's in that home, and the only kind a shared conversation uses", async (context) => {
  const { knex, homeId, pat, kim, outside } = await setup(context);
  const catalogue = [{ id: "gmail", name: "Gmail" }];
  const { integrations } = await startIntegrations(knex, context, { catalogue });
  const owner = inHome(pat, homeId, { manages: true });
  const member = inHome(kim, homeId);

  await assert.rejects(integrations.addAccount(REACH, "gmail", "family", { forHome: true }, member), /owners and admins/u, "members can't add one");
  const { accountId } = await integrations.addAccount(REACH, "gmail", "family", { forHome: true }, owner);
  await integrations.install(REACH, "gmail", member);

  const kimsAccounts = (await integrations.list(REACH, member)).plugins[0].accounts;
  assert.deepEqual(kimsAccounts.map((account) => [account.name, account.home]).sort(), [["", false], ["family", true]], "Kim sees her own and the home's");
  assert.deepEqual((await integrations.list(REACH, owner)).plugins[0].accounts.map((account) => account.name), ["family"], "but not Kim's own");
  await assert.rejects(integrations.renameAccount(REACH, accountId, "ours", member), /owners and admins/u, "members can't change it");

  const inRoom = (await integrations.reachableAccounts({ personal: false }, member)).map((account) => account.name);
  assert.deepEqual(inRoom, ["family"], "a shared conversation reaches only the home's account");
  const elsewhere = (await integrations.reachableAccounts(REACH, inHome(outside, -1))).map((account) => account.id);
  assert.ok(!elsewhere.map(String).includes(accountId), "another home never reaches it");

  await integrations.removeAccount(REACH, accountId, owner);

  // A half-added account of one's own can be removed while the app keeps another; a connected one
  // or the last one can't.
  const [extra] = await knex("plugin_accounts").insert({ user_id: kim, plugin_id: "gmail", name: "test" }).returning("id");
  const own = await knex("plugin_accounts").where({ user_id: kim, plugin_id: "gmail", name: "" }).first();
  await knex("plugin_accounts").where({ id: own.id }).update({ status: "connected" });
  await assert.rejects(integrations.removeAccount(REACH, own.id, member), /Disconnect the account first/u);
  await integrations.removeAccount(REACH, extra.id, member);
  await knex("plugin_accounts").where({ id: own.id }).update({ status: "needs-auth" });
  await assert.rejects(integrations.removeAccount(REACH, own.id, member), /only account/u);
  assert.deepEqual((await integrations.list(REACH, member)).plugins[0].accounts.map((account) => account.home), [false]);
  await integrations.uninstall(REACH, "gmail", member);
});

// The home notebook (D-36): a mixed bot notes reusable know-how from one person's private chat,
// says so in a line they can undo, and every chat with that bot in the home reads it.
test("a mixed bot's notebook carries know-how between people, never their chats", async (context) => {
  const { knex, records, as, pat, kim, bot } = await setup(context);
  const states = [];
  let toNote = "";
  const bots = createBotsService(serviceDoubles({
    knex, records, approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools, state) => {
      states.push(state);
      if (toNote) {
        const result = await tools.noteForHome?.execute({ text: toNote });
        return { text: result?.error ? `Not noted: ${result.error}` : "Noted.", transcript: [] };
      }
      return { text: "OK.", transcript: [] };
    }
  }));
  assert.equal((await bots.listBots(as(pat))).bots.find((entry) => entry.id === String(bot.id)).sharing, "mixed", "mixed is the default");

  toNote = "Call the plumber on +39 333 123 4567";
  await bots.sendMessage(bot.id, { text: "The plumber's number" }, as(pat));
  await bots.replyTo(bot.id, {}, undefined, as(pat));
  assert.equal((await knex("bot_notebook").where({ bot_id: bot.id })).length, 0, "phone numbers never go in");

  toNote = "The recycling goes out on Tuesday evenings";
  await bots.sendMessage(bot.id, { text: "Remember, recycling is Tuesday evening, and I'm worried about my test results" }, as(pat));
  const replied = await bots.replyTo(bot.id, {}, undefined, as(pat));
  const line = replied.messages.find((message) => message.kind === "note");
  assert.equal(line.body.text, "The recycling goes out on Tuesday evenings", "the person sees what was noted");

  toNote = "";
  await bots.sendMessage(bot.id, { text: "When does recycling go out?" }, as(kim));
  await bots.replyTo(bot.id, {}, undefined, as(kim));
  assert.match(states.at(-1), /Notes from the home notebook.*recycling goes out on Tuesday evenings/u, "Kim's chat reads the note");
  assert.doesNotMatch(states.at(-1), /test results/u, "but never Pat's chat");

  const kimsView = await bots.notebook(bot.id, {}, as(kim));
  assert.equal(kimsView.notes[0].canRemove, false);
  await assert.rejects(bots.removeNote(bot.id, line.body.noteId, {}, as(kim)), /owners and admins/u, "only its author or an owner or admin removes it");
  let undone = null;
  const [unmarking] = await statementsDuring(knex, async () => { undone = await bots.removeNote(bot.id, line.body.noteId, {}, as(pat)); }, /update "bot_messages"/u);
  // The note's line is found through its own index, not by reading every home's messages.
  assert.ok((await planOf(knex, unmarking)).indexes.has("ix_bot_messages_note"), "removing a note reads its line by index");
  assert.equal(undone.message.body.removed, true, "the line in Pat's chat shows it was undone");
  assert.deepEqual((await bots.notebook(bot.id, {}, as(kim))).notes, []);

  // An owner or admin tidies anyone's note.
  toNote = "The spare key is with the neighbours";
  await bots.sendMessage(bot.id, { text: "Where's the spare key?" }, as(pat));
  const second = (await bots.replyTo(bot.id, {}, undefined, as(pat))).messages.find((message) => message.kind === "note");
  await bots.removeNote(bot.id, second.body.noteId, { manages: true }, as(kim));
  assert.deepEqual((await bots.notebook(bot.id, {}, as(pat))).notes, []);

  await bots.updateBot(bot.id, { keepOutOfNotebook: true }, as(kim));
  toNote = "Kim's note";
  await bots.sendMessage(bot.id, { text: "Something" }, as(kim));
  await bots.replyTo(bot.id, {}, undefined, as(kim));
  assert.match(states.at(-1), /keeps this chat out of the home notebook/u);
  assert.equal((await knex("bot_notebook").where({ bot_id: bot.id }).whereNull("removed_at")).length, 0, "a chat kept out adds nothing");
});

// The bot's computer (D-36): each person's own with a private or mixed bot, so one person's
// sign-ins never reach another; a shared bot's conversation has one everyone uses.
test("each person gets their own computer with a bot, and a shared conversation has one", async (context) => {
  const { knex, records, as, pat, kim, bot } = await setup(context);
  const asked = [];
  const computer = { status: async (computerId) => { asked.push(computerId); return { state: "asleep" }; } };
  const bots = createBotsService(serviceDoubles({ knex, records, computer, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "OK.", transcript: [] }) }));
  for (const person of [pat, kim]) {
    await bots.sendMessage(bot.id, { text: "Hello" }, as(person));
    await bots.replyTo(bot.id, {}, undefined, as(person));
  }
  const own = await knex("bot_conversations").where({ bot_id: bot.id }).whereIn("user_id", [pat, kim]).pluck("id");
  assert.deepEqual([...new Set(asked)].sort(), own.map(String).sort(), "two people, two computers");

  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  asked.length = 0;
  for (const person of [pat, kim]) {
    await bots.sendMessage(bot.id, { text: "Hello again" }, as(person));
    await bots.replyTo(bot.id, {}, undefined, as(person));
  }
  const room = await knex("bot_conversations").where({ bot_id: bot.id }).whereNull("user_id").first();
  assert.deepEqual([...new Set(asked)], [String(room.id)], "a shared conversation's computer is everyone's");
});

// Connect apps' Tools: a person switches an action off for an app; their bots skip that
// app for it, and leave the action out when no connected app still offers it.
test("an action switched off for an app is skipped for it, and dropped when no app offers it", async (context) => {
  const { knex, homeId, pat } = await setup(context);
  const catalogue = [
    { id: "gmail", name: "Gmail", actions: [{ id: "send_draft", name: "Send email" }, { id: "search_email", name: "Search mail" }, { id: "mail_drafts.send", name: "Send saved drafts" }] },
    { id: "outlook", name: "Outlook", actions: [{ id: "send_draft", name: "Send email" }, { id: "mail_drafts.send", name: "Send saved drafts" }] }
  ];
  const { integrations } = await startIntegrations(knex, context, { catalogue });
  const reach = REACH;
  const as = inHome(pat, homeId);
  await knex("plugin_accounts").insert([
    { user_id: pat, plugin_id: "gmail", name: "", status: "connected" },
    { user_id: pat, plugin_id: "outlook", name: "", status: "connected" }
  ]);

  const listed = (await integrations.switchAction(reach, "gmail", "send_draft", false, as)).plugins.find((entry) => entry.id === "gmail");
  assert.deepEqual(listed.actions.map((action) => action.enabled), [false, true, true], "the switch shows, and the count drops");
  let switches = await integrations.toolSwitches(reach, as);
  assert.deepEqual(switches.skip.send_draft, ["gmail"]);
  assert.deepEqual(switches.removed, [], "Outlook still sends");

  await integrations.switchAction(reach, "outlook", "send_draft", false, as);
  switches = await integrations.toolSwitches(reach, as);
  assert.deepEqual(switches.removed, ["send_draft"], "no connected app sends any more, so the bot isn't offered it");
  assert.deepEqual(switches.turnedOff, ["Send email (Gmail)", "Send email (Outlook)"], "the bot is told what was switched off");
  await integrations.switchAction(reach, "gmail", "send_draft", true, as);
  assert.deepEqual((await integrations.toolSwitches(reach, as)).removed, []);
  await assert.rejects(integrations.switchAction(reach, "gmail", "nope", false, as), /no such action/u);

  // One action of a grouped tool (D-42): off in every app, the tool no longer offers it.
  await integrations.switchAction(reach, "gmail", "mail_drafts.send", false, as);
  await integrations.switchAction(reach, "outlook", "mail_drafts.send", false, as);
  const shared = { appFor: () => ({}), attempt: async () => ({}), failed: (error) => ({ error: error.message }), account: () => undefined };
  const mailTools = buildMailTools({ ...shared, removed: (await integrations.toolSwitches(reach, as)).removed });
  assert.deepEqual(mailTools.mailDrafts.inputSchema.shape.action.options, ["list", "read", "create", "update", "delete"]);
  await knex("plugin_actions_off").where({ user_id: pat }).del();
  await knex("plugin_accounts").where({ user_id: pat }).whereIn("plugin_id", ["gmail", "outlook"]).whereNull("workspace_id").whereNull("tokens").del();
});
