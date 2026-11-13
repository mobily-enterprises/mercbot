import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { testBot, testHome } from "../testHome.js";
import { stalledClaims, sweepAppJobs, sweepBotRequests, sweepRoutines } from "./harness.mjs";
import { insertRows } from "./seed.mjs";

// The three queues every server claims from (D-15): routines, Apps' jobs and bot requests. No route reaches their claims
// (they run on a listening server's loops), so harness.mjs runs each loop's own claims until one finds nothing. For each
// queue: two claimers at once never take the same row and both get some; a row another transaction holds is skipped,
// not waited on, and taken once it is free; the claim order; and what is never claimed.

let knex;
let other;
let userId;
let homeId;
let bot;
let asker;

before(async () => {
  knex = await connectTestDatabase();
  // A second connection pool, as a second server has.
  other = await connectTestDatabase();
  userId = String((await knex("users").orderBy("id").first("id")).id);
  homeId = String(await testHome(knex, userId));
  bot = await testBot(knex, userId, { name: "Claims" });
  asker = await testBot(knex, userId, { name: "Asker" });
  await Promise.all([knex.raw("select 1"), other.raw("select 1")]);
});

after(async () => {
  // Their routines, jobs and requests go with them (each references its bot with on delete cascade).
  if (knex) await knex("bots").whereIn("id", [bot?.id, asker?.id].filter(Boolean)).del();
  await other?.destroy();
  await knex?.destroy();
});

const ago = (seconds) => knex.raw(`now() - make_interval(secs => ${Number(seconds)})`);
const ahead = (seconds) => knex.raw(`now() + make_interval(secs => ${Number(seconds)})`);
const idsOf = (rows) => rows.map((row) => String(row.id));
/** Only the rows this file made: a sweep claims whatever is due in the database. */
const only = (made) => (claimed) => claimed.filter((id) => made.includes(id));

async function made(context, table, rows) {
  const inserted = idsOf(await insertRows(knex, table, rows, homeId));
  context.after(async () => {
    await knex(table).whereIn("id", inserted).del();
  });
  return inserted;
}

const routine = (fields) => ({
  bot_id: bot.id,
  conversation_id: bot.conversation_id,
  name: "Morning summary",
  schedule: "Every day at 9:00",
  cron: "0 9 * * *",
  timezone: "UTC",
  enabled: true,
  ...fields
});

const job = (fields) => ({
  workspace_id: homeId,
  kind: "handoff",
  bot_id: bot.id,
  conversation_id: bot.conversation_id,
  user_id: userId,
  title: "Hand-off",
  prompt: "Carry on",
  status: "queued",
  ...fields
});

// A request whose answer came back: its next step is the asking bot's turn (botRequests.js step, the asker branch).
const request = (fields) => ({
  workspace_id: homeId,
  user_id: userId,
  kind: "ask",
  from_bot_id: asker.id,
  from_conversation_id: asker.conversation_id,
  to_bot_id: bot.id,
  to_conversation_id: bot.conversation_id,
  brief: "Characterization",
  status: "done",
  next_step: "asker_turn",
  ...fields
});

/** Two sweeps at once, on two pools: every row once between them, and each claimed some (they overlapped). */
async function claimedOnceBetweenTwo(sweep, ids) {
  const [first, second] = (await Promise.all([sweep(knex, { pauseMs: 20 }), sweep(other, { pauseMs: 20 })])).map(only(ids));
  assert.deepEqual([...first, ...second].sort(), [...ids].sort(), "every due row is claimed exactly once");
  assert.ok(first.length > 0 && second.length > 0, `both claimers took some (${first.length} and ${second.length})`);
}

/** A row held by another transaction is skipped while held, and the next sweep takes it. */
async function lockedRowSkipped(sweep, table, [held, ...rest]) {
  const holder = await knex.transaction();
  try {
    await holder(table).where({ id: held }).forUpdate().first();
    assert.deepEqual(only([held, ...rest])(await sweep(other)), rest, "the held row is skipped, and the sweep doesn't wait for it");
  } finally {
    await holder.rollback();
  }
  assert.deepEqual(only([held, ...rest])(await sweep(other)), [held], "once free, the next sweep takes it");
}

test("routines: two runners at once never claim the same routine", async (context) => {
  const ids = await made(context, "bot_routines", Array.from({ length: 16 }, (_, index) => routine({ next_run_at: ago(60 + index) })));
  await claimedOnceBetweenTwo(sweepRoutines, ids);
});

test("routines: claimed earliest next run first; not due, paused and unscheduled ones are left", async (context) => {
  const [late, early, middle, broken, notDue, paused, unscheduled] = await made(context, "bot_routines", [
    routine({ next_run_at: ago(10) }),
    routine({ next_run_at: ago(30) }),
    routine({ next_run_at: ago(20) }),
    routine({ next_run_at: ago(5), cron: "not a schedule" }),
    routine({ next_run_at: ahead(3600) }),
    routine({ next_run_at: ago(40), enabled: false }),
    routine({ next_run_at: ago(50), cron: null })
  ]);
  const mine = only([late, early, middle, broken, notDue, paused, unscheduled]);
  assert.deepEqual(mine(await sweepRoutines(knex)), [early, middle, late, broken]);
  const rows = new Map((await knex("bot_routines").whereIn("id", [late, early, middle, broken]).select("id", "next_run_at", "last_run_at"))
    .map((row) => [String(row.id), row]));
  for (const id of [late, early, middle]) {
    assert.ok(rows.get(id).next_run_at > new Date(), "a claimed routine's next run moves on before it runs");
    assert.ok(rows.get(id).last_run_at, "and its last run is now");
  }
  assert.equal(rows.get(broken).next_run_at, null, "a schedule that can't be read gets no next run");
  assert.deepEqual(mine(await sweepRoutines(knex)), [], "a second sweep finds nothing due");
});

test("routines: one another transaction holds is skipped, not waited on", async (context) => {
  const ids = await made(context, "bot_routines", [routine({ next_run_at: ago(30) }), routine({ next_run_at: ago(20) }), routine({ next_run_at: ago(10) })]);
  await lockedRowSkipped(sweepRoutines, "bot_routines", ids);
});

test("Apps' jobs: two runners at once never claim the same job", async (context) => {
  const ids = await made(context, "app_jobs", Array.from({ length: 16 }, (_, index) => job({ run_after: ago(60 + index) })));
  await claimedOnceBetweenTwo(sweepAppJobs, ids);
  const statuses = await knex("app_jobs").whereIn("id", ids).pluck("status");
  assert.ok(statuses.every((status) => status === "done"), "each claimed job ran and is done");
});

test("Apps' jobs: claimed in id order whatever their run time; running and future ones are left", async (context) => {
  const [first, second, third, running, future, done] = await made(context, "app_jobs", [
    job({ run_after: ago(10) }),
    job({ run_after: ago(30) }),
    job({ run_after: ago(20) }),
    job({ run_after: ago(60), status: "running" }),
    job({ run_after: ahead(3600) }),
    job({ run_after: ago(60), status: "done" })
  ]);
  const mine = only([first, second, third, running, future, done]);
  assert.deepEqual(mine(await sweepAppJobs(knex)), [first, second, third], "by id, not by run_after");
  const rows = new Map((await knex("app_jobs").whereIn("id", [first, second, third, running, future]).select("id", "status", "claimed_at", "finished_at"))
    .map((row) => [String(row.id), row]));
  for (const id of [first, second, third]) {
    assert.equal(rows.get(id).status, "done");
    assert.ok(rows.get(id).claimed_at && rows.get(id).finished_at, "claimed, then finished");
  }
  assert.equal(rows.get(running).status, "running", "a running job is never claimed as a queued one");
  assert.equal(rows.get(future).status, "queued");
});

test("runs whose server stopped: each lapsed run is taken over by exactly one of two servers; held and lease-less ones are left", async (context) => {
  const [lapsedRoutine, heldRoutine] = await made(context, "bot_routines", [
    routine({ next_run_at: ahead(3600), run_id: "routine-old", run_attempts: 1, run_lease_until: ago(5) }),
    routine({ next_run_at: ahead(3600), run_id: "routine-live", run_attempts: 1, run_lease_until: ahead(60) })
  ]);
  const [lapsedJob, heldJob, leaseless] = await made(context, "app_jobs", [
    job({ run_after: ago(60), status: "running", run_id: "job-old", attempts: 1, lease_until: ago(5) }),
    job({ run_after: ago(60), status: "running", run_id: "job-live", attempts: 1, lease_until: ahead(60) }),
    // A job left running before runs had leases stays lost rather than run twice.
    job({ run_after: ago(60), status: "running" })
  ]);
  const servers = await Promise.all([stalledClaims(knex), stalledClaims(other)]);
  const takeAll = async (claim) => {
    const taken = [];
    for (let found = await claim(); found; found = await claim()) taken.push(found);
    return taken;
  };
  const routines = (await Promise.all(servers.map((server) => takeAll(server.routine)))).flat();
  const jobs = (await Promise.all(servers.map((server) => takeAll(server.job)))).flat();
  const mineRoutines = routines.filter((found) => [lapsedRoutine, heldRoutine].includes(String(found.id)));
  const mineJobs = jobs.filter((found) => [lapsedJob, heldJob, leaseless].includes(String(found.id)));
  assert.deepEqual(mineRoutines.map((found) => String(found.id)), [lapsedRoutine], "the lapsed routine run, once");
  assert.deepEqual(mineJobs.map((found) => String(found.id)), [lapsedJob], "the lapsed job, once");
  assert.equal(mineRoutines[0].runAttempts, 2);
  assert.notEqual(mineRoutines[0].runId, "routine-old");
  assert.equal(mineJobs[0].attempts, 2);
  assert.notEqual(mineJobs[0].runId, "job-old");

  // The stopped server's end changes nothing; the server that took the job over ends it.
  assert.equal(await servers[0].finish({ id: lapsedJob, runId: "job-old" }, homeId), false);
  assert.equal(await servers[1].finish(mineJobs[0], homeId), true);
  const rows = new Map((await knex("app_jobs").whereIn("id", [lapsedJob, heldJob, leaseless]).select("id", "status", "run_id"))
    .map((row) => [String(row.id), row]));
  assert.equal(rows.get(lapsedJob).status, "done");
  assert.deepEqual([rows.get(heldJob).status, rows.get(heldJob).run_id], ["running", "job-live"], "a run whose lease holds is left");
  assert.equal(rows.get(leaseless).status, "running");
});

test("Apps' jobs: one another transaction holds is skipped, not waited on", async (context) => {
  const ids = await made(context, "app_jobs", [job({ run_after: ago(30) }), job({ run_after: ago(20) }), job({ run_after: ago(10) })]);
  await lockedRowSkipped(sweepAppJobs, "app_jobs", ids);
});

test("bot requests: two servers at once never claim the same step", async (context) => {
  const ids = await made(context, "bot_requests", Array.from({ length: 12 }, (_, index) => request({ run_after: ago(60 + index) })));
  await claimedOnceBetweenTwo(sweepBotRequests, ids);
  const rows = await knex("bot_requests").whereIn("id", ids).select("next_step", "lease_until");
  assert.ok(rows.every((row) => row.next_step === null && row.lease_until === null), "each step ran: nothing next, no lease");
});

test("bot requests: claimed earliest run time first, a lapsed lease taken again; a live lease, no next step and future ones left", async (context) => {
  const [late, early, middle, lapsed, leased, finished, future] = await made(context, "bot_requests", [
    request({ run_after: ago(10) }),
    request({ run_after: ago(30) }),
    request({ run_after: ago(20) }),
    request({ run_after: ago(40), lease_until: ago(1) }),
    request({ run_after: ago(50), lease_until: ahead(60) }),
    request({ run_after: ago(70), next_step: null }),
    request({ run_after: ahead(3600) })
  ]);
  const mine = only([late, early, middle, lapsed, leased, finished, future]);
  assert.deepEqual(mine(await sweepBotRequests(knex)), [lapsed, early, middle, late]);
  const rows = new Map((await knex("bot_requests").whereIn("id", [late, early, middle, lapsed, leased, future]).select("id", "next_step", "lease_until"))
    .map((row) => [String(row.id), row]));
  for (const id of [late, early, middle, lapsed]) {
    assert.equal(rows.get(id).next_step, null, "the asking bot's turn ran");
    assert.equal(rows.get(id).lease_until, null, "and its lease is given back");
  }
  assert.equal(rows.get(leased).next_step, "asker_turn", "a step another server holds a live lease on is left to it");
  assert.ok(rows.get(leased).lease_until > new Date());
  assert.equal(rows.get(future).next_step, "asker_turn");
  assert.equal(rows.get(future).lease_until, null);
});

test("bot requests: one another transaction holds is skipped, not waited on", async (context) => {
  const ids = await made(context, "bot_requests", [request({ run_after: ago(30) }), request({ run_after: ago(20) }), request({ run_after: ago(10) })]);
  await lockedRowSkipped(sweepBotRequests, "bot_requests", ids);
});
