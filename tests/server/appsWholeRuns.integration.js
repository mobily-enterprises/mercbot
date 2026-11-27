import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";

// A script's changes are all or nothing (D-140): a button's run that fails leaves none of its records and none of the AI
// work it queued, a run reads what it wrote, and a job has a bigger budget than a button (200 record calls, not 50).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const save = (key, code, kind = "action", settings = {}, outcome = { expect: {} }) => ({
  key, kind, summary: key.replaceAll("_", " "), settings, code,
  tests: [{ name: "runs", input: {}, records: { notes: [] }, ai: { picture: { picture: "1" } }, ...outcome }]
});

test("a run's changes are all or nothing, it reads its own writes, and a job's budget is bigger", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-whole" });
  const { knex, options } = home;
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args)
  });
  const [made] = await knex("bots").insert({ made_by: home.userId, workspace_id: home.workspaceId, name: "Otto", color: "#7E57C2" }).returning("id");
  const bot = { id: String(made.id ?? made), name: "Otto", archived: false, main: true };
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => [bot] });
  cleanup.after(() => scripts.close());
  const owner = { type: "person", id: String(home.userId), name: "Pat" };
  const ctx = home.ctx(owner);
  await registry.createTable(owner, { key: "notes", fields: [{ key: "text", type: "text" }, { key: "picture", type: "image" }] }, options);
  await apps.createApp(owner, { name: "Notes" }, options);
  const appId = (await apps.find("notes", options)).id;
  // A saved script is the draft's until it's published (D-139).
  const saved = async (...args) => {
    assert.deepEqual((await scripts.save(owner, "notes", save(...args), options)).errors, []);
    await apps.publish(owner, "notes", {}, options);
  };
  const press = (key) => scripts.runNamed("action", appId, key, {}, { kind: "button" }, null, options);
  const notes = async () => (await gate.read(ctx, "notes", { page: { size: 200 } })).records.length;

  await saved("half_done", `async function main() {
    await records.create("notes", { text: "one" });
    await records.create("notes", { text: "two" });
    throw new Error("the third step failed");
  }`, "action", {}, { expectError: "the third step failed" });
  await assert.rejects(press("half_done"), /the third step failed/u);
  assert.equal(await notes(), 0, "neither note stays");

  await saved("reads_its_own", `async function main() {
    const made = await records.create("notes", { text: "fresh" });
    const again = await records.get("notes", made.id);
    const listed = await records.list("notes", { where: '=text == "fresh"' });
    return { notify: again.text + " " + listed.length };
  }`, "action", {}, { expect: { notify: "fresh 1" } });
  assert.equal((await press("reads_its_own")).notify, "fresh 1", "it sees what it wrote before it commits");
  assert.equal(await notes(), 1);

  await knex("apps").where({ id: appId }).update({ connected_access: JSON.stringify(["ai"]) });
  await saved("picture_then_fail", `async function main() {
    const made = await records.create("notes", { text: "with a picture" });
    await ai.picture({ prompt: "a cat", into: { table: "notes", id: made.id, field: "picture" } });
    throw new Error("changed my mind");
  }`, "action", {}, { expectError: "changed my mind" });
  await assert.rejects(press("picture_then_fail"), /changed my mind/u);
  assert.equal(Number((await knex("app_jobs").where({ app_id: appId }).count({ n: "*" }))[0].n), 0, "the picture it queued went with it");
  assert.equal(await notes(), 1);

  const many = (count) => `async function main() { for (let n = 0; n < ${count}; n += 1) await records.create("notes", { text: "n" + n }); return {}; }`;
  await saved("sixty", many(60));
  await assert.rejects(press("sixty"), /at most 50 record calls per run/u, "a button keeps its 50");
  assert.equal(await notes(), 1, "and leaves nothing of them");
  await saved("nightly", many(120), "job", { every: "day", at: "02:00" });
  await knex("app_scripts").where({ app_id: appId, key: "nightly" }).update({ next_run_at: new Date(Date.now() - 1000) });
  await scripts.runDue({ matchChanges: async () => [] });
  const [run] = await knex("app_script_runs").join("app_scripts", "app_scripts.id", "app_script_runs.script_id").where({ "app_scripts.key": "nightly", "app_scripts.app_id": appId }).select("app_script_runs.ok", "app_script_runs.error");
  assert.deepEqual([run.ok, run.error], [true, null], "a job does 120");
  assert.equal(await notes(), 121);
});
