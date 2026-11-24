import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { dayOf, monthOf } from "./usage.js";

// What a home has spent (D-73): read from the totals every finished piece of work adds to, by month (kept for good)
// and by day (kept 13 months), never by adding up calls, so it costs the same however busy the home is. Days and
// months are UTC's. Owners and admins see the whole home; a member sees only their own use. What's spent is the
// totals' `spend` measure: what the work cost at its AI providers, unless a copy built on Mercbot names another.
// Reports over any range of days are reports.js's.

/** Every group of a grouped total, a page at a time. */
export async function everyGroup(handle, spec, options) {
  const rows = [];
  for (let number = 1; ; number += 1) {
    const answer = await handle.aggregate({ ...spec, page: { size: handle.pageLimits().request, number } }, options);
    rows.push(...answer.rows);
    if (!answer.page.hasMore) return rows;
  }
}

/** The days a recurring task's cost is shown for (D-132): today and the 29 before it. */
const TASK_DAYS = 30;

/** A home's totals the reader may see: the whole home for its owners and admins, else their own use. */
export function seen(homeId, reader) {
  return { workspaceId: Number(homeId), ...(reader.manages ? {} : { userId: Number(reader.userId) }) };
}

/**
 * Who is reading a home's spending: owners and admins see the whole home, a member their own use (D-73).
 * @param {import("fastify").FastifyRequest} request
 * @returns {import("./types.js").SpendingReader}
 */
export function readerOf(request) {
  return {
    userId: String(request.user.id),
    manages: hasPermission(request.permissions, "workspace.settings.update"),
    from: typeof request.query?.from === "string" ? request.query.from : undefined,
    to: typeof request.query?.to === "string" ? request.query.to : undefined
  };
}

/**
 * What each recurring task a reader may see the cost of has used in the last TASK_DAYS days (D-132): its runs, AI calls
 * and spending (`spend`, the task totals' measure), by task, a page of groups at a time. Owners and admins see every
 * task's, a member only those that run as them.
 * @param {any} handle the task totals' handle, or a copy's view of them
 * @param {string} spend the measure that is what was spent
 * @param {string} homeId
 * @param {{ userId: string, manages: boolean }} reader
 * @param {object} options
 * @param {Date} at now
 * @returns {Promise<Array<{ kind: string, id: string, runs: number, calls: number, spentNano: number }>>}
 */
async function taskSpending(handle, spend, homeId, reader, options, at) {
  const from = dayOf(new Date(at.getTime() - (TASK_DAYS - 1) * 24 * 60 * 60 * 1000));
  const rows = await everyGroup(handle, {
    groupBy: ["taskKind", "taskId"],
    measures: { runs: { sum: "runs" }, calls: { sum: "calls" }, spent: { sum: spend } },
    filters: { ...seen(homeId, reader), dayFrom: from },
    sort: ["taskKind", "taskId"]
  }, options);
  return rows.map((row) => ({
    kind: row.taskKind,
    id: String(row.taskId),
    runs: Number(row.runs) || 0,
    calls: Number(row.calls) || 0,
    spentNano: Number(row.spent) || 0
  }));
}

/**
 * @param {object} dependencies
 * @param {{ usageMonthly: any, usageTasksDaily: any }} dependencies.resources the monthly and task totals' handles
 * @param {(reason: string) => object} dependencies.systemContext the handle's feature's system scope
 * @param {string} [dependencies.spend] the totals' measure that is what was spent
 * @param {() => Date} [dependencies.now]
 */
export function createSpending({ resources, systemContext, spend = "costNano", now = () => new Date() }) {
  const { usageMonthly, usageTasksDaily } = resources;

  /**
   * The account menu's figures: this month's spending the reader sees. `note`, `attention` and `action` are what a
   * copy built on Mercbot adds under it (a line, whether it needs the reader's attention, and the label of an item
   * that opens Settings → Spending); Mercbot adds none.
   * @param {string} homeId
   * @param {{ userId: string, manages: boolean }} reader
   */
  async function summary(homeId, reader) {
    const month = monthOf(now());
    const [row] = await usageMonthly.aggregate(
      { measures: { spent: { sum: spend } }, filters: { ...seen(homeId, reader), month: `${month}-01` } },
      { context: systemContext("add up this month's spending a home's member may see") }
    );
    return { scope: reader.manages ? "home" : "own", month, monthNano: Number(row?.spent) || 0, note: null, attention: false, action: null };
  }

  /**
   * What each recurring task the reader may see has cost in the last TASK_DAYS days (taskSpending).
   * @param {string} homeId
   * @param {{ userId: string, manages: boolean }} reader
   */
  function tasks(homeId, reader) {
    return taskSpending(usageTasksDaily, spend, homeId, reader, { context: systemContext("add up what a home's recurring tasks have cost") }, now());
  }

  return Object.freeze({
    summary,
    tasks
  });
}
