import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { celSchema } from "../../packages/apps/src/shared/formulas.js";
import { compileWhere, planToIds } from "../../packages/apps/src/shared/where.js";

// The fields shared tables need (D-130), through the data gate on the test database: a person field holds someone in
// the home now and reads back with their name ("Former member" once they leave); a one-to-one link (unique) leaves at
// most one live record per target, a restore included; tags are filtered with `"x" in tags`; a date and time is kept
// as one instant; a person column imports by name. Labelling people costs the same few queries whatever the page.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context) {
  const home = await appsHome(context, { slug: "apps-shared" });
  const { knex, userId, workspaceId, options } = home;
  const { registry, gate } = appsParts(home);
  const [other, leaver] = (await knex("users").whereNot({ id: userId }).orderBy("id").limit(2).select("id", "display_name", "username"));
  assert.ok(leaver, "the test database needs three users");
  await knex("workspace_memberships").insert([userId, other.id, leaver.id].map((id) => ({ workspace_id: workspaceId, user_id: id, role_sid: "member", status: "active" })));
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "data" });
  const contacts = await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const tasks = await registry.createTable(person, {
    key: "tasks",
    fields: [
      { key: "title", type: "text", required: true },
      { key: "assignee", type: "person" },
      { key: "tags", type: "tags" },
      { key: "due", type: "datetime" },
      { key: "site", type: "url" },
      { key: "notes", type: "longtext" }
    ]
  }, options);
  const pipeline = await registry.createTable(person, {
    key: "pipeline",
    fields: [{ key: "contact", type: "link", target: "contacts", unique: true, required: true }, { key: "stage", type: "text" }]
  }, options);
  const idOf = (table, key) => table.fields.find((field) => field.key === key).id;
  return { home, knex, userId: String(userId), other, leaver, workspaceId, options, registry, gate, ctx, contacts, tasks, pipeline, idOf };
}

test("a person field holds someone in the home now, and reads back with their name until they leave", async (context) => {
  const { home, knex, gate, ctx, tasks, idOf, other, leaver, userId, workspaceId } = await setup(context);
  const assignee = idOf(tasks, "assignee");
  const mine = await gate.create(ctx, "tasks", { title: "Mine", assignee: userId });
  const theirs = await gate.create(ctx, "tasks", { title: "Theirs", assignee: String(leaver.id) });
  const outsider = (await knex("users").whereNotIn("id", [userId, other.id, leaver.id]).first("id"))?.id ?? "999999999";
  await assert.rejects(gate.create(ctx, "tasks", { title: "Stranger", assignee: String(outsider) }), { code: "apps_value_person_unknown" });
  await assert.rejects(gate.update(ctx, "tasks", mine.id, { assignee: "999999999" }), { code: "apps_value_person_unknown" });
  await assert.rejects(gate.create(ctx, "tasks", { title: "Named", assignee: "Ana" }), { code: "apps_value_person_invalid" });

  const read = async () => new Map((await gate.read(ctx, "tasks")).records.map((record) => [record.id, record[assignee]]));
  const before = await read();
  assert.equal(before.get(mine.id).id, userId);
  assert.ok(before.get(theirs.id).label && before.get(theirs.id).label !== "Former member");
  await knex("workspace_memberships").where({ workspace_id: workspaceId, user_id: leaver.id }).update({ status: "removed" });
  assert.deepEqual((await read()).get(theirs.id), { id: String(leaver.id), label: "Former member" }, "the id is kept");
  assert.deepEqual((await gate.get(ctx, "tasks", theirs.id))[assignee], { id: String(leaver.id), label: "Former member" });
  // Their record stays editable, sent back whole as a form sends it; nobody is newly set to them (a new call: a call
  // reads who is in the home once).
  const later = home.ctx({ type: "person", id: userId, name: "Tester" }, { kind: "data" });
  await gate.update(later, "tasks", theirs.id, { title: "Theirs, renamed", assignee: String(leaver.id) });
  await assert.rejects(gate.update(later, "tasks", mine.id, { assignee: String(leaver.id) }), { code: "apps_value_person_unknown" });
});

test("labelling people costs the same few queries for a page of 5 or 40 records", async (context) => {
  const { knex, gate, ctx, userId, other } = await setup(context);
  const fill = async (count) => {
    for (let at = 0; at < count; at += 1) await gate.create(ctx, "tasks", { title: `T${at}`, assignee: at % 2 ? userId : String(other.id) });
  };
  await fill(5);
  const few = await queriesDuring(knex, () => gate.read(ctx, "tasks", { page: { size: 100 } }));
  await fill(35);
  const many = await queriesDuring(knex, () => gate.read(ctx, "tasks", { page: { size: 100 } }));
  assert.equal(many, few, `40 records took ${many} queries, 5 took ${few}`);
});

test("a one-to-one link leaves at most one live record per target, a restore and an update included", async (context) => {
  const { gate, ctx } = await setup(context);
  const ana = await gate.create(ctx, "contacts", { name: "Ana" });
  const ben = await gate.create(ctx, "contacts", { name: "Ben" });
  const first = await gate.create(ctx, "pipeline", { contact: ana.id, stage: "Lead" });
  await assert.rejects(gate.create(ctx, "pipeline", { contact: ana.id, stage: "Again" }), (error) => error.statusCode === 409 && error.code === "apps_link_unique_taken");
  const forBen = await gate.create(ctx, "pipeline", { contact: ben.id });
  await assert.rejects(gate.update(ctx, "pipeline", forBen.id, { contact: ana.id }), { code: "apps_link_unique_taken" });
  await gate.update(ctx, "pipeline", first.id, { stage: "Customer" });

  await gate.markObsolete(ctx, "pipeline", first.id);
  const second = await gate.create(ctx, "pipeline", { contact: ana.id, stage: "Back" });
  await assert.rejects(gate.restore(ctx, "pipeline", first.id), { code: "apps_link_unique_taken" }, "restoring would make two");
  await gate.markObsolete(ctx, "pipeline", second.id);
  await gate.restore(ctx, "pipeline", first.id);

  // Two at once: the lock lets one in.
  const carl = await gate.create(ctx, "contacts", { name: "Carl" });
  const results = await Promise.allSettled([1, 2, 3].map((n) => gate.create(ctx, "pipeline", { contact: carl.id, stage: `Race ${n}` })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.reason.code === "apps_link_unique_taken"));
});

test("an import into a one-to-one extension takes one row per target, in a fixed number of queries", async (context) => {
  const { knex, gate, ctx, pipeline, idOf } = await setup(context);
  const ana = await gate.create(ctx, "contacts", { name: "Ana" });
  const ben = await gate.create(ctx, "contacts", { name: "Ben" });
  await gate.create(ctx, "pipeline", { contact: ana.id, stage: "Lead" });
  const row = (contact, stage) => ({ [idOf(pipeline, "contact")]: contact, [idOf(pipeline, "stage")]: stage });
  const stages = async () => (await gate.read(ctx, "pipeline", { page: { size: 100 } })).records.map((record) => record[idOf(pipeline, "stage")]).sort();

  const taken = await gate.importRecords(ctx, "pipeline", [row("Ana", "Again"), row("Ben", "New")]);
  assert.deepEqual(taken.errors.map((error) => error.row), [2], "Ana has one already");
  assert.match(taken.errors[0].message, /can have only one/u);
  const twice = await gate.importRecords(ctx, "pipeline", [row("Ben", "One"), row(ben.id, "Two")], { dryRun: true });
  assert.deepEqual(twice.errors.map((error) => error.row), [3], "Ben twice in one sheet");
  assert.deepEqual(await stages(), ["Lead"], "nothing written");

  // Checking them costs the same queries for 3 rows or 60.
  const fill = async (count) => {
    const people = [];
    for (let at = 0; at < count; at += 1) people.push(await gate.create(ctx, "contacts", { name: `P${count}-${at}` }));
    return people.map((person) => row(person.id, "Lead"));
  };
  const few = await fill(3);
  const many = await fill(60);
  const fewQueries = await queriesDuring(knex, () => gate.importRecords(ctx, "pipeline", few));
  const manyQueries = await queriesDuring(knex, () => gate.importRecords(ctx, "pipeline", many));
  assert.equal(manyQueries, fewQueries, `60 rows took ${manyQueries} queries, 3 took ${fewQueries}`);
  assert.equal((await stages()).length, 64);
});

test("tags are filtered with \"x\" in tags; a date and time is one instant; a person column imports by name", async (context) => {
  const { knex, gate, ctx, tasks, idOf, userId } = await setup(context);
  await gate.create(ctx, "tasks", { title: "A", tags: ["urgent", "home"], due: "2026-11-24T09:30:00+01:00", site: "https://example.com", notes: "long ".repeat(3000) });
  await gate.create(ctx, "tasks", { title: "B", tags: "home" });
  await gate.create(ctx, "tasks", { title: "C" });
  const keyToId = new Map(tasks.fields.map((field) => [field.key, field.id]));
  const where = (formula, state = {}) => ({
    plan: planToIds(compileWhere({ ...celSchema(tasks), state: { tag: "string" }, params: {} }, formula), keyToId),
    variables: { state: { tag: "string" }, params: {} },
    values: { state, params: {} }
  });
  const titles = async (formula, state) => (await gate.read(ctx, "tasks", { where: where(formula, state) })).records.map((record) => record[idOf(tasks, "title")]).sort();
  assert.deepEqual(await titles('="home" in tags'), ["A", "B"]);
  assert.deepEqual(await titles('="urgent" in tags && "home" in tags'), ["A"]);
  assert.deepEqual(await titles("=state.tag in tags", { tag: "urgent" }), ["A"]);
  assert.deepEqual(await titles("=state.tag in tags", { tag: "" }), []);
  const a = (await gate.read(ctx, "tasks", { where: where('="urgent" in tags') })).records[0];
  assert.equal(new Date(a[idOf(tasks, "due")]).toISOString(), "2026-11-24T08:30:00.000Z");

  const name = (await knex("users").where({ id: userId }).first("display_name", "username"));
  const label = name.display_name || name.username;
  const row = (title, who) => ({ [idOf(tasks, "title")]: title, [idOf(tasks, "assignee")]: who, [idOf(tasks, "due")]: "2026-12-01 10:00" });
  const imported = await gate.importRecords(ctx, "tasks", [row("By name", label.toUpperCase()), row("By id", userId)]);
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.imported, 2);
  const bad = await gate.importRecords(ctx, "tasks", [row("Nobody", "No Such Person")]);
  assert.match(bad.errors[0].message, /must be someone in this home/u);
  const dueOf = (await gate.read(ctx, "tasks", { page: { size: 100 } })).records.find((record) => record[idOf(tasks, "title")] === "By name")[idOf(tasks, "due")];
  assert.equal(new Date(dueOf).toISOString(), "2026-12-01T10:00:00.000Z", "a sheet's time without a zone is UTC");
});

test("an app and the Data tab's tables come with who is using them and the home's people, by name", async (context) => {
  const { home, userId, other, leaver, options } = await setup(context);
  const actor = { type: "person", id: userId, name: "Tester" };
  const app = await home.apps.apps.createApp(actor, { name: "Tasks app" }, options);
  const call = home.browser({ member: { userId, workspace: home.workspace } });
  const opened = await call("GET", `/api/w/${home.workspace.slug}/apps/${app.slug}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.me.id, userId);
  assert.deepEqual(opened.body.people.map((person) => person.id).sort(), [userId, String(other.id), String(leaver.id)].sort());
  assert.ok(opened.body.people.every((person) => typeof person.name === "string" && person.name));
  const tables = await call("GET", `/api/w/${home.workspace.slug}/app-data/tables?brief=true`);
  assert.deepEqual(tables.body.people.map((person) => person.id).sort(), [userId, String(other.id), String(leaver.id)].sort());
});
