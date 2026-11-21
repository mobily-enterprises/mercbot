import assert from "node:assert/strict";
import test from "node:test";
import { queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { startIntegrations } from "../support/ownedHandles.mjs";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { botIn, separateHome } from "./testHome.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { appCard } from "../../packages/bots/src/server/botActions.js";
import { buildCardTools } from "../../packages/bots/src/server/cardTools.js";
import { connectedKeys } from "../../packages/bots/src/server/connectedApps.js";
import { accessOf } from "../support/appKey.mjs";

// What the bots and Connect apps read of a home's apps and accounts and a person's skills (D-31, D-111), against the
// disposable test database: an app's name and card come from the catalogue, a tool asks only for the connected
// accounts of its own apps, a turn names who connected each account, a turn and the "/" picker list skills without
// their instructions, and a person without a display name is named the same way wherever others see them. The coming-soon apps people want are counted over
// everyone's wishes.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const CATALOGUE = Object.freeze([
  { id: "gmail", name: "Gmail", logo: "gmail", color: "#EA4335", icon: "mail", oauth: { provider: "google" } },
  { id: "outlook", name: "Outlook", logo: "outlook", color: "#0078D4", icon: "mail", oauth: { provider: "microsoft" } },
  { id: "google-calendar", name: "Google Calendar", logo: "googlecalendar", color: "#4285F4", icon: "calendar", oauth: { provider: "google" } },
  { id: "todoist", name: "Todoist", soon: true }
]);
// The sign-ins: an account signed in as old-access@example.com was given less than its app now asks for (D-42), and
// each account's key names it. No provider is called.
const CONNECTIONS = Object.freeze({
  lacksAccess: (row) => row.label === "old-access@example.com",
  accessToken: async (accountId) => accessOf(`key-${accountId}`)
});

/** The integrations service with the catalogue above, on the test's Knex. */
async function connectApps(knex, context) {
  return (await startIntegrations(knex, context, { catalogue: CATALOGUE, connections: CONNECTIONS })).integrations;
}

/**
 * The test database's first person (Pat) and a person of the test's own, Lee, with no display name, in a home of the
 * test's own (`homeId`) that Pat owns and Lee is a member of; the home with its accounts, Lee, and anything else the
 * test names in `cleanup` are removed when it ends.
 */
async function setup(context) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").first()).id);
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [lee] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `lee-${stamp}`, email: `lee-${stamp}@example.com`, username: `lee${stamp.replace("-", "")}`, display_name: ""
  }).returning("id");
  const homeId = await separateHome(knex, pat, [lee.id]);
  const cleanup = [];
  context.after(async () => {
    for (const work of cleanup.reverse()) await work();
    await knex("workspaces").where({ id: homeId }).del();
    await knex("plugin_accounts").where({ user_id: lee.id }).del();
    await knex("users").where({ id: lee.id }).del();
    await knex.destroy();
  });
  return { knex, pat, lee: String(lee.id), leeName: `lee-${stamp}`, homeId, cleanup };
}

/** `rows` as accounts `user_id` added in `homeId`, in order; their ids. */
async function addAccounts(knex, homeId, userId, rows) {
  const added = await knex("plugin_accounts").insert(rows.map((row) => ({ user_id: userId, workspace_id: homeId, name: "", ...row }))).returning("id");
  return added.map((row) => String(row.id));
}

test("a bot's tool asks only for the connected accounts of its own apps", async (context) => {
  const { knex, lee, homeId } = await setup(context);
  const as = memberOptions({ userId: lee, homeId });
  const ids = await addAccounts(knex, homeId, lee, [
    { plugin_id: "gmail", status: "connected", label: "lee@example.com" },
    { plugin_id: "gmail", status: "needs-auth" },
    { plugin_id: "google-calendar", status: "connected", label: "lee@example.com" },
    { plugin_id: "outlook", status: "connected", label: "lee@work.example" }
  ]);
  const real = await connectApps(knex, context);
  const read = [];
  const integrations = {
    ...real,
    async reachableAccounts(...args) {
      const rows = await real.reachableAccounts(...args);
      read.push(...rows.map((row) => row.id));
      return rows;
    }
  };

  const keys = await connectedKeys({ integrations, call: as }, ["gmail", "outlook"], "mail");
  assert.deepEqual(keys.map((key) => [key.app, key.address, key.key.token]), [["Gmail", "lee@example.com", `key-${ids[0]}`], ["Outlook", "lee@work.example", `key-${ids[3]}`]]);
  assert.deepEqual(read, [ids[0], ids[3]], "not the Gmail account waiting for sign-in, nor the calendar's");

  // Switched off for Gmail, its account is still told apart from an app that isn't connected.
  read.length = 0;
  await assert.rejects(connectedKeys({ integrations, skip: ["gmail"], call: as }, ["gmail"], "mail"), /switched this action off for Gmail/u);
  await assert.rejects(connectedKeys({ integrations, skip: ["gmail"], call: as }, ["gmail", "outlook"], "mail", "lee@example.com"), /switched this action off for Gmail/u);
  assert.deepEqual([...new Set(read)], [ids[0], ids[3]]);
});

test("an app's card and the connect card read the catalogue, and at most the home's connected accounts of that app", async (context) => {
  const { knex, lee, homeId } = await setup(context);
  const as = memberOptions({ userId: lee, homeId });
  const [gmail] = await addAccounts(knex, homeId, lee, [{ plugin_id: "gmail", status: "connected", label: "old-access@example.com" }]);
  const integrations = await connectApps(knex, context);

  let card = null;
  assert.equal(await queriesDuring(knex, async () => { card = appCard(integrations, "google-calendar"); }), 0, "an app's card reads no table");
  assert.deepEqual([card.id, card.name, card.logo, card.color, card.icon], ["google-calendar", "Google Calendar", "googlecalendar", "#4285F4", "calendar"]);
  assert.deepEqual(appCard(integrations, "nothing-like-it"), { id: "nothing-like-it" });

  /** One reply's connect card, and the reads it sends. */
  async function suggest(app, task) {
    const after = [];
    const { suggestConnect } = buildCardTools({ integrations, notebook: null, after, call: as });
    let result = null;
    const reads = await statementsDuring(knex, async () => { result = await suggestConnect.execute({ app, task }); }, /^\s*(select|with)\b/iu);
    return { result, card: after[0], reads };
  }

  // A connected Gmail that was given less than Gmail now asks for still gets its card, to sign in again (D-42).
  let shown = await suggest("gmail", "read your mail");
  assert.equal(shown.result.status, "card shown");
  assert.deepEqual([shown.card.body.app, shown.card.body.button, shown.card.body.plugin.logo], ["Gmail", "Connect", "gmail"]);
  // The home's connected Gmail accounts and nothing else (JSKIT reads their hidden home column in a second statement).
  const sql = shown.reads.map((read) => read.sql);
  assert.ok(sql.length >= 1 && sql.length <= 2 && sql.every((text) => /"plugin_accounts"/u.test(text)), `only the home's Gmail accounts are read:\n${sql.join("\n")}`);
  assert.match(sql[0], /"plugin_id" = .*"status" = /u);

  await knex("plugin_accounts").where({ id: gmail }).update({ label: "lee@example.com" });
  shown = await suggest("Gmail", "read your mail");
  assert.match(shown.result.error, /Gmail is already connected/u);
  assert.equal(shown.card, undefined);

  // Named by part of its name, and one Mercbot can't sign in to yet.
  shown = await suggest("calendar", "add lunch");
  assert.deepEqual([shown.card.body.app, shown.card.body.button], ["Google Calendar", "Connect"]);
  shown = await suggest("Todoist", "add buy milk");
  assert.deepEqual([shown.result.status, shown.card.body.button, shown.card.body.soon], ["card shown, not connectable yet", "Ask for it", true]);
  shown = await suggest("Basecamp", "list my projects");
  assert.match(shown.result.error, /isn't one of the apps Mercbot connects to/u);
  assert.equal(shown.reads.length, 0, "an app that isn't in the catalogue reads nothing");
});

/**
 * Pat's bot, with the bots service on the integrations service above, whose replies keep the state note they were given
 * (`turn.state`); `turn.listed` counts reads of the whole Connect apps list.
 */
async function patsBot(context) {
  const shared = await setup(context);
  const { knex, pat, homeId } = shared;
  const bot = await botIn(knex, homeId, pat, { name: `Reads ${Date.now()}` });
  const real = await connectApps(knex, context);
  const turn = { state: "", listed: 0 };
  const integrations = { ...real, list: async (...args) => ((turn.listed += 1), real.list(...args)) };
  const bots = createBotsService(serviceDoubles({
    knex, ...await startBotParts(knex, context), integrations, approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, _tools, note) => {
      turn.state = note;
      return { text: "OK.", transcript: [] };
    }
  }));
  const as = memberOptions({ userId: pat, homeId: bot.workspace_id });
  /**
   * One message from Pat in a chat with the bot (their direct chat, unless `chatId` names another) and the bot's reply;
   * the reply's statements that match `matching`.
   */
  async function replyTo(text, matching = /^$/u, chatId = bot.conversation_id) {
    const sent = await bots.chat.sendMessage(chatId, { text }, as);
    return statementsDuring(knex, () => bots.chat.reply(chatId, { afterMessageId: sent.messages[0].id }, undefined, as), matching);
  }
  return { ...shared, bot, bots, as, turn, replyTo };
}

test("a turn names the home's connected apps and who connected each, without reading the Connect apps list", async (context) => {
  const { knex, pat, lee, leeName, homeId, turn, replyTo } = await patsBot(context);
  await addAccounts(knex, homeId, pat, [
    { plugin_id: "gmail", status: "connected", label: "reads-inbox@example.com" },
    { plugin_id: "google-calendar", status: "needs-auth" }
  ]);
  await addAccounts(knex, homeId, lee, [{ plugin_id: "gmail", status: "connected", label: "lee@example.com" }]);

  await replyTo("What can you do?");
  assert.equal(turn.listed, 0, "a turn never reads the whole Connect apps list");
  // Pat's turn: Pat's mailbox is theirs, Lee's is the home's too, named by who connected it (D-111).
  assert.match(turn.state, new RegExp(`connected accounts, which you use for the person you're working for: Gmail: 2 accounts, reads-inbox@example\\.com \\(connected by them\\); lee@example\\.com \\(connected by ${leeName}\\)`, "u"));
  assert.match(turn.state, /waiting for sign-in in Connect apps: [^\n]*Google Calendar/u);
});

test("a turn and the \"/\" picker list the person's skills without their instructions", async (context) => {
  const { knex, pat, lee, homeId, cleanup, bot, bots, as, turn, replyTo } = await patsBot(context);
  // A person's skills are theirs in a home (D14).
  const skills = await knex("user_skills").insert(Array.from({ length: 35 }, (_, index) => ({
    workspace_id: homeId,
    user_id: pat,
    name: `Skill ${String(index + 1).padStart(2, "0")}`,
    description: `Does job ${index + 1}`,
    instructions: "A long set of steps. ".repeat(500)
  }))).returning("id");
  cleanup.push(() => knex("user_skills").whereIn("id", skills.map((row) => row.id)).del());
  const instructionsRead = (statements) => statements.filter((statement) => /"instructions"|user_skills"?\.\*|select \*/iu.test(statement.sql));

  // A person's own skills are used only in a Private chat whose only member is them (D15, O24), never in their direct
  // chat, which is Public.
  await replyTo("What can you do?");
  assert.doesNotMatch(turn.state, /Skill 01/u, "not in a Public chat");
  const { id: alone } = await seedChat(knex, { homeId, kind: "private", title: "Just me", people: [pat], bots: [bot.id] });
  const turnReads = await replyTo("What can you do?", /user_skills/u, alone);
  assert.match(turn.state, /The person's own skills \(use read_skill\): Skill 01 \(Does job 1\); [^\n]*Skill 30 \(Does job 30\)\./u);
  assert.doesNotMatch(turn.state, /Skill 31/u, "the first 30, in the order they were made");
  assert.deepEqual(instructionsRead(turnReads), [], "a turn lists skills without their instructions");
  assert.equal(turnReads.length, 1, "in one read of the first 30");

  // The "/" picker offers them by the same rule: in that Private chat, never in their direct chat, a Private chat with
  // someone else, or without a chat; and a message that picks one keeps it only where it's offered.
  const ownIn = async (chatId) => (await bots.skillsFor(chatId, as)).skills.filter((skill) => skill.own).map((skill) => skill.name);
  const { id: withLee } = await seedChat(knex, { homeId, kind: "private", title: "Pat and Lee", people: [pat, lee], bots: [bot.id] });
  assert.deepEqual([await ownIn(bot.conversation_id), await ownIn(withLee), await ownIn(undefined)], [[], [], []]);
  assert.ok((await ownIn(withLee)).length === 0 && (await bots.skillsFor(withLee, as)).skills.length > 0, "Mercbot's skills are still offered");
  let offered = null;
  const pickerReads = await statementsDuring(knex, async () => { offered = await bots.skillsFor(alone, as); }, /user_skills/u);
  const own = offered.skills.filter((skill) => skill.own).map((skill) => skill.name);
  assert.ok(own.includes("Skill 01") && own.includes("Skill 35"), "the picker offers every skill of theirs");
  const elsewhere = await bots.chat.sendMessage(bot.conversation_id, { text: `Please <@skill:u-${skills[0].id}>` }, as);
  assert.deepEqual(elsewhere.messages.at(-1).body.skills, [], "not kept in their direct chat, which is Public");
  const picked = String(skills[2].id);
  let message = null;
  const sendReads = await statementsDuring(knex, async () => { message = await bots.chat.sendMessage(alone, { text: `Please <@skill:u-${picked}>` }, as); }, /user_skills/u);
  assert.deepEqual(message.messages.at(-1).body.skills, [{ id: `u-${picked}`, name: "Skill 03" }]);
  assert.deepEqual(instructionsRead([...pickerReads, ...sendReads]), [], "nor the picker, nor a picked skill's message");
});

test("a person without a display name is named by their email's first part wherever others see them", async (context) => {
  const { knex, pat, lee, leeName, homeId } = await setup(context);
  await knex("workspace_memberships").where({ workspace_id: homeId, user_id: lee }).update({ role_sid: "admin" });
  const bot = await botIn(knex, homeId, pat, { name: `Names ${Date.now()}` });
  const integrations = await connectApps(knex, context);
  const asPat = memberOptions({ userId: pat, homeId });
  const asLee = memberOptions({ userId: lee, homeId, role: "admin", permissions: ["workspace.settings.update"] });

  // Connect apps: "Added by <name>" (D-111), in the list and for the one account a sign-in waits on.
  const { accountId } = await integrations.addAccount("gmail", "family", asLee);
  const listed = (await integrations.list(asPat)).plugins.find((plugin) => plugin.id === "gmail").accounts.find((account) => account.id === accountId);
  assert.deepEqual([listed.addedBy, listed.addedByYou, listed.canChange], [leeName, false, false], "a member sees who added it, and can't change it");
  const byLee = (await integrations.list(asLee)).plugins.find((plugin) => plugin.id === "gmail").accounts.find((account) => account.id === accountId);
  assert.deepEqual([byLee.addedByYou, byLee.canChange], [true, true]);
  assert.deepEqual((await integrations.accountStatus(accountId, asPat)).account, listed, "one account reads as the list shows it");
  // Another home of Pat's (this file's database copy is its own, so it goes with it).
  const patsOtherHome = await separateHome(knex, pat);
  await assert.rejects(integrations.accountStatus(accountId, memberOptions({ userId: pat, homeId: patsOtherHome })), /Account not found/u, "another home doesn't reach it");
  await knex("workspaces").where({ id: patsOtherHome }).del();
  await assert.rejects(integrations.accountStatus("not-an-id", asPat), /Account not found/u);

  // A chat of theirs (D-112): Pat sees Lee by that name among its people.
  const { id: chatId } = await seedChat(knex, { homeId, title: "Bins", people: [pat, lee], bots: [bot.id] });
  const parts = await startBotParts(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, ...parts, integrations, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "OK.", transcript: [] }) }));
  const { chat } = await bots.chats.get(chatId, asPat);
  assert.equal(chat.people.find((person) => String(person.userId) === String(lee))?.name, leeName);
});

test("the coming-soon apps people want are counted over everyone's wishes, most wanted first, then by name", async (context) => {
  const { knex, pat, lee, homeId, cleanup } = await setup(context);
  const colleague = String((await knex("users").whereNotIn("id", [pat, lee]).orderBy("id").first()).id);
  const catalogue = [
    { id: "gmail", name: "Gmail" },
    { id: "trello", name: "Trello", soon: true },
    { id: "asana", name: "Asana", soon: true },
    { id: "notion", name: "Notion", soon: true },
    { id: "todoist", name: "Todoist", soon: true }
  ];
  const { integrations } = await startIntegrations(knex, context, { catalogue, connections: CONNECTIONS });
  cleanup.push(() => knex("app_interest").whereIn("user_id", [pat, lee, colleague]).del());
  // Each wish is made as Connect apps makes it, by adding a coming-soon app (D-33).
  const wishes = [[lee, ["trello", "asana", "notion"]], [pat, ["trello", "notion"]], [colleague, ["asana", "notion"]]];
  for (const [person, apps] of wishes) {
    for (const app of apps) await integrations.install(app, memberOptions({ userId: person, homeId }));
  }
  // A wish for an app the catalogue no longer has isn't listed.
  await knex("app_interest").insert({ user_id: lee, plugin_id: "retired-app" });

  // Anyone's call counts everyone's wishes: whoever shows the list decides who sees it.
  assert.deepEqual(await integrations.comingSoonWanted(requestContextOptions({ user: { id: lee } })), [
    { id: "notion", name: "Notion", people: 3 },
    { id: "asana", name: "Asana", people: 2 },
    { id: "trello", name: "Trello", people: 2 }
  ]);
  // Connect apps shows each person only their own wish, never how many people want an app.
  const listed = (await integrations.list(memberOptions({ userId: pat, homeId }))).plugins;
  assert.deepEqual(listed.filter((plugin) => plugin.soon).map((plugin) => [plugin.id, plugin.wanted, "wantedBy" in plugin]), [
    ["trello", true, false],
    ["asana", false, false],
    ["notion", true, false],
    ["todoist", false, false]
  ]);
});
