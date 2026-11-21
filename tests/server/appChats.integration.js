import assert from "node:assert/strict";
import test from "node:test";
import { registerRoutes } from "../../packages/apps/src/server/registerRoutes.js";
import { appsHome } from "../support/appsHome.mjs";
import { startBotRecords } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Ask Builder (D-41): an app has one chat with the home's Builder, made the first time anyone asks, Public, named after
// the app, with the Builder and the person who asked in it, and found again after that, also when two pages ask at
// once. It replaces the shared Builder's rooms (builderRooms.integration.js). Through the apps' route as a member's
// request reaches it, on the bots' real records.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("Ask Builder opens the app's one chat with the Builder, made the first time", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const records = await startBotRecords(knex, cleanup);
  const home = await appsHome(cleanup, { slug: "apps-chat", knex, records });
  const { workspaceId, workspace, userId, options, apps: capability } = home;
  const { apps } = capability;
  const person = { type: "person", id: userId, name: "Pat" };
  const [bot] = await knex("bots").insert({ workspace_id: workspaceId, made_by: userId, name: "Bea", color: "#1E86FC" }).returning("id");
  const builderId = String(bot.id ?? bot);
  const app = await apps.createApp(person, { name: "Stock tracker" }, options);

  // The route, as a member's request reaches it.
  const routes = new Map();
  registerRoutes({ router: { register: (method, route, _options, handler) => routes.set(`${method} ${route}`, handler) } },
    { appsRuntime: capability, notices: { subscribe: () => () => {} }, streams: new Set() });
  const ask = async (slug) => {
    const reply = {
      statusCode: 0,
      body: undefined,
      code(status) {
        this.statusCode = status;
        return this;
      },
      send(sent) {
        this.body = sent;
        return this;
      }
    };
    const request = { params: { workspaceSlug: workspace.slug, slug }, body: {}, query: {}, user: { id: userId }, workspace, permissions: [], callOptions: async () => options };
    await routes.get("POST /api/w/:workspaceSlug/apps/:slug/chat")(request, reply);
    return { status: reply.statusCode, body: reply.body };
  };

  // Without a Builder there's no one to ask; an app the home doesn't have is a 404.
  assert.deepEqual((await ask(app.slug)).body.code, "apps_builder_missing");
  await apps.setBuilder(person, builderId, options);
  const missing = await ask("no-such-app");
  assert.deepEqual({ status: missing.status, code: missing.body.code }, { status: 404, code: "apps_app_not_found" });

  // The first ask makes it: Public, named after the app, the Builder and the person in it.
  const first = await ask(app.slug);
  assert.equal(first.status, 200);
  const chat = first.body.chat;
  const stored = await knex("conversations").where({ id: chat.id }).first("kind", "title", "app_id", "workspace_id");
  assert.deepEqual(stored, { kind: "public", title: "Stock tracker", app_id: app.id, workspace_id: String(workspaceId) });
  assert.deepEqual((await knex("chat_bots").where({ conversation_id: chat.id }).pluck("bot_id")).map(String), [builderId]);
  assert.deepEqual((await knex("chat_people").where({ conversation_id: chat.id }).pluck("user_id")).map(String), [userId]);

  // Found again, also when two pages ask at once: one chat per app.
  const [again, twice] = await Promise.all([ask(app.slug), ask(app.id)]);
  assert.deepEqual([again.body.chat.id, twice.body.chat.id], [chat.id, chat.id]);
  assert.equal((await knex("conversations").where({ workspace_id: workspaceId, app_id: app.id })).length, 1);
});
