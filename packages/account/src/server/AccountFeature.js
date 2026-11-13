// readable-check: allow no-direct-knex - infrastructure: hands the database connection to retention.js, which makes, archives and drops the usage tables' partitions
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAccountService } from "./accountService.js";
import { createMeter, logAiFailure } from "./meter.js";
import { registerRoutes } from "./registerRoutes.js";
import { createReports } from "./reports.js";
import { createRetention } from "./retention.js";
import { createSpending } from "./spending.js";
import { USAGE_FILTERS, createUsageRecorder } from "./usage.js";
import {
  computerDayResource,
  usageDailyResource,
  usageEventResource,
  usageJobResource,
  usageMonthlyResource,
  vaultItemResource
} from "./tableResources.js";

/** The tables the account feature owns, with their search entries. */
export const ACCOUNT_OWNS = Object.freeze([
  vaultItemResource,
  { resource: usageEventResource, searchSchema: USAGE_FILTERS.usageEvents },
  { resource: usageDailyResource, searchSchema: USAGE_FILTERS.usageDaily },
  { resource: usageMonthlyResource, searchSchema: USAGE_FILTERS.usageMonthly },
  { resource: computerDayResource, searchSchema: USAGE_FILTERS.computerDays },
  { resource: usageJobResource, searchSchema: USAGE_FILTERS.usageJobs }
]);

/** How often every server keeps the usage tables: makes their partitions ahead, and archives and drops old ones. */
const UPKEEP_MS = 60 * 60 * 1000;

// The account menu (D-16, D-17): spending and the Vault. What work uses, from any package (D-73), is recorded
// through the meter provided here: by Mercbot's own recorder (usage.js), with what each call cost at its provider, or
// by a copy built on Mercbot that records it its own way (`mercbot.usage-recorder`), which then also answers what a
// home has spent. The AI providers' failures go to `mercbot.provider-failures` when a feature provides it, and to the server
// log otherwise.
const AccountFeature = defineFeature({
  id: "mercbot.account",
  domain: "account",
  owns: ACCOUNT_OWNS,
  systemScope:
    "record what every piece of work uses for whoever's bot and home it was, add up a home's and a goal's spending, archive and drop old usage, and read a person's Vault logins for a bot's turn acting for them",
  requires: {
    records: "mercbot.bots.records",
    http: "runtime.http",
    uploads: "runtime.uploads",
    env: "runtime.env",
    database: "runtime.database",
    fastify: "runtime.fastify",
    profiles: "users.profiles"
  },
  optional: {
    aiFailures: "mercbot.provider-failures",
    usageRecorder: "mercbot.usage-recorder",
    copyRunners: "mercbot.copy-runners"
  },
  provides: {
    account: "mercbot.account",
    meter: "mercbot.meter",
    // Provided so the shutdown hook can stop the sweeps.
    sweeps: "mercbot.account.sweeps"
  },
  /**
   * @param {object} capabilities
   * @param {{ directory: { botOwner: (botId: string, options: object) => Promise<{ userId: string, workspaceId: string, name: string } | null> } }} capabilities.records mercbot.bots.records
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} capabilities.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} capabilities.profiles
   * @param {import("./types.js").AiFailures | null} capabilities.aiFailures where the AI providers' failures are kept
   * @param {import("./types.js").UsageRecorder | null} capabilities.usageRecorder a copy's own recording of what work uses
   * @param {{ runsThisCopy: (userId: string, options: object) => Promise<boolean> } | null} capabilities.copyRunners whom a
   *   copy names as its runners
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  async setup({
    records, http, uploads, env, database, fastify, profiles, aiFailures, usageRecorder, copyRunners, resources, systemContext
  }) {
    const account = createAccountService({ resources, systemContext, env, copyRunners });
    const recorder = usageRecorder || createUsageRecorder({ resources, systemContext, directory: records.directory });
    const spending = usageRecorder?.spending || {
      ...createSpending({ resources, systemContext }),
      ...createReports({ resources, systemContext, profiles })
    };
    const archivedColumns = usageRecorder?.archivedColumns ?? [];
    const retention = createRetention({ resources, systemContext, env, knex: database.knex, archivedColumns });
    const meter = createMeter({ recorder, recordError: aiFailures ? aiFailures.record : logAiFailure });
    registerRoutes(http, { account, spending, uploads, track: meter.track });
    // Every serving server keeps the usage tables (D-15), every hour and once at start so their partitions are there;
    // a failure is logged and tried again next time.
    const timers = [];
    const upkeep = () => retention.sweep().catch((error) => console.warn("Keeping the usage tables failed; the next sweep tries again.", error));
    fastify.addHook("onListen", () => {
      upkeep();
      const timer = setInterval(upkeep, UPKEEP_MS);
      timer.unref();
      timers.push(timer);
    });
    return {
      account,
      meter: Object.freeze({
        track: meter.track,
        currentMeter: meter.currentMeter,
        startComputerDay: meter.startComputerDay,
        computerDay: meter.computerDay,
        startComputation: meter.startComputation,
        spentSince: recorder.spentSince,
        pausedMessage: recorder.pausedMessage
      }),
      sweeps: Object.freeze({
        stop() {
          for (const timer of timers.splice(0)) clearInterval(timer);
        }
      })
    };
  },
  async shutdown(_dependencies, { outputs }) {
    outputs.sweeps.stop();
  }
});

export { AccountFeature };
