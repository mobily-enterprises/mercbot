import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";

// An app's scripts message a person in their own chat with the app's bot (D-147), on the test database: a job's or a
// button's chat.tell(person, text) goes to that person of the home, as the app's bot (its own, else the home's main
// bot), at most 20 a day to one person from one app, never from a public app's visitor's run, and only pretends in a
// draft's preview. Each is in the app's activity. The bots' part (posting it in the chat) is a stand-in here;
// appTellChats.integration.js has the real one.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context) {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-tell" });
  const owner = { type: "person", id: String(home.userId), name: "Pat" };
  const told = [];
  const bots = {
    members: async () => [String(home.userId), "8"],
    tellPerson: async (_call, message) => (told.push(message), "500")
  };
  const bot = async (name) => String((await home.knex("bots").insert({ workspace_id: home.workspaceId, made_by: home.userId, name, color: "#1E86FC" }).returning("id"))[0].id);
  const [otto, coach] = [await bot("Otto"), await bot("Coach")];
  const faces = [{ id: otto, name: "Otto", main: true, archived: false }, { id: coach, name: "Coach", main: false, archived: false }];
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = appsParts(home, { trustMs: Infinity, beforeSave: (...args) => scripts.beforeSave(...args) });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => faces, connected: () => bots });
  cleanup.after(() => scripts.close());
  const app = await apps.createApp(owner, { name: "Learn" }, home.options);
  await home.knex("apps").where({ id: app.id }).update({ bot_id: coach });
  const ctx = { ...home.ctx(owner), via: { kind: "script", appId: app.id, script: "x" } };
  const code = async (work) => (await work.catch((error) => error)).code;
  return { home, owner, told, scripts, apps, app, ctx, code, coach };
}

test("a job's chat.tell messages a person of the home in their own chat with the app's bot", async (context) => {
  const { home, owner, told, scripts, apps, app, coach } = await setup(context);
  const job = `async function main() {
    await chat.tell("${home.userId}", "Lesson 4 is ready: open it when you like.");
    return {};
  }`;
  assert.deepEqual((await scripts.save(owner, app.slug, {
    key: "ready", kind: "job", summary: "Says a lesson is ready", settings: { every: "day", at: "07:00" }, code: job,
    tests: [{ name: "tells", input: {}, chat: { tell: { told: true } }, expect: {} }]
  }, home.options)).errors, []);
  await apps.saveDraft(owner, app.slug, { home: "main", screens: { main: { content: [{ type: "text", value: "Hi" }] } } }, "First", home.options);
  await apps.publish(owner, app.slug, {}, home.options);
  await home.knex("app_scripts").where({ key: "ready", draft: false }).update({ next_run_at: new Date(Date.now() - 1000) });
  await scripts.runDue({ matchChanges: async () => [] });
  assert.deepEqual(told, [{ appId: app.id, title: "Learn", botId: coach, userId: String(home.userId), text: "Lesson 4 is ready: open it when you like." }], "once, as the app's own bot");
  const activity = await home.knex("audit_events").where({ workspace_id: home.workspaceId, action: "sent" }).first("changes");
  assert.deepEqual(activity.changes, { sent: { app: "Learn", kind: "message", to: 1 } });
});

test("chat.tell goes to someone in the home, in 1 to 2,000 characters, at most 20 a day to one person from one app", async (context) => {
  const { told, scripts, app, ctx, code } = await setup(context);
  const { sending } = scripts;
  assert.equal(await code(sending.tellFromRun(ctx, app.id, ["99", "Hi"])), "apps_tell_invalid", "not in the home");
  assert.equal(await code(sending.tellFromRun(ctx, app.id, ["8", ""])), "apps_tell_invalid", "nothing to say");
  assert.equal(await code(sending.tellFromRun(ctx, app.id, ["8", "x".repeat(2001)])), "apps_tell_invalid", "too long");
  for (let at = 1; at <= 20; at += 1) await sending.tellFromRun(ctx, app.id, ["8", `Message ${at}`]);
  assert.equal(await code(sending.tellFromRun(ctx, app.id, ["8", "One more"])), "apps_send_limit", "the 21st to one person today");
  await sending.tellFromRun(ctx, app.id, [ctx.actor.id, "Another person still hears"]);
  assert.equal(told.length, 21);
});

test("chat.tell is never a public app's visitor's, and only pretends in a draft's preview", async (context) => {
  const { told, scripts, app, ctx, code } = await setup(context);
  assert.equal(await code(scripts.sending.tellFromRun({ ...ctx, visitor: { email: "v@example.com" } }, app.id, ["8", "Hi"])), "apps_tell_visitor");
  const practice = { simulated: [] };
  assert.deepEqual(await scripts.sending.tellFromRun({ ...ctx, practice }, app.id, ["8", "Hi"]), { simulated: true });
  assert.deepEqual(practice.simulated, [{ sent: { kind: "message" }, script: "x" }]);
  assert.deepEqual(told, []);
});
