// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** plugin_accounts
 * every connected account is its home's, for everyone in it and their bots (D-111); user_id is who added it
 */
export const pluginAccountResource = defineTableResource({
  name: "pluginAccounts",
  tableName: "plugin_accounts",
  ownership: "workspace",
  schema: {
    bridgeRef: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    connectedAt: { type: "dateTime", nullable: true },
    label: { type: "string", maxLength: 200, noTrim: true, nullable: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    // The Request pace chosen in Connect apps (D-96): "gentle", "normal" or "fast"; null is Gentle.
    pace: { type: "string", maxLength: 16, noTrim: true, nullable: true },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    signInState: { type: "string", maxLength: 16, noTrim: true, nullable: true },
    status: { type: "string", maxLength: 16, noTrim: true, search: true },
    tokens: { type: "object", nullable: true, additionalProperties: true },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** plugin_account_people
 * who a home's person is at an app connected with the home's API credentials, when their address finds no one there:
 * the user they picked, asked until an owner or admin confirms it (D-93)
 */
export const pluginAccountPersonResource = defineTableResource({
  name: "pluginAccountPeople",
  tableName: "plugin_account_people",
  ownership: "workspace",
  schema: {
    accountId: { type: "id", required: true, search: true },
    appUserId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    appUserName: { type: "string", maxLength: 200, noTrim: true, required: true },
    confirmedAt: { type: "dateTime", nullable: true },
    confirmedBy: { type: "id", nullable: true },
    createdAt: { type: "dateTime" },
    org: { type: "string", maxLength: 100, noTrim: true, required: true, search: true },
    status: { type: "string", maxLength: 16, noTrim: true, required: true, search: true },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** plugin_account_turns
 * each connected account's next turn to send a request to its app, shared by every server (D-96, appRequests.js)
 */
export const pluginAccountTurnResource = defineTableResource({
  name: "pluginAccountTurns",
  tableName: "plugin_account_turns",
  ownership: "public",
  idProperty: "account_id",
  schema: {
    id: { type: "id", primary: true, required: true, storage: { column: "account_id" } },
    nextAt: { type: "dateTime", required: true }
  }
});

/** oauth_states
 * a sign-in in progress, found by its unguessable state on the provider's callback
 */
export const oauthStateResource = defineTableResource({
  name: "oauthStates",
  tableName: "oauth_states",
  ownership: "public",
  idProperty: "state",
  schema: {
    id: { type: "string", primary: true, maxLength: 64, noTrim: true, required: true, storage: { column: "state" } },
    accountId: { type: "id", nullable: true, search: true },
    // The hash of the cookie the browser that started it keeps (D-97, signInBinding.js).
    binding: { type: "string", nullable: true, maxLength: 64, noTrim: true },
    bridgeConnectionId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    // A lent sign-in's: the account the linked copy is linked to, who begins it here signed in (D-97).
    lentTo: { type: "id", nullable: true },
    provider: { type: "string", maxLength: 32, noTrim: true, required: true, search: true },
    verifier: { type: "object", required: true, additionalProperties: true }
  }
});

/** home_plugins
 * the apps on a home's list (D-111); user_id is who added it, null once they're gone
 */
export const homePluginResource = defineTableResource({
  name: "homePlugins",
  tableName: "home_plugins",
  ownership: "workspace",
  schema: {
    installedAt: { type: "dateTime" },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    userId: { type: "id", nullable: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** user_skills */
export const userSkillResource = defineTableResource({
  name: "userSkills",
  tableName: "user_skills",
  ownership: "user",
  schema: {
    createdAt: { type: "dateTime" },
    description: { type: "string", maxLength: 240, noTrim: true },
    instructions: { type: "string", noTrim: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    updatedAt: { type: "dateTime" },
    userId: { type: "id", hidden: true, search: true }
  }
});

/** app_interest
 * surrogateId (user_id, plugin_id)
 */
export const appInterestResource = defineTableResource({
  name: "appInterest",
  tableName: "app_interest",
  ownership: "user",
  schema: {
    createdAt: { type: "dateTime" },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    userId: { type: "id", hidden: true, search: true }
  }
});

/** plugin_actions_off
 * surrogateId (user_id, plugin_id, action_id)
 */
export const pluginActionsOffResource = defineTableResource({
  name: "pluginActionsOff",
  tableName: "plugin_actions_off",
  ownership: "user",
  schema: {
    actionId: { type: "string", maxLength: 80, noTrim: true, required: true },
    pluginId: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    userId: { type: "id", hidden: true, search: true }
  }
});

/** bridge_link
 * deployment-wide bridge state
 */
export const bridgeLinkResource = defineTableResource({
  name: "bridgeLink",
  tableName: "bridge_link",
  ownership: "public",
  schema: {
    createdAt: { type: "dateTime" },
    hubUrl: { type: "string", maxLength: 300, noTrim: true, required: true },
    linkedBy: { type: "id", nullable: true, search: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    pending: { type: "object", nullable: true, additionalProperties: true },
    token: { type: "object", nullable: true, additionalProperties: true }
  }
});

/** connector_apps
 * deployment-wide: the client this copy registered with each app that hosts its own connection point (D-34)
 */
export const connectorAppResource = defineTableResource({
  name: "connectorApps",
  tableName: "connector_apps",
  ownership: "public",
  schema: {
    client: { type: "object", required: true, additionalProperties: true },
    createdAt: { type: "dateTime" },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    redirectUri: { type: "string", maxLength: 300, noTrim: true, required: true },
    server: { type: "object", required: true, additionalProperties: true },
    tools: { type: "array" },
    updatedAt: { type: "dateTime" }
  }
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  pluginAccountResource,
  pluginAccountPersonResource,
  pluginAccountTurnResource,
  oauthStateResource,
  homePluginResource,
  userSkillResource,
  appInterestResource,
  pluginActionsOffResource,
  bridgeLinkResource,
  connectorAppResource
]);
