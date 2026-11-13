// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** vault_items */
export const vaultItemResource = defineTableResource({
  name: "vaultItems",
  tableName: "vault_items",
  ownership: "user",
  schema: {
    createdAt: { type: "dateTime" },
    data: { type: "object", additionalProperties: true },
    kind: { type: "string", maxLength: 20, noTrim: true, required: true, search: true },
    label: { type: "string", maxLength: 120, noTrim: true },
    userId: { type: "id", hidden: true, search: true }
  }
});

/** The fields every usage table keeps of a piece of work: what it used and what it cost at its provider. */
const USED = Object.freeze({
  botId: { type: "integer", search: true },
  botName: { type: "string", maxLength: 80, noTrim: true, nullable: true },
  cacheHitTokens: { type: "integer" },
  cacheMissTokens: { type: "integer" },
  calls: { type: "integer" },
  costNano: { type: "integer" },
  estimatedCalls: { type: "integer" },
  images: { type: "integer" },
  outputTokens: { type: "integer" },
  seconds: { type: "integer" },
  kind: { type: "string", maxLength: 20, noTrim: true, required: true, search: true },
  userId: { type: "integer", search: true },
  workspaceId: { type: "integer", search: true }
});

/** usage_events
 * One AI call or computer day (D-56, D-73), kept 14 days for disputes and debugging in daily partitions: what it used
 * and what the provider charged for it (costNano, in nanodollars). Written and read only through the account
 * feature's own methods.
 */
export const usageEventSchema = Object.freeze({
  botId: { type: "id", nullable: true, search: true },
  botName: { type: "string", maxLength: 80, noTrim: true, nullable: true },
  cacheHitTokens: { type: "integer" },
  cacheMissTokens: { type: "integer" },
  costNano: { type: "integer" },
  createdAt: { type: "dateTime" },
  images: { type: "integer" },
  kind: { type: "string", maxLength: 20, noTrim: true, required: true, search: true },
  outputTokens: { type: "integer" },
  purpose: { type: "string", maxLength: 20, noTrim: true },
  seconds: { type: "integer" },
  servedBy: { type: "string", maxLength: 40, noTrim: true, nullable: true },
  state: { type: "string", maxLength: 12, noTrim: true, search: true },
  userId: { type: "id", nullable: true, search: true },
  workspaceId: { type: "integer", search: true }
});

export const usageEventResource = defineTableResource({
  name: "usageEvents",
  tableName: "usage_events",
  ownership: "system",
  schema: usageEventSchema
});

/** usage_daily
 * The totals per home, day (UTC), bot, person and kind, where 0 is none (D-73): kept 13 months in monthly partitions,
 * then archived and dropped. Every finished piece of work adds to its row.
 */
export const usageDailySchema = Object.freeze({ ...USED, day: { type: "date", search: true } });

export const usageDailyResource = defineTableResource({
  name: "usageDaily",
  tableName: "usage_daily",
  ownership: "system",
  schema: usageDailySchema
});

/** usage_monthly
 * The same totals per home and month (UTC), kept for good (D-73): price tags, the account menu and a month's spending
 * by bot and kind read them.
 */
export const usageMonthlySchema = Object.freeze({ ...USED, month: { type: "date", search: true } });

export const usageMonthlyResource = defineTableResource({
  name: "usageMonthly",
  tableName: "usage_monthly",
  ownership: "system",
  schema: usageMonthlySchema
});

/** computer_days
 * The day (UTC) each bot's computer was last counted for (D-73), so a day is counted once.
 */
export const computerDaySchema = Object.freeze({
  computerId: { type: "integer", search: true },
  day: { type: "date" },
  workspaceId: { type: "integer", search: true }
});

export const computerDayResource = defineTableResource({
  name: "computerDays",
  tableName: "computer_days",
  ownership: "system",
  schema: computerDaySchema
});

/** usage_jobs
 * A background job over the usage tables: archiving a month of daily totals; claimed by one server at a time, with
 * what it found.
 */
export const usageJobSchema = Object.freeze({
  claimedAt: { type: "dateTime" },
  details: { type: "object", additionalProperties: true },
  doneAt: { type: "dateTime", nullable: true },
  job: { type: "string", maxLength: 20, noTrim: true, required: true, search: true },
  period: { type: "string", maxLength: 10, noTrim: true, required: true, search: true },
  server: { type: "string", maxLength: 120, noTrim: true, search: true },
  state: { type: "string", maxLength: 12, noTrim: true, search: true }
});

export const usageJobResource = defineTableResource({
  name: "usageJobs",
  tableName: "usage_jobs",
  ownership: "system",
  schema: usageJobSchema
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  vaultItemResource,
  usageEventResource,
  usageDailyResource,
  usageMonthlyResource,
  computerDayResource,
  usageJobResource
]);
