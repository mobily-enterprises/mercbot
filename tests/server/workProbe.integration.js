import assert from "node:assert/strict";
import test from "node:test";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { createPolicyRepository } from "../../packages/bots/src/server/records/policyRepository.js";
import { REQUEST_SEARCH, ROUTINE_SEARCH, createWorkRepository } from "../../packages/bots/src/server/records/workRepository.js";
import {
  approvalRuleResource,
  botConversationResource,
  botMessageResource,
  botPolicyResource,
  botRequestResource,
  botRoutineResource
} from "../../packages/bots/src/server/records/tableResources.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot, testHome } from "./testHome.js";
import { cleanupStack } from "../support/cleanupStack.mjs";

// The handle calls the bots' work makes, on PostgreSQL: claim() with SKIP LOCKED and a custom `due`
// filter, patchWhere with now() + make_interval bound as a value, a jsonb merge as a value,
// createMany upserts on bot_policies (user-owned), deleteWhere's count,
// and lockMany, the stand-in for botList.js's FOR NO KEY UPDATE. Fixtures are seeded with Knex.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const FEATURE = "mercbot.bots.records";

async function setup(context) {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own(FEATURE, [
    { resource: botRequestResource, searchSchema: REQUEST_SEARCH },
    { resource: botRoutineResource, searchSchema: ROUTINE_SEARCH },
    botMessageResource,
    botConversationResource,
    botPolicyResource,
    approvalRuleResource
  ]);
  const systemContext = runtime.declareSystemScope(FEATURE, "probe the bots' work calls on PostgreSQL");
  const [userId, otherId] = await knex("users").orderBy("id").limit(2).pluck("id");
  assert.ok(userId && otherId, "the test database needs two users");
  const homeId = await testHome(knex, userId);
  const tag = Date.now().toString(36);
  const asker = await testBot(knex, userId, { name: `Asker ${tag}` });
  const target = await testBot(knex, userId, { name: `Target ${tag}` });
  const third = await testBot(knex, userId, { name: `Third ${tag}` });
  cleanup.after(() => knex("bots").whereIn("id", [asker.id, target.id, third.id]).del());
  const member = requestContextOptions({ user: { id: userId }, workspace: { id: homeId, slug: "probe" }, membership: { roleSid: "owner" }, permissions: ["*"] });
  return {
    knex,
    handles,
    work: createWorkRepository(handles),
    policies: createPolicyRepository(handles),
    system: { context: systemContext("bot request runner") },
    job: { context: systemContext("routine runner").forWorkspaceUser(homeId, userId, { actorId: userId }) },
    member,
    userId,
    otherId,
    homeId,
    tag,
    asker,
    target,
    third
  };
}

/** A queued request between two bots, due now unless `fields` says otherwise. */
async function seedRequest(knex, { homeId, userId }, from, to, fields = {}) {
  const [row] = await knex("bot_requests").insert({
    workspace_id: homeId,
    user_id: userId,
    from_bot_id: from.id,
    from_conversation_id: from.conversation_id,
    to_bot_id: to.id,
    to_conversation_id: to.conversation_id,
    brief: "probe",
    next_step: "target_turn",
    ...fields
  }).returning("*");
  return row;
}

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${what} waited more than ${ms} ms`)), ms).unref())
]);

test("claim() skips a request another worker holds, answers its hidden home, and the lease binds now() + make_interval", async (context) => {
  const probe = await setup(context);
  const { knex, handles, work, system } = probe;
  const first = await seedRequest(knex, probe, probe.asker, probe.target, { run_after: knex.raw("now() - interval '2 minutes'") });
  const second = await seedRequest(knex, probe, probe.target, probe.asker, { run_after: knex.raw("now() - interval '1 minute'") });
  // Not due: its step waits for later, or another server holds its lease, or no step waits.
  await seedRequest(knex, probe, probe.asker, probe.third, { run_after: knex.raw("now() + interval '1 hour'") });
  await seedRequest(knex, probe, probe.third, probe.asker, { lease_until: knex.raw("now() + interval '1 hour'") });
  await seedRequest(knex, probe, probe.target, probe.third, { next_step: null, status: "done" });

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let signalHeld;
  const holding = new Promise((resolve) => { signalHeld = resolve; });
  // Worker A takes the oldest due request and holds it while worker B claims.
  const workerA = handles.botRequests.withTransaction(system, async (txOptions) => {
    const [taken] = await handles.botRequests.claim({ filters: { due: true }, sort: ["runAfter"], take: 1 }, { ...txOptions, fields: ["status"] });
    signalHeld();
    await held;
    return taken;
  });
  await holding;
  const workerB = await withTimeout(work.claimRequest(120, system), 5000, "a claim beside a held one");
  release();
  const takenA = await workerA;
  assert.equal(String(takenA.id), String(first.id));
  assert.equal(String(workerB.id), String(second.id), "B skipped the row A holds and took the next due one");
  assert.equal(String(workerB.workspaceId), String(probe.homeId), "the claim answers the hidden home in a system context");
  assert.equal(workerB.nextStep, "target_turn");
  assert.ok(Array.isArray(workerB.chain), "chain reads as an array");
  const { leased } = await knex("bot_requests").where({ id: second.id })
    .first(knex.raw("lease_until > now() + interval '110 seconds' and lease_until < now() + interval '130 seconds' as leased"));
  assert.equal(leased, true, "lease_until is now() + 120 s by the database's clock");
  // B's lease now hides it, and A held a lock without a lease: A's request is the only one left due.
  const next = await work.claimRequest(120, system);
  assert.equal(String(next.id), String(first.id));
  assert.equal(await work.claimRequest(120, system), null, "nothing else is due");
});

test("a request changes only while its filters still match, run_after takes now(), and the cards merge their jsonb body", async (context) => {
  const probe = await setup(context);
  const { knex, work, member, job } = probe;
  const created = await work.createRequest({
    userId: String(probe.userId),
    kind: "ask",
    fromBotId: String(probe.asker.id),
    fromConversationId: String(probe.asker.conversation_id),
    toBotId: String(probe.target.id),
    toConversationId: String(probe.target.conversation_id),
    chain: [String(probe.asker.id)],
    brief: "probe brief",
    status: "queued",
    nextStep: "target_turn",
    timeZone: "UTC",
    language: ""
  }, member);
  assert.equal(typeof created.id, "string");
  assert.deepEqual(created.chain, [String(probe.asker.id)]);
  const { workspace_id: stamped } = await knex("bot_requests").where({ id: created.id }).first("workspace_id");
  assert.equal(String(stamped), String(probe.homeId), "the create stamps the request's home from the context");

  const open = await work.openRequestBetween({ fromBotId: probe.asker.id, toBotId: probe.target.id, userId: probe.userId }, member);
  assert.equal(open?.id, created.id, "statuses: [...] filters with IN");

  const changed = await work.changeRequest(created.id, { status: "working", runAfter: work.secondsFromNow(3), turns: 1 }, job, { statuses: ["queued"] });
  assert.equal(changed?.status, "working", "patchWhere answers the record it changed");
  assert.equal(await work.changeRequest(created.id, { status: "done" }, job, { statuses: ["queued"] }), null, "a request no longer queued is left alone");
  const { soon } = await knex("bot_requests").where({ id: created.id })
    .first(knex.raw("run_after > now() and run_after < now() + interval '10 seconds' as soon"));
  assert.equal(soon, true);
  assert.equal(await work.changeRequest(created.id, { nextStep: null }, job, { id: created.id, nextStep: "asker_turn" }), null, "nextStep filters by its value");
  assert.ok(await work.changeRequest(created.id, { leaseUntil: null, runAfter: work.now() }, job, { stepWaiting: true }), "stepWaiting matches a waiting step");
  assert.equal((await work.newestRequest({ toConversationId: String(probe.target.conversation_id), statuses: ["working"] }, member))?.id, created.id);

  const [message] = await knex("bot_messages").insert({
    workspace_id: probe.homeId,
    bot_id: probe.asker.id,
    conversation_id: probe.asker.conversation_id,
    kind: "bot_request",
    role: "system",
    body: { requestId: created.id, status: "queued", brief: "probe brief" }
  }).returning("*");
  await work.patchCards([String(message.id)], { status: "working", question: null }, job);
  const { body } = await knex("bot_messages").where({ id: message.id }).first("body");
  assert.deepEqual(body, { requestId: created.id, status: "working", brief: "probe brief", question: null }, "the patch merges into the stored body");
});

test("claimRoutine() takes a due routine once and moves its next run; nameIs matches in any case; deleteWhere counts", async (context) => {
  const probe = await setup(context);
  const { knex, work, job, homeId } = probe;
  const base = { workspace_id: homeId, bot_id: probe.asker.id, conversation_id: probe.asker.conversation_id, schedule: "every day" };
  const [due] = await knex("bot_routines").insert({ ...base, name: `Due ${probe.tag}`, cron: "0 9 * * *", enabled: true, next_run_at: knex.raw("now() - interval '1 minute'") }).returning("*");
  await knex("bot_routines").insert([
    { ...base, name: `Off ${probe.tag}`, cron: "0 9 * * *", enabled: false, next_run_at: knex.raw("now() - interval '1 minute'") },
    { ...base, name: `Later ${probe.tag}`, cron: "0 9 * * *", enabled: true, next_run_at: knex.raw("now() + interval '1 hour'") },
    { ...base, name: `Once ${probe.tag}`, cron: null, enabled: true, next_run_at: knex.raw("now() - interval '1 minute'") }
  ]);
  const nextRun = new Date(Date.now() + 86_400_000);
  const { system } = probe;
  const claimed = await work.claimRoutine((routine) => {
    assert.equal(routine.cron, "0 9 * * *", "nextRunOf gets the claimed routine");
    return nextRun.toISOString();
  }, 90, system);
  assert.equal(String(claimed.id), String(due.id));
  assert.equal(String(claimed.workspaceId), String(homeId));
  assert.equal(await work.claimRoutine(() => null, 90, system), null, "its next run moved on, so nothing else is due");
  const stored = await knex("bot_routines").where({ id: due.id }).first(
    knex.raw("next_run_at as next"),
    knex.raw("last_run_at > now() - interval '1 minute' as ran"),
    knex.raw("run_lease_until between now() + interval '80 seconds' and now() + interval '100 seconds' as leased"),
    "run_id",
    "run_attempts"
  );
  assert.equal(new Date(stored.next).getTime(), nextRun.getTime());
  assert.equal(stored.ran, true, "last_run_at is the database's now()");
  assert.deepEqual([stored.run_id, stored.run_attempts, stored.leased], [claimed.runId, 1, true], "the run holds a lease of 90 s on the database's clock");

  // The run's server renews and ends it by its run id; a run id that isn't the routine's changes nothing.
  assert.equal(await work.renewRoutineRun(claimed, 90, system), true);
  assert.equal(await work.renewRoutineRun({ id: claimed.id, runId: "not-this-run" }, 90, system), false);
  assert.equal((await work.endRoutineRun(claimed, { failed: true }, system)).failures, 1, "a failed run counts");
  assert.equal(await work.endRoutineRun(claimed, { failed: false }, system), null, "an ended run can't end again");

  const named = await work.routineNamed(probe.asker.conversation_id, `due ${probe.tag}`.toUpperCase(), job);
  assert.equal(named?.id, String(due.id));
  assert.equal(await work.deleteRoutine(due.id, probe.target.conversation_id, job), false, "another conversation's routine is left alone");
  assert.equal(await work.deleteRoutine(due.id, probe.asker.conversation_id, job), true);
});

test("bot_policies upsert on their key; a rule outside the person's own reads as missing", async (context) => {
  const probe = await setup(context);
  const { knex, policies, member, otherId, tag } = probe;
  await knex("bot_policies").where({ user_id: probe.userId }).del();
  assert.equal((await policies.policy(member)).autoReview, true, "auto-review is on until the person sets it");
  await policies.setAutoReview(false, member);
  await policies.setAutoReview(false, member);
  await Promise.all([policies.setAutoReview(true, member), policies.setAutoReview(true, member)]);
  const rows = await knex("bot_policies").where({ user_id: probe.userId });
  assert.equal(rows.length, 1, "one row per person, kept by the unique user_id");
  assert.equal(rows[0].auto_review, true);

  await policies.addRule({ action: `send email ${tag}`, behaviour: "ask" }, member);
  const [theirs] = await knex("approval_rules").insert({ user_id: otherId, action: `theirs ${tag}`, behaviour: "allow" }).returning("id");
  const { rules } = await policies.policy(member);
  assert.ok(rules.some((rule) => rule.action === `send email ${tag}`));
  assert.ok(!rules.some((rule) => rule.action === `theirs ${tag}`), "another person's rules stay theirs");
  assert.equal(await policies.updateRule(String(theirs.id), { action: "x", behaviour: "allow" }, member), false);
  await policies.deleteRule(String(theirs.id), member);
  assert.ok(await knex("approval_rules").where({ id: theirs.id }).first(), "another person's rule is not deleted");
});

test("lockMany() locks conversations in id order, and records whether it blocks a child row's insert (FOR NO KEY UPDATE)", async (context) => {
  const probe = await setup(context);
  const { knex, handles, member } = probe;
  const ids = [probe.target.conversation_id, probe.asker.conversation_id].map(String);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let signalHeld;
  const holding = new Promise((resolve) => { signalHeld = resolve; });
  const locker = handles.botConversations.withTransaction(member, async (txOptions) => {
    const locked = await handles.botConversations.lockMany(ids, { ...txOptions, fields: ["pinPosition"] });
    signalHeld(locked.map((row) => row.id));
    await held;
  });
  const lockedIds = await holding;
  assert.deepEqual(lockedIds, [...ids].sort((a, b) => Number(a) - Number(b)), "locked in id order");
  // A message insert checks its conversation's foreign key with FOR KEY SHARE. FOR NO KEY UPDATE (the
  // old pin order) lets it through; FOR UPDATE makes it wait.
  let blocked;
  try {
    await knex.transaction(async (trx) => {
      await trx.raw("set local lock_timeout = '300ms'");
      await trx("bot_messages").insert({ workspace_id: probe.homeId, bot_id: probe.asker.id, conversation_id: probe.asker.conversation_id, kind: "text", role: "user", body: { text: "while locked" } });
      blocked = false;
    });
  } catch (error) {
    if (error.code !== "55P03") throw error;
    blocked = true;
  } finally {
    release();
    await locker;
  }
  context.diagnostic(`lockMany on bot_conversations ${blocked ? "BLOCKS" : "does not block"} a message insert into a locked conversation (FOR UPDATE vs FOR NO KEY UPDATE).`);
});
