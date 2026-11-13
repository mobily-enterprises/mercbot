import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { startApps } from "../support/appsFeatures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";

const { tenantOf } = anyapiTestables;

// Visitor access (D-66): the fence is in the data gate, so a visitor's context reaches only what the public app
// lists, whoever serves its visitors: a signed-in visitor's own records, a link's rows, and nothing at all without
// access. Each path is its own subtest, so each one shows. The apps feature runs as the server starts it
// (tests/support/appsFeatures.mjs), and the gate's checks get a visitor's context in the home, as a visitor's call
// runs (a system context for that home).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const forbidden = (pattern) => (error) => error.statusCode === 403 && (!pattern || pattern.test(error.message));
const missing = (error) => error.statusCode === 400 && /doesn't exist/u.test(error.message);

test("a visitor's context reaches only what a public app lists, on every method of the gate", async (context) => {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first()).id);
  const slug = `apps-access-${Date.now()}`;
  const [home] = await knex("workspaces").insert({ slug, name: "Access test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = home.id ?? home;
  const started = await startApps({ knex, env: { ...process.env, MERCBOT_VAULT_KEY: randomBytes(32).toString("base64") } });
  const { registry, gate, apps, scripts } = started.apps;
  const member = started.memberOptions(userId, { id: workspaceId, slug });
  // A visitor's calls run in the home alone (a system context for that home).
  const visitorOptions = started.jobOptions(workspaceId);
  context.after(async () => {
    await started.stop();
    await knex("any_records").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("any_resource_configs").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
  });

  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = { workspaceId, actor: person, via: { kind: "data" }, options: member };
  await registry.createTable(person, { key: "teams", fields: [{ key: "title", type: "text", required: true }] }, member);
  const teams = (await registry.loadTables(member)).find((table) => table.key === "teams");
  await registry.createTable(person, {
    key: "people",
    fields: [
      { key: "name", type: "text", required: true },
      { key: "email", type: "email" },
      { key: "salary", type: "money" },
      { key: "team", type: "link", target: teams.id },
      { key: "badge", type: "text" }
    ]
  }, member);
  await registry.createTable(person, { key: "payroll", fields: [{ key: "who", type: "text", required: true }, { key: "amount", type: "money" }] }, member);
  const tables = await registry.loadTables(member);
  const people = tables.find((table) => table.key === "people");
  const idOf = (key) => people.fields.find((field) => field.key === key).id;
  const red = await gate.create(ctx, "teams", { title: "Red" });
  const blue = await gate.create(ctx, "teams", { title: "Blue" });
  const ann = await gate.create(ctx, "people", { name: "Ann", email: "ann@example.test", salary: 900000, team: red.id });
  const bob = await gate.create(ctx, "people", { name: "Bob", email: "bob@example.test", salary: 500000 });
  await gate.create(ctx, "payroll", { who: "Ann", amount: 900000 });

  await apps.createApp(person, { name: "Directory" }, member);
  const save = async (input) => assert.deepEqual((await scripts.save(person, "directory", input, member)).errors, []);
  await save({
    key: "everyone", kind: "source", summary: "Everyone and their salary",
    code: "async function main() { return (await records.list('people', {})).map((row) => ({ name: row.name, salary: row.salary })) }",
    tests: [{ name: "lists", input: null, records: { people: [{ name: "A", salary: 5 }] }, expect: [{ name: "A", salary: 5 }] }]
  });
  await save({
    key: "pay", kind: "source", summary: "Payroll",
    code: "async function main() { return (await records.list('payroll', {})).map((row) => ({ who: row.who })) }",
    tests: [{ name: "lists", input: null, records: { payroll: [{ who: "A" }] }, expect: [{ who: "A" }] }]
  });
  // A rule on saving runs as the home: it counts every live person, Bob too, and fills in a badge.
  await save({
    key: "badge", kind: "rule", summary: "Numbers each new person", settings: { table: "people" },
    code: "async function main() { return { set: { badge: 'P-' + (await records.list('people', { limit: 100 })).length } } }",
    tests: [{ name: "numbers", input: { action: "create", record: { name: "A" }, previous: null }, records: { people: [{ name: "X" }] }, expect: { set: { badge: "P-1" } } }]
  });

  // The public screen both definitions share: a list with a row click, a data script's list, a form.
  const peopleScreen = () => ({
    public: true,
    data: { list: { from: "people", sort: "name" }, everyone: { script: "everyone" }, pay: { script: "pay" } },
    content: [
      {
        type: "table",
        rows: "=data.list",
        columns: [{ label: "Name", value: "=row.name" }, { label: "Team", value: "=row.team" }],
        onRowClick: [{ notify: '="Hi " + row.name' }]
      },
      { type: "table", rows: "=data.everyone", columns: [{ label: "Name", value: "=row.name" }] },
      {
        type: "form",
        table: "people",
        fields: ["name", "email"],
        buttons: [{ type: "button", label: "Join", do: [{ create: { table: "people", values: "=form.values" } }] }]
      }
    ]
  });
  const inside = { data: { all: { from: "people" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Salary", value: "=row.salary" }] }] };
  const base = () => ({
    home: "inside",
    public: { home: "people", tables: { people: { can: ["list", "get", "create"], rows: '=name != "Bob"', read: ["name", "team"], write: ["name", "email"] } } },
    screens: { inside, people: peopleScreen() }
  });
  assert.deepEqual((await apps.saveDraft(person, "directory", base(), "v1", member)).errors, []);
  await apps.publish(person, "directory", {}, member);
  await apps.setPublic(person, "directory", true, member);

  const visitor = { signedIn: false, email: "" };
  const visitorCtx = (definition) => ({
    workspaceId,
    actor: { type: "visitor", id: null, name: "Directory (public form)" },
    via: { kind: "public" },
    visitor,
    access: compile(definition, tables, visitor),
    options: visitorOptions
  });

  await context.test("a signed-in visitor changes and removes only their own records, and the owner stays theirs (P10)", async () => {
    const signedIn = { signedIn: true, email: "ANN@example.test" };
    const own = compile(
      { public: { signIn: "required", tables: { people: { can: ["get", "update", "delete"], rows: "own", owner: "email", read: ["name"], write: ["name"] } } } },
      tables,
      signedIn
    );
    const annCtx = { workspaceId, actor: { type: "visitor", id: "1", name: "ann@example.test via Directory" }, via: { kind: "public" }, visitor: signedIn, access: own, options: visitorOptions };
    await assert.rejects(gate.get(annCtx, "people", bob.id), (error) => error.statusCode === 404);
    await assert.rejects(gate.update(annCtx, "people", bob.id, { name: "Hijacked" }), (error) => error.statusCode === 404);
    await assert.rejects(gate.markObsolete(annCtx, "people", bob.id), (error) => error.statusCode === 404);
    const changed = await gate.update(annCtx, "people", ann.id, { name: "Ann B", email: "eve@example.test" });
    assert.deepEqual(Object.keys(changed).sort(), ["id", "obsolete", idOf("name")].sort(), "an update gives back only what they may read");
    const stored = await gate.get(ctx, "people", ann.id);
    assert.deepEqual([stored[idOf("name")], stored[idOf("email")]], ["Ann B", "ann@example.test"], "the owner can't be changed");
    assert.deepEqual(Object.keys(await gate.get(annCtx, "people", ann.id)).sort(), ["id", "obsolete", idOf("name")].sort());
    await assert.rejects(gate.restore(annCtx, "people", ann.id), forbidden());
    await gate.update(ctx, "people", ann.id, { name: "Ann" });
  });

  await context.test("links reach only the linked table's rows: labels, groups' names and links a visitor writes (P5, P9)", async () => {
    const dan = await gate.create(ctx, "people", { name: "Dan", email: "dan@example.test", team: blue.id });
    const linked = base();
    linked.public.tables.people.write.push("team");
    linked.public.tables.teams = { can: [], rows: '=title != "Blue"', read: ["title"] };
    const linkedCtx = visitorCtx(linked);
    const { records } = await gate.read(linkedCtx, "people");
    const teamOf = (name) => records.find((record) => record[idOf("name")] === name)[idOf("team")];
    assert.deepEqual(teamOf("Ann"), { id: red.id, label: "Red", obsolete: false, missing: false });
    assert.deepEqual(teamOf("Dan"), { id: blue.id, label: null }, "Blue is outside the teams' rows");
    assert.deepEqual([...(await gate.getMany(linkedCtx, "teams", [red.id, blue.id])).keys()], [red.id], "a group's name, as totals grouped by team get it");
    await assert.rejects(gate.create(linkedCtx, "people", { name: "Gil", team: blue.id }), missing, "a link to a record outside the rows");
    await assert.rejects(gate.create(linkedCtx, "people", { name: "Gil", team: "999999" }), missing, "reads the same as a missing one");
    const gil = await gate.create(linkedCtx, "people", { name: "Gil", team: red.id });
    await gate.markObsolete(ctx, "people", gil.id);
    await gate.markObsolete(ctx, "people", dan.id);
  });

  await context.test("a visitor's ctx without access reaches nothing, on every method of the gate", async () => {
    const bare = { workspaceId, actor: { type: "visitor", id: null, name: "No access" }, via: { kind: "public" }, visitor, options: visitorOptions };
    for (const [name, call] of Object.entries({
      read: () => gate.read(bare, "people"),
      get: () => gate.get(bare, "people", ann.id),
      getMany: () => gate.getMany(bare, "people", [ann.id]),
      create: () => gate.create(bare, "people", { name: "Gus" }),
      update: () => gate.update(bare, "people", ann.id, { name: "Gus" }),
      markObsolete: () => gate.markObsolete(bare, "people", ann.id),
      restore: () => gate.restore(bare, "people", ann.id),
      history: () => gate.history(bare, "people", ann.id),
      totals: () => gate.totals(bare, "people", { groupBy: idOf("name") }),
      grandTotal: () => gate.grandTotal(bare, "people"),
      count: () => gate.count(bare, "people"),
      activity: () => gate.activity(bare),
      actors: () => gate.actors(bare),
      importRecords: () => gate.importRecords(bare, "people", [{ name: "Gus" }])
    })) await assert.rejects(call(), forbidden(), name);
  });

});
