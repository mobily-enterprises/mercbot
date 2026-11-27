import { nextRunAt } from "./routineSchedule.js";
import { RUN_LEASE, handOverRuns, keepLease, tellHandedOver } from "./runLease.js";

/** What a server that handed routines over says, and every routine runner listens to (tellHandedOver). */
const ROUTINES_HANDED_OVER = "routines";

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
 * @param {import("@local/notices/server/types").Notices} [dependencies.notices] how a stopping server's handed-over
 *   runs are told, and heard
 * @param {(routine: object, signal: AbortSignal) => Promise<void>} dependencies.run runs one claimed routine
 *   until `signal`, its lease's, aborts
 * @param {number} [dependencies.everyMs]
 * @param {number} [dependencies.concurrency]
 * @param {typeof RUN_LEASE} [dependencies.lease]
 */
export function startRoutineRunner({ work, systemContext, notices, run, everyMs = 30000, concurrency = 2, lease = RUN_LEASE }) {
  let active = 0;
  /** @type {Map<Promise<void>, import("./types.js").RunningRun>} */
  const running = new Map();
  let stopped = false;
  let ticking = false;
  // A tick asked for while one runs (another server's notice): the running one looks again before it ends.
  let again = false;

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
    if (ticking) {
      again = true;
      return;
    }
    ticking = true;
    try {
      for (again = true; again && !stopped;) {
        again = false;
        await claimWhileFree();
      }
    } catch {
      // The database is unreachable; the next tick tries again.
    } finally {
      ticking = false;
    }
  }

  /** Claims and starts routines while this server has room for them and any is due. */
  async function claimWhileFree() {
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
  }

  const timer = setInterval(tick, everyMs);
  timer.unref();
  // Another server handed its runs over as it stopped: they're claimed here at once.
  const unsubscribe = notices?.subscribe(ROUTINES_HANDED_OVER, "all", () => tick()) ?? (() => {});
  tick();

  /**
   * Shutting down: claim nothing more, and hand the runs in progress over at once (handOverRuns), waiting for none to
   * finish: the server that takes one over, told so, posts its result instead of this one.
   * The drain's time is never waited out.
   */
  async function drain() {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    await tellHandedOver(notices, ROUTINES_HANDED_OVER, await handOverRuns(running));
  }

  return Object.freeze({ drain });
}
