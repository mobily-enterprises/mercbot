import { settledWithin } from "./backgroundWork.js";
import { nextRunAt } from "./routineSchedule.js";
import { RUN_LEASE, handOverRuns, keepLease } from "./runLease.js";

/** The routine's next run time, or null when its schedule can't say (it stops). */
function nextRunOf(routine) {
  try {
    return nextRunAt(routine.cron, routine.timezone);
  } catch {
    return null;
  }
}

/**
 * Runs due routines. Every server runs this loop; a due routine is claimed in one
 * transaction with SKIP LOCKED, and its next run time moves on before the run starts, so exactly
 * one server runs it (D-15). Runs missed while every server was down collapse into one catch-up
 * run, because the next time is always counted from now. Routines of every home
 * are claimed in the routine runner's system context; each claimed routine answers its home
 * (workspaceId), where its run works.
 *
 * A run holds its routine with a lease this loop renews while it runs, and stops at its next step
 * once this server can't be sure it still holds it (runLease.js keepLease). When nothing is due, the
 * loop takes over a run whose server stopped (its lease lapsed) and runs it again under a new run
 * id, from the steps it saved; the stopped server's result is never posted (D-59).
 * @param {object} dependencies
 * @param {import("./types.js").WorkRepository} dependencies.work
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {(routine: object, signal: AbortSignal) => Promise<void>} dependencies.run runs one claimed routine
 *   until `signal`, its lease's, aborts
 * @param {number} [dependencies.everyMs]
 * @param {number} [dependencies.concurrency]
 * @param {typeof RUN_LEASE} [dependencies.lease]
 */
export function startRoutineRunner({ work, systemContext, run, everyMs = 30000, concurrency = 2, lease = RUN_LEASE }) {
  let active = 0;
  /** @type {Map<Promise<void>, import("./types.js").RunningRun>} */
  const running = new Map();
  let stopped = false;
  let ticking = false;

  const options = () => ({ context: systemContext("routine runner") });

  /** A due routine, or else a run a stopped server left; a run its routine no longer wants ends unrun. */
  async function claim() {
    const due = await work.claimRoutine(nextRunOf, lease.seconds, options());
    if (due) return due;
    for (;;) {
      const stalled = await work.claimStalledRoutine(lease.seconds, options());
      if (!stalled?.superseded) return stalled;
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      while (!stopped && active < concurrency) {
        const routine = await claim();
        if (!routine) break;
        active += 1;
        const held = keepLease(() => work.renewRoutineRun(routine, lease.seconds, options()), `Routine ${routine.id} ("${routine.name}")`, lease);
        const job = Promise.resolve()
          .then(() => run(routine, held.signal))
          .catch(() => {})
          .finally(() => {
            held.stop();
            active -= 1;
            running.delete(job);
          });
        running.set(job, { lease: held, release: () => work.changeRoutineRun(routine, { runLeaseUntil: work.now() }, options()) });
      }
    } catch {
      // The database is unreachable; the next tick tries again.
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(tick, everyMs);
  timer.unref();
  tick();

  /**
   * Shutting down: claim nothing more, and give runs in progress up to `ms` to finish. Runs still
   * going after that stop and are handed over (handOverRuns): the server that takes one over posts
   * its result instead of this one.
   * @param {number} ms
   */
  async function drain(ms) {
    stopped = true;
    clearInterval(timer);
    await settledWithin(Promise.allSettled([...running.keys()]), ms);
    await handOverRuns(running);
  }

  return Object.freeze({ drain });
}
