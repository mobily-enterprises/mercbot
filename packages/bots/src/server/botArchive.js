import { BotsError } from "./botsError.js";
import { mayChangeBot } from "./botAdditions.js";
import { isId } from "./botRows.js";
import { createWorkPause } from "./workPause.js";


/**
 * Archiving what is in the way, and bringing it back. A conversation (D-101): a Shared bot's shared tab, hidden for
 * everyone in the home, or the person's own "You only", hidden for them; while archived nobody sees it, writes there or
 * finds it, and resumed it's back in its place, as it was, and opens. A whole bot (D-108): put away for everyone in the
 * Archived bots section, its chats read-only and found by no search; unarchived, it's back in everyone's sidebar where
 * they had it. Either way its routines and watches pause, a line where they were naming them, they stay paused when it's
 * back, no work runs there (conversations.runsNoWork), and the same people may undo it as do it. Every method takes the
 * call's options last: the person is its context, never an id it's given.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("@local/computer/server/types").Computer} dependencies.computer an archived bot's computers sleep
 * @param {(botId: string, options: import("./types.js").CallOptions) => Promise<object>} dependencies.listedBot the bot as
 *   the list shows it (botList.js), which every change answers, so the page updates
 */
export function createBotArchive({ records, conversations, apps, computer, listedBot }) {
  const { conversations: store, archives, directory } = records;
  const pauseWorkIn = createWorkPause({ records, apps, conversations });
  const notThere = () => new BotsError(404, "That conversation isn't there.", { code: "bots_conversation_not_found" });

  /**
   * The bot and the conversation `roomId` names, when the person may archive it (or with `resuming`, resume it):
   * - one of a Shared bot's shared tabs, but not its first (General, where everyone lands) nor an app's Builder tab, for
   *   the person who started it and the home's owners and admins (403 for anyone else);
   * - the person's own "You only", for them alone. Another person's isn't seen at all (the row policies), so like
   *   another bot's or another home's conversation it isn't there (404).
   */
  async function target(botId, roomId, options, { resuming = false } = {}) {
    const bot = await store.botOf(botId, options);
    if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    if (bot.kind === "group" || bot.sharing !== "shared") {
      throw new BotsError(409, "Only a Shared bot's conversations can be archived.", { code: "bots_archive_shared_only" });
    }
    const conversation = isId(roomId) ? await store.conversationRow(String(roomId), options) : null;
    if (!conversation || String(conversation.bot_id) !== String(bot.id) || conversation.group_id) throw notThere();
    const person = conversations.personOf(options);
    if (conversation.user_id) {
      if (String(conversation.user_id) !== person) throw notThere();
      return { bot, conversation, own: true };
    }
    if (!resuming && conversation.app_id) {
      throw new BotsError(409, `“${conversation.title}” is an app's conversation with ${bot.name}, so it can't be archived.`, {
        code: "bots_archive_app_conversation"
      });
    }
    if (!resuming && String((await directory.roomOf(bot.id, null, options))?.id) === String(conversation.id)) {
      throw new BotsError(409, `“${conversation.title}” is where everyone lands, so it can't be archived.`, { code: "bots_archive_first" });
    }
    if (!mayChangeBot(conversation.created_by, person, options)) {
      const verb = resuming ? "resume" : "archive";
      throw new BotsError(403, `Only the person who started “${conversation.title}” and the home's owners and admins can ${verb} it.`, {
        code: "bots_archive_forbidden"
      });
    }
    return { bot, conversation, own: false };
  }

  /** Everyone in the home sees a shared tab come and go, on any server; the person alone their You only. */
  async function tellChanged({ bot, own }, options) {
    const people = own ? [conversations.personOf(options)] : await conversations.everyoneIn(options);
    await conversations.publish(people, { botId: String(bot.id), type: "changed" });
  }

  /**
   * Archives a conversation (D-101): hidden for everyone (a shared tab) or the person (You only), anyone who had it open
   * lands on General, and its routines and watches pause, a line there naming them. Archiving one already archived
   * changes nothing. Answers the bot as listed.
   */
  async function archiveRoom(botId, roomId, options) {
    const found = await store.withTransaction(options, async (txOptions) => {
      const archived = await target(botId, roomId, txOptions);
      if (archived.conversation.archived_at) return archived;
      await archives.markArchived(archived.conversation.id, true, txOptions);
      await pauseWorkIn(archived.bot, [String(archived.conversation.id)], {
        text: "Paused while archived",
        detail: (paused) => `This conversation was archived, so its ${paused} paused. They stay paused when it's resumed: resume them here.`
      }, txOptions);
      return archived;
    });
    await tellChanged(found, options);
    return { bot: await listedBot(String(found.bot.id), options) };
  }

  /**
   * Resumes an archived conversation (D-101), by the same rule as archiving it, so a member can't undo an admin's: it's
   * back in its place (tabs are in id order), with its messages, files, computer and read points as they were, and opens
   * for whoever resumed it. Its paused routines and watches wait for someone to resume them there. Answers the bot as
   * listed.
   */
  async function resumeRoom(botId, roomId, options) {
    const found = await store.withTransaction(options, async (txOptions) => {
      const resumed = await target(botId, roomId, txOptions, { resuming: true });
      if (resumed.conversation.archived_at) await archives.markArchived(resumed.conversation.id, false, txOptions);
      const seat = await conversations.conversationOf(resumed.bot, txOptions);
      await store.updateConversation(seat.id, { room_id: resumed.conversation.id }, txOptions);
      return resumed;
    });
    await tellChanged(found, options);
    return { bot: await listedBot(String(found.bot.id), options) };
  }

  /**
   * A Shared bot's archived conversations the person sees (D-101), oldest first: its archived shared tabs and their own
   * archived You only, never another person's. Each says who archived it ("you" for the person) and when, and whether
   * the person may resume it. A fixed number of reads, however many there are.
   */
  async function archivedConversations(botId, options) {
    const bot = await store.botOf(botId, options);
    if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    if (bot.kind === "group" || bot.sharing !== "shared") return { conversations: [] };
    const person = conversations.personOf(options);
    const rows = (await archives.archivedOf(bot.id, options)).filter((row) => !row.user_id || String(row.user_id) === person);
    const others = [...new Set(rows.map((row) => row.archived_by).filter((id) => id != null && String(id) !== person).map(String))];
    const names = others.length ? await store.namesOf(others, options) : new Map();
    const archivedBy = (id) => (id == null ? null : String(id) === person ? "you" : names.get(String(id)) || "Someone");
    return {
      conversations: rows.map((row) => ({
        id: String(row.id),
        title: row.user_id ? "You only" : row.title,
        own: Boolean(row.user_id),
        archivedAt: new Date(row.archived_at).toISOString(),
        archivedBy: archivedBy(row.archived_by),
        canResume: Boolean(row.user_id) || mayChangeBot(row.created_by, person, options)
      }))
    };
  }

  /**
   * The bot the person may archive, or with `unarchiving` unarchive (D-108): one of the home's, for whoever made it and
   * the home's owners and admins (403 for anyone else, decided before anything about the bot is said). A group chat
   * isn't archived (it's its people's, not the whole home's), nor the home's main bot or its Builder, which others
   * reach for: another must take their place first.
   */
  async function botTarget(botId, options, { unarchiving = false } = {}) {
    const bot = await store.botOf(botId, options);
    if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    if (!mayChangeBot(bot.user_id, conversations.personOf(options), options)) {
      const verb = unarchiving ? "unarchive" : "archive";
      throw new BotsError(403, `Only the person who made ${bot.name} and the home's owners and admins can ${verb} it.`, {
        code: "bots_archive_forbidden"
      });
    }
    if (unarchiving) return bot;
    if (bot.kind === "group") {
      throw new BotsError(409, "A group chat can't be archived. Leave it or delete it instead.", { code: "bots_archive_group" });
    }
    if (bot.is_main) {
      throw new BotsError(409, `${bot.name} is this home's main bot, so it can't be archived. Make another bot the main bot first.`, {
        code: "bots_archive_main"
      });
    }
    if (String((await apps.apps.builder(options))?.id) === String(bot.id)) {
      throw new BotsError(409, `${bot.name} builds this home's apps, so it can't be archived. Choose another Builder in Apps first.`, {
        code: "bots_archive_builder"
      });
    }
    return bot;
  }

  /**
   * Everyone in the home sees the bot go or come back, on any server, and the people of each group it's in see it there.
   * Archiving posts its "Paused while archived" lines, so it's `messages` news: a page reads the bot and catches up the
   * chat it has open; unarchiving posts nothing, so it's `changed`.
   */
  async function tellBotChanged(bot, options, type = "changed") {
    await conversations.publish(await conversations.everyoneIn(options), { botId: String(bot.id), type });
    for (const [groupId, people] of await archives.groupsWith(bot.id, options)) {
      await conversations.publish(people, { botId: groupId, type: "changed" });
    }
  }

  /**
   * Archives a bot for everyone in the home (D-108): it leaves every sidebar and pin for Archived bots, its routines and
   * watches in every conversation with it pause, a line there naming them, and its computers go to sleep, so it costs
   * nothing while it's put away. Its chats, files and each person's pins and section are kept. Archiving one already
   * archived changes nothing. Answers the bot as listed.
   */
  async function archiveBot(botId, options) {
    const { bot, conversationIds } = await store.withTransaction(options, async (txOptions) => {
      const found = await botTarget(botId, txOptions);
      if (!(await archives.markBotArchived(found.id, true, txOptions))) return { bot: found, conversationIds: [] };
      const ids = await archives.conversationIdsOf(found.id, txOptions);
      await pauseWorkIn(found, ids, {
        text: "Paused while archived",
        detail: (paused) => `${found.name} was archived, so its ${paused} paused. They stay paused when it's unarchived: resume them here.`
      }, archives.forEveryone(txOptions));
      return { bot: found, conversationIds: ids };
    });
    if (conversationIds.length) {
      await computer.sleepHome(String(bot.workspace_id), conversationIds)
        .catch((error) => console.warn("Putting an archived bot's computers to sleep failed; they sleep when idle.", error?.message));
    }
    await tellBotChanged(bot, options, "messages");
    return { bot: await listedBot(String(bot.id), options) };
  }

  /**
   * Unarchives a bot (D-108), by the same rule as archiving it: it's back in everyone's sidebar, in the section and pin
   * each person had it in, with its chats as they were. Its paused routines and watches wait for someone to resume
   * them, as the line where they paused says. Answers the bot as listed.
   */
  async function unarchiveBot(botId, options) {
    const bot = await store.withTransaction(options, async (txOptions) => {
      const found = await botTarget(botId, txOptions, { unarchiving: true });
      await archives.markBotArchived(found.id, false, txOptions);
      return found;
    });
    await tellBotChanged(bot, options);
    return { bot: await listedBot(String(bot.id), options) };
  }

  return Object.freeze({
    archiveRoom,
    resumeRoom,
    archivedConversations,
    archiveBot,
    unarchiveBot
  });
}
