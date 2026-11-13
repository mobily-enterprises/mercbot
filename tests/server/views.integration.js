import assert from "node:assert/strict";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { addRecord, viewsFixture } from "../support/viewsFixture.mjs";
import { buildViewTools } from "../../packages/bots/src/server/viewTools.js";

// Views (D-55): saved at once as the next live version, seen by everyone in the home (D-66), never
// writing; apps share one or keep a copy; every committed write tells open views.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function fixture(context) {
  const f = await viewsFixture(context);
  await f.registry.createTable(f.bot, {
    key: "deals",
    fields: [{ key: "name", type: "text" }, { key: "stage", type: "text" }, { key: "value", type: "number" }]
  }, f.options);
  await addRecord(f, "deals", { name: "Big", stage: "Open", value: 100 });
  await addRecord(f, "deals", { name: "Small", stage: "Open", value: 10 });
  await addRecord(f, "deals", { name: "Mid", stage: "Won", value: 50 });
  return f;
}

function byName(tables, values) {
  const table = tables.find((entry) => entry.key === "deals");
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [table.fields.find((field) => field.key === key).id, value]));
}

const definition = (kind = "bar") => ({
  data: {
    byStage: { from: "deals", groupBy: "stage", sum: "value", grandTotal: true },
    biggest: { from: "deals", sort: "-value", limit: 2 }
  },
  content: [
    { type: "chart", kind, rows: "=data.byStage", measure: "total" },
    { type: "table", rows: "=data.biggest", columns: [{ label: "Deal", value: "=row.name" }] }
  ]
});

test("a bot's view is saved at once, live, in versions people restore; it never writes", async (context) => {
  const f = await fixture(context);
  const made = await f.views.save(f.ctx, { title: "Deals", summary: "Open deals", definition: definition() }, { userId: f.maker, botId: null });
  assert.deepEqual(made.errors, []);
  assert.deepEqual(made.problems, [], "the self-check found its data loads");
  const key = made.view.key;
  assert.equal("shared" in made.view, false, "there is nothing to share: every view is the home's");

  const asked = (query) => f.runtime.query(f.ctx, { slug: key, screen: "main", query });
  const totals = await asked("byStage");
  assert.equal(totals.grandTotal.total, 160, "the total is across every group");
  assert.equal(totals.grandTotal.count, 3);
  const biggest = await asked("biggest");
  assert.equal(biggest.records.length, 2, "the limit holds");
  assert.equal(biggest.records[0].name, "Big");

  // Live: the same query shows what changed, with no new version.
  await f.gate.create(f.ctx, "deals", byName(await f.registry.loadTables(f.options), { name: "Huge", stage: "Open", value: 900 }));
  assert.equal((await asked("biggest")).records[0].name, "Huge");

  const changed = await f.views.save(f.ctx, { view: key, title: "Deals by stage", summary: "As a pie", definition: definition("pie") }, { userId: f.maker });
  assert.equal(changed.view.key, key, "editing keeps one view");
  assert.equal(changed.view.version, 2);
  assert.equal((await f.views.get(key, f.options)).definition.content[0].kind, "pie");
  assert.equal((await f.apps.find(key, f.options)).name, "Deals by stage");

  const { versions } = await f.apps.versions(key, {}, f.options);
  assert.equal(versions.length, 2);
  const maker = f.person(f.maker);
  await f.views.restore(maker.actor, key, versions.at(-1).id, maker.options);
  assert.equal((await f.views.get(key, f.options)).definition.content[0].kind, "bar");

  await assert.rejects(f.runtime.action(f.ctx, { slug: key, screen: "main", path: "content/0/do" }), { code: "apps_view_read_only" });
  await assert.rejects(f.apps.saveDraft(f.ctx.actor, key, {}, "", f.options), { code: "apps_view_refused" });
  await assert.rejects(f.apps.publish(f.ctx.actor, key, {}, f.options), { code: "apps_view_refused" });
  await assert.rejects(f.apps.setPublic(f.ctx.actor, key, true, f.options), { code: "apps_view_refused" });

  const refused = await f.views.save(f.ctx, { title: "Nope", definition: { data: {}, content: [{ type: "button", label: "Go", do: [] }] } }, { userId: f.maker });
  assert.deepEqual(refused.errors.map((error) => error.path), ["content[0]"]);
  assert.equal((await f.views.list(f.options)).length, 1, "a refused view makes nothing");
});

test("the bots' list of views costs the same for 2 views as for 12", async (context) => {
  const f = await fixture(context);
  const listed = async () => {
    let views = [];
    const queries = await queriesDuring(f.knex, async () => { views = await f.views.list(f.options); });
    return { views, queries };
  };
  for (let index = 0; index < 2; index += 1) {
    await f.views.save(f.ctx, { title: `Deals ${index}`, summary: `Summary ${index}`, definition: definition() }, { userId: f.maker, botId: null });
  }
  const few = await listed();
  for (let index = 2; index < 12; index += 1) {
    await f.views.save(f.ctx, { title: `Deals ${index}`, summary: `Summary ${index}`, definition: definition() }, { userId: f.maker, botId: null });
  }
  const many = await listed();
  assert.equal(many.views.length, 12);
  assert.deepEqual(many.views[0], { view: many.views[0].view, title: "Deals 0", summary: "Summary 0", params: [] });
  assert.equal(many.queries, few.queries, `12 views took ${many.queries} queries, 2 took ${few.queries}`);
});

test("every view is the home's from the start, and anyone in it retires one or brings it back", async (context) => {
  const f = await fixture(context);
  const { view } = await f.views.save(f.ctx, { title: "Mine", definition: definition() }, { userId: f.maker });
  const maker = f.person(f.maker);
  const other = f.person(f.other);
  assert.deepEqual((await f.views.list(other.options)).map((entry) => entry.view), [view.key], "another member's bot sees it");
  assert.equal((await f.views.get(view.key, f.options)).title, "Mine");
  assert.deepEqual((await f.apps.list({}, other.options)).apps.map((app) => app.slug), [view.key], "so does the member, in the Apps area");
  assert.equal("access" in (await f.apps.list({}, other.options)).apps[0], false, "no answer says who may see it");
  const theirs = await f.views.save(f.ctx, { view: view.key, title: "Mine", summary: "Changed by another", definition: definition() }, { userId: f.other });
  assert.deepEqual(theirs.errors, [], "another member's bot changes it like its maker's");

  // A view kept to its maker before D-66 is the home's too: its old access is no longer read.
  await f.knex("apps").where({ workspace_id: f.workspaceId, slug: view.key }).update({ access: "members" });
  assert.equal((await f.views.list(f.options)).length, 1);
  assert.equal((await f.apps.list({}, other.options)).apps.length, 1);

  // Retired, never deleted (D-62): gone from every list and lookup, with its row, versions and key kept.
  await f.apps.setPins([(await f.apps.find(view.key, maker.options)).id], maker.options);
  await f.views.retire(other, view.key, other.options);
  await assert.rejects(f.apps.find(view.key, f.options), { code: "apps_app_not_found" });
  await assert.rejects(f.views.retire(maker, view.key, maker.options), { code: "apps_view_not_found" });
  assert.ok(!(await f.views.list(f.options)).some((entry) => entry.view === view.key));
  assert.deepEqual((await f.apps.list({}, maker.options)).pins, [], "it leaves the pins");
  const kept = await f.knex("apps").where({ workspace_id: f.workspaceId, slug: view.key }).first();
  assert.ok(kept.retired_at, "the row stays");
  assert.ok((await f.knex("app_versions").where({ app_id: kept.id }).count("* as n").first()).n > 0, "and its versions");
  const again = await f.views.save(f.ctx, { title: view.title, definition: definition() }, { userId: f.maker });
  assert.notEqual(again.view.key, view.key, "its key is never given to another view");

  const audited = await f.knex("audit_events").where({ workspace_id: f.workspaceId }).whereRaw("changes \\? 'retiredView'").first();
  assert.equal(audited.actor.id, String(f.other), "who retired it is in the Activity");

  // Brought back as it was, by anyone in the home; a name now taken gets the next free one.
  assert.deepEqual((await f.views.retired(f.options)).map((entry) => entry.view), [view.key], "everyone sees it to bring back");
  const back = await f.views.bringBack(maker, view.key, maker.options);
  assert.deepEqual(back, { view: view.key, title: `${view.title} (2)`, renamed: true }, "another view has its name now");
  assert.equal((await f.apps.find(view.key, f.options)).name, `${view.title} (2)`);
  assert.equal(String((await f.apps.find(view.key, f.options)).liveVersionId), String(kept.live_version_id), "as it was, with its versions");
  assert.deepEqual(await f.views.retired(f.options), []);
  await assert.rejects(f.views.bringBack(maker, view.key, maker.options), { code: "apps_view_not_found" }, "only a retired view comes back");
  await f.views.retire(maker, again.view.key, maker.options);
  await f.views.retire(maker, view.key, maker.options);
  assert.equal((await f.views.bringBack(maker, again.view.key, maker.options)).renamed, false, "a free name stays as it was");
});

test("renaming a field shows in a view with no new version; removing it gives a new version", async (context) => {
  const f = await fixture(context);
  const { view } = await f.views.save(f.ctx, { title: "Deals", definition: definition() }, { userId: f.maker });
  const tables = await f.registry.loadTables(f.options);
  const stage = tables[0].fields.find((field) => field.key === "stage");
  await f.registry.renameField(f.ctx.actor, stage.id, { key: "phase" }, f.options);
  const renamed = await f.views.get(view.key, f.options);
  assert.equal(renamed.definition.data.byStage.groupBy, "phase");
  assert.equal(renamed.version, 1);

  const impact = await f.apps.fieldImpact(stage.id, f.options);
  assert.deepEqual(impact.uses.map((use) => use.slug), [view.key], "the impact dialog lists the view");
  await f.apps.removeField(f.ctx.actor, stage.id, f.options);
  const removed = await f.views.get(view.key, f.options);
  assert.equal(removed.version, 2);
  assert.equal(removed.definition.data.byStage, undefined);
  assert.equal((await f.runtime.query(f.ctx, { slug: view.key, screen: "main", query: "biggest" })).records.length, 2, "it still opens");
});

test("an app shares a view: the view's change shows, and the view is protected while shared", async (context) => {
  const f = await fixture(context);
  const { view } = await f.views.save(f.ctx, { title: "Deals", definition: { ...definition(), params: { stage: {} } } }, { userId: f.maker });
  const maker = f.person(f.maker);
  const crm = await f.apps.createApp(f.ctx.actor, { name: "CRM" }, f.options);
  const app = (key = view.key) => ({ home: "main", screens: { main: { params: { id: {} }, content: [{ type: "view", view: key, params: { stage: "=params.id" } }] } } });

  assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, crm.slug, app(), "", f.options)).errors, [], "a view made in someone's own chat is usable at once");
  const draft = await f.apps.get(crm.slug, { version: "draft" }, f.options);
  assert.equal(draft.definition.screens.main.content[0].view, view.key, "shown by key");
  const stored = await f.knex("app_versions").where({ id: draft.version.id }).first();
  assert.equal(stored.definition.screens.main.content[0].view, (await f.apps.find(view.key, f.options)).id, "stored by id");

  // A new title reaches the app without touching it.
  const titled = await f.views.save(f.ctx, { view: view.key, title: "Renamed", definition: { ...definition(), params: { stage: {} } } }, { userId: f.maker, isBuilder: true });
  assert.deepEqual(titled.errors, []);
  assert.equal((await f.apps.get(crm.slug, { version: "draft" }, f.options)).definition.screens.main.content[0].view, view.key);

  const notBuilder = await f.views.save(f.ctx, { view: view.key, title: "Mine now", definition: { ...definition(), params: { stage: {} } } }, { userId: f.maker });
  assert.match(notBuilder.errors[0].message, /Only the Builder/u);
  const newParams = await f.views.save(f.ctx, { view: view.key, title: "Deals", definition: definition() }, { userId: f.maker, isBuilder: true });
  assert.match(newParams.errors[0].message, /parameters can't change/u);
  await assert.rejects(f.views.retire(maker, view.key, maker.options), { code: "apps_view_in_use" });
});

test("two apps sharing a view both get its change, and a refusal names them both", async (context) => {
  const f = await fixture(context);
  const { view } = await f.views.save(f.ctx, { title: "Deals", definition: definition() }, { userId: f.maker });
  const screen = { home: "main", screens: { main: { content: [{ type: "view", view: view.key }] } } };
  for (const name of ["CRM", "Sales desk"]) {
    const app = await f.apps.createApp(f.ctx.actor, { name }, f.options);
    assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, app.slug, screen, "", f.options)).errors, []);
    await f.apps.publish(f.ctx.actor, app.slug, {}, f.options);
  }
  const refused = await f.views.save(f.ctx, { view: view.key, title: "Deals", definition: definition("pie") }, { userId: f.maker });
  assert.match(refused.errors[0].message, /CRM/u);
  assert.match(refused.errors[0].message, /Sales desk/u);

  const changed = await f.views.save(f.ctx, { view: view.key, title: "Deals", definition: definition("pie") }, { userId: f.maker, isBuilder: true });
  assert.equal(changed.view.version, 2);
  const live = await f.views.get(view.key, f.options);
  assert.equal(live.definition.content[0].kind, "pie");
  const slugs = await f.knex("apps").where({ workspace_id: f.workspaceId, kind: "app" }).whereIn("name", ["CRM", "Sales desk"]).pluck("slug");
  assert.equal(slugs.length, 2);
  for (const slug of slugs) {
    const { definition: shown } = await f.apps.get(slug, { version: "live" }, f.options);
    assert.equal(shown.screens.main.content[0].view, view.key, "each app shows the view itself, so the change is already there");
  }
});

test("an app keeps a copy: it stays through Draft and Publish, and is offered the newer version", async (context) => {
  const f = await fixture(context);
  const { view } = await f.views.save(f.ctx, { title: "Deals", definition: definition() }, { userId: f.maker });
  const crm = await f.apps.createApp(f.ctx.actor, { name: "CRM" }, f.options);
  const app = { home: "main", screens: { main: { content: [{ type: "view", view: view.key, copy: true }] } } };
  assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, crm.slug, app, "", f.options)).errors, []);
  await f.apps.publish(f.ctx.actor, crm.slug, {}, f.options);
  const screen = `view-${view.key}`;
  const chart = async (version) => (await f.apps.get(crm.slug, { version }, f.options)).definition.screens[screen].content[0].kind;
  assert.equal(await chart("live"), "bar");
  assert.equal((await f.runtime.query(f.ctx, { slug: crm.slug, screen, query: "biggest" })).records.length, 2, "it runs as the app's own screen");

  // A copy doesn't hold its original back.
  const changed = await f.views.save(f.ctx, { view: view.key, title: "Deals", definition: definition("pie") }, { userId: f.maker });
  assert.deepEqual(changed.errors, []);
  assert.deepEqual(changed.copies, ["CRM"], "whoever changes the view hears which apps hold a copy");
  assert.equal(await chart("live"), "bar", "the copy stays as it was");

  const { definition: live } = await f.apps.get(crm.slug, {}, f.options);
  assert.deepEqual(await f.views.copyUpdates(live, f.options), [{ screen, view: view.key, title: "Deals", from: 1, to: 2 }]);
  await f.views.updateCopy(f.ctx.actor, crm.slug, screen, f.options);
  assert.equal(await chart("live"), "bar", "the update waits for Publish");
  assert.equal(await chart("draft"), "pie");
  await f.apps.publish(f.ctx.actor, crm.slug, {}, f.options);
  assert.equal(await chart("live"), "pie");
  assert.deepEqual(await f.views.copyUpdates((await f.apps.get(crm.slug, {}, f.options)).definition, f.options), []);

  // A copy outlives its original, which is retired, never deleted (D-62).
  const maker = f.person(f.maker);
  await f.views.retire(maker, view.key, maker.options);
  const gone = await f.apps.get(crm.slug, {}, f.options);
  assert.equal(gone.definition.screens[screen].copiedFrom.view, view.key, "it still says where it came from");
  assert.deepEqual(await f.views.copyUpdates(gone.definition, f.options), []);
  assert.equal(await chart("live"), "pie");
});

test("every committed write tells open views, once; a rolled-back one never does", async (context) => {
  const f = await fixture(context);
  const heard = [];
  f.notices.subscribe("apps-data", f.workspaceId, (event) => heard.push(event));
  // The listener connects in the background; an ordinary notice proves it's there.
  let ready = false;
  f.notices.subscribe("views-test", f.workspaceId, () => (ready = true));
  for (let tries = 0; tries < 50 && !ready; tries += 1) {
    await f.notices.publish("views-test", f.workspaceId, {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "the notices connection listens");
  // The fixture's own writes arrive first; notices come in order, so that's all of them.
  heard.length = 0;
  // PostgreSQL delivers notices in commit order, so once a marker sent after the work has arrived,
  // every notice the work's commits sent has arrived too.
  const settle = async () => {
    const arrived = new Promise((resolve) => {
      const stop = f.notices.subscribe("views-test", f.workspaceId, () => {
        stop();
        resolve();
      });
    });
    await f.notices.publish("views-test", f.workspaceId, {});
    await arrived;
  };
  const tables = await f.registry.loadTables(f.options);
  const tableId = tables[0].id;

  const created = await f.gate.create(f.ctx, "deals", byName(tables, { name: "New", stage: "Open", value: 1 }));
  await settle();
  assert.deepEqual(heard, [{ tables: [tableId] }]);

  heard.length = 0;
  await f.gate.update(f.ctx, "deals", created.id, byName(tables, { name: "Newer" }));
  await settle();
  assert.deepEqual(heard, [{ tables: [tableId] }]);

  heard.length = 0;
  await assert.rejects(f.gate.withTransaction(f.ctx, async (txOptions) => {
    await f.gate.create(f.ctx, "deals", byName(tables, { name: "Never", stage: "Open", value: 1 }), { txOptions });
    await settle();
    assert.deepEqual(heard, [], "nothing is announced before the commit");
    throw new Error("Rolled back on purpose.");
  }));
  await settle();
  assert.deepEqual(heard, [], "a rollback announces nothing");

  const imported = await f.gate.importRecords(f.ctx, "deals", [byName(tables, { name: "One" }), byName(tables, { name: "Two" })]);
  assert.equal(imported.imported, 2);
  await settle();
  assert.deepEqual(heard, [{ tables: [tableId] }], "an import is one notice");
});

test("a view a bot makes in a person's own chat is the home's at once, so an app can use it", async (context) => {
  const f = await fixture(context);
  const tools = buildViewTools({
    views: f.views,
    call: f.options,
    botId: null,
    userId: f.maker,
    isBuilder: false,
    ctx: async () => f.ctx,
    failed: (error) => ({ error: error.message }),
    after: []
  });
  const saved = await tools.viewSave.execute({ title: "Deals", summary: "Open deals", definition: definition() });
  assert.equal(saved.status, "saved");
  assert.doesNotMatch(saved.note || "", /private/u);
  assert.match(saved.note, /everyone in the home/u);
  const crm = await f.apps.createApp(f.ctx.actor, { name: "CRM" }, f.options);
  const screen = { home: "main", screens: { main: { content: [{ type: "view", view: saved.view }] } } };
  assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, crm.slug, screen, "", f.options)).errors, []);
});

test("a bot makes a view with one card per reply; a refusal says where; no tool restores or deletes", async (context) => {
  const f = await fixture(context);
  const after = [];
  const tools = buildViewTools({
    views: f.views,
    call: f.options,
    botId: null,
    userId: f.maker,
    isBuilder: false,
    ctx: async () => f.ctx,
    failed: (error) => ({ error: error.message }),
    after
  });
  assert.deepEqual(Object.keys(tools).sort(), ["viewGet", "viewList", "viewSave"], "no tool restores, retires or deletes");

  const refused = await tools.viewSave.execute({ title: "Nope", summary: "", definition: { data: { all: { from: "deels" } }, content: [{ type: "spacer" }] } });
  assert.equal(refused.status, "not saved");
  assert.equal(refused.errors[0].path, "data.all.from");
  assert.match(refused.errors[0].message, /Did you mean "deals"/u);
  assert.deepEqual(after, [], "a refused view posts no card");

  // A model often sends the whole definition as a string: that's taken, and only real nonsense refused.
  const notJson = await tools.viewSave.execute({ title: "Nope", summary: "", definition: "{ not json" });
  assert.deepEqual(notJson.errors.map((error) => error.path), ["definition"]);
  assert.equal(tools.viewSave.inputSchema.safeParse({ title: "As text", summary: "", definition: JSON.stringify(definition()) }).success, true, "the schema lets a string through");
  const asText = await tools.viewSave.execute({ title: "As text", summary: "", definition: JSON.stringify(definition()) });
  assert.equal(asText.status, "saved");
  const maker = f.person(f.maker);
  await f.views.retire(maker, asText.view, maker.options);
  after.length = 0;

  const saved = await tools.viewSave.execute({ title: "Deals", summary: "Open deals", definition: definition() });
  assert.equal(saved.status, "saved");
  assert.match(saved.note, /everyone in the home can open it/u);
  assert.deepEqual(after.map((message) => [message.kind, message.body.path, message.body.title]), [["view", saved.view, "Deals"]]);

  const again = await tools.viewSave.execute({ view: saved.view, title: "Deals again", summary: "As a pie", definition: definition("pie") });
  assert.equal(again.version, 2);
  assert.deepEqual(after.map((message) => message.body.title), ["Deals again"], "one card per reply, the latest");

  assert.deepEqual((await tools.viewList.execute({})).views.map((view) => view.view), [saved.view]);
  assert.equal((await tools.viewGet.execute({ view: saved.view })).definition.content[0].kind, "pie");
  assert.match((await tools.viewGet.execute({ view: "nope" })).error, /No view/u);

  // Its data is checked as it would show: a query that can't run comes back to be fixed.
  const failing = await tools.viewSave.execute({
    view: saved.view,
    title: "Deals",
    summary: "",
    definition: { data: { one: { record: "deals", id: "=params.id" } }, params: { id: {} }, content: [{ type: "field", label: "Name", value: "=data.one.name" }] }
  });
  assert.equal(failing.status, "saved", "an empty record isn't a failure");
});
