import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import migration from "../../migrations/20261120150000_home_settings.cjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { DEFAULT_BOT_NAME } from "../../packages/bots/src/server/onboarding.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// A home's default for new bots (D-100), against the disposable test database, each test in homes of its own: every
// way of making a bot follows it and group chats and bots already there don't; only owners and admins set it (a member
// is refused 403, through the routes too); the question once a second person joins shows once, to owners and admins
// only; the first conversation's card and the New home form set it; the migration counts homes that already had two
// people as asked; and the bot list's statements don't grow with its bots while the question is on.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];
const COLOR = "#1E86FC";
const texts = (page) => page.messages.filter((message) => message.kind === "text").map((message) => message.body.text);
const tabsOf = (bot) => (bot.rooms || []).map((room) => [room.title, Boolean(room.own)]);

/**
 * Pat (the test database's first person) and the bots service, with homes of the test's own: `newHome()` makes one
 * whose only person is Pat, its owner; `join` adds someone; `as` is a person's call in a home, owners and admins with
 * the home's settings permission as JSKIT gives it.
 */
async function setup(context) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const homes = [];
  const people = [];
  context.after(async () => {
    await knex("bots").whereIn("workspace_id", homes).del();
    await knex("workspace_settings").whereIn("workspace_id", homes).del();
    await knex("workspace_memberships").whereIn("workspace_id", homes).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex("users").whereIn("id", people).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    approvals: { decide: async () => "allow" },
    reply: async () => ({ text: "Noted.", transcript: [] })
  }));
  context.after(() => bots.drain(10000));
  const newHome = async () => {
    const [home] = await knex("workspaces")
      .insert({ slug: `home-default-${stamp}-${homes.length}`, name: `Home ${homes.length}`, owner_user_id: pat, is_personal: false })
      .returning("id");
    homes.push(String(home.id));
    await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: pat, role_sid: "owner", status: "active" });
    await knex("workspace_settings").insert({ workspace_id: home.id });
    return String(home.id);
  };
  const person = async (name) => {
    const sid = `${name.toLowerCase()}-${stamp}`;
    const [row] = await knex("users")
      .insert({ auth_provider: "test", auth_provider_user_sid: sid, email: `${sid}@example.com`, username: sid.replace(/-/gu, ""), display_name: name })
      .returning("id");
    people.push(String(row.id));
    return String(row.id);
  };
  const join = (homeId, userId, role = "member") =>
    knex("workspace_memberships").insert({ workspace_id: homeId, user_id: userId, role_sid: role, status: "active" });
  const as = (userId, homeId, role = "member") => memberOptions({ userId, homeId, role, permissions: role === "member" ? [] : MANAGE });
  const sharingOf = async (botId) => (await knex("bots").where({ id: botId }).first()).sharing;
  return { knex, parts, bots, pat, newHome, person, join, as, sharingOf };
}

test("every way of making a bot follows the home's default, and group chats and bots already there don't", async (context) => {
  const { bots, pat, newHome, as, sharingOf } = await setup(context);
  const homeId = await newHome();
  const owner = as(pat, homeId, "owner");
  assert.deepEqual(await bots.homeDefault(owner), { newBotSharing: "mixed", chosen: false, teamQuestion: null, botsJoinIn: true }, "unchosen: Mixed");
  const before = await bots.createBot({ name: "Before", color: COLOR }, owner);
  assert.equal(before.sharing, "mixed");
  assert.equal(before.rooms, null, "a Mixed bot has no tabs");

  assert.deepEqual(await bots.chooseHomeDefault("shared", owner), { newBotSharing: "shared", chosen: true, teamQuestion: null, botsJoinIn: true });
  assert.equal(await sharingOf(before.id), "mixed", "choosing changes no bot already there");

  // New bot: Shared, with General for everyone and its maker's own conversation, You only, open with its intro to come.
  const made = await bots.createBot({ name: "Made", color: COLOR }, owner);
  assert.equal(made.sharing, "shared");
  assert.deepEqual(tabsOf(made), [["General", false], ["You only", true]]);
  assert.equal(made.roomId, made.rooms[1].id, "You only is open");
  assert.equal(made.onboardingStep, "intro-greet", "its intro comes in You only");
  const listed = (await bots.listBots(owner)).bots.find((bot) => bot.id === made.id);
  assert.deepEqual([listed.sharing, tabsOf(listed), listed.roomId], ["shared", tabsOf(made), made.roomId], "the list says the same");

  // Add from a template: Shared the same way, its greeting in You only.
  const added = await bots.addFromTemplate("weekly-meal-planner", "Pat", owner);
  assert.equal(added.sharing, "shared");
  assert.deepEqual(tabsOf(added), [["General", false], ["You only", true]]);
  assert.deepEqual(texts(await bots.messages(added.id, added.roomId, {}, owner)), [added.preview], "the greeting is in You only");
  assert.deepEqual(texts(await bots.messages(added.id, added.rooms[0].id, {}, owner)), [], "General starts empty");

  // A group chat never reads it.
  const { bot: group } = await bots.createGroup({ botIds: [made.id] }, "Pat", owner);
  assert.equal(await sharingOf(group.id), "mixed", "a group chat keeps the table's own default");

  // Private from now on: new bots are Private, and the Shared ones made before stay Shared.
  await bots.chooseHomeDefault("private", owner);
  const later = await bots.createBot({ name: "Later", color: COLOR }, owner);
  const laterAdded = await bots.addFromTemplate("weekly-meal-planner", "Pat", owner);
  assert.deepEqual([later.sharing, later.rooms, laterAdded.sharing, laterAdded.rooms], ["private", null, "private", null]);
  assert.deepEqual(
    [await sharingOf(before.id), await sharingOf(made.id), await sharingOf(added.id)],
    ["mixed", "shared", "shared"],
    "a change leaves every bot already there alone"
  );
});

test("only the home's owners and admins set it: a member is refused 403, through the routes too, and nothing is kept", async (context) => {
  const { knex, parts, bots, pat, newHome, person, join, as } = await setup(context);
  const homeId = await newHome();
  const kim = await person("Kim");
  const lee = await person("Lee");
  await join(homeId, kim);
  await join(homeId, lee, "admin");

  for (const work of [() => bots.chooseHomeDefault("shared", as(kim, homeId)), () => bots.answerTeamQuestion("shared", as(kim, homeId))]) {
    await assert.rejects(work(), (error) => error.statusCode === 403 && error.code === "bots_home_default_forbidden");
  }
  await assert.rejects(bots.chooseHomeDefault("everyone", as(pat, homeId, "owner")), (error) => error.statusCode === 400);
  await assert.rejects(bots.answerTeamQuestion("maybe", as(pat, homeId, "owner")), (error) => error.statusCode === 400);
  assert.equal(await knex("home_settings").where({ workspace_id: homeId }).first(), undefined, "a refusal keeps nothing");

  // The routes, as a request reaches them: JSKIT's permissions decide.
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    { bots, approvals: {}, notices: {}, meter: { track: (_who, work) => work() }, records: parts.records, streams: new Set() }
  );
  const call = async (key, userId, role, body = {}) => {
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
    const permissions = role === "member" ? [] : MANAGE;
    const request = { params: { workspaceSlug: `home-${homeId}` }, body, user: { id: userId }, workspace: { id: homeId }, membership: { roleSid: role }, permissions };
    request.callOptions = async () => requestContextOptions(request);
    await routes.get(key)(request, reply);
    return answer;
  };
  const patch = "PATCH /api/w/:workspaceSlug/home-settings";
  const refused = await call(patch, kim, "member", { newBotSharing: "shared" });
  assert.deepEqual([refused.status, refused.body.code], [403, "bots_home_default_forbidden"]);
  const asked = await call("POST /api/w/:workspaceSlug/home-settings/team-question", kim, "member", { answer: "shared" });
  assert.deepEqual([asked.status, asked.body.code], [403, "bots_home_default_forbidden"]);
  const read = await call("GET /api/w/:workspaceSlug/home-settings", kim, "member");
  assert.deepEqual([read.status, read.body], [200, { newBotSharing: "mixed", chosen: false, teamQuestion: null, botsJoinIn: true }], "everyone reads it");
  const byAdmin = await call(patch, lee, "admin", { newBotSharing: "shared" });
  assert.deepEqual([byAdmin.status, byAdmin.body.newBotSharing], [200, "shared"], "an admin sets it");
  const row = await knex("home_settings").where({ workspace_id: homeId }).first();
  assert.deepEqual([row.new_bot_sharing, String(row.updated_by)], ["shared", lee], "kept, with who chose it");
  const byOwner = await call(patch, pat, "owner", { newBotSharing: "private" });
  assert.deepEqual([byOwner.status, byOwner.body.newBotSharing], [200, "private"], "and the owner");
});

test("the question shows once a second person joins, to owners and admins only, and either answer ends it", async (context) => {
  const { bots, pat, newHome, person, join, as, sharingOf } = await setup(context);
  const kim = await person("Kim");
  const lee = await person("Lee");
  const questionFor = async (userId, homeId, role) => (await bots.listBots(as(userId, homeId, role))).home.teamQuestion;

  // Keep Mixed: a home of one isn't asked; Kim joining asks Pat, not Kim; an admin who joins after is asked too.
  const kept = await newHome();
  const old = await bots.createBot({ name: "Old", color: COLOR }, as(pat, kept, "owner"));
  assert.equal(await questionFor(pat, kept, "owner"), null, "a home of one person isn't asked");
  await join(kept, kim);
  assert.deepEqual(await questionFor(pat, kept, "owner"), { name: "Kim", sharing: "mixed" }, "the owner is asked, naming who joined");
  assert.equal(await questionFor(kim, kept, "member"), null, "a member is never asked");
  await join(kept, lee, "admin");
  assert.deepEqual(await questionFor(lee, kept, "admin"), { name: "Kim", sharing: "mixed" }, "an admin is asked too");
  const keep = await bots.answerTeamQuestion("keep", as(pat, kept, "owner"));
  assert.deepEqual(keep, { newBotSharing: "mixed", chosen: true, teamQuestion: null, botsJoinIn: true });
  assert.deepEqual([await questionFor(pat, kept, "owner"), await questionFor(lee, kept, "admin")], [null, null], "once answered, nobody is asked");
  assert.equal((await bots.answerTeamQuestion("shared", as(lee, kept, "admin"))).newBotSharing, "mixed", "a later answer changes nothing");
  assert.equal(await sharingOf(old.id), "mixed");

  // Make them Shared: new bots are Shared, the bot already there isn't.
  const shared = await newHome();
  const first = await bots.createBot({ name: "First", color: COLOR }, as(pat, shared, "owner"));
  await join(shared, kim);
  assert.equal((await questionFor(pat, shared, "owner")).name, "Kim");
  assert.deepEqual(await bots.answerTeamQuestion("shared", as(pat, shared, "owner")), { newBotSharing: "shared", chosen: true, teamQuestion: null, botsJoinIn: true });
  assert.equal(await sharingOf(first.id), "mixed", "Make them Shared changes no bot already there");
  assert.equal((await bots.createBot({ name: "Next", color: COLOR }, as(pat, shared, "owner"))).sharing, "shared");

  // Private, the question says so; a home already Shared before anyone joined isn't asked.
  const privateHome = await newHome();
  await bots.chooseHomeDefault("private", as(pat, privateHome, "owner"));
  await join(privateHome, kim);
  assert.deepEqual(await questionFor(pat, privateHome, "owner"), { name: "Kim", sharing: "private" });
  const teamHome = await newHome();
  await bots.chooseHomeDefault("shared", as(pat, teamHome, "owner"));
  await join(teamHome, kim);
  assert.equal(await questionFor(pat, teamHome, "owner"), null, "new bots already Shared: nothing to ask");
});

test("the first conversation asks right after its bot is named, the answer sets the default, and typing past it doesn't", async (context) => {
  const { bots, pat, newHome, as, sharingOf } = await setup(context);
  const user = { displayName: "Pat" };
  /** The main bot's first conversation up to its name, the step after "rename" and what it showed. */
  const named = async (homeId) => {
    const owner = as(pat, homeId, "owner");
    const main = await bots.ensureFirstBot(owner);
    await bots.advanceOnboarding(main.id, "start", user, owner);
    await bots.chooseName(main.id, DEFAULT_BOT_NAME, owner);
    await bots.advanceOnboarding(main.id, "confirm", user, owner);
    const renamed = await bots.advanceOnboarding(main.id, "rename", user, owner);
    return { owner, main, renamed, card: renamed.messages.find((message) => message.kind === "choice") };
  };

  const asked = await newHome();
  const { owner, main, renamed, card } = await named(asked);
  assert.equal(renamed.bot.onboardingStep, "home-default", "the step waits for the answer");
  assert.deepEqual(
    [card.body.purpose, card.body.question, card.body.options],
    ["home-default", "Will anyone else use this home with you?", ["Just me", "Me and other people"]]
  );
  assert.deepEqual((await bots.advanceOnboarding(main.id, "home-default", user, owner)).messages, [], "nothing runs until it's answered");
  const answered = await bots.answerChoice(main.id, card.id, ["Me and other people"], owner);
  // The conversation carries on, offering a team next while the home has no other bot (D-105: teams.integration.js).
  assert.equal(answered.bot.onboardingStep, "team-offer", "the conversation carries on");
  assert.deepEqual(answered.home, { newBotSharing: "shared", chosen: true, teamQuestion: null, botsJoinIn: true });
  assert.equal(await sharingOf(main.id), "mixed", "the main bot keeps its mode");
  assert.equal((await bots.createBot({ name: "Next", color: COLOR }, owner)).sharing, "shared");

  // Just me sets Mixed.
  const alone = await newHome();
  const single = await named(alone);
  assert.equal((await bots.answerChoice(single.main.id, single.card.id, ["Just me"], single.owner)).home.newBotSharing, "mixed");
  assert.equal((await bots.homeDefault(single.owner)).chosen, true);

  // Chosen already (the New home form): no card of its own; the team's comes instead (D-105).
  const formed = await newHome();
  await bots.chooseHomeDefault("shared", as(pat, formed, "owner"));
  const quiet = await named(formed);
  assert.deepEqual([quiet.card?.body.purpose, quiet.renamed.bot.onboardingStep], ["team", "team"]);

  // Typing instead of answering: the card closes, the conversation carries on, and the default stays unchosen.
  const typed = await newHome();
  const busy = await named(typed);
  const sent = await bots.sendMessage(busy.main.id, { text: "Hello there" }, busy.owner);
  assert.equal(sent.messages.find((message) => message.id === busy.card.id)?.body.inactive, true);
  assert.equal(sent.bot.onboardingStep, "about");
  assert.deepEqual(await bots.homeDefault(busy.owner), { newBotSharing: "mixed", chosen: false, teamQuestion: null, botsJoinIn: true });
});

test("the bot list reads the default and the question in the same statements for 4 bots as for 60", async (context) => {
  const { knex, bots, pat, newHome, person, join, as } = await setup(context);
  const homeId = await newHome();
  await join(homeId, await person("Kim"));
  const owner = as(pat, homeId, "owner");
  const insertBots = (count, from) => knex("bots").insert(Array.from({ length: count }, (_, index) => ({
    user_id: pat, workspace_id: homeId, name: `Bot ${from + index}`, color: COLOR
  })));
  await insertBots(3, 0);
  await bots.listBots(owner);
  await insertBots(1, 3);
  let listed;
  const few = await queriesDuring(knex, async () => {
    listed = await bots.listBots(owner);
  });
  assert.deepEqual([listed.bots.length, listed.home.teamQuestion?.name], [4, "Kim"]);
  await insertBots(56, 4);
  const many = await queriesDuring(knex, async () => {
    listed = await bots.listBots(owner);
  });
  assert.deepEqual([listed.bots.length, listed.home.teamQuestion?.name], [60, "Kim"]);
  assert.equal(many, few, `the list's statements don't grow with its bots (${few} for 4, ${many} for 60)`);
});

test("the migration counts homes that already had two people or more as asked, and keeps one row per home", async (context) => {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  const schema = `home_settings_check_${randomBytes(4).toString("hex")}`;
  const trx = await knex.transaction();
  try {
    // A schema of its own, rolled back after: the tables the migration reads, as small as it needs them.
    await trx.raw(`CREATE SCHEMA ${schema}`);
    await trx.raw(`SET LOCAL search_path TO ${schema}`);
    await trx.raw("CREATE TABLE users (id bigint PRIMARY KEY)");
    await trx.raw("CREATE TABLE workspaces (id bigint PRIMARY KEY)");
    await trx.raw("CREATE TABLE workspace_memberships (workspace_id bigint, user_id bigint, status text)");
    await trx("users").insert([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await trx("workspaces").insert([{ id: 10 }, { id: 11 }, { id: 12 }]);
    await trx("workspace_memberships").insert([
      { workspace_id: 10, user_id: 1, status: "active" },
      { workspace_id: 11, user_id: 1, status: "active" },
      { workspace_id: 11, user_id: 2, status: "active" },
      { workspace_id: 12, user_id: 1, status: "active" },
      { workspace_id: 12, user_id: 3, status: "pending" }
    ]);
    await migration.up(trx);
    const rows = await trx("home_settings").select("workspace_id", "new_bot_sharing", "team_question_answered_at");
    assert.deepEqual(rows.map((row) => [String(row.workspace_id), row.new_bot_sharing, row.team_question_answered_at !== null]), [["11", null, true]],
      "only the home with two active people, asked already, and its new bots still Mixed");
    for (const [values, refusal] of [
      [{ workspace_id: 10, new_bot_sharing: "everyone" }, /home_settings_new_bot_sharing_check/u],
      [{ workspace_id: 11 }, /home_settings_workspace_unique/u]
    ]) {
      await trx.raw("SAVEPOINT refused");
      await assert.rejects(trx("home_settings").insert(values), refusal);
      await trx.raw("ROLLBACK TO SAVEPOINT refused");
    }
    await trx("workspaces").where({ id: 11 }).del();
    assert.equal((await trx("home_settings").count({ rows: "*" }))[0].rows, "0", "a home's settings go with it");
  } finally {
    await trx.rollback();
  }
});
