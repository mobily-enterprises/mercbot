// mercbot.bots.records for tests that build the bots' services without booting a server: the records feature started
// as the server starts it, on the test's own Knex, beside JSKIT's own owners of the users and workspaces tables
// (users.profiles, workspaces.memberships and workspaces, which it requires). The test database is the migrated one.
import { startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { WorkspaceRecordsFeature } from "@jskit-ai/workspaces-core/test/WorkspaceRecordsFeature";
import { AccountFeature } from "../../packages/account/src/server/AccountFeature.js";
import { BotRecordsFeature } from "../../packages/bots/src/server/records/BotRecordsFeature.js";
import { requestContextOptions } from "./requestContextOptions.mjs";

const OWNERS = Object.freeze([BotRecordsFeature, WorkspaceRecordsFeature, UsersIdentityProvider, UsersExtensionsProvider]);

/** What AccountFeature is given beside its records: no routes, and a server that never listens, so no sweeps run. */
const accountInputs = (knex, env) => ({
  "runtime.http": { router: { register() {} } },
  "runtime.uploads": {},
  "runtime.env": env,
  "runtime.database": { knex },
  "runtime.fastify": { addHook() {}, register() {} }
});

/** Starts the features, stopped when the test ends, and answers the capabilities `requires` names. */
async function started(knex, context, { features, requires, inputs = {} }) {
  const { capabilities, stop } = await startTestFeatures({ knex, features, requires, inputs });
  context.after(stop);
  return capabilities;
}

/** `feature` as defined, keeping the handles the resource runtime gives it in `kept.handles`. */
function keepingHandles(feature, kept) {
  return Object.freeze({
    ...feature,
    setup(dependencies, setupContext) {
      const runtime = dependencies.resourceRuntime;
      const resourceRuntime = new Proxy({}, {
        get: (_target, name) => (name === "own" ? async (featureId, owns) => (kept.handles = await runtime.own(featureId, owns)) : runtime[name])
      });
      return feature.setup({ ...dependencies, resourceRuntime }, setupContext);
    }
  });
}

/**
 * Starts the bots' records, stopped when the test ends.
 * @param {import("knex").Knex} knex the test database
 * @param {{ after: (work: () => unknown) => void }} context the test's context, for its cleanup
 * @returns {Promise<import("../../packages/bots/src/server/types.js").BotRecords>}
 */
export async function startBotRecords(knex, context) {
  return (await started(knex, context, { features: OWNERS, requires: { records: "mercbot.bots.records" } })).records;
}

/**
 * The bots' records with mercbot.account beside them, as the server starts it, for a test whose bot saves a login to
 * the person's Vault (the bots service's `account`). Its routes are registered nowhere, so it needs no uploads.
 * @param {import("knex").Knex} knex the test database
 * @param {{ after: (work: () => unknown) => void }} context the test's context, for its cleanup
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} [env] the account's environment (the Vault key)
 * @returns {Promise<{ records: import("../../packages/bots/src/server/types.js").BotRecords, account: object }>}
 */
export async function startBotRecordsWithAccount(knex, context, env = process.env) {
  const { records, account } = await started(knex, context, {
    features: [...OWNERS, AccountFeature],
    requires: { records: "mercbot.bots.records", account: "mercbot.account" },
    inputs: accountInputs(knex, env)
  });
  return { records, account };
}

/**
 * The bots' records with what expectScoped and expectFlatQueries need beside them: the bots' own handles, by resource
 * name, and a system context that reads every home's rows (for seeding a home and reading another's back).
 * @param {import("knex").Knex} knex the test database
 * @param {{ after: (work: () => unknown) => void }} context the test's context, for its cleanup
 */
export async function startBotRecordsForChecks(knex, context) {
  const kept = {};
  const { capabilities, resources, stop } = await startTestFeatures({
    knex,
    features: [keepingHandles(BotRecordsFeature, kept), ...OWNERS.slice(1)],
    requires: { records: "mercbot.bots.records" }
  });
  context.after(stop);
  const systemContext = resources.declareSystemScope("tests.bots", "seed and read back the bots tests' homes");
  return { records: capabilities.records, handles: kept.handles, systemContext };
}

/**
 * The call options a signed-in member's request in a home carries, as the bots routes build them
 * (requestContextOptions: what a route's `request.callOptions()` answers).
 * @param {{ userId: string | number, homeId: string | number, role?: string, permissions?: string[] }} member
 */
export function memberOptions({ userId, homeId, role = "member", permissions = [] }) {
  return requestContextOptions({
    user: { id: userId },
    workspace: { id: homeId, slug: `home-${homeId}` },
    membership: { roleSid: role },
    permissions
  });
}

// BotsFeature's systemScope (packages/bots/src/server/BotsFeature.js), word for word.
const BOTS_SYSTEM_SCOPE = "run the bots' queued work and resume their replies in every home";

/**
 * What BotsFeature gives the bots service beside its records, for a test whose bots do background work (requests
 * between bots, goals, routines, Apps tasks, resumed replies) or name people and homes: the records, users.profiles,
 * the workspaces' records, mercbot.account and its meter (what a goal has spent, a login saved to the Vault) and the
 * bots' system context, all on one runtime, stopped when the test ends. Spread it into serviceDoubles in place of
 * `records`; a test's own meter or account, passed after it, wins. The account's routes are registered nowhere, so it
 * needs no uploads.
 * @param {import("knex").Knex} knex the test database
 * @param {{ after: (work: () => unknown) => void }} context the test's context, for its cleanup
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} [env] the account's environment (the Vault key)
 */
export async function startBotParts(knex, context, env = process.env) {
  const { capabilities, resources, stop } = await startTestFeatures({
    knex,
    features: [...OWNERS, AccountFeature],
    requires: { records: "mercbot.bots.records", profiles: "users.profiles", workspaces: "workspaces", account: "mercbot.account", meter: "mercbot.meter" },
    inputs: accountInputs(knex, env)
  });
  context.after(stop);
  const systemContext = resources.declareSystemScope("mercbot.bots", BOTS_SYSTEM_SCOPE);
  const { records, profiles, workspaces, account, meter } = capabilities;
  return { records, profiles, workspaces, account, meter, systemContext };
}

/**
 * A routine or an Apps job row (snake_case, as a test seeds it with Knex) as its runner claims it and hands it to
 * bots.runRoutine or bots.runAppTask: the record's camelCase fields, its hidden workspaceId (the home it runs in)
 * included.
 * @param {Record<string, unknown>} row
 */
export function claimedWork(row) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column.replace(/_([a-z])/gu, (_, letter) => letter.toUpperCase()), value]));
}
