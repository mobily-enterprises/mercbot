// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** file_storage
 * surrogateId (workspace_id)
 */
export const fileStorageResource = defineTableResource({
  name: "fileStorage",
  tableName: "file_storage",
  ownership: "workspace",
  schema: {
    kind: { type: "string", noTrim: true, required: true, search: true },
    settings: { type: "object", required: true, additionalProperties: true },
    driveLook: { type: "object", nullable: true, additionalProperties: true },
    move: { type: "object", nullable: true, additionalProperties: true },
    moveStatus: { type: "string", nullable: true, noTrim: true, search: true },
    moveClaim: { type: "string", nullable: true, noTrim: true, search: true },
    moveLeaseUntil: { type: "dateTime", nullable: true },
    moveCancel: { type: "boolean" },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** files_keys: the files key each files bucket keeps, decided by the first server to make one (D-91)
 * deployment-wide
 */
export const filesKeyResource = defineTableResource({
  name: "filesKeys",
  tableName: "files_keys",
  ownership: "public",
  idProperty: "bucket",
  schema: {
    id: { type: "string", primary: true, maxLength: 64, noTrim: true, required: true, storage: { column: "bucket" } },
    record: { type: "string", noTrim: true, required: true },
    createdAt: { type: "dateTime" }
  }
});

/** shell_runs */
export const shellRunResource = defineTableResource({
  name: "shellRuns",
  tableName: "shell_runs",
  ownership: "workspace",
  schema: {
    background: { type: "boolean" },
    changed: { type: "array" },
    // The bot in a chat whose command it is (D-112).
    chatBotId: { type: "id", required: true, search: true },
    exitCode: { type: "integer", nullable: true },
    finishedAt: { type: "dateTime", nullable: true },
    heartbeatAt: { type: "dateTime" },
    output: { type: "string", noTrim: true },
    script: { type: "string", noTrim: true, required: true },
    server: { type: "string", maxLength: 64, noTrim: true, required: true },
    startedAt: { type: "dateTime" },
    status: { type: "string", maxLength: 12, noTrim: true, search: true },
    userId: { type: "id", nullable: true, search: true },
    why: { type: "string", noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** page_versions: every saved version of a page (D-74) */
export const pageVersionResource = defineTableResource({
  name: "pageVersions",
  tableName: "page_versions",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    content: { type: "string", noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    kind: { type: "string", maxLength: 12, noTrim: true, required: true, search: true },
    pageKey: { type: "string", maxLength: 40, noTrim: true, required: true, search: true },
    path: { type: "string", noTrim: true, required: true, search: true },
    userId: { type: "id", nullable: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** media_checks: the pictures and videos waiting for a copy's check, which every server takes from in turn (D-90) */
export const mediaCheckResource = defineTableResource({
  name: "mediaChecks",
  tableName: "media_checks",
  ownership: "workspace",
  schema: {
    attempts: { type: "integer" },
    checkAfter: { type: "dateTime" },
    // Where the picture came from, kept loose: the check runs after its chat or bot may have gone.
    chatBotId: { type: "id", nullable: true, search: true },
    conversationId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    origin: { type: "string", maxLength: 16, noTrim: true, required: true, search: true },
    path: { type: "string", noTrim: true, required: true, search: true },
    place: { type: "object", nullable: true, additionalProperties: true },
    userId: { type: "id", nullable: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** internet_days: what a home's bot commands received and sent on the internet each day (UTC), one row a day (D-127) */
export const internetDayResource = defineTableResource({
  name: "internetDays",
  tableName: "internet_days",
  ownership: "workspace",
  schema: {
    bytesIn: { type: "integer" },
    bytesOut: { type: "integer" },
    connections: { type: "integer" },
    day: { type: "date", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** internet_minutes: each bot's new internet connections in its present minute, one row a bot (D-127) */
export const internetMinuteResource = defineTableResource({
  name: "internetMinutes",
  tableName: "internet_minutes",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    connections: { type: "integer" },
    // Minutes since 1970 (UTC).
    minute: { type: "integer", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  fileStorageResource, internetDayResource, internetMinuteResource, mediaCheckResource, pageVersionResource, shellRunResource
]);
