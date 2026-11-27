import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";

// Who acted, as scripts see them (D-140): a rule on saving gets the actor's id and role in the home, so an expense app
// can refuse a claimant approving their own claim and a member approving anyone's; a button's script asks
// `people.me()` for the person pressing it. Never anything the browser sends.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const APPROVAL = `async function main(input) {
  const approving = input.record.approved && !(input.previous && input.previous.approved);
  if (!approving) return {};
  if (input.record.claimant === input.actor.id) return { refuse: "You can't approve your own claim." };
  if (!["owner", "admin"].includes(input.actor.role)) return { refuse: "Only owners and admins approve claims." };
  return {};
}`;

test("rules know who acted and their role; a button's script knows who pressed", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-who" });
  const { knex, userId, workspaceId, workspace } = home;
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const person = async (name, role) => {
    const id = String((await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email: `${name}-${stamp}@example.com`, username: `${name}${stamp}`, display_name: name
    }).returning("id"))[0].id);
    await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: id, role_sid: role, status: "active" });
    cleanup.after(() => knex("users").where({ id }).del());
    return id;
  };
  await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role_sid: "owner", status: "active" }).onConflict(["workspace_id", "user_id"]).merge();
  const kim = await person("Kim", "member");
  const lee = await person("Lee", "admin");
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args)
  });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => [] });
  cleanup.after(() => scripts.close());
  const owner = { type: "person", id: userId, name: "Pat" };
  const asPerson = (id, name, role) => ({
    options: home.memberOptions(id, workspace, { role, permissions: [] }),
    actor: { type: "person", id, name },
    via: { kind: "data" }
  });
  await registry.createTable(owner, {
    key: "claims",
    fields: [{ key: "title", type: "text", required: true }, { key: "claimant", type: "person" }, { key: "approved", type: "yesno" }]
  }, home.options);
  await apps.createApp(owner, { name: "Claims" }, home.options);
  const saved = await scripts.save(owner, "claims", {
    key: "approvals", kind: "rule", summary: "Only an owner or admin, never the claimant, approves", settings: { table: "claims", on: ["update"] }, code: APPROVAL,
    tests: [{ name: "own", input: { action: "update", record: { claimant: "7", approved: true }, previous: { approved: false }, actor: { id: "7", role: "admin" } }, expect: { refuse: "You can't approve your own claim." } }]
  }, home.options);
  assert.deepEqual(saved.errors, []);

  const lees = await gate.create(asPerson(lee, "Lee", "admin"), "claims", { title: "Taxi", claimant: lee });
  const kims = await gate.create(asPerson(kim, "Kim", "member"), "claims", { title: "Lunch", claimant: kim });
  await assert.rejects(gate.update(asPerson(lee, "Lee", "admin"), "claims", lees.id, { approved: true }), /approve your own claim/u);
  await assert.rejects(gate.update(asPerson(kim, "Kim", "member"), "claims", lees.id, { approved: true }), /Only owners and admins/u);
  await gate.update(asPerson(lee, "Lee", "admin"), "claims", kims.id, { approved: true });
  // A role read from the home, not the request: a job or a bot's save carries no membership.
  const kimsSecond = await gate.create(asPerson(kim, "Kim", "member"), "claims", { title: "Train", claimant: kim });
  const asJob = (id, name) => ({ options: home.job, actor: { type: "person", id, name }, via: { kind: "data" } });
  await assert.rejects(gate.update(asJob(kim, "Kim"), "claims", lees.id, { approved: true }), /Only owners and admins/u);
  await gate.update(asJob(lee, "Lee"), "claims", kimsSecond.id, { approved: true });

  // ---- A button's script: who pressed it ----
  assert.deepEqual((await scripts.save(owner, "claims", {
    key: "whoami", kind: "action", summary: "Says who pressed",
    code: "async function main() { const me = await people.me(); return { notify: me.name + ' (' + me.role + ')' } }",
    tests: [{ name: "t", input: {}, me: { id: "1", name: "Ann", role: "member" }, expect: { notify: "Ann (member)" } }]
  }, home.options)).errors, []);
  const appId = (await apps.find("claims", home.options)).id;
  const pressed = await scripts.runNamed("action", appId, "whoami", {}, { kind: "button" }, null, home.memberOptions(kim, workspace, { role: "member", permissions: [] }));
  assert.match(pressed.notify, /\(member\)$/u);
});
