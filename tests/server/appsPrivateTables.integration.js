import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";
import { buildAppTools } from "../../packages/bots/src/server/appTools.js";
import { createTableCatalog } from "../../packages/apps/src/server/tableCatalog.js";

// Private tables (D-138), on the test database: owners and admins choose who may read and who may change a table's
// records, and every way in keeps to it, for a member who isn't allowed, a named person and an admin: the data gate's
// reads and writes (the Data tab, its search and export, bots), a screen's list, a script, a job as its person, links,
// related records and roll-ups, and a bot's table list and reads as the person it helps; a public app's visitors keep to its visitor access. The check costs the same however
// many tables are private.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a private table's records reach only whom its owners chose, every way in, at the same cost", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-private" });
  const { knex, userId, workspaceId, workspace, options } = home;
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const member = async (name, role) => {
    const id = String((await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email: `${name}-${stamp}@example.com`, username: `${name}${stamp}`, display_name: name
    }).returning("id"))[0].id);
    await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: id, role_sid: role, status: "active" });
    cleanup.after(() => knex("users").where({ id }).del());
    return id;
  };
  await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role_sid: "owner", status: "active" }).onConflict(["workspace_id", "user_id"]).merge();
  const kim = await member("Kim", "member");
  const ann = await member("Ann", "member");
  const lee = await member("Lee", "admin");
  let scripts = null;
  const { resources, repository, registry, gate, apps, practices, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args)
  });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => [] });
  cleanup.after(() => scripts.close());
  const runtime = createRuntime({ apps, gate, scripts, practices });
  const owner = { type: "person", id: String(userId), name: "Pat" };
  const as = (id, name, role) => ({ options: home.memberOptions(id, workspace, { role, permissions: [] }), actor: { type: "person", id, name }, via: { kind: "data" } });
  const ctxOf = { owner: home.ctx(owner), kim: as(kim, "Kim", "member"), ann: as(ann, "Ann", "member"), lee: as(lee, "Lee", "admin") };
  const code = async (work) => (await work.catch((error) => error)).code;

  await registry.createTable(owner, { key: "staff", fields: [{ key: "name", type: "text" }] }, options);
  await registry.createTable(owner, { key: "salaries", fields: [{ key: "label", type: "text" }, { key: "amount", type: "money" }, { key: "staff", type: "link", target: "staff" }] }, options);
  await registry.addField(owner, "staff", { key: "pay", type: "money", rollup: { from: "salaries", link: "staff", measure: "sum", field: "amount" } }, options);
  const sam = await gate.create(ctxOf.owner, "staff", { name: "Sam" });
  const pay = await gate.create(ctxOf.owner, "salaries", { label: "Sam's pay", amount: 500000, staff: sam.id });
  const ids = Object.fromEntries((await registry.loadTables(options)).flatMap((table) => table.fields.map((field) => [`${table.key}.${field.key}`, field.id])));

  // ---- Choosing: owners and admins; changing needs no less than reading; named people are the home's ----
  assert.equal(await code(registry.chooseAccess(owner, "salaries", { read: "managers", change: "people", people: [ann] }, options)), "apps_table_access_wider_change");
  assert.equal(await code(registry.chooseAccess(owner, "salaries", { read: "people", change: "managers" }, options)), "apps_table_access_people_missing");
  await registry.chooseAccess(owner, "salaries", { read: "people", change: "managers", people: [ann] }, options);

  // ---- The gate: Kim may not read, Ann reads but may not change, Lee (admin) does both ----
  assert.equal(await code(gate.read(ctxOf.kim, "salaries", {})), "apps_table_private");
  assert.equal(await code(gate.get(ctxOf.kim, "salaries", pay.id)), "apps_table_private");
  assert.equal(await code(gate.totals(ctxOf.kim, "salaries", { groupBy: ids["salaries.staff"] })), "apps_table_private");
  assert.equal(await code(gate.create(ctxOf.kim, "salaries", { label: "x" })), "apps_table_private");
  assert.equal((await gate.read(ctxOf.ann, "salaries", {})).records.length, 1, "Ann is named");
  assert.equal(await code(gate.update(ctxOf.ann, "salaries", pay.id, { amount: 1 })), "apps_table_private", "but only owners and admins change it");
  await gate.update(ctxOf.lee, "salaries", pay.id, { amount: 600000 });
  assert.equal(await code(gate.importRecords(ctxOf.ann, "salaries", [{ [ids["salaries.label"]]: "y" }])), "apps_table_private");

  // ---- Links, related records and roll-ups into it ----
  const kimSees = await gate.get(ctxOf.kim, "staff", sam.id);
  assert.equal(kimSees[ids["staff.pay"]], null, "a total of what Kim can't see isn't Kim's");
  assert.equal((await gate.get(ctxOf.ann, "staff", sam.id))[ids["staff.pay"]], 600000);
  assert.deepEqual((await gate.related(ctxOf.kim, "staff", sam.id)).map((group) => group.table.key), [], "its records linking to Sam stay out of sight");
  assert.deepEqual((await gate.related(ctxOf.ann, "staff", sam.id)).map((group) => group.table.key), ["salaries"]);
  await registry.createTable(owner, { key: "reviews", fields: [{ key: "text", type: "text" }, { key: "pay", type: "link", target: "salaries" }] }, options);
  const review = await gate.create(ctxOf.owner, "reviews", { text: "Fine", pay: pay.id });
  const reviewPay = (await registry.loadTables(options)).find((table) => table.key === "reviews").fields.find((field) => field.key === "pay").id;
  assert.deepEqual((await gate.get(ctxOf.kim, "reviews", review.id))[reviewPay], { id: pay.id, label: null }, "a link into it shows its number only");
  assert.equal((await gate.get(ctxOf.ann, "reviews", review.id))[reviewPay].label, "Sam's pay");

  // ---- A bot works as the person it helps: its table list leaves the table out, and its reads are refused ----
  const botFor = (id, role) => buildAppTools({
    apps: { registry, gate, catalog: createTableCatalog({ registry, gate }) }, directory: { findBot: async () => ({ name: "Otto" }) }, call: home.memberOptions(id, workspace, { role, permissions: [] }),
    botId: "1", chatBotId: null, userId: id, isBuilder: false, after: [], attempted: [], via: null
  });
  const tablesOf = async (id, role) => (await botFor(id, role).dataTables.execute({}, {})).tables.map((table) => table.table);
  assert.ok(!(await tablesOf(kim, "member")).includes("salaries"), "Kim's bot doesn't list it");
  assert.ok((await tablesOf(ann, "member")).includes("salaries"), "Ann's bot does");
  assert.match((await botFor(kim, "member").dataQuery.execute({ table: "salaries" }, {})).error ?? "", /Salaries is private/u);
  assert.equal((await botFor(ann, "member").dataQuery.execute({ table: "salaries" }, {})).total, 1);

  // ---- A screen's list and a button's script, as the person using the app ----
  await apps.createApp(owner, { name: "Payroll" }, options);
  assert.deepEqual((await scripts.save(owner, "payroll", {
    key: "count_pay", kind: "action", summary: "Counts the pay records", code: "async function main() { return { notify: String((await records.list('salaries')).length) } }",
    tests: [{ name: "t", input: {}, records: { salaries: [{ label: "a" }] }, expect: { notify: "1" } }]
  }, options)).errors, []);
  const definition = { home: "pay", screens: { pay: { data: { all: { from: "salaries" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Label", value: "=row.label" }] }] } } };
  assert.deepEqual((await apps.saveDraft(owner, "payroll", definition, "", options)).errors, []);
  await apps.publish(owner, "payroll", {}, options);
  const appId = (await apps.find("payroll", options)).id;
  const list = (who) => runtime.query(who, { slug: appId, version: "live", screen: "pay", query: "all" });
  assert.equal(await code(list(ctxOf.kim)), "apps_table_private");
  assert.equal((await list(ctxOf.ann)).records.length, 1);
  const press = (id, role) => scripts.runNamed("action", appId, "count_pay", {}, { kind: "button" }, null, home.memberOptions(id, workspace, { role, permissions: [] }));
  await assert.rejects(press(kim, "member"), /Salaries is private/u);
  assert.equal((await press(ann, "member")).notify, "1");

  // ---- A job reaches it as its person; with none (they left), it doesn't ----
  const job = `async function main() { return (await records.list('salaries')).length }`;
  assert.deepEqual((await scripts.save(owner, "payroll", {
    key: "nightly_pay", kind: "job", summary: "Reads pay", settings: { every: "day", at: "02:00" }, code: job,
    tests: [{ name: "t", input: {}, records: { salaries: [] }, expect: 0 }]
  }, options)).errors, []);
  await apps.publish(owner, "payroll", {}, options);
  const runJob = async (person) => {
    await knex("app_scripts").where({ key: "nightly_pay", draft: false }).update({ runs_as_user_id: person, next_run_at: new Date(Date.now() - 1000) });
    await scripts.runDue({ matchChanges: async () => [] });
    return (await knex("app_script_runs").join("app_scripts", "app_scripts.id", "app_script_runs.script_id").where({ "app_scripts.key": "nightly_pay" }).orderBy("app_script_runs.id", "desc").first("app_script_runs.ok")).ok;
  };
  assert.equal(await runJob(ann), true, "as Ann, it reads");
  assert.equal(await runJob(kim), false, "as Kim, it's refused");
  assert.equal(await runJob(null), false, "with no person, it's refused");

  // ---- A public app's visitors keep to its visitor access ----
  const visitor = { signedIn: false, email: "" };
  const publicRule = { public: { tables: { salaries: { can: ["list"], rows: "all", read: ["label"] } } } };
  const visitorCtx = { workspaceId, actor: { type: "visitor", id: null, name: "Public" }, via: { kind: "public" }, visitor, access: compile(publicRule, await registry.loadTables(options), visitor), options: home.job };
  assert.equal((await gate.read(visitorCtx, "salaries", {})).records.length, 1);

  // ---- The check costs the same with 1 private table or 50 ----
  const once = async () => queriesDuring(knex, () => gate.read({ ...ctxOf.ann }, "salaries", { page: { size: 10 } }));
  const withOne = await once();
  for (let index = 0; index < 49; index += 1) {
    await registry.createTable(owner, { key: `vault_${index}`, fields: [{ key: "name", type: "text" }] }, options);
    await registry.chooseAccess(owner, `vault_${index}`, { read: "managers", change: "managers" }, options);
  }
  await registry.loadTables(options);
  assert.equal(await once(), withOne, "the same reads with 50 private tables");
});
