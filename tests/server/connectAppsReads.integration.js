import assert from "node:assert/strict";
import test from "node:test";
import { queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { startIntegrations } from "../support/ownedHandles.mjs";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { testBot, testHome } from "./testHome.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { appCard } from "../../packages/bots/src/server/botActions.js";
import { buildCardTools } from "../../packages/bots/src/server/cardTools.js";
import { connectedKeys } from "../../packages/bots/src/server/connectedApps.js";

// What the bots and Connect apps read of a person's apps, accounts and skills (D-31, D-37), against the
// disposable test database: an app's name and card come from the catalogue, a tool asks only for the connected
// accounts of its own apps, a turn and the "/" picker list skills without their instructions, and a person without a
// display name is named the same way wherever others see them. The coming-soon apps people want are counted over
// everyone's wishes.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// The person's own accounts and the home's, as a bot's own chat and Connect apps reach them.
const REACH = Object.freeze({ personal: true });
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
  accessToken: async (_reach, accountId) => ({ accessToken: `key-${accountId}` })
});

/** The integrations service with the catalogue above, on the test's Knex. */
async function connectApps(knex, context) {
  return (await startIntegrations(knex, context, { catalogue: CATALOGUE, connections: CONNECTIONS })).integrations;
}

/**
 * The test database's first person (Pat) and a person of the test's own, Lee, with no display name; Lee's accounts and
 * anything else the test names in `cleanup` are removed when it ends.
 */
async function setup(context) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").first()).id);
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [lee] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `lee-${stamp}`, email: `lee-${stamp}@example.com`, username: `lee${stamp.replace("-", "")}`, display_name: ""
  }).returning("id");
  const cleanup = [];
  context.after(async () => {
    for (const work of cleanup.reverse()) await work();
    await knex("plugin_accounts").where({ user_id: lee.id }).del();
    await knex("users").where({ id: lee.id }).del();
    await knex.destroy();
  });
  return { knex, pat, lee: String(lee.id), leeName: `lee-${stamp}`, cleanup };
}

/** `rows` as `user_id`'s own accounts (of no home), in order; their ids. */
async function addAccounts(knex, userId, rows) {
  const added = await knex("plugin_accounts").insert(rows.map((row) => ({ user_id: userId, name: "", ...row }))).returning("id");
  return added.map((row) => String(row.id));
}

test("a bot's tool asks only for the connected accounts of its own apps", async (context) => {
  const { knex, lee } = await setup(context);
  const as = requestContextOptions({ user: { id: lee } });
  const ids = await addAccounts(knex, lee, [
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

  const keys = await connectedKeys({ integrations, reach: REACH, call: as }, ["gmail", "outlook"], "mail");
  assert.deepEqual(keys.map((key) => [key.app, key.address, key.key]), [["Gmail", "lee@example.com", `key-${ids[0]}`], ["Outlook", "lee@work.example", `key-${ids[3]}`]]);
  assert.deepEqual(read, [ids[0], ids[3]], "not the Gmail account waiting for sign-in, nor the calendar's");

  // Switched off for Gmail, its account is still told apart from an app that isn't connected.
  read.length = 0;
  await assert.rejects(connectedKeys({ integrations, reach: REACH, skip: ["gmail"], call: as }, ["gmail"], "mail"), /switched this action off for Gmail/u);
  await assert.rejects(connectedKeys({ integrations, reach: REACH, skip: ["gmail"], call: as }, ["gmail", "outlook"], "mail", "lee@example.com"), /switched this action off for Gmail/u);
  assert.deepEqual([...new Set(read)], [ids[0], ids[3]]);
});

test("an app's card and the connect card read the catalogue, and at most the person's connected accounts of that app", async (context) => {
  const { knex, lee } = await setup(context);
  const as = requestContextOptions({ user: { id: lee } });
  const [gmail] = await addAccounts(knex, lee, [{ plugin_id: "gmail", status: "connected", label: "old-access@example.com" }]);
  const integrations = await connectApps(knex, context);

  let card = null;
  assert.equal(await queriesDuring(knex, async () => { card = appCard(integrations, "google-calendar"); }), 0, "an app's card reads no table");
  assert.deepEqual([card.id, card.name, card.logo, card.color, card.icon], ["google-calendar", "Google Calendar", "googlecalendar", "#4285F4", "calendar"]);
  assert.deepEqual(appCard(integrations, "nothing-like-it"), { id: "nothing-like-it" });

  /** One reply's connect card, and the reads it sends. */
  async function suggest(app, task) {
    const after = [];
    const { suggestConnect } = buildCardTools({ integrations, reach: REACH, notebook: null, after, call: as });
    let result = null;
    const reads = await statementsDuring(knex, async () => { result = await suggestConnect.execute({ app, task }); }, /^\s*(select|with)\b/iu);
    return { result, card: after[0], reads };
  }

  // A connected Gmail that was given less than Gmail now asks for still gets its card, to sign in again (D-42).
  let shown = await suggest("gmail", "read your mail");
  assert.equal(shown.result.status, "card shown");
  assert.deepEqual([shown.card.body.app, shown.card.body.button, shown.card.body.plugin.logo], ["Gmail", "Authorize", "gmail"]);
  // The person's connected Gmail accounts and nothing else (JSKIT reads their hidden home column in a second statement).
  const sql = shown.reads.map((read) => read.sql);
  assert.ok(sql.length >= 1 && sql.length <= 2 && sql.every((text) => /"plugin_accounts"/u.test(text)), `only the person's Gmail accounts are read:\n${sql.join("\n")}`);
  assert.match(sql[0], /"plugin_id" = .*"status" = /u);

  await knex("plugin_accounts").where({ id: gmail }).update({ label: "lee@example.com" });
  shown = await suggest("Gmail", "read your mail");
  assert.match(shown.result.error, /Gmail is already connected/u);
  assert.equal(shown.card, undefined);

  // Named by part of its name, and one Mercbot can't sign in to yet.
  shown = await suggest("calendar", "add lunch");
  assert.deepEqual([shown.card.body.app, shown.card.body.button], ["Google Calendar", "Authorize"]);
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
  const { knex, pat, cleanup } = shared;
  const bot = await testBot(knex, pat, { name: `Reads ${Date.now()}` });
  cleanup.push(() => knex("bots").where({ id: bot.id }).del());
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
  /** One message from Pat and the bot's reply; the reply's statements that match `matching`. */
  async function replyTo(text, matching = /^$/u) {
    const sent = await bots.sendMessage(bot.id, { text }, as);
    return statementsDuring(knex, () => bots.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as), matching);
  }
  return { ...shared, bot, bots, as, turn, replyTo };
}

test("a turn names the connected apps without reading the Connect apps list", async (context) => {
  const { knex, pat, cleanup, turn, replyTo } = await patsBot(context);
  const accounts = await addAccounts(knex, pat, [
    { plugin_id: "gmail", status: "connected", label: "reads-inbox@example.com" },
    { plugin_id: "google-calendar", status: "needs-auth" }
  ]);
  cleanup.push(() => knex("plugin_accounts").whereIn("id", accounts).del());

  await replyTo("What can you do?");
  assert.equal(turn.listed, 0, "a turn never reads the whole Connect apps list");
  assert.match(turn.state, /Connected accounts: [^\n]*Gmail: reads-inbox@example\.com/u);
  assert.match(turn.state, /waiting for sign-in in Connect apps: [^\n]*Google Calendar/u);
});

test("a turn and the \"/\" picker list the person's skills without their instructions", async (context) => {
  const { knex, pat, cleanup, bot, bots, as, turn, replyTo } = await patsBot(context);
  const skills = await knex("user_skills").insert(Array.from({ length: 35 }, (_, index) => ({
    user_id: pat,
    name: `Skill ${String(index + 1).padStart(2, "0")}`,
    description: `Does job ${index + 1}`,
    instructions: "A long set of steps. ".repeat(500)
  }))).returning("id");
  cleanup.push(() => knex("user_skills").whereIn("id", skills.map((row) => row.id)).del());
  const instructionsRead = (statements) => statements.filter((statement) => /"instructions"|user_skills"?\.\*|select \*/iu.test(statement.sql));

  const turnReads = await replyTo("What can you do?", /user_skills/u);
  assert.match(turn.state, /The person's own skills \(use read_skill\): Skill 01 \(Does job 1\); [^\n]*Skill 30 \(Does job 30\)\./u);
  assert.doesNotMatch(turn.state, /Skill 31/u, "the first 30, in the order they were made");
  assert.deepEqual(instructionsRead(turnReads), [], "a turn lists skills without their instructions");
  assert.equal(turnReads.length, 1, "in one read of the first 30");

  // The "/" picker, and a message that picks a skill with it, read names too.
  let offered = null;
  const pickerReads = await statementsDuring(knex, async () => { offered = await bots.skillsFor(as); }, /user_skills/u);
  const own = offered.skills.filter((skill) => skill.own).map((skill) => skill.name);
  assert.ok(own.includes("Skill 01") && own.includes("Skill 35"), "the picker offers every skill of theirs");
  const picked = String(skills[2].id);
  let message = null;
  const sendReads = await statementsDuring(knex, async () => { message = await bots.sendMessage(bot.id, { text: `Please <@skill:u-${picked}>` }, as); }, /user_skills/u);
  assert.deepEqual(message.messages.at(-1).body.skills, [{ id: `u-${picked}`, name: "Skill 03" }]);
  assert.deepEqual(instructionsRead([...pickerReads, ...sendReads]), [], "nor the picker, nor a picked skill's message");
});

test("a person without a display name is named by their email's first part wherever others see them", async (context) => {
  const { knex, pat, lee, leeName, cleanup } = await setup(context);
  const homeId = String(await testHome(knex, pat));
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: lee, role_sid: "admin", status: "active" });
  const bot = await testBot(knex, pat, { name: `Names ${Date.now()}` });
  cleanup.push(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId, user_id: lee }).del();
  });
  const integrations = await connectApps(knex, context);
  const asPat = memberOptions({ userId: pat, homeId });
  const asLee = memberOptions({ userId: lee, homeId, role: "admin", permissions: ["workspace.settings.update"] });

  // Connect apps: "Everyone in <home> · added by <name>" (D-37), in the list and for the one account a sign-in waits on.
  const { accountId } = await integrations.addAccount(REACH, "gmail", "family", { forHome: true }, asLee);
  const listed = (await integrations.list(REACH, asPat)).plugins.find((plugin) => plugin.id === "gmail").accounts.find((account) => account.id === accountId);
  assert.deepEqual([listed.home, listed.addedBy], [true, leeName]);
  assert.deepEqual((await integrations.accountStatus(REACH, accountId, asPat)).account, listed, "one account reads as the list shows it");
  await assert.rejects(integrations.accountStatus(REACH, accountId, requestContextOptions({ user: { id: pat } })), /Account not found/u, "outside the home it isn't reached");
  await assert.rejects(integrations.accountStatus(REACH, "not-an-id", asPat), /Account not found/u);

  // The home notebook (D-36): a note from Lee's chat.
  await knex("bot_notebook").insert({ workspace_id: homeId, bot_id: bot.id, text: "The bins go out on Tuesday", source_user_id: lee });
  const parts = await startBotParts(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, ...parts, integrations, approvals: { decide: async () => "allow" }, reply: async () => ({ text: "OK.", transcript: [] }) }));
  const { notes } = await bots.notebook(bot.id, {}, asPat);
  assert.deepEqual(notes.map((note) => [note.text, note.author]), [["The bins go out on Tuesday", leeName]]);
});

test("the coming-soon apps people want are counted over everyone's wishes, most wanted first, then by name", async (context) => {
  const { knex, pat, lee, cleanup } = await setup(context);
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
    for (const app of apps) await integrations.install(REACH, app, requestContextOptions({ user: { id: person } }));
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
  const listed = (await integrations.list(REACH, requestContextOptions({ user: { id: pat } }))).plugins;
  assert.deepEqual(listed.filter((plugin) => plugin.soon).map((plugin) => [plugin.id, plugin.wanted, "wantedBy" in plugin]), [
    ["trello", true, false],
    ["asana", false, false],
    ["notion", true, false],
    ["todoist", false, false]
  ]);
});
