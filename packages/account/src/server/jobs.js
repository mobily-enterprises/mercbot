// Background jobs every server runs (D-15), such as archiving a month of daily totals: each job's period is claimed by
// one server at a time, and a claim left by a server that died is taken by another after an hour.

const CLAIM_FOR_MS = 60 * 60 * 1000;

/**
 * Claims a job's period for this server, unless another server holds it (claimed within the hour) or it's done.
 * @param {{ jobs: any, job: string, period: string, server: string, at: Date, options: object }} claim `jobs` is the
 *   handle of the jobs table (job, period, state, server, claimedAt, details, with a claimedBefore filter)
 * @returns {Promise<boolean>}
 */
export async function claimJob({ jobs, job, period, server, at, options }) {
  await jobs.createMany(
    [{ job, period, state: "running", server: "", claimedAt: new Date(0).toISOString(), details: {} }],
    { ...options, onConflict: { keys: ["job", "period"], action: "ignore" }, returning: "none" }
  );
  const claimed = await jobs.patchWhere(
    { job, period, state: "running", claimedBefore: new Date(at.getTime() - CLAIM_FOR_MS).toISOString() },
    { server, claimedAt: at.toISOString() },
    { ...options, returning: "count" }
  );
  return claimed > 0;
}
