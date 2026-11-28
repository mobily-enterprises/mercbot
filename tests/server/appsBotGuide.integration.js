import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { membersOn } from "../support/appsFeatures.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase, earlierTransactionsEnded } from "../support/testDatabase.mjs";

// Every app has a bot to talk to (D-147), the apps' side, on the test database: the app guide kept with each version as
// it's saved and published, never written per turn; the bot an app's chat is with; the brief it's told; and the
// person's chat with it. The bots' chats are a stand-in here (appBotChats.integration.js has the real ones).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A home with Otto (its main bot) and Coach, and the chats the app's chat button asks for, kept to be read. */
async function setup(context) {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const bots = botsOf(knex);
  const ids = {};
  const asked = [];
  const faces = async () => [
    { id: ids.otto, name: "Otto", color: "#1E86FC", shape: "cloud", main: true, archived: false },
    { id: ids.coach, name: "Coach", color: "#0B8043", shape: "tuft", main: false, archived: Boolean(ids.coachArchived) }
  ];
  const records = {
    ...bots,
    directory: { ...bots.directory, homeBotFaces: faces },
    chats: { ...membersOn(knex), appBotChat: async (input) => (asked.push(input), { id: "900", ...input }) }
  };
  const home = await appsHome(cleanup, { slug: "apps-bot", knex, records });
  for (const name of ["Otto", "Coach"]) {
    ids[name.toLowerCase()] = String((await knex("bots").insert({ workspace_id: home.workspaceId, made_by: home.userId, name, color: "#1E86FC" }).returning("id"))[0].id);
  }
  const actor = { type: "person", id: home.userId, name: "Pat" };
  return { knex, home, ids, asked, actor };
}

const versionRow = (knex, id) => knex("app_versions").where({ id }).first("guide", "published_at");

test("saving and publishing keep the version's app guide, and an app chat's turn reads it, never writing it again", async (context) => {
  const { knex, home, actor } = await setup(context);
  const { apps, appBots } = home.apps;
  const { app, errors } = await home.apps.installTemplate(home.ctx(actor), "learn_to_program", {});
  assert.deepEqual(errors, []);
  const draftId = (await knex("apps").where({ id: app.id }).first("draft_version_id")).draft_version_id;
  const drafted = (await versionRow(knex, draftId)).guide;
  assert.ok(drafted.startsWith("# The app guide of \"Learn to program\"\n"), "saving the draft wrote its guide");
  assert.ok(drafted.includes("\n- check (action, a button runs it): Runs the person's code"), "with the draft's scripts");

  await earlierTransactionsEnded(knex);
  await apps.publish(actor, app.slug, {}, home.options);
  const published = await versionRow(knex, draftId);
  assert.ok(published.published_at, "it's the live version now");
  assert.equal(published.guide, drafted, "publishing kept the same guide, with the scripts that went live");

  // A turn reads what's kept: a guide changed in the database comes back as it is, so nothing wrote it per turn.
  await knex("app_versions").where({ id: draftId }).update({ guide: "KEPT GUIDE" });
  const turn = await appBots.forTurn(app.id, home.options);
  const { brief } = JSON.parse(readFileSync(new URL("../../packages/apps/templates/learn_to_program.json", import.meta.url), "utf8")).definition;
  assert.deepEqual(turn, { name: "Learn to program", slug: app.slug, guide: "KEPT GUIDE", brief }, "its brief is its template's");

  // A version from before guides were kept gets one the first time a turn needs it, written once, the same as publishing's.
  await knex("app_versions").where({ id: draftId }).update({ guide: null });
  assert.equal((await appBots.forTurn(app.id, home.options)).guide, drafted);
  assert.equal((await versionRow(knex, draftId)).guide, drafted, "and kept");
});

test("an app's chat is with its own bot, else the home's main bot, and an app without a brief gets one from its name and purpose", async (context) => {
  const { knex, home, ids, asked, actor } = await setup(context);
  const { apps, appBots } = home.apps;
  const { app } = await home.apps.installTemplate(home.ctx(actor), "todos", {});
  await earlierTransactionsEnded(knex);
  await apps.publish(actor, app.slug, {}, home.options);
  const answered = await appBots.botChat(app.slug, home.options);
  assert.deepEqual(answered.bot, { id: ids.otto, name: "Otto", color: "#1E86FC", shape: "cloud" }, "no bot of its own: the main bot");
  assert.deepEqual(asked, [{ appId: app.id, botId: ids.otto, title: app.name }], "the person's chat with it, named after the app");
  const { brief } = await appBots.forTurn(app.id, home.options);
  assert.equal(brief, `You're the bot of the app "${app.name}", which is for this: ${(await import("../../packages/apps/src/server/templates.js")).templateDescription("todos")}. ` +
    "Help the person with what they're doing in it: answer questions about what's on their screen, explain how the app works, and look up or change its records for them when they ask.");

  await knex("apps").where({ id: app.id }).update({ bot_id: ids.coach });
  assert.equal((await appBots.botChat(app.slug, home.options)).bot.name, "Coach", "its own bot");
  ids.coachArchived = true;
  assert.equal((await appBots.botChat(app.slug, home.options)).bot.name, "Otto", "an archived bot gives way to the main bot");

  const view = await apps.createApp(actor, { name: "A view", kind: "view" }, home.options);
  await assert.rejects(appBots.botChat(view.slug, home.options), (error) => error.statusCode === 409 && error.code === "apps_view_refused");
});
