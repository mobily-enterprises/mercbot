// THIS FILE ALONE IS REWIRED BY THE PORT.
//
// The characterization tests reach everything else over HTTP. What no route reaches is built here, from the app's own
// modules, as the server builds it: the three queue loops' claims (routines, Apps' jobs and bot requests run in the
// background on a listening server, never for a request), the Apps tables a home's records live in (only the Builder
// bot's tools make them), the accounts a shared bot's room may use (only a bot's tools ask for that reach) and AnyAPI's
// rows for a home's tables. When the port changes how these are constructed (handles and table resources in place of
// Knex), only this file changes; the tests that call it stay as they are.
import { setTimeout as pause } from "node:timers/promises";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { __testables as anyapiTestables, createAnyapi } from "../../../packages/apps/src/server/anyapi.js";
import { createRegistry } from "../../../packages/apps/src/server/registry.js";
import { startAppJobRunner } from "../../../packages/bots/src/server/appJobRunner.js";
import { createBotRequests } from "../../../packages/bots/src/server/botRequests.js";
import { botMessageResource, botRequestResource, botRoutineResource } from "../../../packages/bots/src/server/records/tableResources.js";
import { REQUEST_SEARCH, ROUTINE_SEARCH, createWorkRepository } from "../../../packages/bots/src/server/records/workRepository.js";
import { startRoutineRunner } from "../../../packages/bots/src/server/routineRunner.js";
import { ACCOUNT_FILTERS, createAccounts } from "../../../packages/integrations/src/server/accounts.js";
import { reachableAccounts } from "../../../packages/integrations/src/server/rowPolicies.js";
import { pluginAccountResource } from "../../../packages/integrations/src/server/tableResources.js";

const QUIET = Object.freeze({ publish: async () => {}, publishEach: async () => {}, subscribe: () => () => {} });
const HOUR_MS = 60 * 60 * 1000;
// A sweep that takes longer than this is waiting on something: a claim that waits on another transaction's lock.
const BOUND_MS = 15000;

async function within(promise, message) {
  let timer = null;
  try {
    return await Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message())), BOUND_MS)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one loop's claims until a claim finds nothing due, and answers the ids it claimed, in claim order. The loop is
 * the app's own; `start(watch)` starts it with its claim wrapped by `watch`, which counts the claims, records what each
 * answers (its record, or null) and waits `pauseMs` first, so two sweeps at once interleave. Its timer is an hour, so
 * only its first tick and the ticks its own finished work starts run.
 */
async function sweep(pauseMs, start) {
  const claimed = [];
  let open = 0;
  let lastError = null;
  let foundNothing = () => {};
  const nothingLeft = new Promise((resolve) => (foundNothing = resolve));
  const watch = (claim) => async (...args) => {
    open += 1;
    try {
      if (pauseMs) await pause(pauseMs);
      const record = await claim(...args);
      if (record) claimed.push(String(record.id));
      else foundNothing();
      return record;
    } catch (error) {
      lastError = error;
      throw error;
    } finally {
      open -= 1;
    }
  };
  const loop = start(watch);
  try {
    await within(nothingLeft, () => `No claim came back empty within ${BOUND_MS / 1000} s: a claim waited on a lock, or failed (${lastError?.message || "no error"}).`);
  } catch (error) {
    await loop.drain(0);
    throw error;
  }
  await loop.drain(BOUND_MS);
  // A run that finished may have started one more claim (it finds nothing); the sweep ends after it.
  const deadline = Date.now() + BOUND_MS;
  while (open > 0) {
    if (Date.now() > deadline) throw new Error("A claim was still open after the loop drained.");
    await pause(5);
  }
  return claimed;
}

/**
 * The bots' records as BotRecordsFeature owns them, on this Knex (a second pool is a second server), and the bots'
 * system context, as BotsFeature declares it.
 * @param {import("knex").Knex} knex
 */
async function botsWork(knex) {
  const runtime = await createTestResourceRuntime({ knex });
  const resources = await runtime.own("mercbot.bots.records", [
    { resource: botRequestResource, searchSchema: REQUEST_SEARCH },
    { resource: botRoutineResource, searchSchema: ROUTINE_SEARCH },
    botMessageResource
  ]);
  return {
    runtime,
    work: createWorkRepository(resources),
    systemContext: runtime.declareSystemScope("mercbot.bots", "run the bots' queued work and resume their replies in every home")
  };
}

/**
 * apps.jobs as AppsFeature gives it to the bots (createAppJobs on its app_jobs handle, owned with its search entries),
 * on the same runtime. Apps' modules load only for the Apps job sweeps.
 * @param {Awaited<ReturnType<typeof createTestResourceRuntime>>} runtime
 */
async function appJobs(runtime) {
  const [{ createAppJobs }, { withPlatformSearch }, { appJobResource }] = await Promise.all([
    import("../../../packages/apps/src/server/appJobs.js"),
    import("../../../packages/apps/src/server/platformTables.js"),
    import("../../../packages/apps/src/server/tableResources.js")
  ]);
  const { appJobs: handle } = await runtime.own("mercbot.apps", withPlatformSearch([appJobResource]));
  return createAppJobs({ appJobs: handle });
}

/**
 * The routine runner's claims (packages/bots/src/server/routineRunner.js): due routines' ids in claim order.
 * @param {import("knex").Knex} knex
 * @param {{ pauseMs?: number }} [options]
 */
export async function sweepRoutines(knex, { pauseMs = 0 } = {}) {
  const { work, systemContext } = await botsWork(knex);
  return sweep(pauseMs, (watch) =>
    startRoutineRunner({ work: { ...work, claimRoutine: watch(work.claimRoutine) }, systemContext, run: async () => {}, everyMs: HOUR_MS, concurrency: 1000 }));
}

/**
 * The Apps job runner's claims (packages/bots/src/server/appJobRunner.js): queued jobs' ids in claim order; each claimed
 * job runs (doing nothing) and is marked done before the sweep ends.
 * @param {import("knex").Knex} knex
 * @param {{ pauseMs?: number }} [options]
 */
export async function sweepAppJobs(knex, { pauseMs = 0 } = {}) {
  const { runtime, systemContext } = await botsWork(knex);
  const jobs = await appJobs(runtime);
  return sweep(pauseMs, (watch) =>
    startAppJobRunner({ jobs: { ...jobs, claimNext: watch(jobs.claimNext) }, systemContext, notices: QUIET, run: async () => {}, everyMs: HOUR_MS, concurrency: 1000 }));
}

/**
 * The takeover claims of runs whose server stopped (D-59), on this Knex as one server's: a routine run
 * (records.work.claimStalledRoutine) and an Apps job (apps.jobs.claimStalled), each with a 90 s lease,
 * and the job's end as its runner writes it, in the job's home.
 * @param {import("knex").Knex} knex
 */
export async function stalledClaims(knex) {
  const { runtime, work, systemContext } = await botsWork(knex);
  const jobs = await appJobs(runtime);
  const system = { context: systemContext("run the stopped servers' runs") };
  return {
    routine: () => work.claimStalledRoutine(90, system),
    job: () => jobs.withTransaction(system, (txOptions) => jobs.claimStalled(txOptions, 90)),
    finish: (job, homeId) => jobs.finish(job, "done", { context: systemContext("app job runner").forWorkspace(String(homeId)) })
  };
}

/**
 * The bot requests' claims (packages/bots/src/server/botRequests.js runDue): each due step is claimed, then run; the
 * asking bot's turn (the step of a request whose answer came back) is answered by a turn that does nothing but record
 * the request and wait `pauseMs`. Answers the requests' ids in claim order.
 * @param {import("knex").Knex} knex
 * @param {{ pauseMs?: number }} [options]
 */
export async function sweepBotRequests(knex, { pauseMs = 0 } = {}) {
  const claimed = [];
  const { work, systemContext } = await botsWork(knex);
  const requests = createBotRequests({
    work,
    systemContext,
    // Every bot is found and nobody has a name: the steps' lookups are not what these tests pin.
    directory: { findBot: async (botId) => ({ id: String(botId), name: "A bot", color: "", shape: "", kind: "bot" }) },
    profiles: { findById: async () => null },
    notices: QUIET,
    meter: { track: (_who, work) => work() },
    rowOf: async (botId, conversationId) => ({ id: String(botId), conversation_id: String(conversationId) }),
    respond: async (_row, { requestTurn }) => {
      claimed.push(String((requestTurn.asking || requestTurn.working).id));
      if (pauseMs) await pause(pauseMs);
      return [];
    },
    append: async () => [],
    tell: async () => {},
    claimReply: async () => true,
    runs: { limits: { heartbeatMs: HOUR_MS }, heartbeat: async () => {}, release: async () => {} },
    background: (work) => {
      work.catch(() => {});
    }
  });
  await within(requests.runDue(), () => `The bot requests' claims did not finish within ${BOUND_MS / 1000} s: a claim waited on a lock.`);
  return claimed;
}

/**
 * Makes Apps tables in a home, as the Builder's tools do (packages/apps/src/server/registry.js createTable), in order,
 * so a link field's target table comes first. `definitions` are createTable's input ({ key, fields: [{ key, type,
 * required, target }] }); the tables' ids and fields are read over HTTP afterwards.
 * @param {import("knex").Knex} knex
 * @param {string} workspaceId
 * @param {{ type: "person", id: string, name: string }} actor
 * @param {object[]} definitions
 */
export async function createTables(knex, workspaceId, actor, definitions) {
  // The registry on the handles AppsFeature owns for it (the tables and fields, the audit trail), on this Knex, and AnyAPI
  // building the home's instance from them, as AppsFeature builds both. Apps' modules load only for this.
  const [{ createTestResourceRuntime: testResourceRuntime }, { loadTables }, { appFieldResource, appTableResource, auditEventResource }, { withPlatformSearch }] =
    await Promise.all([
      import("@jskit-ai/resource-runtime/test"),
      import("../../../packages/apps/src/server/tables.js"),
      import("../../../packages/apps/src/server/tableResources.js"),
      import("../../../packages/apps/src/server/platformTables.js")
    ]);
  const runtime = await testResourceRuntime({ knex });
  const resources = await runtime.own("mercbot.apps", withPlatformSearch([appTableResource, appFieldResource, auditEventResource]));
  const systemContext = runtime.declareSystemScope("tests.characterization", "make a home's Apps tables as the Builder's tools do");
  const inHome = (id) => ({ context: systemContext("make a home's Apps tables").forWorkspace(String(id)) });
  const anyapi = createAnyapi({ knex, notices: QUIET, loadTables: (id) => loadTables(resources, inHome(id)) });
  const registry = createRegistry({ resources, anyapi, notices: QUIET });
  for (const definition of definitions) await registry.createTable(actor, definition, inHome(workspaceId));
}

/** Removes a home's AnyAPI rows: its records and its tables' storage configuration, which belong to no home row. */
export async function dropTables(knex, workspaceId) {
  const tenant = anyapiTestables.tenantOf(workspaceId);
  await knex("any_records").where({ tenant_id: tenant }).del();
  await knex("any_resource_configs").where({ tenant_id: tenant }).del();
}

/**
 * The ids of the connected accounts a reach may use (packages/integrations/src/server/accounts.js), in id order. A
 * shared bot's room asks with `personal: false` (botConversations.js reachOf); no route does.
 * @param {import("knex").Knex} knex
 * @param {{ userId: string, homeId?: string | null, personal?: boolean }} reach
 */
export async function reachableAccountIds(knex, { userId, homeId = null, personal }) {
  const { accounts, systemContext } = await integrationsAccountsOn(knex);
  // As a bot's turn asks: a job acting for the person, in the home, or for them alone outside any home.
  const scope = systemContext("a bot's turn reaches the accounts of its room");
  const context = homeId ? scope.forWorkspace(String(homeId), { actorId: String(userId) }) : scope.forUser(String(userId), { actorId: String(userId) });
  return (await accounts.reachable(personal === undefined ? {} : { personal }, { context })).map((account) => account.id);
}

const integrationsAccounts = new WeakMap();

/** integrations' plugin_accounts repository on `knex`, as IntegrationsFeature builds it, once per connection. */
function integrationsAccountsOn(knex) {
  if (!integrationsAccounts.has(knex)) {
    integrationsAccounts.set(knex, (async () => {
      const runtime = await createTestResourceRuntime({ knex });
      const { pluginAccounts } = await runtime.own("mercbot.integrations", [
        { resource: pluginAccountResource, rowPolicy: reachableAccounts, searchSchema: ACCOUNT_FILTERS }
      ]);
      const systemContext = runtime.declareSystemScope("mercbot.integrations", "characterization: the accounts a bot's turn reaches");
      return { accounts: createAccounts({ pluginAccounts, systemContext }), systemContext };
    })());
  }
  return integrationsAccounts.get(knex);
}
