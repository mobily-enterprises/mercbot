import { settledWithin } from "./backgroundWork.js";

/**
 * Routine and watch runs hold their row with a lease while they run (D-15, D-59): their server
 * renews it every `heartbeatMs`, so one that stopped (a deploy, a crash) is found by any server
 * once the lease lapses, `seconds` after its last beat, and taken over. A run is tried at most
 * `attempts` times; one that stopped its server every time is given up as failed.
 */
export const RUN_LEASE = Object.freeze({ seconds: 90, heartbeatMs: 20000, attempts: 3 });

/**
 * Renews a run's lease every `heartbeatMs` until stopped. `renew()` answers whether this server
 * still holds the run. The run is stopped at its next step (`signal` aborts with RunTakenOver) as
 * soon as this server can't be sure it holds the run, so two servers never work on one run at once:
 * another server took it over, or no renewal went through for most of the lease (the server was
 * paused, or lost its database) on this server's own steady clock, which a changed system clock
 * doesn't move. `handOver()` stops it the same way when this server shuts down.
 * @param {() => Promise<boolean>} renew
 * @param {string} what the run, for the log, e.g. Routine 12 ("Morning news")
 * @param {{ seconds: number, heartbeatMs: number }} [lease]
 * @returns {{ signal: AbortSignal, handOver: () => void, stop: () => void }}
 */
export function keepLease(renew, what, { seconds, heartbeatMs } = RUN_LEASE) {
  const stopping = new AbortController();
  const lose = (why) => {
    if (stopping.signal.aborted) return;
    console.warn(`${what}: ${why}`);
    stopping.abort(new RunTakenOver(what));
  };
  // A renewal answers on the database's clock, so a lease is only counted as held from when the
  // last renewal that went through was asked. Checked once a beat, it is given up at least a beat
  // before it could lapse, which leaves the run's step in progress time to end first.
  let heldSince = performance.now();
  const timer = setInterval(() => {
    if (stopping.signal.aborted) return;
    if (performance.now() - heldSince > seconds * 1000 - 2 * heartbeatMs) {
      lose("no renewal of its lease went through in time, so this server stops the run and another carries it on.");
      return;
    }
    const asked = performance.now();
    renew()
      .then((held) => {
        if (held) heldSince = Math.max(heldSince, asked);
        else lose("another server took its run over, so this server stops it and won't post its result.");
      })
      .catch((error) => console.warn(`${what}: renewing its run's lease failed; the next beat tries again (${error?.message || error}).`));
  }, heartbeatMs);
  timer.unref();
  return {
    signal: stopping.signal,
    handOver: () => lose("this server is stopping, so it hands the run over to another."),
    stop: () => clearInterval(timer)
  };
}

/** How long a run stopped at shutdown may take to reach its next step before its lease is ended. */
const HAND_OVER_MS = 5000;

/**
 * Shutting down: a runner's runs still going are stopped at their next step, and each that stops
 * within `ms` is handed over at once (`release` ends its lease now), so another server carries it on
 * without waiting for the lease to lapse, and never beside this one. A run that doesn't stop in time
 * keeps its lease, which lapses by itself once this server has gone.
 * @param {Map<Promise<void>, import("./types.js").RunningRun>} running
 *   the runner's runs, each removed once it has settled
 * @param {number} [ms]
 */
export async function handOverRuns(running, ms = HAND_OVER_MS) {
  const left = [...running];
  for (const [, { lease }] of left) lease.handOver();
  await settledWithin(Promise.allSettled(left.map(([run]) => run)), ms);
  await Promise.all(left.filter(([run]) => !running.has(run)).map(([, { release }]) => release().catch(() => {})));
}

/** A run whose lease another server holds now, or whose row is gone: its result isn't posted. */
export class RunTakenOver extends Error {
  /** @param {string} what */
  constructor(what) {
    super(`${what}: its run is no longer this server's (another server took it over, or it was removed), so its result isn't posted.`);
    this.name = "RunTakenOver";
  }
}

/** A routine pauses after this many failed runs in a row (docs/usage-tracking-design.md, question 4). */
export const FAILURES_BEFORE_PAUSE = 5;

/**
 * What a run holds while it runs (routineCheckpoint, jobCheckpoint): the steps an earlier server
 * saved, if it was taken over, and its ending, which `settle` writes with the run's result, in one
 * transaction, so the result is posted once, by the server holding the run.
 * @param {{ what: string, steps?: object[] | null, attempts?: number, signal: AbortSignal | null,
 *   save: (steps: object[]) => Promise<void>, end: import("./types.js").RunCheckpoint["end"] }} run
 * @returns {import("./types.js").RunCheckpoint}
 */
function checkpointOf({ what, steps, attempts = 1, signal, save, end }) {
  return {
    what,
    steps: attempts > 1 && Array.isArray(steps) ? steps : [],
    givenUp: attempts > RUN_LEASE.attempts,
    signal,
    save,
    end,
    async settle(options, outcome) {
      const ending = await end(outcome, options);
      if (!ending) throw new RunTakenOver(what);
      return ending.messages;
    }
  };
}

/**
 * What a routine's run in the chat holds while it runs (checkpointOf). Null for a routine with no
 * claimed run.
 * @param {import("./types.js").WorkRepository} work
 * @param {{ id: string, name: string, runId?: string | null, runAttempts?: number, runSteps?: object[] | null, enabled?: boolean }} routine
 * @param {import("./types.js").CallOptions} call the run's call options
 * @param {AbortSignal | null} [signal] its lease's (keepLease): the run stops when it aborts
 * @returns {import("./types.js").RunCheckpoint | null}
 */
export function routineCheckpoint(work, routine, call, signal = null) {
  if (!routine.runId) return null;
  /**
   * Ends the run if this server still holds it: a failure adds one to the routine's failures in a
   * row, and the fifth pauses it, with a line in the chat saying how to resume it. Null when the
   * run isn't this server's any more.
   */
  async function end({ failed }, options) {
    const ended = await work.endRoutineRun(routine, { failed }, options);
    if (!ended) return null;
    if (!failed || Number(ended.failures) < FAILURES_BEFORE_PAUSE || !ended.enabled) return { paused: false, messages: [] };
    await work.changeRoutine(routine.id, { enabled: false, nextRunAt: null }, options);
    return { paused: true, messages: pausedMessages(routine) };
  }
  return checkpointOf({
    what: `Routine ${routine.id} ("${routine.name}")`,
    steps: routine.runSteps,
    attempts: routine.runAttempts,
    signal,
    save: (steps) => work.changeRoutineRun(routine, { runSteps: steps }, call).then(() => {}),
    end
  });
}

/** What a routine that just paused itself says in its chat: plainly, and how to resume it. */
function pausedMessages(routine) {
  return [
    {
      kind: "text",
      role: "bot",
      body: {
        text:
          `I've paused my routine "${routine.name}", because its last ${FAILURES_BEFORE_PAUSE} runs failed in a row. ` +
          `It won't run again until you resume it: switch it back on under Routines in my Details panel, or ask me ` +
          `to resume it. A run that works starts the count again.`
      }
    },
    {
      kind: "event",
      role: "system",
      body: {
        text: "Paused routine",
        icon: "routine",
        name: routine.name,
        detail: `Paused routine "${routine.name}" by itself after ${FAILURES_BEFORE_PAUSE} failed runs in a row; it runs again once resumed.`
      }
    }
  ];
}

/**
 * What a task from Apps (a watch run, a button's hand-off, a finished command's follow-up) holds
 * while it runs (checkpointOf); its ending is the job's. Null for a job with no claimed run.
 * @param {import("@local/apps/server/types").AppJobs} jobs apps.jobs
 * @param {{ id: string, runId?: string | null, attempts?: number, steps?: object[] | null }} job
 * @param {import("./types.js").CallOptions} options the job's own home, in the app job runner's system context
 * @param {AbortSignal | null} [signal] its lease's (keepLease): the run stops when it aborts
 * @returns {import("./types.js").RunCheckpoint | null}
 */
export function jobCheckpoint(jobs, job, options, signal = null) {
  if (!job.runId) return null;
  return checkpointOf({
    what: `Task ${job.id}`,
    steps: job.steps,
    attempts: job.attempts,
    signal,
    save: (steps) => jobs.saveSteps(job, steps, options),
    end: async ({ failed }, txOptions) => ((await jobs.finish(job, failed ? "failed" : "done", txOptions)) ? { paused: false, messages: [] } : null)
  });
}

/**
 * What a connect follow-up holds while its bot carries on (checkpointOf, connectFollowUps.js): its steps are kept on
 * its row, and ending it removes the row, in the transaction that posts its result.
 * @param {import("./types.js").FollowUpRepository} followUps records.followUps
 * @param {import("./records/followUpRepository.js").HeldFollowUp} run the follow-up as this server took it
 * @param {import("./types.js").CallOptions} call the run's call options
 * @param {AbortSignal | null} [signal] its lease's (keepLease): the run stops when it aborts
 * @returns {import("./types.js").RunCheckpoint}
 */
export function followUpCheckpoint(followUps, run, call, signal = null) {
  return checkpointOf({
    what: `Connect follow-up ${run.id}`,
    steps: run.steps,
    attempts: run.attempts,
    signal,
    save: (steps) => followUps.saveSteps(run, steps, call),
    end: async (_outcome, options) => ((await followUps.end(run, options)) ? { paused: false, messages: [] } : null)
  });
}
