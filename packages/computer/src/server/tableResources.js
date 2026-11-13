// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** bot_computers
 * addWorkspace from bot_conversations via conversation_id
 */
export const botComputerResource = defineTableResource({
  name: "botComputers",
  tableName: "bot_computers",
  ownership: "workspace",
  idProperty: "conversation_id",
  schema: {
    id: { type: "id", primary: true, required: true, storage: { column: "conversation_id" } },
    error: { type: "string", noTrim: true },
    serverId: { type: "string", maxLength: 200, noTrim: true, required: true },
    state: { type: "string", maxLength: 20, noTrim: true, search: true },
    updatedAt: { type: "dateTime" },
    url: { type: "string", noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_browser_state
 * addWorkspace from bot_conversations via conversation_id
 */
export const botBrowserStateResource = defineTableResource({
  name: "botBrowserState",
  tableName: "bot_browser_state",
  ownership: "workspace",
  idProperty: "conversation_id",
  schema: {
    id: { type: "id", primary: true, required: true, storage: { column: "conversation_id" } },
    cookiesSavedAt: { type: "dateTime", nullable: true },
    cookiesSha256: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    profileBytes: { type: "integer", nullable: true },
    profileFile: { type: "string", maxLength: 80, noTrim: true, nullable: true },
    profileSavedAt: { type: "dateTime", nullable: true },
    profileSha256: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    url: { type: "string", noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** computer_tickets
 * addWorkspace from bot_conversations via conversation_id
 * a ticket redeemed without a home (desktop socket) is read in the computer's system scope
 */
export const computerTicketResource = defineTableResource({
  name: "computerTickets",
  tableName: "computer_tickets",
  ownership: "workspace",
  idProperty: "ticket",
  schema: {
    id: { type: "string", primary: true, maxLength: 64, noTrim: true, required: true, storage: { column: "ticket" } },
    conversationId: { type: "id", required: true, search: true },
    expiresAt: { type: "dateTime", required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** mercbot_servers
 * deployment-wide
 */
export const mercbotServerResource = defineTableResource({
  name: "mercbotServers",
  tableName: "mercbot_servers",
  ownership: "public",
  schema: {
    id: { type: "string", primary: true, maxLength: 200, noTrim: true, required: true },
    seenAt: { type: "dateTime" },
    url: { type: "string", maxLength: 500, noTrim: true, required: true }
  }
});

/** mercbot_settings
 * deployment-wide
 */
export const mercbotSettingResource = defineTableResource({
  name: "mercbotSettings",
  tableName: "mercbot_settings",
  ownership: "public",
  idProperty: "name",
  schema: {
    id: { type: "string", primary: true, maxLength: 60, noTrim: true, required: true, storage: { column: "name" } },
    value: { type: "string", noTrim: true, required: true }
  }
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  botComputerResource,
  botBrowserStateResource,
  computerTicketResource,
  mercbotServerResource,
  mercbotSettingResource
]);
