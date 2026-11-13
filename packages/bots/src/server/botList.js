import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { DEFAULT_BOT_COLOR, DEFAULT_BOT_NAME } from "./onboarding.js";
import { BOT_PALETTE, BRAND_COLOR } from "./botPalette.js";
import { BotsError } from "./botsError.js";
import { cleanName, cloudShape, previewOf, toBot, toRoom, toSection } from "./botRows.js";

const BRAND_SHAPE = "mercbot";

/**
 * The person's list of bots: the home's bots and their own group chats as they see them, new bots, pins and sections.
 * Every method takes the call's options last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 */
export function createBotList({ records, conversations }) {
  const { conversations: store, messages } = records;

  /**
   * The home's bots and the person's own group chats, each as this person sees it (the row policy
   * keeps a group chat to its people): a bot they haven't talked to yet shows as new, with its
   * introduction to come. With `botId`, just that bot, read the same way. A fixed number of reads,
   * whatever the number of bots, rooms and groups.
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @param {{ botId?: string }} [only]
   */
  async function listBots(options, { botId } = {}) {
    const person = conversations.personOf(options);
    const bots = await store.listBots(options, { botId });
    const seats = await store.seatsOf(options, { botId });
    // A shared bot's tabs, each unread while it has news from the bot or someone else (D-36).
    const rooms = await messages.roomsWithNews(bots.filter(conversations.isShared).map((bot) => bot.id), options);
    const roomsByBot = Map.groupBy(rooms, (room) => String(room.bot_id));
    const rows = bots.map((bot) => {
      const seat = seats.get(String(bot.id)) || {
        id: null,
        user_id: person,
        onboarding_step: bot.kind === "group" ? null : "intro-greet",
        unread: false,
        hidden: false,
        last_activity_at: bot.created_at
      };
      const own = roomsByBot.get(String(bot.id)) || [];
      if (!own.length) return conversations.asSeen(bot, seat);
      const row = conversations.asSeen(bot, seat, own.find((room) => String(room.id) === String(seat.room_id)) || own[0]);
      const latest = own.reduce((last, room) => (room.last_activity_at > last ? room.last_activity_at : last), own[0].last_activity_at);
      return { ...row, unread: own.some((room) => room.unread), last_activity_at: latest };
    });
    const sections = (await store.sectionsOf(options)).map(toSection);
    // Each conversation's latest previewable message, one row per conversation however long the
    // chats are; a group's preview is its latest message from anyone.
    const conversationIds = rows.filter((row) => row.conversation_id).map((row) => row.conversation_id);
    const previews = await messages.latestPerConversation(conversationIds, options);
    const previewByBot = new Map(previews.map((row) => [String(row.bot_id), previewOf(row)]));
    const groupIds = rows.filter((row) => row.kind === "group").map((row) => row.id);
    const members = await conversations.membersOf(groupIds, options);
    const people = await conversations.peopleOf(groupIds, options);
    return {
      bots: rows.map((row) => ({
        ...toBot(row),
        ...(row.kind === "group" ? { members: members.get(String(row.id)) || [], people: people.get(String(row.id)) || [] } : {}),
        rooms:
          row.room && row.kind !== "group"
            ? roomsByBot.get(String(row.id)).map((room) => ({ ...toRoom(room), unread: room.unread }))
            : null,
        preview: previewByBot.get(String(row.id)) || ""
      })),
      sections
    };
  }

  /** One bot as the list shows it (D-15): what an open page reads again when that bot has news. */
  async function listedBot(botId, options) {
    const [bot] = (await listBots(options, { botId })).bots;
    if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    return bot;
  }

  /** The first visit after sign-up creates the default bot and starts onboarding. */
  async function ensureFirstBot(options) {
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      await store.lockHome(txOptions);
      const existing = await store.firstBot(txOptions);
      if (existing) return toBot(await conversations.seenBy(existing, txOptions));
      const bot = await store.createBot(
        { user_id: conversations.personOf(txOptions), name: DEFAULT_BOT_NAME, color: DEFAULT_BOT_COLOR, is_main: true },
        txOptions
      );
      const row = conversations.asSeen(bot, await conversations.conversationOf(bot, txOptions, { onboarding_step: "start" }));
      await conversations.append(row, [{ kind: "timestamp", role: "system", body: { at: new Date().toISOString() } }], txOptions);
      return toBot(await conversations.refresh(row, txOptions));
    }));
  }

  /** New bot: unpinned, top of its group by activity, starting its own short intro. */
  async function createBot(input = {}, options) {
    const name = cleanName(input.name);
    const shape = cloudShape(input.shape);
    const color = shape === BRAND_SHAPE ? BRAND_COLOR : String(input.color || "").toUpperCase();
    if (!BOT_PALETTE.includes(color)) throw new BotsError(400, "Pick one of the colours.", { code: "bots_colour_unknown" });
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const bot = await store.createBot({ user_id: conversations.personOf(txOptions), name, shape, color }, txOptions);
      const row = conversations.asSeen(bot, await conversations.conversationOf(bot, txOptions, { onboarding_step: "intro-greet" }));
      await conversations.append(row, [{ kind: "timestamp", role: "system", body: { at: new Date().toISOString() } }], txOptions);
      return { ...toBot(row), preview: "" };
    }));
  }

  /** The person's pinned bots in a new order, as the list shows them after it. */
  async function reorderPins(botIds, options) {
    const order = Array.isArray(botIds) ? botIds.map(String) : [];
    return store.withTransaction(options, async (txOptions) => {
      if (!(await store.reorderPins(order, txOptions))) {
        throw new BotsError(409, "The pinned bots changed. Try again.", { code: "bots_pins_changed" });
      }
      return (await listBots(txOptions)).bots;
    });
  }

  /** A section made from a bot sits directly above it and holds it. */
  async function createSection({ name, botId }, options) {
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const sections = await store.lockSections(txOptions);
      const bot = botId ? await conversations.ownedBot(botId, txOptions).catch(() => null) : null;
      if (botId && !bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
      const current = bot?.section_id ? sections.find((section) => String(section.id) === String(bot.section_id)) : null;
      const section = await store.insertSection(cleanName(name), current ? current.position : sections.length, sections, txOptions);
      if (bot) await store.updateConversation(bot.seat_id, { section_id: section.id, pin_position: null }, txOptions);
      return listBots(txOptions);
    }));
  }

  async function updateSection(sectionId, patch = {}, options) {
    const section = await store.ownedSection(sectionId, options);
    const update = {};
    if (patch.name !== undefined) update.name = cleanName(patch.name);
    if (patch.collapsed !== undefined) update.collapsed = Boolean(patch.collapsed);
    return toSection(Object.keys(update).length ? await store.updateSection(section.id, update, options) : section);
  }

  async function moveSection(sectionId, direction, options) {
    return store.withTransaction(options, async (txOptions) => {
      const sections = await store.lockSections(txOptions);
      const index = sections.findIndex((section) => String(section.id) === String(sectionId));
      if (index < 0) throw new BotsError(404, "Section not found.", { code: "bots_section_not_found" });
      const other = sections[index + (direction === "up" ? -1 : 1)];
      if (other) await store.swapSections(sections[index], other, txOptions);
      return listBots(txOptions);
    });
  }

  async function deleteSection(sectionId, options) {
    const section = await store.ownedSection(sectionId, options);
    await store.deleteSection(section.id, options);
    return listBots(options);
  }

  return Object.freeze({
    listBots,
    listedBot,
    ensureFirstBot,
    createBot,
    reorderPins,
    ownedSection: store.ownedSection,
    createSection,
    updateSection,
    moveSection,
    deleteSection
  });
}
