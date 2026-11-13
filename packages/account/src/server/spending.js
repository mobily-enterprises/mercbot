import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { monthOf } from "./usage.js";

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
 * @param {object} dependencies
 * @param {{ usageMonthly: any }} dependencies.resources the monthly totals' handle
 * @param {(reason: string) => object} dependencies.systemContext the handle's feature's system scope
 * @param {string} [dependencies.spend] the totals' measure that is what was spent
 * @param {() => Date} [dependencies.now]
 */
export function createSpending({ resources, systemContext, spend = "costNano", now = () => new Date() }) {
  const { usageMonthly } = resources;

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
   * Each bot's price tag: this month, and all time a hover away.
   * @param {string} homeId
   * @param {{ userId: string, manages: boolean }} reader
   */
  async function priceTags(homeId, reader) {
    const from = `${monthOf(now())}-01`;
    const rows = await everyGroup(usageMonthly, {
      groupBy: ["botId"],
      measures: { monthNano: { sum: spend, where: { month: { gte: from } } }, allNano: { sum: spend } },
      filters: seen(homeId, reader)
    }, { context: systemContext("add up each bot's spending a home's member may see") });
    return {
      bots: rows
        .filter((row) => Number(row.botId) > 0)
        .map((row) => ({ botId: String(row.botId), monthNano: Number(row.monthNano) || 0, allNano: Number(row.allNano) || 0 }))
    };
  }

  return Object.freeze({
    summary,
    priceTags
  });
}
