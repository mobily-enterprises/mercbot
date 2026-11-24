import { defineFeature } from "@jskit-ai/kernel/server/features";
import { isStagingOrProduction } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { personName } from "@local/homes/server/personName";
import { ACCOUNT_FILTERS, createAccounts } from "./accounts.js";
import { loadCatalogue } from "./catalogue.js";
import { SIGN_IN_STATE_FILTERS, createConnections } from "./connections.js";
import { createDepartures } from "./departures.js";
import { ACTION_SWITCH_FILTERS, createIntegrationsService } from "./integrationsService.js";
import { PROVIDERS, createOAuth } from "./oauth.js";
import { registerRoutes } from "./registerRoutes.js";
import { createSednaCredentials } from "./sednaCredentials.js";
import { TABLE_RESOURCES, oauthStateResource, pluginAccountResource, pluginActionsOffResource, userSkillResource } from "./tableResources.js";

/**
 * Outside staging and production only (APP_ENV, D-87): the Test Preview's stand-in Google Drive
 * (tests/support/fakeDrive.mjs, D-80) at MERCBOT_TEST_GOOGLE_DRIVE_URL is Google's sign-in for connected accounts too,
 * so an account there is renewed and signed in to again without Google. It is signed in to with this copy's own Google
 * app, as Google is (credentials in oauth.js), which the stand-in checks as Google does: without one nothing is renewed,
 * and one it doesn't know is refused invalid_client. Otherwise nothing changes.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function standInGoogle(env) {
  const url = String(env.MERCBOT_TEST_GOOGLE_DRIVE_URL || "").trim();
  if (!url || isStagingOrProduction(env)) return {};
  const google = {
    ...PROVIDERS.google,
    server: { issuer: url, authorization_endpoint: `${url}/authorize`, token_endpoint: `${url}/token` },
    whoami: { ...PROVIDERS.google.whoami, url: `${url}/oauth2/v3/userinfo` }
  };
  return { providers: { ...PROVIDERS, google }, oauthClient: createOAuth({ env, insecure: true }) };
}

/**
 * The apps connected with API credentials (D-93), by the kind plugin.json names. Outside staging and production only
 * (APP_ENV, D-87), the Test Preview's stand-in Sedna (tests/support/fakeSedna.mjs) at MERCBOT_TEST_SEDNA_URL answers
 * for every tenant instead of <tenant>.sednanetwork.com. Otherwise Sedna is always Sedna.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function credentialKinds(env) {
  const url = String(env.MERCBOT_TEST_SEDNA_URL || "").trim();
  return { sedna: createSednaCredentials({ standIn: url && !isStagingOrProduction(env) ? url : "" }) };
}

/**
 * The call's home's people, `[{ id, name, email }]`, a person's sign-in address, and the person of the home who signs in
 * with an address: whom an app connected with the home's API credentials matches to its users (D-93, appPeople.js).
 * JSKIT confirms an address before it is a person's.
 * @param {{ memberships: import("@jskit-ai/workspaces-core/server/types").WorkspacesMemberships,
 *   profiles: import("@jskit-ai/users-core/server/types").UsersProfiles }} capabilities
 */
export function homeDirectory({ memberships, profiles }) {
  return {
    homePeople: async (options) => {
      const ids = await memberships.activeMemberIds(options.context?.workspace?.id, passedOn(options));
      return (await profiles.listByIds(ids, passedOn(options))).map((user) => ({ id: String(user.id), name: personName(user), email: String(user.email || "") }));
    },
    emailOf: async (userId, options) => String((await profiles.findById(userId, passedOn(options)))?.email || ""),
    memberWithEmail: async (email, options) => {
      const person = await profiles.findByEmail(email, passedOn(options));
      const homeId = options.context?.workspace?.id;
      const member = person && await memberships.findActiveByWorkspaceIdAndUserId(homeId, person.id, passedOn(options));
      return member ? String(person.id) : null;
    }
  };
}

/** Each owned table's search entries, by resource. */
const OWNS_ENTRIES = new Map([
  [pluginAccountResource, { searchSchema: ACCOUNT_FILTERS }],
  [oauthStateResource, { searchSchema: SIGN_IN_STATE_FILTERS }],
  [pluginActionsOffResource, { searchSchema: ACTION_SWITCH_FILTERS }],
  // A person's own skills reach the model only in a private chat whose one person they are (the bots' rule, D-112).
  [userSkillResource, { rowPolicy: ({ requires, ...args }) => requires.records.rules.personalRule(args) }]
]);

/** The tables the integrations feature owns, with their search entries. */
export const INTEGRATIONS_OWNS = Object.freeze(
  TABLE_RESOURCES.map((resource) => (OWNS_ENTRIES.has(resource) ? { resource, ...OWNS_ENTRIES.get(resource) } : resource))
);

// Connect apps (D-31, D-33, D-111): the catalogue, the apps on each home's list and the home's accounts of each, signing
// them in, and this copy's side of the bridge between copies of Mercbot. When a home's people change, the accounts of
// anyone no longer in it go (departures.js). A feature that lends this copy's sign-ins to other copies provides
// `mercbot.integrations.bridged-sign-ins`.
const IntegrationsFeature = defineFeature({
  id: "mercbot.integrations",
  domain: "integrations",
  owns: INTEGRATIONS_OWNS,
  systemScope:
    "finish provider sign-ins, which no one is signed in to; act on a person's own wishes, switches and skills for a job; withdraw the accounts of someone no longer in a home; count app demand; pace each connected account's requests to its app",
  requires: {
    records: "mercbot.bots.records",
    http: "runtime.http",
    env: "runtime.env",
    events: "runtime.events",
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
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} capabilities.events
   * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} capabilities.profiles
   * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesMemberships} capabilities.memberships
   * @param {import("@local/apps/server/types").Apps} capabilities.apps whose Activity trail records an unlink (D-31) and
   *   the accounts that went with someone who left (D-111)
   * @param {import("./types.js").BridgedSignIns | null} capabilities.bridgedSignIns the bridge connections this copy
   *   lends its sign-ins to, if a feature keeps them
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  async setup({ http, env, events, profiles, memberships, apps, bridgedSignIns, resources, systemContext }) {
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
      credentialKinds: credentialKinds(env),
      systemContext,
      ...homeDirectory({ memberships, profiles }),
      ...standInGoogle(env)
    });
    const integrations = createIntegrationsService({ resources, accounts, catalogue, connections, profiles, systemContext });
    const departures = createDepartures({
      accounts,
      connections,
      activeMemberIds: (homeId, options) => memberships.activeMemberIds(homeId, passedOn(options)),
      namesOf: integrations.namesOf,
      appName: integrations.appName,
      recordActivity: (entry, options) => apps.activity.record(entry, options),
      systemContext
    });
    // JSKIT tells of a home's people changing (workspace.member.remove among them) with the home's id alone.
    events.register({
      id: "mercbot.integrations.departures",
      matches: (event) => event.type === "entity.changed" && event.source === "workspace" && event.entity === "member",
      handle: (event) =>
        departures.withdrawDeparted(String(event.entityId)).catch((error) =>
          console.warn("Removing the accounts of someone who left a home failed; they go at the home's next change of people.", error))
    });
    registerRoutes(http, { integrations, catalogue, env });
    return { integrations };
  }
});

export { IntegrationsFeature };
