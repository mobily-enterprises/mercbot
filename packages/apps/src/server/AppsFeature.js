// readable-check: allow no-direct-knex - infrastructure: AnyAPI keeps each home's runtime tables (the ones people define while the app runs, which no table resource describes) on the app's Knex
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { createAnyapi } from "./anyapi.js";
import { createAppsRepository } from "./appsRepository.js";
import { createAppsRuntime } from "./appsRuntime.js";
import { registerRoutes } from "./registerRoutes.js";
import { createAppJobs } from "./appJobs.js";
import { withPlatformSearch } from "./platformTables.js";
import { TABLE_RESOURCES } from "./tableResources.js";
import { loadTables } from "./tables.js";

// Apps (D-35, docs/apps-design.md): mini-apps built by bots on one AnyAPI database per home (D-36).
const AppsFeature = defineFeature({
  id: "mercbot.apps",
  domain: "apps",
  // The 15 apps tables, with the filters platformTables.js declares; the runtime tables are AnyAPI's.
  owns: withPlatformSearch(TABLE_RESOURCES),
  // The watch loop, due scripts, the pruning of scripts' old runs and the sweep of unused practice
  // copies of drafts run over every home.
  systemScope: "check app watches, run due scripts, prune old script runs and clear unused practice copies of drafts in every home",
  requires: {
    records: "mercbot.bots.records",
    http: "runtime.http",
    database: "runtime.database",
    fastify: "runtime.fastify",
    notices: "mercbot.notices",
    env: "runtime.env"
  },
  provides: {
    apps: "mercbot.apps"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} capabilities.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@local/notices/server/types").Notices} capabilities.notices
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   */
  async setup({ resources, systemContext, records, http, database, fastify, notices, env }) {
    // Each home's AnyAPI declares its runtime tables from the home's registry, whoever asks first.
    const anyapi = createAnyapi({
      knex: database.knex,
      notices,
      loadTables: (workspaceId) => loadTables(resources, { context: systemContext("build a home's runtime tables").forWorkspace(workspaceId) })
    });
    const apps = createAppsRuntime({ resources, systemContext, records, anyapi, notices, env });
    const reports = createAppsRepository(resources);
    // Only a server that is serving checks watches (D-15); on shutdown it finishes the claim in
    // hand (D-19).
    let watchLoop = null;
    fastify.addHook("onListen", () => {
      watchLoop = apps.watches.start({
        prune: async () => {
          await apps.scripts.prune();
          await apps.practices.sweep();
        },
        also: () => apps.scripts.runDue({ matchChanges: apps.watches.matchChanges })
      });
    });
    // Live streams close first, so pages reconnect to another server (D-19).
    const streams = new Set();
    fastify.addHook("preClose", async () => {
      for (const stream of streams) stream.end();
      // The loop runs only on a server that started listening, as above.
      if (watchLoop) await watchLoop.drain(10000);
      await apps.scripts.close();
    });
    registerRoutes(http, { appsRuntime: apps, notices, streams });
    return {
      apps: Object.freeze({
        anyapi: apps.anyapi,
        registry: apps.registry,
        gate: apps.gate,
        apps: apps.apps,
        practices: apps.practices,
        views: apps.views,
        runtime: apps.runtime,
        trial: apps.trial,
        watches: apps.watches,
        scripts: apps.scripts,
        installTemplate: apps.installTemplate,
        templateSummaries: apps.templateSummaries,
        // app_jobs: queued by apps (queueTask), claimed by the bots' app job runner in its system context.
        jobs: createAppJobs({ appJobs: resources.appJobs }),
        // The home's Activity trail, for what other features record there (an unlinked copy, D-31): an
        // entry `{ actor, via, action, changes }` in the call's home.
        activity: Object.freeze({
          record: (entry, options) => resources.auditEvents.create(entry, { ...passedOn(options), returning: "none" })
        }),
        // Reads over every home the call's options reach (a system context's): the apps a person made, with their
        // homes, and how many public apps each home has.
        acrossHomes: Object.freeze({
          madeBy: (userId, limit, options) => reports.appsMadeBy(userId, limit, passedOn(options)),
          publicCounts: (workspaceIds, options) => reports.publicAppsByHome(workspaceIds, passedOn(options))
        })
      })
    };
  }
});

export { AppsFeature };
