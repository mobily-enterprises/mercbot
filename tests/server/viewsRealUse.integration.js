import assert from "node:assert/strict";
import test from "node:test";
import { inParallel } from "../support/inParallel.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { addRecord, makeHome, viewsFixture } from "../support/viewsFixture.mjs";
import { createNotices } from "../../packages/notices/src/server/notices.js";
import { checkView } from "../../packages/apps/src/shared/check.js";
import { scopeStyle } from "../../packages/apps/src/server/appStyle.js";
import { createBotLibrary } from "../../packages/bots/src/server/botLibrary.js";
import { startBotRecords } from "../support/botRecords.mjs";
import { previewOf } from "../../packages/bots/src/server/botRows.js";
import { toModelHistory } from "../../packages/bots/src/server/botAgent.js";

// Views (D-55) in the conditions real homes put them in: empty tables, messy data, columns that go
// away, people and bots that leave, several things happening at once, and definitions a model got
// wrong. Nothing here may crash, leak or quietly show the wrong figures.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const dealsFields = [
  { key: "title", type: "text" },
  { key: "stage", type: "choice", choices: ["Open", "Won"] },
  { key: "amount", type: "money" },
  { key: "closes", type: "date" },
  { key: "hot", type: "yesno" }
];
const makeDeals = (f) => f.registry.createTable(f.bot, { key: "deals", fields: dealsFields }, f.options);
const list = (extra = {}) => ({ data: { all: { from: "deals", sort: "-amount", ...extra } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Deal", value: "=row.title" }] }] });
const totals = (extra = {}) => ({ data: { by: { from: "deals", groupBy: "stage", sum: "amount", grandTotal: true, ...extra } }, content: [{ type: "totals", rows: "=data.by" }] });
const save = async (f, definition, working = {}, title = "Deals") => {
  const saved = await f.views.save(f.ctx, { title, definition, ...working.input }, { userId: f.maker, isBuilder: true, ...working });
  assert.deepEqual(saved.errors, [], JSON.stringify(saved.errors));
  return saved.view;
};
const ask = (f, slug, query, extra = {}) => f.runtime.query(f.ctx, { slug, screen: "main", query, ...extra });

test("an empty table gives an empty view, not an error", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const saved = await f.views.save(f.ctx, { title: "Empty", definition: { ...list(), data: { ...list().data, ...totals().data }, content: [...list().content, ...totals().content] } }, { userId: f.maker });
  assert.deepEqual(saved.problems, [], "an empty table is nothing to fix");
  assert.deepEqual((await ask(f, saved.view.key, "all")).records, []);
  const by = await ask(f, saved.view.key, "by");
  assert.deepEqual(by.totals, []);
  assert.deepEqual(by.grandTotal, { count: 0 }, "no sum over nothing, and no crash");
});

test("the figures are right with messy records: blanks, obsolete ones, and many rows", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const big = await addRecord(f, "deals", { title: "Big", stage: "Open", amount: 1000 });
  await addRecord(f, "deals", { title: "Small", stage: "Open", amount: 1 });
  await addRecord(f, "deals", { title: "Won one", stage: "Won", amount: 50 });
  await addRecord(f, "deals", { title: "No stage or amount" });
  const gone = await addRecord(f, "deals", { title: "Obsolete", stage: "Open", amount: 7777 });
  await f.gate.markObsolete(f.ctx, "deals", gone.id);
  const view = await save(f, { ...totals(), data: { ...totals().data, ...list().data }, content: [...totals().content, ...list().content] });

  const by = await ask(f, view.key, "by");
  assert.equal(by.grandTotal.total, 1051, "an obsolete record isn't counted");
  assert.equal(by.grandTotal.count, 4, "a record with no stage is");
  assert.equal(by.totals.reduce((sum, item) => sum + (item.total ?? 0), 0), 1051, "the groups add up to the total");
  assert.ok(by.totals.some((item) => item.key === null), "blanks have their own group");

  const first = await ask(f, view.key, "all");
  assert.equal(first.records.length, 4);
  assert.ok(!first.records.some((record) => record.title === "Obsolete"));
  // A record changed or restored shows at once: no stored copy of the answer.
  await f.gate.restore(f.ctx, "deals", gone.id);
  assert.equal((await ask(f, view.key, "all")).records[0].title, "Obsolete");
  await f.gate.markObsolete(f.ctx, "deals", big.id);
  assert.equal((await ask(f, view.key, "by")).grandTotal.total, 7828);

  const limited = await save(f, list({ limit: 2 }), {}, "Top two");
  assert.deepEqual((await ask(f, limited.key, "all")).records.map((record) => record.title), ["Obsolete", "Won one"]);
});

test("past 100 rows a list stops at 100 and says how many there are", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  await inParallel(130, (n) => addRecord(f, "deals", { title: `Deal ${n}`, stage: "Open", amount: n }));
  const view = await save(f, { ...list(), data: { ...list().data, ...totals().data }, content: [...list().content, ...totals().content] });
  const all = await ask(f, view.key, "all");
  assert.equal(all.records.length, 100);
  assert.equal(all.total, 130);
  assert.equal((await ask(f, view.key, "by")).grandTotal.count, 130, "the total counts them all, not the page");
});

test("totals group by a link, naming each group by its record", async (context) => {
  const f = await viewsFixture(context);
  await f.registry.createTable(f.bot, { key: "people", fields: [{ key: "name", type: "text", required: true }] }, f.options);
  await f.registry.createTable(f.bot, { key: "tasks", fields: [{ key: "what", type: "text" }, { key: "who", type: "link", target: "people" }] }, f.options);
  const ana = await addRecord(f, "people", { name: "Ana" });
  await addRecord(f, "tasks", { what: "One", who: String(ana.id) });
  await addRecord(f, "tasks", { what: "Two", who: String(ana.id) });
  await addRecord(f, "tasks", { what: "Three" });
  const view = await save(f, { data: { by: { from: "tasks", groupBy: "who", grandTotal: true } }, content: [{ type: "chart", kind: "bar", rows: "=data.by", measure: "count" }] });
  const by = await ask(f, view.key, "by");
  assert.equal(by.totals.find((item) => item.count === 2).label, "Ana");
  assert.equal(by.grandTotal.count, 3);
});

test("totals grouped by a link cost the same queries for 5 groups and for 60", async (context) => {
  const f = await viewsFixture(context);
  await f.registry.createTable(f.bot, { key: "people", fields: [{ key: "name", type: "text", required: true }] }, f.options);
  await f.registry.createTable(f.bot, { key: "tasks", fields: [{ key: "what", type: "text" }, { key: "who", type: "link", target: "people" }] }, f.options);
  const people = await inParallel(60, (index) => addRecord(f, "people", { name: `Person ${index}` }));
  const assign = (from, to) => inParallel(to - from, (offset) => addRecord(f, "tasks", { what: "Task", who: String(people[from + offset].id) }));
  const view = await save(f, { data: { by: { from: "tasks", groupBy: "who" } }, content: [{ type: "chart", kind: "bar", rows: "=data.by", measure: "count" }] });
  const measured = async (groups) => {
    let by = null;
    const count = await queriesDuring(f.knex, async () => {
      by = await ask(f, view.key, "by");
    });
    assert.equal(by.totals.length, groups);
    for (const item of by.totals) assert.equal(item.label, `Person ${people.findIndex((someone) => String(someone.id) === String(item.key))}`);
    return count;
  };
  await assign(0, 5);
  await ask(f, view.key, "by"); // caches warm up on the first read
  const few = await measured(5);
  await assign(5, 60);
  const many = await measured(60);
  assert.equal(many, few, `60 groups took ${many} queries, 5 groups ${few}`);
});

test("what a person types and what an app passes in are values, never instructions", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  await addRecord(f, "deals", { title: "Acme", stage: "Open", amount: 10 });
  await addRecord(f, "deals", { title: "Bolt", stage: "Won", amount: 20 });
  const view = await save(f, {
    params: { stage: {} },
    state: { search: { type: "string" } },
    data: { found: { from: "deals", where: '=stage == params.stage && title.contains(state.search)' } },
    content: [{ type: "input", bind: "state.search", label: "Search" }, { type: "table", rows: "=data.found", columns: [{ label: "Deal", value: "=row.title" }] }]
  });
  const search = (params, state) => ask(f, view.key, "found", { params, state });
  assert.deepEqual((await search({ stage: "Open" }, { search: "" })).records.map((record) => record.title), ["Acme"]);
  assert.deepEqual((await search({ stage: "Open" }, { search: "Bol" })).records, []);
  for (const hostile of ["' OR 1=1 --", "%", "\"); drop table apps; --", "Open' OR 'x'='x"]) {
    assert.deepEqual((await search({ stage: hostile }, { search: "" })).records, [], hostile);
    assert.deepEqual((await search({ stage: "Open" }, { search: hostile })).records, [], hostile);
  }
  // Values of the wrong kind, or none at all, are the declared defaults: a filter that finds nothing.
  assert.deepEqual((await search({}, { search: 5 })).records, []);
  assert.deepEqual((await search({ stage: "Open", extra: "ignored" }, {})).records.map((record) => record.title), ["Acme"]);
});

test("whatever a model writes, a bad definition comes back as errors, never a crash", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const tables = await f.registry.loadTables(f.options);
  const part = (node) => ({ data: { all: { from: "deals" } }, content: [node] });
  const deep = (depth) => (depth ? { type: "row", content: [deep(depth - 1)] } : { type: "spacer" });
  const broken = [
    null, "a view", 5, [], {}, { content: "x" }, { content: {} }, { content: [] }, { content: [null] }, { content: ["text"] }, { content: [5] },
    { content: [{}] }, { content: [{ type: 5 }] }, { content: [{ type: "text", value: "=nope(" }] }, { content: [{ type: "text", value: "=data.missing.x" }] },
    { data: null, content: [{ type: "spacer" }] }, { data: [], content: [{ type: "spacer" }] }, { data: "x", content: [{ type: "spacer" }] },
    { data: { a: null }, content: [{ type: "spacer" }] }, { data: { a: 5 }, content: [{ type: "spacer" }] }, { data: { a: {} }, content: [{ type: "spacer" }] },
    { data: { a: { from: "nowhere" } }, content: [{ type: "spacer" }] }, { data: { a: { from: "deals", where: "=nope ==" } }, content: [{ type: "spacer" }] },
    { data: { a: { from: "deals", sort: "nope" } }, content: [{ type: "spacer" }] }, { data: { a: { from: "deals", groupBy: "nope" } }, content: [{ type: "spacer" }] },
    { data: { a: { from: "deals", sum: "title", groupBy: "stage" } }, content: [{ type: "spacer" }] }, { data: { a: { from: 5 } }, content: [{ type: "spacer" }] },
    { params: "x", content: [{ type: "text", value: "=params.x" }] }, { params: 5, content: [{ type: "text", value: "=params.x" }] },
    { state: "x", content: [{ type: "input", bind: "state.q" }] }, { state: { q: null }, content: [{ type: "spacer" }] }, { state: { q: {} }, content: [{ type: "spacer" }] },
    part({ type: "table", rows: "=data.nope", columns: [] }), part({ type: "table", rows: "=data.all", columns: "x" }), part({ type: "table", rows: "=data.all", columns: [null] }),
    part({ type: "chart", kind: "donut", rows: "=data.all" }), part({ type: "chart" }), part({ type: "totals", rows: "=data.all" }), part({ type: "tabs" }), part({ type: "tabs", tabs: "x" }), part({ type: "tabs", tabs: [null] }),
    part({ type: "grid", columns: 9, content: [] }), part({ type: "row", content: "x" }), part({ type: "input", bind: "nothing" }), part({ type: "field", value: 5, label: {} }), part({ type: "text", class: "bad class!" }),
    part(deep(14)), { content: Array.from({ length: 450 }, () => ({ type: "spacer" })) }, { data: Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`q${n}`, { from: "deals" }])), content: [{ type: "spacer" }] },
    { style: "@import url(https://evil.example/x.css);", content: [{ type: "spacer" }] }, { style: "a { background: url(https://evil.example/leak) }", content: [{ type: "spacer" }] },
    { screens: {}, content: [{ type: "spacer" }] }, { navigation: {}, content: [{ type: "spacer" }] }, { public: true, content: [{ type: "spacer" }] }
  ];
  for (const definition of broken) {
    const label = JSON.stringify(definition)?.slice(0, 90);
    assert.doesNotThrow(() => checkView(definition, tables), label);
    const saved = await f.views.save(f.ctx, { title: "Broken", definition }, { userId: f.maker });
    assert.ok(saved.errors.length, `refused: ${label}`);
    for (const error of saved.errors) assert.ok(typeof error.message === "string" && error.message, `says why: ${label}`);
  }
  assert.deepEqual(await f.views.list(f.options), [], "none of them left anything behind");
});

test("a view's own CSS stays in its own area", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const view = await save(f, { ...list(), style: "body { background: red; } .x-card { color: blue; } :root { color: pink; }" });
  const css = scopeStyle(view.id, (await f.views.get(view.key, f.options)).definition.style);
  for (const rule of css.split("}").map((entry) => entry.trim()).filter(Boolean)) {
    assert.ok(rule.startsWith(`[data-app-style="${view.id}"]`), `fenced: ${rule}`);
  }
});

test("columns and tables going away never break a view or widen it silently", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  await addRecord(f, "deals", { title: "Open one", stage: "Open", amount: 5 });
  await addRecord(f, "deals", { title: "Won one", stage: "Won", amount: 6 });
  const view = await save(f, {
    data: { open: { from: "deals", where: '=stage == "Open"', sort: "-amount" }, by: { from: "deals", groupBy: "stage", sum: "amount" } },
    content: [
      { type: "text", value: "Heading", size: "title" },
      { type: "table", rows: "=data.open", columns: [{ label: "Deal", value: "=row.title" }, { label: "Amount", value: "=row.amount" }] },
      { type: "chart", kind: "bar", rows: "=data.by", measure: "total" }
    ]
  });
  const tables = await f.registry.loadTables(f.options);
  const field = (key) => tables[0].fields.find((entry) => entry.key === key);

  // A filter on the removed field is reported as widening, before anyone confirms.
  const impact = await f.apps.fieldImpact(field("stage").id, f.options);
  assert.equal(impact.uses[0].slug, view.key);
  assert.deepEqual(impact.uses[0].widened.map((entry) => entry.query), ["open"]);

  await f.apps.removeField(f.ctx.actor, field("amount").id, f.options);
  const one = await f.views.get(view.key, f.options);
  assert.equal(one.version, 2);
  assert.equal(one.definition.content[1].columns.length, 1, "the column went, the table stayed");
  assert.equal((await ask(f, view.key, "open")).records[0].title, "Open one");

  // An old version that still uses the removed field restores, and fails closed instead of showing too much.
  const { versions } = await f.apps.versions(view.key, {}, f.options);
  const maker = f.person(f.maker);
  await f.views.restore(maker.actor, view.key, versions.at(-1).id, maker.options);
  const restored = await ask(f, view.key, "by");
  assert.equal(restored.needsAttention, true);
  assert.deepEqual(restored.records, []);
});

test("several things at once: saves, restores and same titles", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const view = await save(f, list());
  const saves = await Promise.all(Array.from({ length: 10 }, (_, n) => f.views.save(f.ctx, { view: view.key, title: `Deals ${n}`, definition: list({ limit: n + 1 }) }, { userId: f.maker, isBuilder: true })));
  assert.ok(saves.every((saved) => !saved.errors.length));
  const { versions } = await f.apps.versions(view.key, {}, f.options);
  const numbers = versions.map((version) => version.number);
  assert.equal(new Set(numbers).size, numbers.length, `every version has its own number: ${numbers}`);
  assert.equal(Math.max(...numbers), 11);
  assert.equal(versions.filter((version) => version.live).length, 1);
  assert.equal(versions.find((version) => version.live).number, 11, "the newest is what shows");

  const same = await Promise.all(Array.from({ length: 6 }, () => f.views.save(f.ctx, { title: "Same title", definition: list() }, { userId: f.maker })));
  assert.ok(same.every((saved) => !saved.errors.length), JSON.stringify(same.map((saved) => saved.errors)));
  assert.equal(new Set(same.map((saved) => saved.view.key)).size, 6, "each gets its own key");
});

test("titles people really use all make working views", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  for (const title of ["Data", "builder", "Pins", "売上の概要", "📈", "2024 deals", "Q3 / Q4: open & won", `<script>alert(1)</script>`, "x".repeat(200), "  spaced  "]) {
    const view = await save(f, list(), {}, title);
    assert.equal((await ask(f, view.key, "all")).records.length, 0, title);
    assert.ok(!["builder", "pins", "data", "watches"].includes(view.key), `${title}: ${view.key} can't be a route`);
    const app = await f.apps.createApp(f.ctx.actor, { name: `Host ${view.id}` }, f.options);
    const saved = await f.apps.saveDraft(f.ctx.actor, app.slug, {
      home: "home",
      screens: { home: { content: [{ type: "view", view: view.key }, { type: "view", view: view.key, copy: true }] } }
    }, "", f.options);
    assert.deepEqual(saved.errors, [], `${title}: embeds as ${view.key}`);
  }
});

test("an app and the Builder can go round and round without losing a view part", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const view = await save(f, { ...list(), params: { who: {} } });
  const app = await f.apps.createApp(f.ctx.actor, { name: "Round trip" }, f.options);
  const first = {
    home: "home",
    screens: {
      home: { params: { id: {} }, content: [{ type: "view", view: view.key, params: { who: "=params.id" } }, { type: "view", view: view.key, copy: true, params: { who: "=params.id" } }] },
      other: { params: { id: {} }, content: [{ type: "view", view: view.key, copy: true, params: { who: "=params.id" } }] }
    }
  };
  assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, app.slug, first, "", f.options)).errors, []);
  const screen = `view-${view.key}`;
  const read = async () => (await f.apps.get(app.slug, { version: "draft" }, f.options)).definition;
  const once = await read();
  assert.equal(Object.keys(once.screens).filter((key) => key.startsWith("view-")).length, 1, "two copies of one view share a screen");
  // What the Builder reads, it can save straight back, again and again, and nothing changes.
  assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, app.slug, once, "", f.options)).errors, []);
  assert.deepEqual((await f.apps.saveDraft(f.ctx.actor, app.slug, await read(), "", f.options)).errors, []);
  assert.deepEqual(await read(), once);
  await f.apps.publish(f.ctx.actor, app.slug, {}, f.options);
  assert.deepEqual((await f.apps.get(app.slug, {}, f.options)).definition.screens[screen].copiedFrom, { view: view.key, version: 1 });
  const home = (await f.apps.get(app.slug, {}, f.options)).definition.screens.home.content;
  assert.equal(home[0].view, view.key);
  assert.equal(home[1].screen, screen);
});

test("a copy's update keeps the rest of the draft, and refuses what the app can't take", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const view = await save(f, list());
  const app = await f.apps.createApp(f.ctx.actor, { name: "Host" }, f.options);
  const screen = `view-${view.key}`;
  const definition = { home: "home", screens: { home: { content: [{ type: "text", value: "First" }, { type: "view", view: view.key, copy: true }] } } };
  await f.apps.saveDraft(f.ctx.actor, app.slug, definition, "", f.options);
  await f.apps.publish(f.ctx.actor, app.slug, {}, f.options);

  // Someone has a draft in progress when the original changes.
  const working = structuredClone((await f.apps.get(app.slug, {}, f.options)).definition);
  working.screens.home.content[0].value = "Work in progress";
  await f.apps.saveDraft(f.ctx.actor, app.slug, working, "", f.options);
  await f.views.save(f.ctx, { view: view.key, title: "Deals", definition: list({ limit: 3 }) }, { userId: f.maker });
  await f.views.updateCopy(f.ctx.actor, app.slug, screen, f.options);
  const draft = (await f.apps.get(app.slug, { version: "draft" }, f.options)).definition;
  assert.equal(draft.screens.home.content[0].value, "Work in progress", "the update joins the draft in progress");
  assert.equal(draft.screens[screen].data.all.limit, 3);
  assert.equal(draft.screens[screen].copiedFrom.version, 2);
  await f.apps.publish(f.ctx.actor, app.slug, {}, f.options);

  // The original now needs a parameter this app doesn't pass: it's refused, plainly, and nothing changes.
  await f.views.save(f.ctx, { view: view.key, title: "Deals", definition: { ...list(), params: { who: {} } } }, { userId: f.maker });
  await assert.rejects(f.views.updateCopy(f.ctx.actor, app.slug, screen, f.options), { code: "apps_view_copy_refused" });
  assert.equal((await f.apps.get(app.slug, {}, f.options)).definition.screens[screen].copiedFrom.version, 2);
  assert.equal((await f.apps.get(app.slug, {}, f.options)).version.draft, false);

  // A screen that isn't a copy, or a copy whose original was retired, has nothing to update.
  await assert.rejects(f.views.updateCopy(f.ctx.actor, app.slug, "home", f.options), { code: "apps_view_original_gone" });
  const maker = f.person(f.maker);
  await f.views.retire(maker, view.key, maker.options);
  await assert.rejects(f.views.updateCopy(f.ctx.actor, app.slug, screen, f.options), { code: "apps_view_original_gone" });
  assert.deepEqual(await f.views.copyUpdates((await f.apps.get(app.slug, {}, f.options)).definition, f.options), []);
  assert.equal((await f.runtime.query(f.ctx, { slug: app.slug, screen, query: "all" })).records.length, 0, "and the copy still runs");
});

test("a field removal reaches a copy like any screen, and a shared view by itself", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const view = await save(f, { data: { all: { from: "deals" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Deal", value: "=row.title" }, { label: "Hot", value: "=row.hot" }] }] });
  const app = await f.apps.createApp(f.ctx.actor, { name: "Host" }, f.options);
  await f.apps.saveDraft(f.ctx.actor, app.slug, { home: "home", screens: { home: { content: [{ type: "view", view: view.key }, { type: "view", view: view.key, copy: true }] } } }, "", f.options);
  await f.apps.publish(f.ctx.actor, app.slug, {}, f.options);
  const hot = (await f.registry.loadTables(f.options))[0].fields.find((field) => field.key === "hot");
  const impact = await f.apps.fieldImpact(hot.id, f.options);
  assert.deepEqual(impact.uses.map((use) => use.slug).sort(), [app.slug, view.key].sort(), "the dialog lists both");
  await f.apps.removeField(f.ctx.actor, hot.id, f.options);
  const copy = (await f.apps.get(app.slug, {}, f.options)).definition.screens[`view-${view.key}`];
  assert.equal(copy.content[0].columns.length, 1);
  assert.equal((await f.views.get(view.key, f.options)).definition.content[0].columns.length, 1);
});

test("other homes see nothing, whichever way they ask; everyone in the home sees every view", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const mine = await save(f, list(), { isBuilder: false }, "Chat one");
  const ours = await save(f, list(), {}, "Home one");
  const elsewhere = await makeHome(f.knex, "elsewhere");
  const there = f.optionsIn(elsewhere);
  await f.registry.createTable(f.bot, { key: "deals", fields: dealsFields }, there);
  for (const key of [mine.key, ours.key, mine.id, ours.id]) {
    await assert.rejects(f.views.get(key, there), { code: "apps_view_not_found" });
    await assert.rejects(f.apps.find(key, there), { code: "apps_app_not_found" });
    await assert.rejects(f.views.retire(f.person(f.maker, true), key, there), { code: "apps_view_not_found" });
    await assert.rejects(f.runtime.query({ ...f.ctx, options: there }, { slug: key, screen: "main", query: "all" }), { code: "apps_app_not_found" });
  }
  const foreign = await f.apps.createApp(f.ctx.actor, { name: "Foreign" }, there);
  const embed = await f.apps.saveDraft(f.ctx.actor, foreign.slug, { home: "home", screens: { home: { content: [{ type: "view", view: ours.key }] } } }, "", there);
  assert.match(embed.errors[0].message, /no view/u, "another home's view can't be embedded");
  assert.deepEqual(await f.views.list(there), []);

  // Another member's bot and the Library's search find every view of the home, whoever's chat made it (D-66).
  const library = createBotLibrary({ records: await startBotRecords(f.knex, context), conversations: {}, apps: { apps: f.apps } });
  const names = async (userId) => (await library.search("one", f.optionsIn(f.workspaceId, userId))).files.map((file) => file.name).sort();
  assert.deepEqual(await names(f.maker), ["Chat one", "Home one"]);
  assert.deepEqual(await names(f.other), ["Chat one", "Home one"]);
  assert.deepEqual((await library.search("one", f.optionsIn(elsewhere, f.other))).files, []);
});

test("the people and bots behind a view can leave", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const [bot] = await f.knex("bots").insert({ user_id: f.maker, workspace_id: f.workspaceId, name: "Leaving", color: "#123456" }).returning("id");
  const saved = await f.views.save(f.ctx, { title: "Left behind", definition: list() }, { userId: f.maker, botId: bot.id });
  const app = () => f.apps.get(saved.view.key, {}, f.options).then(({ app: row }) => row);
  assert.deepEqual(await f.views.details(await app(), f.options), { bot: { id: String(bot.id), name: "Leaving" } }, "who to ask; nothing about who may keep it");
  await f.knex("bots").where({ id: bot.id }).del();
  assert.equal((await f.views.details(await app(), f.options)).bot, null, "no one to ask, and still there");
  assert.equal((await ask(f, saved.view.key, "all")).records.length, 0);
});

test("the chat and the Library know a view", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const view = await save(f, list());
  const [bot] = await f.knex("bots").insert({ user_id: f.maker, workspace_id: f.workspaceId, name: "Librarian", color: "#123456" }).returning("id");
  const [conversation] = await f.knex("bot_conversations").insert({ workspace_id: f.workspaceId, bot_id: bot.id, user_id: f.maker }).returning("id");
  const row = { id: bot.id, conversation_id: conversation.id };
  const conversations = { ownedSingleBot: async () => row };
  const library = createBotLibrary({ records: await startBotRecords(f.knex, context), conversations, apps: { apps: f.apps } });
  const mine = f.optionsIn(f.workspaceId, f.maker);
  const body = { path: view.key, title: view.title, summary: "All deals" };
  // Saved twice in two replies: two cards, one entry.
  for (const title of ["Deals", "Deals, newer"]) {
    await f.knex("bot_messages").insert({ workspace_id: f.workspaceId, bot_id: bot.id, conversation_id: conversation.id, kind: "view", role: "bot", body: JSON.stringify({ ...body, title }) });
  }
  const { items } = await library.library(bot.id, mine);
  assert.deepEqual(items.map((item) => [item.kind, item.path, item.name]), [["view", view.key, "Deals, newer"]]);
  await library.pinItem(bot.id, { messageId: items[0].messageId, path: view.key, pinned: true }, mine);
  assert.equal((await library.library(bot.id, mine)).items[0].pinned, true);

  assert.equal(previewOf({ kind: "view", body }), "View: Deals");
  const history = toModelHistory([{ id: 1, kind: "view", role: "bot", body }]);
  assert.match(history[0].content, new RegExp(view.key, "u"), "the bot can find it again, even after the conversation moves on");
});

test("a change on one server reaches a page on another, and survives a dropped connection", async (context) => {
  const f = await viewsFixture(context);
  await makeDeals(f);
  const other = createNotices({ knex: f.knex });
  f.whenDone(() => other.close());
  const heard = [];
  other.subscribe("apps-data", f.workspaceId, (event) => heard.push(event));
  const until = async (done, what) => {
    for (let tries = 0; tries < 100 && !(await done()); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(await done(), what);
  };
  const write = () => addRecord(f, "deals", { title: "News" });
  // The other server's listener connects in the background.
  const heardWrite = async () => {
    await write();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return heard.length > 0;
  };
  await until(heardWrite, "the other server hears a write");

  // Each listening connection is ended, and waited for until it is gone (at most 10 s): a write
  // heard from here on came through a connection opened again.
  const ended = await f.knex.raw(
    "select pg_terminate_backend(pid, 10000) as gone from pg_stat_activity where query ilike 'LISTEN %' and datname = current_database() and pid <> pg_backend_pid()"
  );
  assert.ok(ended.rows.length > 0 && ended.rows.every((row) => row.gone), "the listening connections are gone");
  heard.length = 0;
  await until(heardWrite, "it listens again after losing its connection");
});
