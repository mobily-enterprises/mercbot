import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { DEFAULT_BOT_COLOR, DEFAULT_BOT_NAME } from "./onboarding.js";
import { BOT_PALETTE, BRAND_COLOR } from "./botPalette.js";
import { BotsError } from "./botsError.js";
import { mayChangeBot } from "./botAdditions.js";
import { cleanName, cloudShape, previewOf, toBot, toOwnTab, toRoom, toSection } from "./botRows.js";
import { GENERAL } from "./templates.js";

const BRAND_SHAPE = "mercbot";
/** A new bot's template columns: Mercbot's general template, from now. */
const generalTemplate = () => ({ library_template: GENERAL.slug, template_since: new Date().toISOString() });

/**
 * What a new bot starts with: the template columns pointing it at its template, and the greeting it opens with, "" for a
 * general one, which introduces itself when the person first opens it.
 * @typedef {{ columns: Record<string, unknown>, greeting: string }} NewBotStart
 */

/**
 * A new bot's name, cloud and colour as New bot gives them, checked: Mercbot's own cloud always in its orange, any other
 * in one of the palette's colours (400 otherwise).
 * @param {{ name?: unknown, shape?: unknown, color?: unknown }} input
 */
export function lookOf(input) {
  const name = cleanName(input.name);
  const shape = cloudShape(input.shape);
  const color = shape === BRAND_SHAPE ? BRAND_COLOR : String(input.color || "").toUpperCase();
  if (!BOT_PALETTE.includes(color)) throw new BotsError(400, "Pick one of the colours.", { code: "bots_colour_unknown" });
  return { name, shape, color };
}

/**
 * The person's list of bots: the home's bots and their own group chats as they see them, new bots, pins and sections.
 * Every method takes the call's options last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("./types.js").HomeDefaults} dependencies.homeDefaults the sharing the home's new bots get (D-100)
 * @param {{ startOn: (start: { choice: object, botName: string, firstName?: string }, options: object) => Promise<NewBotStart> }}
 *   dependencies.templates what a new bot made on a chosen template starts with (botTemplates.js)
 */
export function createBotList({ records, conversations, homeDefaults, templates }) {
  const { conversations: store, messages, newBots } = records;

  /**
   * The home's bots and the person's own group chats, each as this person sees it (the row policy
   * keeps a group chat to its people): a bot they haven't talked to yet shows as new, with its
   * introduction to come. With `botId`, just that bot, read the same way. The whole list comes with the home's default
   * for new bots and the question its owners and admins are asked once a second person joins (`home`, D-100). A fixed
   * number of reads, whatever the number of bots, rooms and groups.
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
    // Each row with its tabs: a Shared bot's rooms and, last, the person's own conversation as "You only" (D-99). An
    // archived tab or You only (D-101) is no tab: it's counted, for the strip's Archived (N), and isn't new or recent.
    const entries = bots.map((bot) => {
      const seat = seats.get(String(bot.id)) || {
        id: null,
        user_id: person,
        onboarding_step: bot.kind === "group" ? null : "intro-greet",
        unread: false,
        hidden: false,
        last_activity_at: bot.created_at
      };
      const rooms = roomsByBot.get(String(bot.id)) || [];
      const own = rooms.filter((room) => !room.archived_at);
      if (!own.length) return { row: conversations.asSeen(bot, seat), tabs: null };
      const group = bot.kind === "group";
      const seatTab = !group && seat.id !== null && !seat.archived_at;
      const youOnly = seatTab && String(seat.room_id) === String(seat.id);
      const row = youOnly
        ? conversations.asSeen(bot, seat)
        : conversations.asSeen(bot, seat, own.find((room) => String(room.id) === String(seat.room_id)) || own[0]);
      // Archive is offered on a shared tab but its first (General, where everyone lands) and an app's, to whoever started
      // it and the home's owners and admins, and on You only to its person (D-101).
      const archivable = (room) =>
        String(room.id) !== String(rooms[0].id) && !room.app_id && mayChangeBot(room.created_by, person, options);
      const tabs = own.map((room) => ({ ...toRoom(room), unread: room.unread, canArchive: archivable(room) }));
      if (seatTab) tabs.push({ ...toOwnTab(seat), canArchive: true });
      const all = seatTab ? [...own, seat] : own;
      const latest = all.reduce((last, entry) => (entry.last_activity_at > last ? entry.last_activity_at : last), all[0].last_activity_at);
      const archived = rooms.length - own.length + (!group && seat.archived_at ? 1 : 0);
      return { row: { ...row, unread: tabs.some((tab) => tab.unread), last_activity_at: latest }, tabs: group ? null : tabs, archived };
    });
    const rows = entries.map((entry) => entry.row);
    const sections = (await store.sectionsOf(options)).map(toSection);
    // Each row's latest previewable message, one row per conversation however long the chats are: a group's is its
    // latest message from anyone; a Shared bot's is the bot's newest reply in any of its shared tabs, whichever is
    // open, never one in You only (D-99); any other bot's is from the conversation the person has open.
    const conversationIds = entries.flatMap(({ row, tabs }) =>
      tabs ? tabs.filter((tab) => !tab.own).map((tab) => tab.id) : row.conversation_id ? [row.conversation_id] : []);
    const previews = await messages.latestPerConversation(conversationIds, options);
    const newestLast = previews.toSorted((a, b) => Number(a.id) - Number(b.id));
    const previewByBot = new Map(newestLast.map((row) => [String(row.bot_id), previewOf(row)]));
    const groupIds = rows.filter((row) => row.kind === "group").map((row) => row.id);
    const members = await conversations.membersOf(groupIds, options);
    const people = await conversations.peopleOf(groupIds, options);
    return {
      bots: entries.map(({ row, tabs, archived = 0 }) => ({
        ...toBot(row),
        ...(row.kind === "group" ? { members: members.get(String(row.id)) || [], people: people.get(String(row.id)) || [] } : {}),
        // A Shared bot nobody has opened since it became Shared has no tabs yet: its first look opens General.
        ...(row.kind !== "group" && !tabs ? { roomId: null } : {}),
        rooms: tabs,
        // How many of its conversations the person sees archived (D-101).
        ...(tabs ? { archived } : {}),
        preview: previewByBot.get(String(row.id)) || ""
      })),
      sections,
      ...(botId ? {} : { home: await homeDefaults.asSeen(options) })
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
      // The home's main bot points at Mercbot's general template (D-98).
      const first = { user_id: conversations.personOf(txOptions), name: DEFAULT_BOT_NAME, color: DEFAULT_BOT_COLOR, is_main: true };
      const bot = await store.createBot({ ...first, ...generalTemplate() }, txOptions);
      const row = conversations.asSeen(bot, await conversations.conversationOf(bot, txOptions, { onboarding_step: "start" }));
      await conversations.append(row, [{ kind: "timestamp", role: "system", body: { at: new Date().toISOString() } }], txOptions);
      return toBot(await conversations.refresh(row, txOptions));
    }));
  }

  /**
   * New bots, made together in the call's transaction: New bot's one, or a team's several (D-105), through the same
   * statements, each one for all of them, so six cost what one does. Each `{ name, shape, color, start }` (lookOf, and
   * NewBotStart) is unpinned, top of its group by activity, in the person's section `sectionId` when given, and shared
   * as the home's new bots are (D-100): a Shared one has its General tab at once, and opens on the person's own, where
   * its intro or greeting is. A template's bot opens with its template's greeting, written as it is made, and asks its
   * setup questions once the person answers; a general one introduces itself when the person first opens it. Neither
   * starts any AI work as it is made. Answers each as New bot does, in the order given.
   * @param {Array<{ name: string, shape: string, color: string, start: NewBotStart }>} entries
   * @param {string | null} sectionId
   * @param {import("./types.js").CallOptions} txOptions
   */
  async function makeBots(entries, sectionId, txOptions) {
    const person = conversations.personOf(txOptions);
    const sharing = await homeDefaults.sharingOf(txOptions);
    const now = new Date().toISOString();
    const made = await newBots.createBots(entries.map(({ name, shape, color, start }) =>
      ({ user_id: person, name, shape, color, sharing, ...start.columns })), txOptions);
    const greetingOf = (at) => entries[at].start.greeting;
    const seats = await newBots.createSeats(made.map((bot, at) => ({
      bot_id: bot.id,
      onboarding_step: greetingOf(at) ? null : "intro-greet",
      section_id: sectionId,
      unread: Boolean(greetingOf(at)),
      last_activity_at: now
    })), txOptions);
    await newBots.openWith(seats.flatMap((seat, at) => {
      const where = { bot_id: made[at].id, conversation_id: seat.id };
      const greeting = greetingOf(at) ? [{ ...where, kind: "text", role: "bot", body: { text: greetingOf(at) } }] : [];
      return [{ ...where, kind: "timestamp", role: "system", body: { at: now } }, ...greeting];
    }), txOptions);
    const tabs = await homeDefaults.firstTabsOf(made.map((bot, at) => ({ bot, seat: seats[at] })), txOptions);
    return made.map((bot, at) => ({ ...toBot(conversations.asSeen(bot, seats[at])), rooms: tabs[at], preview: greetingOf(at) }));
  }

  /**
   * New bot (makeBots): on the template chosen in New bot (`template`: `{ library: slug }`, `{ home: id }` or
   * `{ draft }`, a new one of the home's; D-98), or with none chosen on Mercbot's general one.
   */
  async function createBot(input = {}, options) {
    const look = lookOf(input);
    // A new template's tag lost to a race runs the whole transaction again.
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const start = input.template == null
        ? { columns: generalTemplate(), greeting: "" }
        : await templates.startOn({ choice: input.template, botName: look.name }, txOptions);
      const [made] = await makeBots([{ ...look, start }], null, txOptions);
      return made;
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
    makeBots,
    createBot,
    reorderPins,
    ownedSection: store.ownedSection,
    createSection,
    updateSection,
    moveSection,
    deleteSection
  });
}
