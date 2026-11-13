import { startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { WorkspaceRecordsFeature } from "@jskit-ai/workspaces-core/test/WorkspaceRecordsFeature";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createShell } from "../../packages/files/src/server/shell.js";
import { createShellRuns } from "../../packages/files/src/server/shellRuns.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createIntegrationsService } from "../../packages/integrations/src/server/integrationsService.js";

// For a test that builds a feature's modules itself, without starting the feature and its routes: the feature's
// handles and system context on the test's own Knex, as the resource runtime gives them to the feature's setup, beside
// JSKIT's own owners of the users and workspaces tables (users.profiles, workspaces.memberships). The test database is
// the migrated one.

/**
 * Owns each feature's tables, stopped when the test ends.
 * @param {import("knex").Knex} knex the test database
 * @param {{ after: (work: () => unknown) => void }} context the test's context, for its cleanup
 * @param {Record<string, ReadonlyArray<object>>} ownsByFeature each feature's owns entries (its exported *_OWNS), by feature id
 * @returns {Promise<{
 *   profiles: import("@jskit-ai/users-core/server/types").UsersProfiles,
 *   memberships: object,
 *   features: Record<string, { resources: Record<string, any>, systemContext: (reason: string) => object }>
 * }>}
 */
export async function ownedHandles(knex, context, ownsByFeature) {
  const { capabilities, resources: runtime, stop } = await startTestFeatures({
    knex,
    features: [UsersIdentityProvider, UsersExtensionsProvider, WorkspaceRecordsFeature],
    requires: { profiles: "users.profiles", memberships: "workspaces.memberships" }
  });
  context.after(stop);
  const features = {};
  for (const [featureId, owns] of Object.entries(ownsByFeature)) {
    features[featureId] = {
      resources: await runtime.own(featureId, owns),
      systemContext: runtime.declareSystemScope(featureId, `the ${featureId} tests' own modules, built without starting the feature`)
    };
  }
  return { profiles: capabilities.profiles, memberships: capabilities.memberships, features };
}

/**
 * The integrations service as IntegrationsFeature builds it, on the test's Knex: `{ integrations }`. `connections`
 * stands in for the sign-ins (by default no account lacks access).
 * @param {import("knex").Knex} knex
 * @param {{ after: (work: () => unknown) => void }} context
 * @param {{ catalogue: ReadonlyArray<object>, connections?: object }} options
 */
export async function startIntegrations(knex, context, { catalogue, connections = { lacksAccess: () => false } }) {
  const { profiles, features } = await ownedHandles(knex, context, { "mercbot.integrations": INTEGRATIONS_OWNS });
  const { resources, systemContext } = features["mercbot.integrations"];
  const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
  const integrations = createIntegrationsService({ resources, accounts, catalogue, connections, profiles, systemContext });
  return { integrations };
}

/** A meter for commands that opens every block and records nothing. */
const FREE_BLOCKS = Object.freeze({ startComputation: async () => ({ blockSeconds: 600, renew: async () => true, settle: async () => true }) });

/**
 * The bots' command line as the files feature builds it, on the test's Knex and `store`: `{ shell, commandOutput,
 * inHome }`. `inHome(homeId)` is a job's call options in one home, as a bot's tools carry them.
 * @param {import("knex").Knex} knex
 * @param {{ after: (work: () => unknown) => void }} context
 * @param {{ store: object, env?: Record<string, unknown>, limits?: object, meter?: object }} options `meter` records
 *   commands' computation (D-73); by default every block is opened and nothing recorded
 */
export async function startShell(knex, context, { store, env = process.env, limits, meter = FREE_BLOCKS }) {
  const { features } = await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS });
  const { resources, systemContext } = features["mercbot.files"];
  const runs = createShellRuns({ shellRuns: resources.shellRuns, systemContext });
  return {
    shell: createShell({ store, runs, env, meter, ...(limits ? { limits } : {}) }),
    commandOutput: runs.commandOutput,
    inHome: (homeId) => ({ context: systemContext("a bot's tools, in the home their turn runs in").forWorkspace(String(homeId)) })
  };
}
