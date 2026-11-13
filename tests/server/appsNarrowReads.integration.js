import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { buildAppTools } from "../../packages/bots/src/server/appTools.js";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { createViews } from "../../packages/apps/src/server/views.js";

// The apps' reads ask for the rows they use (the read-then-filter sweep): a details page counts only
// its app's tables, the version list pages without definitions, a copy or a view part reads its own
// view, pins read the apps asked for, a button finds its one bot, and the Builder's overview reads apps
// alone.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** The bots' directory over the test's bots (botsOf), counting each read. */
function countedBots(knex) {
  const { directory } = botsOf(knex);
  const calls = { listHomeBots: 0, findBot: 0 };
  const counted = (name) => (...args) => {
    calls[name] += 1;
    return directory[name](...args);
  };
  return { records: { directory: { listHomeBots: counted("listHomeBots"), findBot: counted("findBot") } }, calls };
}

/** `handle` answering as it does, adding the rows its reads answer to `rows[name]`. */
function counted(handle, rows, name) {
  rows[name] = 0;
  const add = (found) => ((rows[name] += found.length), found);
  return {
    ...handle,
    queryAll: async (...args) => add(await handle.queryAll(...args)),
    query: async (...args) => {
      const answer = await handle.query(...args);
      add(answer.records);
      return answer;
    },
    get: async (...args) => {
      const found = await handle.get(...args);
      if (found) rows[name] += 1;
      return found;
    }
  };
}

/**
 * A home with the apps features started (appsHome) and the bots this test makes, and the apps' parts wired on its
 * handles with the apps' and versions' reads counted in `rows`: `parts.apps`, `parts.views`, `parts.runtime`.
 */
async function home(context, slug) {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const bots = countedBots(knex);
  const started = await appsHome(cleanup, { slug, knex, records: bots.records });
  const rows = {};
  const handles = { ...started.handles, apps: counted(started.handles.apps, rows, "apps"), appVersions: counted(started.handles.appVersions, rows, "appVersions") };
  const parts = appsParts({ ...started, handles }, { trustMs: Infinity, records: bots.records });
  const { apps, gate, registry, practices, systemContext } = parts;
  const runtime = createRuntime({ apps, gate, practices, scripts: { functionsFor: async () => null, runNamed: async () => null } });
  const views = createViews({ resources: handles, records: bots.records, systemContext, registry, apps, runtime });
  const person = { type: "person", id: started.userId, name: "Pat" };
  const bot = { type: "bot", id: "1", name: "Otto" };
  const reset = () => Object.keys(rows).forEach((name) => (rows[name] = 0));
  return { ...started, knex, cleanup, bots, rows, reset, parts: { ...parts, runtime, views }, person, ctx: { options: started.options, actor: bot, via: { kind: "chat", botId: "1" } } };
}

const DEALS = { key: "deals", fields: [{ key: "name", type: "text" }, { key: "stage", type: "text" }] };
const viewDefinition = (stage = "Open") => ({
  data: { all: { from: "deals", where: `=stage == "${stage}"` } },
  content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }] }]
});
const saveView = async (h, title, stage) =>
  (await h.parts.views.save(h.ctx, { title, definition: viewDefinition(stage) }, { userId: h.userId, botId: null })).view;

test("an app's details count only the tables it uses; pickers and filters get the tables alone", async (context) => {
  const h = await home(context, "narrow-tables");
  const { registry, apps } = h.apps;
  for (const key of ["deals", "people", "notes"]) await registry.createTable(h.person, { key, fields: [{ key: "name", type: "text" }] }, h.options);
  const crm = await apps.createApp(h.person, { name: "CRM" }, h.options);
  const screen = { data: { all: { from: "deals" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }] }] };
  assert.deepEqual((await apps.saveDraft(h.person, crm.slug, { home: "main", screens: { main: screen } }, "", h.options)).errors, []);
  const call = h.browser({ member: { userId: h.userId, workspace: h.workspace } });
  const tables = async (query) => {
    let answer = null;
    const counts = await queriesDuring(h.knex, async () => (answer = await call("GET", `/api/w/${h.workspace.slug}/app-data/tables${query}`)), { matching: /count\(\*\)/iu });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return { tables: answer.body.tables, counts };
  };

  const every = await tables("");
  assert.deepEqual(every.tables.map((table) => table.key).sort(), ["deals", "notes", "people"]);
  const one = await tables(`?app=${crm.id}`);
  assert.deepEqual(one.tables.map((table) => [table.key, table.count, table.usedBy.map((app) => app.name)]), [["deals", 0, ["CRM"]]]);
  assert.ok(one.counts >= 1, "the app's table is counted");
  assert.equal(one.counts * 3, every.counts, `one table counted, not three (${one.counts} of ${every.counts} counts)`);
  const brief = await tables("?brief=true");
  assert.deepEqual(brief.tables.map((table) => table.key).sort(), ["deals", "notes", "people"]);
  assert.equal(brief.counts, 0, "nothing is counted for a picker");
  assert.ok(brief.tables.every((table) => !("count" in table) && !("usedBy" in table)), "nor is any app read");
});

test("an app's versions come 50 at a time, newest first, without their definitions", async (context) => {
  const h = await home(context, "narrow-versions");
  const { apps } = h.apps;
  const app = await apps.createApp(h.person, { name: "Big" }, h.options);
  const heavy = { home: "main", screens: { main: { content: [{ type: "text", value: "x".repeat(20000) }] } } };
  await h.handles.apps.withTransaction(h.options, async (txOptions) => {
    for (let number = 1; number <= 55; number += 1) await apps.addVersion(app, h.person, heavy, `Version ${number}`, "builder", txOptions);
  });
  const call = h.browser({ member: { userId: h.userId, workspace: h.workspace } });
  const versions = async (query = "") => {
    const answer = await call("GET", `/api/w/${h.workspace.slug}/apps/${app.slug}/versions${query}`);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return answer.body;
  };

  let first = null;
  const statements = await statementsDuring(h.knex, async () => (first = await versions()), /from "app_versions"/u);
  assert.equal(first.versions.length, 50, "one page");
  assert.deepEqual(first.versions.slice(0, 2).map((version) => [version.number, version.summary, version.live]), [[55, "Version 55", true], [54, "Version 54", false]]);
  assert.equal(first.more, true);
  assert.ok(statements.length && statements.every((statement) => !statement.sql.includes('"definition"')), "no definition is read");

  const rest = await versions(`?before=${first.versions.at(-1).id}`);
  assert.deepEqual(rest.versions.map((version) => version.number), [5, 4, 3, 2, 1]);
  assert.equal(rest.more, false);
});

/** A home with a deals table and five views, the first two `kept` and `shown`. */
async function viewsHome(context, slug) {
  const h = await home(context, slug);
  await h.apps.registry.createTable(h.person, DEALS, h.options);
  const kept = await saveView(h, "Kept", "Open");
  const shown = await saveView(h, "Shown", "Won");
  for (const name of ["One", "Two", "Three"]) await saveView(h, name, name);
  return { h, kept, shown };
}

/** A published app of one screen whose content is `content`. */
async function publishedApp(h, name, content) {
  const { apps } = h.parts;
  const app = await apps.createApp(h.person, { name }, h.options);
  assert.deepEqual((await apps.saveDraft(h.person, app.slug, { home: "main", screens: { main: { content } } }, "", h.options)).errors, []);
  await apps.publish(h.person, app.slug, {}, h.options);
  return app;
}

test("a copy's update is found and taken from the copied view alone", async (context) => {
  const { h, kept } = await viewsHome(context, "narrow-copies");
  const { apps, views } = h.parts;
  const keeps = await publishedApp(h, "Keeps", [{ type: "view", view: kept.key, copy: true }]);
  await views.save(h.ctx, { view: kept.key, title: "Kept", definition: viewDefinition("Won") }, { userId: h.userId });

  // The app's page offers the copy's update, from the one view it copied.
  const { definition } = await apps.get(keeps.slug, {}, h.options);
  h.reset();
  const screen = `view-${kept.key}`;
  assert.deepEqual(await views.copyUpdates(definition, h.options), [{ screen, view: kept.key, title: "Kept", from: 1, to: 2 }]);
  assert.deepEqual([h.rows.apps, h.rows.appVersions], [1, 1], "the copied view and its live version, of five views");

  // Taking the update reads every view once, for the draft's save check, and the copied one beside it.
  const updated = async () => {
    h.reset();
    await views.updateCopy(h.person, keeps.slug, screen, h.options);
    return h.rows.apps + h.rows.appVersions;
  };
  const withFive = await updated();
  for (const name of ["Four", "Five", "Six"]) await saveView(h, name, name);
  const withEight = await updated();
  assert.ok(withEight - withFive <= 3 * 2, `each view adds its row and live version to the save check alone (${withFive} → ${withEight} rows)`);
  assert.equal((await apps.get(keeps.slug, { version: "draft" }, h.options)).definition.screens[screen].copiedFrom.version, 2);
});

test("an app that shows a view names it from that view's row alone", async (context) => {
  const { h, shown } = await viewsHome(context, "narrow-shows");
  const shows = await publishedApp(h, "Shows", [{ type: "view", view: shown.key }]);
  h.reset();
  const live = await h.parts.apps.get(shows.slug, {}, h.options);
  assert.equal(live.definition.screens.main.content[0].view, shown.key);
  assert.equal(h.rows.apps, 2, "the app and the view it shows, of five views");
});

test("saving pins reads only the apps asked for", async (context) => {
  const h = await home(context, "narrow-pins");
  const { apps } = h.parts;
  const made = [];
  for (const name of ["One", "Two", "Three", "Four", "Five", "Six"]) made.push(await apps.createApp(h.person, { name }, h.options));
  h.reset();
  assert.deepEqual(await apps.setPins([made[2].id, "a_nope", made[2].id, 7], h.options), [made[2].id]);
  assert.equal(h.rows.apps, 1, "the one real app asked for, of six");
  assert.deepEqual((await apps.list({}, h.options)).pins, [made[2].id]);
});

test("a view part reads the view's screen, tables and style alone", async (context) => {
  const h = await home(context, "narrow-part");
  const { apps, views } = h.apps;
  await h.apps.registry.createTable(h.person, DEALS, h.options);
  const { view } = await views.save(h.ctx, { title: "Open deals", definition: viewDefinition() }, { userId: h.userId, botId: null });
  const call = h.browser({ member: { userId: h.userId, workspace: h.workspace } });
  const base = `/api/w/${h.workspace.slug}/apps`;

  const before = { ...h.bots.calls };
  let part = null;
  const partReads = await queriesDuring(h.knex, async () => (part = await call("GET", `${base}/${view.key}/part`)));
  assert.equal(part.status, 200, JSON.stringify(part.body));
  assert.deepEqual(Object.keys(part.body).sort(), ["app", "screen", "style", "tables"]);
  assert.equal(part.body.app.slug, view.key);
  assert.equal(part.body.screen.content[0].type, "table");
  assert.deepEqual(part.body.tables.map((table) => table.key), ["deals"]);
  assert.deepEqual(h.bots.calls, before, "no bot is read");
  const fullReads = await queriesDuring(h.knex, () => call("GET", `${base}/${view.key}`));
  assert.ok(partReads < fullReads, `fewer reads than the app's page (${partReads} against ${fullReads})`);

  const app = await apps.createApp(h.person, { name: "Not a view" }, h.options);
  assert.equal((await call("GET", `${base}/${app.slug}/part`)).status, 404, "an app is no view part");
  assert.equal((await call("GET", `${base}/nothing-here/part`)).status, 404);
});

test("a button finds its one bot without listing the home's bots", async (context) => {
  const h = await home(context, "narrow-bots");
  const { knex, userId, workspaceId, options } = h;
  const made = await knex("bots").insert(Array.from({ length: 12 }, (_, index) => ({ user_id: userId, workspace_id: workspaceId, name: `Bot ${index}`, color: "#1E86FC" }))).returning("id");
  const otto = String(made[7].id ?? made[7]);
  h.cleanup.after(() => knex("bots").whereIn("id", made.map((row) => row.id ?? row)).del());
  const { registry, gate, apps, runtime } = h.apps;
  await registry.createTable(h.person, { key: "companies", fields: [{ key: "name", type: "text", required: true }] }, options);
  const acme = await gate.create({ options, actor: h.person, via: {} }, "companies", { name: "Acme" });
  await apps.createApp(h.person, { name: "Companies" }, options);
  const definition = {
    home: "list",
    screens: { list: { data: { all: { from: "companies" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }], rowActions: [{ type: "button", label: "Research", do: [{ askBot: { bot: "Bot 7", task: '="Research " + row.name' } }] }] }] } }
  };
  assert.deepEqual((await apps.saveDraft(h.person, "companies", definition, "v1", options)).errors, []);
  await apps.publish(h.person, "companies", {}, options);

  const listed = h.bots.calls.listHomeBots;
  const sent = await runtime.action({ options, userId, actor: h.person }, { slug: "companies", screen: "list", path: "content/0/rowActions/0/do", row: acme.id });
  assert.deepEqual(sent.effects, [{ notify: "Sent to Bot 7" }]);
  assert.equal(h.bots.calls.listHomeBots, listed, "the home's bots aren't listed to find one");
  assert.equal(String((await knex("app_jobs").where({ workspace_id: workspaceId }).first()).bot_id), otto);
});

test("the Builder's overview reads the apps without the views", async (context) => {
  const h = await home(context, "narrow-overview");
  const { userId, options } = h;
  await h.apps.apps.createApp(h.person, { name: "Companies" }, options);
  for (const title of ["A view", "Another view"]) {
    await h.apps.views.save(h.ctx, { title, definition: { content: [{ type: "text", value: "Hello" }] } }, { userId, botId: null });
  }
  const builder = buildAppTools({
    apps: { ...h.apps, apps: h.parts.apps },
    directory: h.bots.records.directory,
    call: options,
    botId: "1",
    conversationId: null,
    userId: null,
    isBuilder: true,
    after: [],
    attempted: [],
    via: null
  });
  h.reset();
  const overview = await builder.appsOverview.execute({}, {});
  assert.deepEqual(overview.apps.map((app) => app.name), ["Companies"]);
  assert.equal(h.rows.apps, 1, "the one app, not the two views");
});
