import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { RunTakenOver, handOverRuns, keepLease } from "../../packages/bots/src/server/runLease.js";
import { startAppJobRunner } from "../../packages/bots/src/server/appJobRunner.js";
import { startRoutineRunner } from "../../packages/bots/src/server/routineRunner.js";

// A run stops at its next step as soon as its server can't be sure it holds the run's lease, so two
// servers never work on one run at once (D-59), and one stopped for its lease leaves its run to the
// server that carries it on. Short leases here; the real one is 90 s, renewed every 20 s.
const SHORT = Object.freeze({ seconds: 0.5, heartbeatMs: 50, attempts: 3 });

/** A promise that settles only once `signal` aborts, as an agent loop's model call does. */
const untilAborted = (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

const quiet = (context) => context.mock.method(console, "warn", () => {});

test("a lease another server took over stops its run with RunTakenOver", async (context) => {
  quiet(context);
  let renewals = 0;
  const lease = keepLease(async () => (renewals += 1) < 3, "Routine 1 (\"News\")", SHORT);
  context.after(lease.stop);
  await assert.rejects(untilAborted(lease.signal), RunTakenOver);
  assert.equal(renewals, 3, "held while its renewals went through");
});

test("a lease no renewal goes through for (a paused server, a lost database) is given up at least a beat before it could lapse", async (context) => {
  quiet(context);
  const failing = keepLease(() => Promise.reject(new Error("connection refused")), "Task 1", SHORT);
  const stuck = keepLease(() => new Promise(() => {}), "Task 2", SHORT);
  context.after(() => [failing, stuck].forEach((lease) => lease.stop()));
  const started = performance.now();
  await Promise.all([assert.rejects(untilAborted(failing.signal), RunTakenOver), assert.rejects(untilAborted(stuck.signal), RunTakenOver)]);
  const waited = performance.now() - started;
  assert.ok(waited >= SHORT.seconds * 1000 - 2 * SHORT.heartbeatMs - 5, `kept trying for most of the lease (${waited} ms)`);
  assert.ok(waited < SHORT.seconds * 1000, `stopped before it could lapse (${waited} ms)`);
});

test("a lease whose renewals go through holds, and stop() ends its renewals", async () => {
  let renewals = 0;
  const lease = keepLease(async () => ((renewals += 1), true), "Task 1", SHORT);
  await sleep(SHORT.seconds * 1000 * 2);
  assert.equal(lease.signal.aborted, false);
  lease.stop();
  const seen = renewals;
  assert.ok(seen >= 5);
  await sleep(SHORT.heartbeatMs * 3);
  assert.equal(renewals, seen, "no renewal after stop()");
});

test("handing runs over at shutdown stops them, and releases at once only the ones that stopped in time", async (context) => {
  quiet(context);
  const running = new Map();
  const released = [];
  const runOf = (name, { stops }) => {
    const lease = keepLease(async () => true, name, { seconds: 90, heartbeatMs: 20000 });
    const run = (stops ? untilAborted(lease.signal) : new Promise(() => {})).catch(() => {}).finally(() => {
      lease.stop();
      running.delete(run);
    });
    running.set(run, { lease, release: async () => released.push(name) });
    return lease;
  };
  const stopping = runOf("stops at its next step", { stops: true });
  const stuck = runOf("stuck in a call", { stops: false });
  context.after(stuck.stop);
  await handOverRuns(running, 50);
  assert.equal(stopping.signal.reason instanceof RunTakenOver, true);
  assert.equal(stuck.signal.aborted, true);
  assert.deepEqual(released, ["stops at its next step"], "a run still going keeps its lease, which lapses once this server has gone");
});

test("the app job runner finishes a task that ended, and leaves one stopped for its lease to the server carrying it on", async (context) => {
  quiet(context);
  const queued = [
    { id: 1, workspaceId: 7, outcome: "done" },
    { id: 2, workspaceId: 7, outcome: "fails" },
    { id: 3, workspaceId: 7, outcome: "taken over" }
  ];
  const finished = [];
  const ran = [];
  const jobs = {
    withTransaction: (options, work) => work(options),
    claimNext: async () => queued.shift() || null,
    claimStalled: async () => null,
    renew: async () => true,
    release: async () => true,
    finish: async (job, status) => finished.push([job.id, status])
  };
  const runner = startAppJobRunner({
    jobs,
    systemContext: () => ({ forWorkspace: () => ({}) }),
    notices: { subscribe: () => () => {} },
    run: async (job) => {
      ran.push(job.id);
      if (job.outcome === "fails") throw new Error("The model is down.");
      if (job.outcome === "taken over") throw new RunTakenOver(`Task ${job.id}`);
    },
    everyMs: 10,
    concurrency: 3,
    lease: SHORT
  });
  while (ran.length < 3) await sleep(5);
  await runner.drain(1000);
  assert.deepEqual(finished.sort(), [[1, "done"], [2, "failed"]]);
});

test("draining the routine runner hands over a run still going: it stops, and its lease ends at once", async (context) => {
  quiet(context);
  let routine = { id: 4, name: "News" };
  const changes = [];
  let signal = null;
  const work = {
    claimRoutine: async () => {
      const due = routine;
      routine = null;
      return due;
    },
    claimStalledRoutine: async () => null,
    renewRoutineRun: async () => true,
    changeRoutineRun: async (_routine, fields) => changes.push(fields),
    now: () => "now()"
  };
  const runner = startRoutineRunner({
    work,
    systemContext: () => ({}),
    run: (_routine, runSignal) => ((signal = runSignal), untilAborted(runSignal)),
    everyMs: 10,
    lease: SHORT
  });
  while (!signal) await sleep(5);
  await runner.drain(30);
  assert.equal(signal.reason instanceof RunTakenOver, true, "stopped at its next step");
  assert.deepEqual(changes, [{ runLeaseUntil: "now()" }], "its lease ends now, so another server carries it on at once");
});
