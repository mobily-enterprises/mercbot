import { defineFeature } from "@jskit-ai/kernel/server/features";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { ACCOUNT_FILTERS, createAccounts } from "./accounts.js";
import { loadCatalogue } from "./catalogue.js";
import { SIGN_IN_STATE_FILTERS, createConnections } from "./connections.js";
import { ACTION_SWITCH_FILTERS, createIntegrationsService } from "./integrationsService.js";
import { PROVIDERS, createOAuth } from "./oauth.js";
import { registerRoutes } from "./registerRoutes.js";
import { reachableAccounts } from "./rowPolicies.js";
import { TABLE_RESOURCES, oauthStateResource, pluginAccountResource, pluginActionsOffResource } from "./tableResources.js";

/**
 * Outside production only: the Test Preview's stand-in Google Drive (tests/support/fakeDrive.mjs, D-80) at
 * MERCBOT_TEST_GOOGLE_DRIVE_URL is Google's sign-in for connected accounts too, so an account there is renewed and
 * signed in to again without Google. Otherwise nothing changes.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function standInGoogle(env) {
  const url = env.NODE_ENV !== "production" && String(env.MERCBOT_TEST_GOOGLE_DRIVE_URL || "").trim();
  if (!url) return {};
  // The stand-in's own client, whichever pair this copy would pick (credentials in oauth.js).
  const standInEnv = { ...env, GOOGLE_CLIENT_ID: "stand-in", GOOGLE_CLIENT_SECRET: "stand-in", GOOGLE_TEST_CLIENT_ID: "stand-in", GOOGLE_TEST_CLIENT_SECRET: "stand-in" };
  const google = {
    ...PROVIDERS.google,
    server: { issuer: url, authorization_endpoint: `${url}/authorize`, token_endpoint: `${url}/token` },
    whoami: { ...PROVIDERS.google.whoami, url: `${url}/oauth2/v3/userinfo` }
  };
  return { env: standInEnv, providers: { ...PROVIDERS, google }, oauthClient: createOAuth({ env: standInEnv, insecure: true }) };
}

/** Each owned table's row policy and search entries, by resource. */
const OWNS_ENTRIES = new Map([
  [pluginAccountResource, { rowPolicy: reachableAccounts, searchSchema: ACCOUNT_FILTERS }],
  [oauthStateResource, { searchSchema: SIGN_IN_STATE_FILTERS }],
  [pluginActionsOffResource, { searchSchema: ACTION_SWITCH_FILTERS }]
]);

/** The tables the integrations feature owns, with their row policy and search entries. */
export const INTEGRATIONS_OWNS = Object.freeze(
  TABLE_RESOURCES.map((resource) => (OWNS_ENTRIES.has(resource) ? { resource, ...OWNS_ENTRIES.get(resource) } : resource))
);

// Connect apps (D-31, D-33, D-37): the catalogue, people's and homes' accounts of each app, signing them in, and this
// copy's side of the bridge between copies of Mercbot. A feature that lends this copy's sign-ins to other copies
// provides `mercbot.integrations.bridged-sign-ins`.
const IntegrationsFeature = defineFeature({
  id: "mercbot.integrations",
  domain: "integrations",
  owns: INTEGRATIONS_OWNS,
  systemScope:
    "write people's own connected accounts, which belong to no home, once a scoped read found them the caller's; finish provider sign-ins, which no one is signed in to; act on a person's own apps and skills for a job; count app demand",
  requires: {
    http: "runtime.http",
    env: "runtime.env",
    profiles: "users.profiles",
    memberships: "workspaces.memberships",
    apps: "mercbot.apps"
  },
  optional: {
    bridgedSignIns: "mercbot.integrations.bridged-sign-ins"
  },
  provides: {
    integrations: "mercbot.integrations"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} capabilities.profiles
   * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesMemberships} capabilities.memberships
   * @param {import("@local/apps/server/types").Apps} capabilities.apps whose Activity trail records an unlink (D-31)
   * @param {import("./types.js").BridgedSignIns | null} capabilities.bridgedSignIns the bridge connections this copy
   *   lends its sign-ins to, if a feature keeps them
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  async setup({ http, env, profiles, memberships, apps, bridgedSignIns, resources, systemContext }) {
    const catalogue = await loadCatalogue();
    const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
    const connections = createConnections({
      resources,
      accounts,
      catalogue,
      env,
      isMember: async (homeId, userId, options) =>
        Boolean(await memberships.findActiveByWorkspaceIdAndUserId(homeId, userId, passedOn(options))),
      recordActivity: (entry, options) => apps.activity.record(entry, options),
      bridgedSignIns: bridgedSignIns || null,
      ...standInGoogle(env)
    });
    const integrations = createIntegrationsService({ resources, accounts, catalogue, connections, profiles, systemContext });
    registerRoutes(http, { integrations, catalogue, env });
    return { integrations };
  }
});

export { IntegrationsFeature };
