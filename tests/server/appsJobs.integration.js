import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { testDatabaseConfig } from "../support/testDatabase.mjs";
import { createAppJobs } from "../../packages/apps/src/server/appJobs.js";
import { withPlatformSearch } from "../../packages/apps/src/server/platformTables.js";
import { appJobResource } from "../../packages/apps/src/server/tableResources.js";
import { startAppJobRunner } from "../../packages/bots/src/server/appJobRunner.js";

// Bot tasks from Apps (D-35, D-15): two servers' runners share the queue and each task runs once;
// a failing task is marked failed; draining waits for tasks in progress.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/**
 * One server's runner parts on its own connection, as the server wires them: apps.jobs (createAppJobs on AppsFeature's
 * app_jobs handle) and the bots' system context the runner claims in (BotsFeature's systemScope).
 * @param {import("knex").Knex} knex
 */
async function serverOn(knex) {
  const runtime = await createTestResourceRuntime({ knex });
  const { appJobs } = await runtime.own("mercbot.apps", withPlatformSearch([appJobResource]));
  const systemContext = runtime.declareSystemScope("mercbot.bots", "run the bots' queued work and resume their replies in every home");
  return { jobs: createAppJobs({ appJobs }), systemContext };
}

test("each queued task runs once across servers", async (context) => {
  const config = await testDatabaseConfig();
  const knex = knexLib(config);
  const other = knexLib(config);
  const userId = (await knex("users").first())?.id;
  const [home] = await knex("workspaces").insert({ slug: `apps-jobs-${Date.now()}`, name: "Jobs test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = home.id ?? home;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Tess", color: "#1E86FC" }).returning("id");
  context.after(async () => {
    await knex("workspaces").where({ id: workspaceId }).del();
    await Promise.all([knex.destroy(), other.destroy()]);
  });
  await knex("app_jobs").where({ status: "queued" }).update({ status: "failed" }); // leftovers of earlier runs
  const rows = Array.from({ length: 12 }, (_, index) => ({ workspace_id: workspaceId, kind: "handoff", bot_id: bot.id ?? bot, user_id: userId, title: `Task ${index}`, prompt: index === 5 ? "fail" : "ok" }));
  const ids = (await knex("app_jobs").insert(rows).returning("id")).map((row) => String(row.id ?? row));

  const ran = [];
  const run = async (job) => {
    ran.push(String(job.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (job.prompt === "fail") throw new Error("boom");
  };
  const notices = { publish: async () => {}, subscribe: () => () => {} };
  const one = startAppJobRunner({ ...(await serverOn(knex)), notices, run, everyMs: 50, concurrency: 3 });
  const two = startAppJobRunner({ ...(await serverOn(other)), notices, run, everyMs: 50, concurrency: 3 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && Number((await knex("app_jobs").whereIn("id", ids).whereIn("status", ["queued", "running"]).count("* as n").first()).n) > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await Promise.all([one.drain(2000), two.drain(2000)]);

  assert.deepEqual([...ran].sort(), [...ids].sort(), "every task ran exactly once");
  const statuses = Object.fromEntries((await knex("app_jobs").whereIn("id", ids).select("id", "status", "finished_at")).map((row) => [String(row.id), row]));
  assert.equal(statuses[ids[5]].status, "failed");
  assert.equal(Object.values(statuses).filter((row) => row.status === "done" && row.finished_at).length, 11);
});
