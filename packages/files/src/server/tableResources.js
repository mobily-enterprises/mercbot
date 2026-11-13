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

/** shell_runs */
export const shellRunResource = defineTableResource({
  name: "shellRuns",
  tableName: "shell_runs",
  ownership: "workspace",
  schema: {
    background: { type: "boolean" },
    botId: { type: "id", required: true, search: true },
    changed: { type: "array" },
    conversationId: { type: "id", nullable: true, search: true },
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

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([fileStorageResource, pageVersionResource, shellRunResource]);
