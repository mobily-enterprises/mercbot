import { randomUUID } from "node:crypto";
import { passedOn } from "@jskit-ai/resource-runtime/server";

// What the bots' app job runner reads of a claimed job: every field, and the home it runs in.
const JOB_FIELDS = Object.freeze([
  "id",
  "workspaceId",
  "kind",
  "botId",
  "conversationId",
  "userId",
  "watchId",
  "title",
  "prompt",
  "status",
  "runAfter",
  "claimedAt",
  "finishedAt",
  "createdAt",
  "runId",
  "attempts",
  "leaseUntil",
  "steps"
]);

/**
 * App jobs (D-15): tasks apps queue for bots (queueTask), which the bots' app job runner claims on
 * every server and runs once, in its own system context. A running job holds a lease its server
 * renews; a job whose server stopped (its lease lapsed) is taken over by another server under a new
 * run id, so only one server's ending is written (D-59).
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.appJobs the apps
 *   feature's app_jobs handle
 */
export function createAppJobs({ appJobs }) {
  /** @type {(options: object, work: (txOptions: object) => Promise<any>) => Promise<any>} */
  const withTransaction = (options, work) => appJobs.withTransaction(options, work);

  /** The database's now() plus some seconds, as a write's value. */
  const secondsFromNow = (seconds) => appJobs.raw("now() + make_interval(secs => ?)", [Number(seconds)]);

  /**
   * Takes the first job matching `filters`, in id order, with SKIP LOCKED, and marks it running in
   * the caller's transaction under a new run id with a lease of `leaseSeconds`; null when none.
   */
  async function take(filters, leaseSeconds, txOptions) {
    const [job] = await appJobs.claim({ filters, sort: ["id"], take: 1 }, { ...txOptions, fields: JOB_FIELDS });
    if (!job) return null;
    const run = { status: "running", runId: randomUUID(), attempts: Number(job.attempts || 0) + 1 };
    const claimedAt = job.status === "running" ? job.claimedAt : new Date().toISOString();
    await appJobs.patchWhere({ id: String(job.id) }, { ...run, claimedAt, leaseUntil: secondsFromNow(leaseSeconds) }, { ...txOptions, returning: "none" });
    return { ...job, ...run, claimedAt };
  }

  /**
   * The next queued job that is due, in id order, taken with SKIP LOCKED and marked running in the
   * caller's transaction; null when there is none.
   * @param {object} txOptions
   * @param {number} leaseSeconds
   */
  const claimNext = (txOptions, leaseSeconds) => take({ status: "queued", due: true }, leaseSeconds, txOptions);

  /**
   * A running job whose server stopped renewing its lease, taken over in the caller's transaction
   * (a new run id and lease, one more attempt); it carries on from the steps it saved. Null when none.
   * @param {object} txOptions
   * @param {number} leaseSeconds
   */
  const claimStalled = (txOptions, leaseSeconds) => take({ stalled: true }, leaseSeconds, txOptions);

  /**
   * Changes a running job while its run is still this server's; answers whether it was.
   * @param {{ id: string, runId: string }} job
   * @param {object} changes
   * @param {object} options
   */
  async function changeRun(job, changes, options) {
    const changed = await appJobs.patchWhere(
      { id: String(job.id), runId: String(job.runId), status: "running" },
      changes,
      { ...passedOn(options), returning: "count" }
    );
    return Number(changed) > 0;
  }

  /**
   * Keeps a job's lease for `seconds` more (the heartbeat); answers whether this server still holds it.
   * @param {{ id: string, runId: string }} job
   * @param {number} seconds
   * @param {object} options
   */
  const renew = (job, seconds, options) => changeRun(job, { leaseUntil: secondsFromNow(seconds) }, options);

  /**
   * Hands a job's run over at once (its lease ends now), when its server is stopping.
   * @param {{ id: string, runId: string }} job
   * @param {object} options
   */
  const release = (job, options) => changeRun(job, { leaseUntil: appJobs.raw("now()") }, options);

  /**
   * Keeps the steps a job's run has taken so far, so a server that takes it over carries on from them.
   * @param {{ id: string, runId: string }} job
   * @param {object[]} steps
   * @param {object} options
   */
  async function saveSteps(job, steps, options) {
    await changeRun(job, { steps }, options);
  }

  /**
   * A job's end, "done" or "failed", if its run is still this server's; answers whether it was.
   * It never throws: a job that can't be marked stays running until its lease lapses.
   * @param {{ id: string, runId: string }} job
   * @param {"done" | "failed"} status
   * @param {object} options
   */
  const finish = (job, status, options) =>
    changeRun(job, { status, finishedAt: new Date().toISOString(), leaseUntil: null, steps: null }, options).catch(() => false);

  return Object.freeze({
    withTransaction,
    claimNext,
    claimStalled,
    renew,
    release,
    saveSteps,
    finish
  });
}
