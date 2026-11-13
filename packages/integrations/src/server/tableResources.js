// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** plugin_accounts */
export const pluginAccountResource = defineTableResource({
  name: "pluginAccounts",
  tableName: "plugin_accounts",
  ownership: "workspace_or_shared",
  schema: {
    bridgeRef: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    connectedAt: { type: "dateTime", nullable: true },
    label: { type: "string", maxLength: 200, noTrim: true, nullable: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    signInState: { type: "string", maxLength: 16, noTrim: true, nullable: true },
    status: { type: "string", maxLength: 16, noTrim: true, search: true },
    tokens: { type: "object", nullable: true, additionalProperties: true },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", nullable: true, hidden: true, search: true }
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
    bridgeConnectionId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    provider: { type: "string", maxLength: 32, noTrim: true, required: true, search: true },
    verifier: { type: "object", required: true, additionalProperties: true }
  }
});

/** user_plugins */
export const userPluginResource = defineTableResource({
  name: "userPlugins",
  tableName: "user_plugins",
  ownership: "user",
  schema: {
    installedAt: { type: "dateTime" },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    userId: { type: "id", hidden: true, search: true }
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
  oauthStateResource,
  userPluginResource,
  userSkillResource,
  appInterestResource,
  pluginActionsOffResource,
  bridgeLinkResource,
  connectorAppResource
]);
