import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { BotsError } from "./botsError.js";
import { cleanName, cleanTitle, toBot, toRoom } from "./botRows.js";

/**
 * A bot's settings and a shared bot's rooms (D-36): its name, label and sharing, the person's own pins, section and
 * reading state, rooms opened, made and renamed, and a bot deleted. Every method takes the call's options last.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 */
export function createBotSettings({ records, conversations, apps }) {
  const { conversations: store, messages } = records;
  const SHARING = new Set(["private", "shared", "mixed"]);

  async function updateBot(botId, patch = {}, options) {
    const { changed, sharingChanged } = await retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const row = await conversations.ownedBot(botId, txOptions, { lock: true, room: patch.roomId });
      const shared = {};
      const own = {};
      if (patch.name !== undefined) {
        shared.name = cleanName(patch.name);
        own.last_activity_at = new Date().toISOString();
      }
      if (patch.label !== undefined) shared.label = String(patch.label || "").trim().slice(0, 60) || null;
      // Replace the main bot: this bot becomes the home's main bot, the one that can't
      // be deleted; the route lets only owners and admins do it.
      if (patch.main === true && !row.is_main) {
        if (row.kind === "group") throw new BotsError(400, "A group chat can't be the main bot.", { code: "bots_main_bot_group" });
        await store.clearMainBot(txOptions);
        shared.is_main = true;
      }
      // Who sees what (D-36); the route lets only owners and admins change it.
      if (patch.sharing !== undefined) {
        if (!SHARING.has(patch.sharing)) throw new BotsError(400, "Choose private, shared or mixed.", { code: "bots_visibility_unknown" });
        if (row.kind === "group") throw new BotsError(400, "A group chat is always your own.", { code: "bots_group_visibility_fixed" });
        shared.sharing = patch.sharing;
      }
      // The tab the person has open in a shared bot, so it opens there next time.
      if (patch.roomId !== undefined && row.room) own.room_id = row.room.id;
      if (patch.pinned === true && row.pin_position === null) {
        own.pin_position = await store.nextPinPosition(txOptions);
        own.section_id = null;
      }
      if (patch.pinned === false) own.pin_position = null;
      if (patch.hidden !== undefined) own.hidden = Boolean(patch.hidden);
      if (patch.keepOutOfNotebook !== undefined) own.keep_out_of_notebook = Boolean(patch.keepOutOfNotebook);
      if (patch.unread !== undefined) own.unread = Boolean(patch.unread);
      // Reading the bot moves the "new" divider's starting point past everything so far;
      // in a shared bot, for this person in this room. The conversation is locked, so nothing is
      // written there between reading its latest message and recording it.
      if (patch.unread === false) {
        const latest = await messages.latestId(row.conversation_id, txOptions);
        if (!row.room) own.read_up_to = latest === null ? null : Number(latest);
        else if (latest !== null) await store.markRead(row.conversation_id, latest, txOptions);
      }
      if (patch.sectionId !== undefined) {
        own.section_id = patch.sectionId ? (await store.ownedSection(patch.sectionId, txOptions)).id : null;
        own.pin_position = null;
      }
      if (Object.keys(shared).length) await store.updateBot(row.id, shared, txOptions);
      if (Object.keys(own).length) await store.updateConversation(row.seat_id, own, txOptions);
      // Read again as this person sees it now, which gives a newly shared bot its first room.
      const changed = await conversations.seenBy(await store.botOf(row.id, txOptions), txOptions, { room: row.room?.id });
      return { changed, sharingChanged: Boolean(shared.sharing) && shared.sharing !== row.sharing };
    }));
    // Everyone in the home sees the bot change mode, on any server.
    if (sharingChanged) {
      await conversations.publish(await conversations.everyoneIn(options), { botId: String(changed.id), type: "changed" });
    }
    return toBot(changed);
  }

  /**
   * A shared Builder keeps one conversation per app (owner, 2026-10-30): Ask Builder in an app opens
   * that app's room, made fresh the first time (it doesn't continue another), named after the app.
   */
  async function roomForApp(botId, { appId, title } = {}, options) {
    const row = await conversations.ownedBot(botId, options);
    if (!row.room) {
      throw new BotsError(409, "Only a shared bot has a conversation for each app.", { code: "bots_app_conversations_shared_only" });
    }
    const app = await apps.apps.findApp(String(appId || ""), options, { kind: "app" });
    if (!app) throw new BotsError(404, "That app isn't in this home.", { code: "bots_app_not_in_home" });
    const room = await store.appRoomFor(row, app, cleanTitle(title || app.name), options);
    await store.updateConversation(row.seat_id, { room_id: room.id }, options);
    const opened = await conversations.refresh({ ...row, conversation_id: room.id }, options);
    await conversations.tell(opened, { type: "changed" }, options);
    return { bot: toBot(opened), room: toRoom(room) };
  }

  /**
   * A new tab in a shared bot (D-36): it continues from the open one, knowing everything said
   * there so far but nothing said there afterwards. Every tab has a name.
   */
  async function createRoom(botId, input = {}, options) {
    const title = cleanTitle(input.title);
    const row = await conversations.ownedBot(botId, options, { room: input.from });
    if (!row.room || row.kind === "group") {
      throw new BotsError(400, "Only a shared bot has conversations for everyone.", { code: "bots_everyone_conversations_shared_only" });
    }
    const latest = await messages.latestId(row.conversation_id, options);
    const room = await store.createRoom(row, { title, parentId: row.conversation_id, forkedAtMessageId: latest }, options);
    await store.updateConversation(row.seat_id, { room_id: room.id }, options);
    const opened = await conversations.refresh({ ...row, conversation_id: room.id }, options);
    await conversations.tell(opened, { type: "changed" }, options);
    return { bot: toBot(opened), room: toRoom(room) };
  }

  async function renameRoom(botId, roomId, input = {}, options) {
    const title = cleanTitle(input.title);
    const row = await conversations.ownedBot(botId, options, { room: roomId });
    if (String(row.room?.id) !== String(roomId)) {
      throw new BotsError(404, "That conversation isn't there.", { code: "bots_conversation_not_found" });
    }
    const room = await store.renameRoom(roomId, title, options);
    await conversations.tell(row, { type: "changed" }, options);
    return { room: toRoom(room) };
  }

  async function deleteBot(botId, options) {
    const row = await conversations.ownedBot(botId, options);
    if (row.is_main) throw new BotsError(409, "Your main bot can't be deleted.", { code: "bots_main_bot_delete" });
    if (row.kind === "group" && String(row.created_by) !== conversations.personOf(options)) {
      throw new BotsError(403, "Only the person who made this group can delete it. You can leave it instead.", {
        code: "bots_group_delete_forbidden"
      });
    }
    await store.deleteBot(row.id, options);
    return { deleted: String(row.id) };
  }

  return Object.freeze({
    updateBot,
    roomForApp,
    createRoom,
    renameRoom,
    deleteBot
  });
}
