import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Inside a home there's nothing private (D-66): every member sees every app and view, and reads,
// changes and imports into every table. Owners and admins only choose the home's settings.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a member sees every app and changes every table", async (context) => {
  const knex = await connectTestDatabase();
  const [alice, bob, carol] = (await knex("users").orderBy("id").limit(3)).map((user) => String(user.id));
  if (!carol) {
    // Close the connection before failing, so the run ends instead of waiting on it.
    await knex.destroy();
    assert.fail("the test database needs three users (the test template seeds them: tests/support/testDatabase.mjs)");
  }
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  // The home is alice's (the first user's), and bob is a member of it.
  const home = await appsHome(cleanup, { slug: "apps-perm", knex });
  assert.equal(home.userId, alice);
  const { workspaceId, workspace } = home;
  const { registry, gate, apps } = home.apps;
  await knex("workspace_memberships").insert([alice, bob].map((userId) => ({ workspace_id: workspaceId, user_id: userId, role_sid: userId === alice ? "owner" : "member", status: "active" })));
  const person = (id, canManage = false) => ({
    options: home.memberOptions(id, workspace, canManage ? {} : { role: "member", permissions: [] }),
    userId: id,
    canManage,
    actor: { type: "person", id, name: `User ${id}` },
    via: { kind: "data" }
  });
  const owner = person(alice, true);
  const member = person(bob);

  await registry.createTable(owner.actor, { key: "salaries", fields: [{ key: "who", type: "text", required: true }, { key: "amount", type: "money" }] }, owner.options);
  await apps.createApp(owner.actor, { name: "Payroll" }, owner.options);
  await apps.createApp(owner.actor, { name: "Lunch" }, owner.options);

  // Every member sees every app (D-66), even one kept to chosen people before: that's no longer read. The chosen
  // people's table is gone (D-78); the column stays one more release, unread (oldPermissionColumns.integration.js).
  const names = async (ctx) => (await apps.list({}, ctx.options)).apps.map((app) => app.name);
  await knex("apps").where({ workspace_id: workspaceId, slug: "payroll" }).update({ access: "members" });
  assert.deepEqual(await names(member), ["Lunch", "Payroll"]);
  assert.deepEqual(await names(owner), ["Lunch", "Payroll"]);
  assert.deepEqual((await apps.list({ withPins: false }, home.job)).apps.map((app) => app.name), ["Lunch", "Payroll"], "bots see every app");
  assert.equal((await apps.get("payroll", {}, member.options)).app.name, "Payroll");
  for (const app of (await apps.list({}, member.options)).apps) assert.equal("access" in app, false, "no answer says who may use an app");
  for (const removed of ["canUse", "usable", "setAccess", "accessOf"]) assert.equal(apps[removed], undefined, `${removed} is gone`);

  // Every member reads and changes every table (D-66), even one kept to chosen people before.
  const salaries = (await registry.loadTables(member.options))[0];
  await knex("app_tables").where({ id: salaries.id }).update({ writers: "editors" });
  const tables = await registry.loadTables(member.options);
  assert.equal("writers" in tables[0] || "editors" in tables[0], false, "no answer says who may change a table");
  assert.equal(registry.setWriters, undefined, "setWriters is gone");
  const who = salaries.fields.find((field) => field.key === "who").id;
  const pay = await gate.create(member, "salaries", { who: "Bob", amount: 100 });
  assert.equal((await gate.update(member, "salaries", pay.id, { who: "Bob, raised" }))[who], "Bob, raised");
  await gate.markObsolete(member, "salaries", pay.id);
  await gate.restore(member, "salaries", pay.id);
  assert.equal((await gate.read(member, "salaries")).records.length, 1);
  const imported = await gate.importRecords(member, "salaries", [{ [who]: "Imported" }]);
  assert.equal(imported.imported, 1, "and imports into it");
  assert.equal((await gate.read(member, "salaries")).records.length, 2);
  const changes = await knex("audit_events").where({ workspace_id: workspaceId, table_id: salaries.id }).whereRaw("actor->>'id' = ?", [bob]).pluck("action");
  assert.deepEqual(changes.sort(), ["create", "create", "obsolete", "restore", "update"], "each change is in the Activity, with who made it");
});
