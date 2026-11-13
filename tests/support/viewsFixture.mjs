import { connectTestDatabase } from "./testDatabase.mjs";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { createViews } from "../../packages/apps/src/server/views.js";
import { appsHome, appsParts, botsOf } from "./appsHome.mjs";
import { cleanupStack } from "./cleanupStack.mjs";

const { tenantOf } = anyapiTestables;
const afterAll = new WeakMap();

/** A person's home on the test database, removed afterwards: its id. */
export async function makeHome(knex, name = "views") {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = (await knex("users").orderBy("id").first("id")).id;
  const [home] = await knex("workspaces").insert({ slug: `${name}-${stamp}`, name, owner_user_id: owner, is_personal: false }).returning("id");
  const id = String(home.id ?? home);
  afterAll.get(knex).push(async () => {
    await knex("any_records").where({ tenant_id: tenantOf(id) }).del();
    await knex("any_resource_configs").where({ tenant_id: tenantOf(id) }).del();
    await knex("workspaces").where({ id }).del();
  });
  return id;
}

/**
 * Everything views stand on, for one home: the apps features started as the server starts them (appsHome), with
 * views, the gate and the runtime wired on their handles as the server wires them, except that the registry trusts
 * its cached tables for good (only the work's own queries are counted here; appsRegistry checks the refresh) and no
 * scripts run. Calls are the maker's: `options` are their request's in the home and `ctx` the bot's gate ctx there.
 * `optionsIn(homeId, userId)` are a person's request options in another home (makeHome); `person(userId)` is a
 * person as views.retire and bringBack take them, with their own `options` in the home.
 */
export async function viewsFixture(context) {
  const knex = await connectTestDatabase();
  const users = await knex("users").orderBy("id").limit(2).pluck("id");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const other = String(users[1] ?? (await knex("users").insert({ auth_provider: "test", auth_provider_user_sid: `views-${stamp}`, email: `views-${stamp}@example.com`, username: `views-${stamp}`, display_name: "Other", email_normalized: `views-${stamp}@example.com` }).returning("id"))[0].id);
  // Newest first: appsHome's cleanup (the features, its home), then the other homes, then the connection they all
  // need.
  afterAll.set(knex, []);
  const cleanup = cleanupStack(context);
  cleanup.after(async () => {
    for (const cleanUp of afterAll.get(knex)) await cleanUp();
    await knex.destroy();
  });
  // The bots a test makes on the database are the home's bots (a view's maker, its details).
  const records = botsOf(knex);
  const home = await appsHome(cleanup, { slug: "views", knex, records });
  const { notices, workspaceId, options } = home;
  const { resources, registry, gate, apps, practices, systemContext } = appsParts(home, { trustMs: Infinity, notices, records });
  const runtime = createRuntime({ apps, gate, practices, scripts: { functionsFor: async () => null, runNamed: async () => null } });
  const views = createViews({ resources, records, systemContext, registry, apps, runtime });
  const bot = { type: "bot", id: "1", name: "Otto" };
  const ctx = { options, actor: bot, via: { kind: "chat", botId: "1" } };
  const optionsIn = (homeId, userId = home.userId) => home.memberOptions(userId, { id: homeId });
  const person = (userId, canManage = false) => ({
    userId,
    canManage,
    actor: { type: "person", id: String(userId), name: "Someone" },
    options: optionsIn(workspaceId, userId)
  });
  const whenDone = (cleanUp) => afterAll.get(knex).push(cleanUp);
  return { knex, notices, registry, gate, apps, runtime, views, ctx, options, optionsIn, workspaceId, maker: home.userId, other, person, bot, whenDone };
}

/** A table's new record by field names. */
export async function addRecord(f, tableKey, values) {
  const table = (await f.registry.loadTables(f.ctx.options)).find((entry) => entry.key === tableKey);
  const byId = Object.fromEntries(Object.entries(values).map(([key, value]) => [table.fields.find((field) => field.key === key).id, value]));
  return f.gate.create(f.ctx, tableKey, byId);
}
