import { RUN_LEASE, RunTakenOver, handOverRuns, keepLease, tellHandedOver } from "./runLease.js";

/**
 * Runs tasks that Apps queues for bots (D-35): watch runs and button hand-offs, from app_jobs.
 * Every server runs this loop; a task is claimed in one transaction with SKIP LOCKED, so exactly
 * one server runs it (D-15). A task is marked running, under its own run id and with a lease this
 * loop renews, before it starts; the task stops at its next step once this server can't be sure it
 * still holds it (runLease.js keepLease). When none is queued, the loop takes over a task whose server
 * stopped (its lease lapsed) and runs it again from the steps it saved; only the server holding the
 * run writes its result and its end (D-59). A notice wakes the loop early. Jobs of every home are
 * claimed in the app job runner's system context; each claimed job answers its home (workspaceId),
 * where its run works.
 * @param {object} dependencies
 * @param {import("@local/apps/server/types").AppJobs} dependencies.jobs apps.jobs
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {(job: object, signal: AbortSignal) => Promise<void>} dependencies.run runs one claimed task until `signal`,
 *   its lease's, aborts; it throws RunTakenOver when the task stopped for its lease
 * @param {number} [dependencies.everyMs]
 * @param {number} [dependencies.concurrency]
 * @param {typeof RUN_LEASE} [dependencies.lease]
 */
export function startAppJobRunner({ jobs, systemContext, notices, run, everyMs = 5000, concurrency = 2, lease = RUN_LEASE }) {
  let active = 0;
  /** @type {Map<Promise<void>, import("./types.js").RunningRun>} */
  const running = new Map();
  let stopped = false;
  let ticking = false;
  // A tick asked for while one runs (a notice, a task's end): the running one looks again before it ends.
  let again = false;

  /** A queued task, or else one a stopped server left. */
  const claim = () => jobs.withTransaction({ context: systemContext("app job runner") }, async (txOptions) =>
    (await jobs.claimNext(txOptions, lease.seconds)) || jobs.claimStalled(txOptions, lease.seconds));

  /** The job's own home, where its end is written. */
  const inHome = (job) => ({ context: systemContext("app job runner").forWorkspace(job.workspaceId) });

  async function tick() {
    if (stopped) return;
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

  /** Claims and starts tasks while this server has room for them and any is queued. */
  async function claimWhileFree() {
    while (!stopped && active < concurrency) {
      const job = await claim();
      if (!job) break;
      active += 1;
      const held = keepLease(() => jobs.renew(job, lease.seconds, inHome(job)), `Task ${job.id}`, lease);
      // A run that ended with its result has already written its end; this one then changes nothing.
      // One stopped for its lease (RunTakenOver) is left to the server that carries it on.
      const work = Promise.resolve()
        .then(() => run(job, held.signal))
        .then(() => "done", (error) => (error instanceof RunTakenOver ? null : "failed"))
        .then((status) => status && jobs.finish(job, status, inHome(job)))
        .finally(() => {
          held.stop();
          active -= 1;
          running.delete(work);
          tick();
        });
      running.set(work, { lease: held, release: () => jobs.release(job, inHome(job)) });
    }
  }

  const timer = setInterval(tick, everyMs);
  timer.unref();
  const unsubscribe = notices.subscribe("apps-jobs", "all", () => tick());
  tick();

  /**
   * Shutting down: claim nothing more, and hand the tasks in progress over at once (handOverRuns), waiting for none to
   * finish, then tell the other servers (Apps' own "apps-jobs" notice, which their runners tick on).
   * The drain's time is never waited out.
   */
  async function drain() {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    await tellHandedOver(notices, "apps-jobs", await handOverRuns(running));
  }

  return Object.freeze({ drain });
}
