import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { AnyapiRegistry } from "@jskit-ai/resource-runtime/server/anyapi";
import { connectTestDatabase } from "../support/testDatabase.mjs";
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
      { key: "notes", type: "longtext" },
      { key: "hours", type: "number" },
      { key: "done", type: "yesno" }
    ]
  }, options);
  const pipeline = await registry.createTable(person, {
    key: "pipeline",
    fields: [{ key: "contact", type: "link", target: "contacts", unique: true, required: true }, { key: "stage", type: "text" }]
  }, options);
  const idOf = (table, key) => table.fields.find((field) => field.key === key).id;
  return { home, knex, userId: String(userId), other, leaver, workspaceId, options, registry, gate, ctx, person, contacts, tasks, pipeline, idOf };
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

test("an empty number or yes/no is found as \"\" like any field's, and only a list field is asked for a tag", async (context) => {
  const { gate, ctx, tasks, idOf } = await setup(context);
  await gate.create(ctx, "tasks", { title: "Logged", hours: 2, done: true });
  await gate.create(ctx, "tasks", { title: "Open" });
  const keyToId = new Map(tasks.fields.map((field) => [field.key, field.id]));
  const where = (formula) => ({ plan: planToIds(compileWhere({ ...celSchema(tasks), state: {}, params: {} }, formula), keyToId), variables: { state: {}, params: {} }, values: { state: {}, params: {} } });
  const titles = async (formula) => (await gate.read(ctx, "tasks", { where: where(formula) })).records.map((record) => record[idOf(tasks, "title")]).sort();
  assert.deepEqual(await titles('=hours == ""'), ["Open"]);
  assert.deepEqual(await titles('=done != ""'), ["Logged"]);
  // A text holds no tags: `"x" in title` is refused as a filter, never sent to the database as a list test.
  assert.throws(() => where('="Logged" in title'), /can't be turned into a database query/u);
});

test("a table refuses a tags, file or picture field past the ones its storage holds, saying so, and stays as it was", async (context) => {
  const { registry, gate, ctx, options, person } = await setup(context);
  // Each table has 10 places for tags, files and pictures, removed fields' included (AnyAPI's json slots).
  const lists = Array.from({ length: 10 }, (_, at) => ({ key: `list_${at}`, type: at % 2 ? "tags" : "file" }));
  await registry.createTable(person, { key: "albums", fields: [{ key: "title", type: "text" }, ...lists] }, options);
  const full = { statusCode: 409, code: "apps_table_slots_full" };
  await assert.rejects(registry.addField(person, "albums", { key: "cover", type: "image" }, options), full);
  await assert.rejects(registry.createTable(person, { key: "scrapbook", fields: [...lists, { key: "extra", type: "tags" }] }, options), full);
  const tables = await registry.loadTables(options);
  assert.equal(tables.find((table) => table.key === "albums").fields.length, 11, "nothing added");
  assert.ok(!tables.some((table) => table.key === "scrapbook"));
  await registry.addField(person, "albums", { key: "year", type: "number" }, options);
  assert.equal((await gate.create(ctx, "albums", { title: "Summer", list_1: ["beach"], year: 2026 })).obsolete, false);
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

// Links are indexed from the moment they're made (D-130): a link takes one of the shared table's indexed slots, which
// has its own database index, so a filter on it reads only the rows it finds. AnyAPI picks a field's slot once and keeps
// it, so a table holds five links at most, and a sixth is refused, saying so, with the table as it was.
test("a link is made in an indexed slot, five to a table, and a sixth is refused, saying so", async (context) => {
  const { knex, registry, person, options, workspaceId, pipeline, idOf } = await setup(context);
  const slotOf = async (table, key) => (await knex("any_field_configs as f")
    .join("any_resource_configs as r", "r.id", "f.resource_config_id")
    .where({ "r.tenant_id": `ws:${workspaceId}`, "r.resource": table.id, "f.field_name": idOf(table, key) })
    .first("f.slot_column")).slot_column;
  const slot = await slotOf(pipeline, "contact");
  assert.match(slot, /^indexed_string_\d+$/u, "the one-to-one link");
  const indexes = (await knex.raw("select indexdef from pg_indexes where tablename = 'any_records'")).rows.map((row) => row.indexdef);
  assert.ok(indexes.some((index) => index.includes(`(tenant_id, resource, ${slot})`)), "its slot has its own index");
  assert.match(await slotOf(pipeline, "stage"), /^string_\d+$/u, "other text stays in plain slots");

  const links = Array.from({ length: 5 }, (_, at) => ({ key: `link_${at}`, type: "link", target: "contacts" }));
  const wide = await registry.createTable(person, { key: "wide", fields: [{ key: "title", type: "text" }, ...links] }, options);
  for (const link of links) assert.match(await slotOf(wide, link.key), /^indexed_string_\d+$/u, link.key);
  const full = { statusCode: 409, code: "apps_table_slots_full", message: /no room for another link: a table holds 5 links at most/u };
  await assert.rejects(registry.addField(person, "wide", { key: "link_5", type: "link", target: "contacts" }, options), full);
  await assert.rejects(registry.createTable(person, { key: "wider", fields: [...links, { key: "link_5", type: "link", target: "contacts" }] }, options), full);
  const tables = await registry.loadTables(options);
  assert.equal(tables.find((table) => table.key === "wide").fields.length, 6, "nothing added");
  assert.ok(!tables.some((table) => table.key === "wider"));
  await registry.addField(person, "wide", { key: "notes", type: "text" }, options);
});

// AnyAPI keeps a stored field's slot when its indexed declaration changes: a link made before links were indexed keeps
// its plain slot and its values, and declaring it indexed never asks for a migration.
test("a link stored in a plain slot keeps it, and its values, once links are declared indexed", async (context) => {
  // A connection of its own: AnyAPI's registry runs its own transactions.
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  const anyapi = new AnyapiRegistry({ knex });
  const tenant = `ws:keep-${Date.now()}`;
  const cleanUp = async () => {
    await knex("any_records").where({ tenant_id: tenant }).del();
    await knex("any_resource_configs").where({ tenant_id: tenant }).del();
  };
  const before = await anyapi.registerResource({ tenant, resource: "t_old", schema: { f_link: { type: "string", nullable: true } } });
  const slot = before.fields.f_link.slot;
  assert.match(slot, /^string_\d+$/u);
  await knex("any_records").insert({ tenant_id: tenant, resource: "t_old", logical_id: "1", [slot]: "42" });
  const after = await anyapi.registerResource({ tenant, resource: "t_old", schema: { f_link: { type: "string", nullable: true, indexed: true } } });
  assert.equal(after.fields.f_link.slot, slot, "the same slot");
  assert.equal((await knex("any_records").where({ tenant_id: tenant }).first(slot))[slot], "42");
  await cleanUp();
});
