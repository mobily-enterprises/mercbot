import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase, earlierTransactionsEnded } from "../support/testDatabase.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";

// Personal tables (D-145): a table made "each person's own" keeps every record its person's. The data gate sets whose it
// is from who is acting, never from what's sent, and every read, total, link and change reaches only the acting person's
// records, in the query. A button's script acts for the person pressing; a job works for everyone and names whose each
// record is. Visitors never reach one, and no stored roll-up adds one up onto a shared table. Each test tries to break one.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A home with Ann (its first user) and Ben in it, the apps' parts and each person's gate ctx. */
async function twoPeople(context, slug, knex = null) {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug, ...(knex ? { knex } : {}) });
  const ben = String((await home.knex("users").orderBy("id").offset(1).first()).id);
  await home.knex("workspace_memberships").insert([
    { workspace_id: home.workspaceId, user_id: home.userId, role_sid: "owner", status: "active" },
    { workspace_id: home.workspaceId, user_id: ben, role_sid: "member", status: "active" }
  ]);
  let scripts = null;
  const parts = appsParts(home, { trustMs: Infinity, beforeSave: (...args) => scripts.beforeSave(...args) });
  scripts = createScripts({ roleOf: parts.roleOf, resources: parts.resources, repository: parts.repository, systemContext: parts.systemContext, registry: parts.registry, gate: parts.gate, apps: parts.apps, env: process.env, homeBots: async () => [] });
  cleanup.after(() => scripts.close());
  const person = (id, name) => ({ type: "person", id, name });
  const ann = { options: home.options, actor: person(home.userId, "Ann"), via: { kind: "data" } };
  const benCtx = { options: home.memberOptions(ben, home.workspace), actor: person(ben, "Ben"), via: { kind: "data" } };
  return { home, ...parts, scripts, ann, ben: benCtx, annId: home.userId, benId: ben };
}

const fieldOf = (tables, tableKey, key) => tables.find((table) => table.key === tableKey).fields.find((field) => field.key === key).id;

test("a personal table's records are each person's own: made theirs, and only theirs to read, total, link or change", async (context) => {
  const { registry, gate, ann, ben, annId, home } = await twoPeople(context, "apps-personal");
  await registry.createTable(ann.actor, { key: "scores", personal: true, fields: [{ key: "game", type: "text" }, { key: "points", type: "number" }] }, home.options);
  await registry.createTable(ann.actor, { key: "games", fields: [{ key: "name", type: "text" }, { key: "score", type: "link", target: "scores" }] }, home.options);
  const tables = await registry.loadTables(home.options);
  const whose = fieldOf(tables, "scores", "whose");
  const game = fieldOf(tables, "scores", "game");

  // Ann sends Ben's id as whose it is: the gate makes it hers.
  const chess = await gate.create(ann, "scores", { game: "Chess", points: 3, whose: ben.actor.id });
  await gate.create(ben, "scores", { game: "Go", points: 5 });
  assert.equal(chess[whose], annId, "whose it is comes from who made it");
  const games = async (ctx) => (await gate.read(ctx, "scores")).records.map((record) => record[game]);
  assert.deepEqual([await games(ann), await games(ben)], [["Chess"], ["Go"]]);

  // Ben can't open, change, put away or link to Ann's record, and his totals are his alone.
  await assert.rejects(gate.get(ben, "scores", chess.id), { code: "apps_record_not_found" });
  await assert.rejects(gate.update(ben, "scores", chess.id, { points: 0 }), { code: "apps_record_not_found" });
  await assert.rejects(gate.markObsolete(ben, "scores", chess.id), { code: "apps_record_not_found" });
  await assert.rejects(gate.create(ben, "games", { name: "Copy", score: chess.id }), { code: "apps_link_value_missing" });
  const points = fieldOf(tables, "scores", "points");
  assert.deepEqual(await gate.grandTotal(ben, "scores", { measure: "sum", field: points }), { count: 1, total: 5 });
  assert.deepEqual((await gate.totals(ben, "scores", { groupBy: game })).map((group) => group.key), ["Go"]);

  // Nobody gives a record away: whose it is never changes.
  await assert.rejects(gate.update(ann, "scores", chess.id, { whose: ben.actor.id }), { code: "apps_personal_owner_fixed" });
  assert.equal((await gate.get(ann, "scores", chess.id))[whose]?.id, annId);
});

test("a button's script works on the pressing person's records; a job on everyone's, naming whose each new one is", async (context) => {
  const { registry, gate, apps, scripts, ann, ben, annId, benId, home } = await twoPeople(context, "apps-personal-scripts");
  const { knex } = home;
  await registry.createTable(ann.actor, { key: "scores", personal: true, fields: [{ key: "game", type: "text" }] }, home.options);
  await gate.create(ann, "scores", { game: "Chess" });
  await apps.createApp(ann.actor, { name: "Games" }, home.options);
  const press = `async function main(input) {
    await records.create("scores", { game: "Go", whose: input.other });
    return (await records.list("scores", {})).map((row) => row.game + ":" + row.whose);
  }`;
  const nightly = `async function main() {
    const all = (await records.list("scores", {})).map((row) => row.game).sort().join(",");
    await records.create("scores", { game: "Nightly", whose: "${benId}" });
    let refused = "";
    try { await records.create("scores", { game: "Nobody's" }); } catch (error) { refused = error.message; }
    console.log(all + " | " + refused);
    return all;
  }`;
  const save = async (key, kind, code, extra) => assert.deepEqual((await scripts.save(ann.actor, "games", { key, kind, summary: key, code, ...extra }, home.options)).errors, [], key);
  await save("press", "action", press, { tests: [{ name: "lists", input: { other: "1" }, expect: ["Go:1"] }] });
  await save("nightly", "job", nightly, { settings: { every: "hour", at: "00:05" }, tests: [{ name: "runs", input: {}, expect: "" }] });
  await apps.publish(ann.actor, "games", {}, home.options);
  const appId = (await apps.find("games", home.options)).id;

  const listed = await scripts.runNamed("action", appId, "press", { other: annId }, { kind: "button" }, null, ben.options);
  assert.deepEqual(listed, [`Go:${benId}`], "Ben's script sees only his, and what it made is his whatever it said");

  const job = await knex("app_scripts").where({ app_id: appId, key: "nightly", draft: false }).first();
  await knex("app_scripts").where({ id: job.id }).update({ next_run_at: new Date(Date.now() - 1000) });
  await earlierTransactionsEnded(knex);
  await scripts.runDue({ matchChanges: async () => ({ matches: [], count: 0 }) });
  const run = await knex("app_script_runs").where({ script_id: job.id }).orderBy("id", "desc").first();
  assert.equal(run.ok, true, run.error);
  assert.equal(run.log, "Chess,Go | A job adding to Scores names whose record it is (whose).");
  const whose = fieldOf(await registry.loadTables(home.options), "scores", "whose");
  const nightlyRow = (await gate.read(ben, "scores")).records.find((record) => Object.values(record).includes("Nightly"));
  assert.equal(nightlyRow?.[whose]?.id, benId, "the job's record is the person it named");
});

// A job may watch a personal table (D-145, D-146): each person's change sets it off, and it works on their record.
test("a job watching a personal table runs on each person's changes to it", async (context) => {
  const { registry, gate, apps, scripts, repository, resources, systemContext, ann, ben, home } = await twoPeople(context, "apps-personal-watch");
  const { knex } = home;
  await registry.createTable(ann.actor, { key: "requests", personal: true, fields: [{ key: "status", type: "text" }] }, home.options);
  await apps.createApp(ann.actor, { name: "Requests" }, home.options);
  const code = `async function main(input) {
    for (const change of input.changes) await records.update("requests", change.record.id, { status: "Done" });
    return input.changes.length;
  }`;
  const settings = { watch: { table: "requests", on: "update", condition: '=row.status == "Asked"' } };
  const saved = await scripts.save(ann.actor, "requests", { key: "answer", kind: "job", summary: "Answers a request", code, settings, tests: [{ name: "none", input: { changes: [] }, expect: 0 }] }, home.options);
  assert.deepEqual(saved.errors, []);
  await earlierTransactionsEnded(knex);
  await apps.publish(ann.actor, "requests", {}, home.options);
  const asked = await gate.create(ben, "requests", { status: "New" });
  await gate.update(ben, "requests", asked.id, { status: "Asked" });
  const { createWatches } = await import("../../packages/apps/src/server/watches.js");
  const watches = createWatches({ resources, repository, systemContext, registry, gate, apps, records: { directory: { seats: async () => [] } } });
  await earlierTransactionsEnded(knex);
  await scripts.runDue({ matchChanges: watches.matchChanges });
  const status = fieldOf(await registry.loadTables(home.options), "requests", "status");
  assert.equal((await gate.get(ben, "requests", asked.id))[status], "Done", "the job heard Ben's change and answered his record");
});

test("visitors never reach a personal table, and no stored roll-up adds one up onto a shared table", async (context) => {
  const { registry, gate, ann, home } = await twoPeople(context, "apps-personal-fences");
  await registry.createTable(ann.actor, { key: "votes", personal: true, fields: [{ key: "choice", type: "text" }] }, home.options);
  await registry.createTable(ann.actor, { key: "polls", fields: [{ key: "question", type: "text" }] }, home.options);
  await registry.addField(ann.actor, "votes", { key: "poll", type: "link", target: "polls" }, home.options);
  await assert.rejects(
    registry.addField(ann.actor, "polls", { key: "votes_cast", type: "number", rollup: { from: "votes", link: "poll", measure: "count" } }, home.options),
    { code: "apps_rollup_personal" }
  );
  const tables = await registry.loadTables(home.options);
  const definition = {
    home: "vote",
    public: { home: "vote", tables: { votes: { can: ["create", "list"], read: ["choice"], write: ["choice"] } } },
    screens: { vote: { public: true, data: { mine: { from: "votes" } }, content: [{ type: "table", rows: "=data.mine", columns: [{ label: "Choice", value: "=row.choice" }] }] } }
  };
  assert.deepEqual(checkApp(definition, tables).filter((error) => error.path === "public.tables.votes").map((error) => error.message), [
    "Votes is each person's own: a public app's visitors can't reach it."
  ]);
  const visitor = { options: home.job, actor: { type: "visitor", id: null, name: "Visitor" }, via: { kind: "public" }, visitor: { signedIn: false }, access: { tables: new Map() } };
  await assert.rejects(gate.read(visitor, "votes"), { code: "apps_personal_visitor" });
});

test("a person's reads of a personal table cost the same however many records other people have", async (context) => {
  const knex = await connectTestDatabase();
  const { registry, gate, ann, ben, home } = await twoPeople(context, "apps-personal-cost", knex);
  // Closed after the home's own cleanup, which runs first (hooks run in the order they're added).
  context.after(() => knex.destroy());
  await registry.createTable(ann.actor, { key: "scores", personal: true, fields: [{ key: "game", type: "text" }, { key: "points", type: "number" }] }, home.options);
  await gate.create(ann, "scores", { game: "Chess", points: 3 });
  const points = fieldOf(await registry.loadTables(home.options), "scores", "points");
  const annReads = () => queriesDuring(knex, async () => {
    assert.equal((await gate.read(ann, "scores")).records.length, 1);
    await gate.grandTotal(ann, "scores", { measure: "sum", field: points });
  });
  const few = await annReads();
  for (let index = 0; index < 40; index += 1) await gate.create(ben, "scores", { game: `Go ${index}`, points: index });
  assert.equal(await annReads(), few);
});

// What would undo it, or show it elsewhere: removing its Whose field (everyone would then reach every record), the home's
// Activity trail (it would show the values of other people's records) and a bot's watch (it would tell a bot about other
// people's changes).
test("whose a record is can't be removed, the Activity trail hides others' records' values, and no bot watches one", async (context) => {
  const { registry, gate, apps, resources, repository, systemContext, ann, ben, home } = await twoPeople(context, "apps-personal-around");
  await registry.createTable(ann.actor, { key: "notes_to_self", personal: true, fields: [{ key: "text", type: "text" }] }, home.options);
  const whose = fieldOf(await registry.loadTables(home.options), "notes_to_self", "whose");
  await assert.rejects(apps.removeField(ann.actor, whose, home.options), { code: "apps_personal_owner_kept" });

  await gate.create(ann, "notes_to_self", { text: "My secret" });
  const text = fieldOf(await registry.loadTables(home.options), "notes_to_self", "text");
  const seen = async (ctx) => (await gate.activity(ctx, {})).filter((entry) => entry.action === "create").map((entry) => entry.changes?.[text]?.[1] ?? null);
  assert.deepEqual([await seen(ann), await seen(ben)], [["My secret"], [null]]);

  const { createWatches } = await import("../../packages/apps/src/server/watches.js");
  const watches = createWatches({ resources, repository, systemContext, registry, gate, apps, records: { directory: { seats: async () => [{ id: "1" }] } } });
  await assert.rejects(watches.create({ chatBotId: "1" }, { table: "notes_to_self", name: "Snoop", instructions: "Tell me" }, home.options), { code: "apps_watch_personal" });
});
