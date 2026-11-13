// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** apps */
export const appResource = defineTableResource({
  name: "apps",
  tableName: "apps",
  ownership: "workspace",
  schema: {
    id: { type: "string", primary: true, maxLength: 24, noTrim: true, required: true },
    color: { type: "string", maxLength: 16, noTrim: true },
    createdAt: { type: "dateTime" },
    draftVersionId: { type: "id", nullable: true, search: true },
    icon: { type: "string", maxLength: 40, noTrim: true },
    kind: { type: "string", maxLength: 8, noTrim: true, search: true },
    liveVersionId: { type: "id", nullable: true, search: true },
    madeByBotId: { type: "id", nullable: true, search: true },
    madeByUserId: { type: "id", nullable: true, search: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    publicAt: { type: "dateTime", nullable: true },
    retiredAt: { type: "dateTime", nullable: true },
    slug: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    theme: { type: "object", nullable: true, additionalProperties: true },
    updatedAt: { type: "dateTime" },
    visibility: { type: "string", maxLength: 16, noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_versions */
export const appVersionResource = defineTableResource({
  name: "appVersions",
  tableName: "app_versions",
  ownership: "workspace",
  schema: {
    appId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    createdAt: { type: "dateTime" },
    createdBy: { type: "object", additionalProperties: true },
    definition: { type: "object", required: true, additionalProperties: true },
    kind: { type: "string", maxLength: 16, noTrim: true, search: true },
    number: { type: "integer", nullable: true },
    publishedAt: { type: "dateTime", nullable: true },
    summary: { type: "string", noTrim: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_scripts */
export const appScriptResource = defineTableResource({
  name: "appScripts",
  tableName: "app_scripts",
  ownership: "workspace",
  schema: {
    id: { type: "string", primary: true, maxLength: 24, noTrim: true, required: true },
    appId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    code: { type: "string", noTrim: true, required: true, search: true },
    createdBy: { type: "object", required: true, additionalProperties: true },
    cursor: { type: "string", nullable: true },
    enabled: { type: "boolean" },
    key: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    kind: { type: "string", maxLength: 16, noTrim: true, search: true },
    nextRunAt: { type: "dateTime", nullable: true },
    settings: { type: "object", additionalProperties: true },
    summary: { type: "string", noTrim: true, required: true },
    tests: { type: "array" },
    updatedAt: { type: "dateTime" },
    version: { type: "integer" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_script_runs */
export const appScriptRunResource = defineTableResource({
  name: "appScriptRuns",
  tableName: "app_script_runs",
  ownership: "workspace",
  schema: {
    calls: { type: "integer" },
    error: { type: "string", noTrim: true, nullable: true },
    log: { type: "string", noTrim: true, nullable: true },
    ms: { type: "integer" },
    ok: { type: "boolean", required: true },
    scriptId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    startedAt: { type: "dateTime" },
    via: { type: "object", additionalProperties: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_script_rounds */
export const appScriptRoundResource = defineTableResource({
  name: "appScriptRounds",
  tableName: "app_script_rounds",
  ownership: "workspace",
  schema: {
    appId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    createdAt: { type: "dateTime" },
    failed: { type: "integer", required: true },
    failures: { type: "array" },
    passed: { type: "integer", required: true },
    round: { type: "integer", required: true },
    scriptKey: { type: "string", maxLength: 64, noTrim: true, required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_watches */
export const appWatcheResource = defineTableResource({
  name: "appWatches",
  tableName: "app_watches",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    condition: { type: "string", noTrim: true, nullable: true },
    conversationId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    createdBy: { type: "integer", nullable: true },
    cursor: { type: "string", required: true },
    enabled: { type: "boolean" },
    instructions: { type: "string", noTrim: true, required: true },
    name: { type: "string", maxLength: 120, noTrim: true, required: true, search: true },
    on: { type: "string", maxLength: 16, noTrim: true, required: true },
    runsHourStart: { type: "dateTime", nullable: true },
    runsInHour: { type: "integer" },
    tableId: { type: "string", maxLength: 24, noTrim: true, required: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_tables */
export const appTableResource = defineTableResource({
  name: "appTables",
  tableName: "app_tables",
  ownership: "workspace",
  schema: {
    id: { type: "string", primary: true, maxLength: 24, noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    key: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    label: { type: "string", maxLength: 120, noTrim: true, required: true },
    obsoleteAt: { type: "dateTime", nullable: true },
    titleFieldId: { type: "string", maxLength: 24, noTrim: true, nullable: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_fields */
export const appFieldResource = defineTableResource({
  name: "appFields",
  tableName: "app_fields",
  ownership: "workspace",
  schema: {
    id: { type: "string", primary: true, maxLength: 24, noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    key: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    label: { type: "string", maxLength: 120, noTrim: true, required: true },
    obsoleteAt: { type: "dateTime", nullable: true },
    options: { type: "object", additionalProperties: true },
    position: { type: "integer" },
    tableId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    type: { type: "string", maxLength: 16, noTrim: true, required: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_settings
 * surrogateId (workspace_id)
 */
export const appSettingResource = defineTableResource({
  name: "appSettings",
  tableName: "app_settings",
  ownership: "workspace",
  schema: {
    builderBotId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_themes
 * surrogateId (workspace_id)
 */
export const appThemeResource = defineTableResource({
  name: "appThemes",
  tableName: "app_themes",
  ownership: "workspace",
  schema: {
    theme: { type: "object", required: true, additionalProperties: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_pins
 * surrogateId (workspace_id, user_id, app_id)
 */
export const appPinResource = defineTableResource({
  name: "appPins",
  tableName: "app_pins",
  ownership: "workspace_user",
  schema: {
    appId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    position: { type: "integer" },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** audit_events */
export const auditEventResource = defineTableResource({
  name: "auditEvents",
  tableName: "audit_events",
  ownership: "workspace",
  // A watch reads its table's changes a thousand at a time (watches.js).
  queryMaxLimit: 1000,
  schema: {
    action: { type: "string", maxLength: 16, noTrim: true, required: true },
    actor: { type: "object", required: true, additionalProperties: true },
    at: { type: "dateTime" },
    changes: { type: "object", additionalProperties: true },
    recordId: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    tableId: { type: "string", maxLength: 24, noTrim: true, nullable: true },
    via: { type: "object", additionalProperties: true },
    workspaceId: { type: "id", hidden: true, search: true },
    xid: { type: "xid8", nullable: true }
  }
});

/** app_jobs
 * queued by apps, claimed by the bots app job runner through apps.jobs (system scope)
 */
export const appJobResource = defineTableResource({
  name: "appJobs",
  tableName: "app_jobs",
  ownership: "workspace",
  schema: {
    attempts: { type: "integer" },
    botId: { type: "id", required: true, search: true },
    claimedAt: { type: "dateTime", nullable: true },
    conversationId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    finishedAt: { type: "dateTime", nullable: true },
    kind: { type: "string", maxLength: 16, noTrim: true, required: true, search: true },
    leaseUntil: { type: "dateTime", nullable: true },
    prompt: { type: "string", noTrim: true, required: true },
    runAfter: { type: "dateTime" },
    runId: { type: "string", maxLength: 36, noTrim: true, nullable: true, search: true },
    status: { type: "string", maxLength: 16, noTrim: true, search: true },
    steps: { type: "array", nullable: true },
    title: { type: "string", maxLength: 200, noTrim: true, required: true },
    userId: { type: "id", nullable: true, search: true },
    watchId: { type: "id", nullable: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_web_access */
export const appWebAccessResource = defineTableResource({
  name: "appWebAccess",
  tableName: "app_web_access",
  ownership: "workspace",
  schema: {
    createdAt: { type: "dateTime" },
    createdBy: { type: "object", required: true, additionalProperties: true },
    headers: { type: "object", nullable: true, additionalProperties: true },
    origin: { type: "string", maxLength: 255, noTrim: true, required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** app_practices
 * a draft's practice copy (D-71): its records are AnyAPI's, under the copy's own tenant
 */
export const appPracticeResource = defineTableResource({
  name: "appPractices",
  tableName: "app_practices",
  ownership: "workspace",
  schema: {
    id: { type: "string", primary: true, maxLength: 24, noTrim: true, required: true },
    appId: { type: "string", maxLength: 24, noTrim: true, required: true, search: true },
    copied: { type: "array" },
    createdAt: { type: "dateTime" },
    usedAt: { type: "dateTime" },
    versionId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  appResource,
  appVersionResource,
  appScriptResource,
  appScriptRunResource,
  appScriptRoundResource,
  appWatcheResource,
  appTableResource,
  appFieldResource,
  appSettingResource,
  appThemeResource,
  appPinResource,
  auditEventResource,
  appJobResource,
  appWebAccessResource,
  appPracticeResource
]);
