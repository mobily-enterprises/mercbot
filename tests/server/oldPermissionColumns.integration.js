import assert from "node:assert/strict";
import test from "node:test";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { appsHome } from "../support/appsHome.mjs";
import { statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The old permission columns, apps.access and app_tables.writers, stay one more release with nothing reading them
// (D-78). Set the way the third stage kept an app and a table to chosen people (D-35), they keep nothing from anyone:
// everyone in the home still uses the app and changes the table (D-66), and no statement names them.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("the old permission columns keep nothing from anyone in the home", async (context) => {
  const knex = await connectTestDatabase();
  const [alice, bob] = (await knex("users").orderBy("id").limit(2)).map((user) => String(user.id));
  if (!bob) {
    await knex.destroy();
    assert.fail("the test database needs two users (the test template seeds them: tests/support/testDatabase.mjs)");
  }
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const home = await appsHome(cleanup, { slug: "old-perms", knex });
  const { workspaceId, workspace } = home;
  const { registry, gate, apps } = home.apps;
  // alice owns the home and bob is a member.
  await knex("workspace_memberships").insert([
    { workspace_id: workspaceId, user_id: alice, role_sid: "owner", status: "active" },
    { workspace_id: workspaceId, user_id: bob, role_sid: "member", status: "active" }
  ]);
  const person = (id) => ({
    options: home.memberOptions(id, workspace, id === alice ? {} : { role: "member", permissions: [] }),
    actor: { type: "person", id, name: `User ${id}` },
    via: { kind: "data" }
  });
  const owner = person(alice);
  const member = person(bob);
  await registry.createTable(owner.actor, { key: "salaries", fields: [{ key: "who", type: "text", required: true }, { key: "amount", type: "money" }] }, owner.options);
  const payroll = await apps.createApp(owner.actor, { name: "Payroll" }, owner.options);
  const salaries = (await registry.loadTables(owner.options)).find((table) => table.key === "salaries");
  // The app kept to its chosen people and the table to its editors, as the third stage's columns did.
  await knex("apps").where({ id: payroll.id }).update({ access: "members" });
  await knex("app_tables").where({ id: salaries.id }).update({ writers: "editors" });

  // Everyone in the home uses the app and changes the table, and nothing selects apps.access or app_tables.writers.
  const statements = (await statementsDuring(knex, async () => {
    for (const ctx of [owner, member]) {
      assert.deepEqual((await apps.list({}, ctx.options)).apps.map((app) => app.name), ["Payroll"]);
      assert.equal((await apps.get("payroll", {}, ctx.options)).app.name, "Payroll");
      const pay = await gate.create(ctx, "salaries", { who: `Paid by ${ctx.actor.id}`, amount: 1000 });
      await gate.update(ctx, "salaries", pay.id, { amount: 1200 });
    }
    await registry.changed(owner.options);
    await registry.loadTables(owner.options);
  }, /from "(apps|app_tables)"/u)).map((statement) => statement.sql);
  assert.ok(statements.some((sql) => /from "apps"/u.test(sql)) && statements.some((sql) => /from "app_tables"/u.test(sql)), "apps and tables were read");
  assert.deepEqual(statements.filter((sql) => /"access"|"writers"/u.test(sql)), [], "no statement names apps.access or app_tables.writers");
  assert.equal((await gate.read(member, "salaries")).records.length, 2);
});
