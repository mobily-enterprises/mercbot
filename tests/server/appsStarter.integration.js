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
