import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";
import { writeScript } from "../../packages/bots/src/server/scriptWriter.js";

// The Builder's coding loop (D-35): it keeps going while tests fail, saves only a passing script,
// stops after five rounds or 90 seconds, and keeps every round for the Logic tab.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("the coding loop fixes failures, gives up after five rounds, and respects its time cap", async (context) => {
  // The Builder's turn calls in the home with its person's options (`call`); stopping the features closes the
  // scripts' pool.
  const { knex, apps: capability, userId, workspaceId, options: call } = await appsHome(context, { slug: "apps-writer" });
  const { registry, apps, scripts } = capability;
  const actor = { type: "bot", id: "1", name: "Builder" };
  await registry.createTable({ type: "person", id: userId, name: "Pat" }, { key: "leads", fields: [{ key: "name", type: "text", required: true }, { key: "score", type: "number" }] }, call);
  await apps.createApp(actor, { name: "Leads" }, call);
  const base = { scripts, registry, call, actor, app: "leads", key: "grade", kind: "function", settings: { params: ["score"] }, job: "A for 90 and up, B for 70 and up, else C." };
  const tests = [{ name: "A", input: [95], expect: "A" }, { name: "B", input: [70], expect: "B" }, { name: "C", input: [10], expect: "C" }];

  // Round 1 is wrong at the boundary; round 2 sees the failure and fixes it.
  const prompts = [];
  const fixing = async (prompt) => {
    prompts.push(prompt);
    return prompts.length === 1
      ? { summary: "Grades a score", code: "function main(score) { return score > 90 ? 'A' : score > 70 ? 'B' : 'C' }", tests }
      : { summary: "Grades a score", code: "function main(score) { return score >= 90 ? 'A' : score >= 70 ? 'B' : 'C' }", tests };
  };
  const fixed = await writeScript({ ...base, model: fixing });
  assert.equal(fixed.status, "saved");
  assert.equal(fixed.rounds, 2);
  assert.match(prompts[1], /It failed:.*"name":"B".*"got":"C"/su, "the failures went back to the model");
  assert.match(prompts[0], /leads: name \(text\), score \(number\)/u, "the model sees table names and types, never records");
  const rounds = await knex("app_script_rounds").where({ workspace_id: workspaceId, script_key: "grade" }).orderBy("id");
  assert.deepEqual(rounds.map((round) => [round.round, round.passed, round.failed]), [[1, 2, 1], [2, 3, 0]]);

  // A model that never gets it right: five rounds, nothing saved, the last failures returned.
  let calls = 0;
  const stubborn = async () => {
    calls += 1;
    return { summary: "Wrong", code: "function main() { return 'Z' }", tests };
  };
  const failedRun = await writeScript({ ...base, key: "never", model: stubborn });
  assert.deepEqual([failedRun.status, failedRun.rounds, calls], ["not saved", 5, 5]);
  assert.equal(failedRun.failures.length, 3);
  assert.equal(await knex("app_scripts").where({ workspace_id: workspaceId, key: "never" }).first(), undefined);
  // Unusable answers count as failed rounds, not crashes.
  const garbled = await writeScript({ ...base, key: "garbled", model: async () => {
    throw new SyntaxError("Unexpected token");
  } });
  assert.equal(garbled.status, "not saved");

  // Past 90 seconds it stops between rounds.
  let clock = 0;
  const slow = async () => {
    clock += 50000;
    return { summary: "Wrong", code: "function main() { return 'Z' }", tests };
  };
  const capped = await writeScript({ ...base, key: "slow", model: slow, now: () => clock });
  assert.equal(capped.rounds, 2);
  assert.match(JSON.stringify(capped.failures), /90-second limit/u);
});
