// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** bot_computers
 * the computer of one bot in one chat (chat_bot_id, D-112): the chat's, used by whoever can open it
 */
export const botComputerResource = defineTableResource({
  name: "botComputers",
  tableName: "bot_computers",
  ownership: "workspace",
  idProperty: "chat_bot_id",
  schema: {
    id: { type: "id", primary: true, required: true, storage: { column: "chat_bot_id" } },
    // The person who took over the computer and since when (D16): the bot doesn't act on it until it's handed back.
    controlledAt: { type: "dateTime", nullable: true },
    controlledBy: { type: "id", nullable: true },
    error: { type: "string", noTrim: true },
    serverId: { type: "string", maxLength: 200, noTrim: true, required: true },
    state: { type: "string", maxLength: 20, noTrim: true, search: true },
    updatedAt: { type: "dateTime" },
    url: { type: "string", noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_browser_state
 * the saved browser of one bot's computer in one chat (chat_bot_id)
 */
export const botBrowserStateResource = defineTableResource({
  name: "botBrowserState",
  tableName: "bot_browser_state",
  ownership: "workspace",
  idProperty: "chat_bot_id",
  schema: {
    id: { type: "id", primary: true, required: true, storage: { column: "chat_bot_id" } },
    cookiesSavedAt: { type: "dateTime", nullable: true },
    cookiesSha256: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    profileBytes: { type: "integer", nullable: true },
    profileFile: { type: "string", maxLength: 80, noTrim: true, nullable: true },
    profileSavedAt: { type: "dateTime", nullable: true },
    profileSha256: { type: "string", maxLength: 64, noTrim: true, nullable: true },
    // What's signed in on its browser, as the computer panel shows it (D16): [{ label, kind, since }].
    signIns: { type: "array" },
    url: { type: "string", noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** computer_tickets
 * a screen ticket for one bot's computer in one chat (chat_bot_id)
 * a ticket redeemed without a home (desktop socket) is read in the computer's system scope
 */
export const computerTicketResource = defineTableResource({
  name: "computerTickets",
  tableName: "computer_tickets",
  ownership: "workspace",
  idProperty: "ticket",
  schema: {
    id: { type: "string", primary: true, maxLength: 64, noTrim: true, required: true, storage: { column: "ticket" } },
    chatBotId: { type: "id", required: true, search: true },
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
