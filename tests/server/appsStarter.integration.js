import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { createStarterApps } from "../../packages/apps/src/server/starterApps.js";

// Every home gets Contacts and To-dos (D-130), empty and published, the first time its list of apps is read, as its
// sidebar does when it opens: once, whoever asks and however often, and tried again at the next open when adding them
// failed. A home that has them pays one read.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a home's first open adds Contacts and To-dos, live and empty, once, however many pages ask", async (context) => {
  const home = await appsHome(context, { slug: "apps-starter" });
  const { knex, apps: capability, handles, options, userId, workspace } = home;
  const call = home.browser({ member: { userId, workspace } });
  const opened = await call("GET", `/api/w/${workspace.slug}/apps`);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const names = (list) => list.apps.map((app) => app.name).sort();
  assert.deepEqual(names(opened.body), ["Contacts", "To-dos"]);
  for (const app of opened.body.apps) assert.equal((await capability.apps.get(app.slug, {}, options)).definition !== null, true, `${app.name} is live`);
  const tables = (await capability.registry.loadTables(options)).filter((table) => !table.obsolete).map((table) => table.key).sort();
  assert.deepEqual(tables, ["contacts", "departments", "organisations", "todo_lists", "todos"]);
  assert.equal((await capability.gate.read({ options, actor: { type: "person", id: userId } }, "contacts")).total, 0, "empty");

  // Twice, and two pages at once: nothing more, and one read when they're there.
  await Promise.all([call("GET", `/api/w/${workspace.slug}/apps`), call("GET", `/api/w/${workspace.slug}/apps`)]);
  assert.deepEqual(names((await call("GET", `/api/w/${workspace.slug}/apps`)).body), ["Contacts", "To-dos"]);
  const starter = createStarterApps({ appSettings: handles.appSettings, installTemplate: capability.installTemplate, apps: capability.apps });
  assert.equal(await queriesDuring(knex, () => starter.ensure(options)), 1);

});

test("adding them failing never stops the home opening, and they're added at its next open", async (context) => {
  const home = await appsHome(context, { slug: "apps-starter-retry" });
  const { apps: capability, handles, options } = home;
  let broken = true;
  const starter = createStarterApps({
    appSettings: handles.appSettings,
    installTemplate: async (ctx, key) => {
      if (broken) throw new Error("The catalog is down.");
      return capability.installTemplate(ctx, key);
    },
    apps: capability.apps
  });
  await starter.ensure(options);
  assert.equal((await capability.apps.list({}, options)).apps.length, 0);
  broken = false;
  await starter.ensure(options);
  assert.deepEqual((await capability.apps.list({}, options)).apps.map((app) => app.name).sort(), ["Contacts", "To-dos"]);
});

test("a home with an app of a starter's name keeps its own and gets only the other", async (context) => {
  const home = await appsHome(context, { slug: "apps-starter-own" });
  const { apps: capability, handles, options, ctx: ctxOf, userId } = home;
  const person = ctxOf({ type: "person", id: String(userId), name: "Pat" }).actor;
  await capability.apps.createApp(person, { name: "Contacts" }, options);
  const starter = createStarterApps({ appSettings: handles.appSettings, installTemplate: capability.installTemplate, apps: capability.apps });
  await starter.ensure(options);
  assert.deepEqual((await capability.apps.list({}, options)).apps.map((app) => app.name).sort(), ["Contacts", "To-dos"]);
});

test("a home deleted while its starter apps are being added goes, and they stop: the two never deadlock", async (context) => {
  const home = await appsHome(context, { slug: "apps-starter-gone" });
  const { knex, apps: capability, handles, options, workspaceId } = home;
  // Contacts is published with audit_events held by another transaction, so publishing stops part way, just before its
  // audit row (which names the home): its app and draft taken. The home's delete starts then, and the hold ends once the
  // delete waits. Publishing took the app first and the home last, the delete the home first and the app after it, so
  // the two deadlocked and PostgreSQL broke the delete off.
  let held = null;
  const starter = createStarterApps({
    appSettings: handles.appSettings,
    installTemplate: async (ctx, key) => {
      const made = await capability.installTemplate(ctx, key);
      if (!held) {
        held = await knex.transaction();
        await held.raw("LOCK TABLE audit_events IN SHARE MODE");
      }
      return made;
    },
    apps: capability.apps
  });
  const waitingOn = async (statement) => {
    for (const until = Date.now() + 10_000; Date.now() < until;) {
      const { rows: [row] } = await knex.raw(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ?",
        [`${statement}%`]
      );
      if (row.n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`nothing waited on a lock running ${statement}`);
  };
  const adding = starter.ensure(options);
  try {
    await waitingOn('insert into "audit_events"');
    // Started now (a query runs once it's asked for its result), and settled either way, for the assertion below.
    const deleting = knex("workspaces").where({ id: workspaceId }).del().then((count) => ({ count }), (error) => ({ error: error.message }));
    await waitingOn('delete from "workspaces"');
    await held.commit();
    assert.deepEqual(await deleting, { count: 1 }, "the home is deleted");
  } finally {
    if (held && !held.isCompleted()) await held.rollback();
  }
  await adding;
  assert.deepEqual(await knex("apps").where({ workspace_id: workspaceId }).pluck("name"), [], "none of its apps is left");
});
