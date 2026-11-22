// The sidebar's arrangement (D-112, plan 4.1): pinned tiles, then Rooms, People and Bots. Pure, so the layout rules are
// testable.
const byActivity = (a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "") || Number(b.id) - Number(a.id);
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

// People and Bots show every entry up to this many; past it, an entry goes under "N more" only when it was added (a
// person joined, a bot made) and last talked with more than RECENT_MS ago, so a new bot or person always shows.
const ALL_SHOWN = 7;
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
// Unjoined public rooms show at once when there are this many or fewer; more go under "N more public rooms".
const FADED_SHOWN = 3;

/**
 * A chat as the server answers it (ChatView), with the person's own place in it brought up to the row, and the
 * latest message's preview, as the sidebar reads them. A public room the person reads without being in it has no
 * place: it's `visiting`, listed faded. The home's everyone chat is pinned for everyone in it, with no pin position of
 * its own (O9): `pinned` says so for every pinned chat.
 * @param {object} view
 */
export function toChatRow(view) {
  const place = view.place || {};
  return {
    ...view,
    directPerson: view.directPerson ?? null,
    visiting: !view.place,
    pinPosition: place.pinPosition ?? null,
    pinned: Boolean(view.everyone) || (place.pinPosition ?? null) !== null,
    sectionId: place.sectionId ?? null,
    hidden: Boolean(place.hidden),
    unread: Boolean(place.unread),
    // Someone's message there mentions the person, unread since (D-114): the row's "@".
    mentioned: Boolean(place.mentioned),
    muted: Boolean(place.muted),
    readUpTo: place.readUpTo ?? null,
    preview: view.latest?.preview || ""
  };
}

/** A room: a chat that is neither a person's chat with a bot nor a chat between two people. */
export const isRoom = (chat) => !chat.directBotId && !chat.directPerson;

/**
 * People or Bots: each entry is { id, entry: "person" | "bot", person | bot, templateName, templateLine, addedAt, chat,
 * unread, mentioned }, where `chat` is the person's direct chat with them (null until made), `id` is that chat's id,
 * else "person:<id>" or "bot:<id>", which the shell opens, and `addedAt` when the bot was made (null for a person:
 * JSKIT's members list carries no join date, so a person is judged by their chat alone). Unfolded, up to ALL_SHOWN
 * entries are all `shown`; past that, those added or talked with in the last 14 days, the open one, the main bot and
 * any that need the person are `shown`, the rest `more`. Folded, only those that need the person or are open, the rest
 * counted.
 */
function splitEntries(entries, { folded, moreOpen, openId, now }) {
  const needs = (entry) => entry.unread || entry.mentioned || entry.id === openId;
  const lately = (at) => Boolean(at) && now - Date.parse(at) <= RECENT_MS;
  const recent = (entry) => lately(entry.addedAt) || lately(entry.chat?.lastActivityAt);
  if (folded) {
    const shown = entries.filter(needs);
    return { shown, more: [], moreOpen: false, hiddenCount: entries.length - shown.length, count: entries.length };
  }
  const shown = entries.length <= ALL_SHOWN ? entries : entries.filter((entry) => needs(entry) || recent(entry) || entry.bot?.isMain);
  const more = entries.filter((entry) => !shown.includes(entry));
  return { shown, more, moreOpen: Boolean(moreOpen) && more.length > 0, hiddenCount: 0, count: entries.length };
}

/**
 * A bot's template as its sidebar row shows it: its tag after the bot's name, and the line its description gives on
 * hover, "" for both while it has no template (D-98, the chip's source).
 * @param {{ template?: { tag: string, description: string } | null }} bot
 */
export function templateOfRow(bot) {
  const template = bot.template || null;
  if (!template) return { templateName: "", templateLine: "" };
  return { templateName: template.tag, templateLine: `Template ${template.tag}: ${template.description}` };
}

const entryOf = (kind, member, chat) => ({
  id: chat?.id || `${kind}:${member.id}`,
  entry: kind,
  [kind]: member,
  ...(kind === "bot" ? templateOfRow(member) : { templateName: "", templateLine: "" }),
  addedAt: kind === "bot" ? member.createdAt || null : null,
  chat: chat || null,
  unread: Boolean(chat?.unread),
  mentioned: Boolean(chat?.mentioned)
});

/**
 * The sidebar's layout. Pinned tiles (any chat, the everyone chat first). Rooms: the rooms the person is in, grouped
 * by their sections, then the public rooms they aren't in, faded. People: the home's other people. Bots: its active
 * bots, the main one first, with the archived ones apart. Then hidden rooms, archived rooms and the visual order, which
 * follows only what's shown. An archived room is in Archived chats alone, newest archived first, whatever its pin,
 * section or hidden state, which come back when it's unarchived.
 * @param {{
 *   chats: Array<import("../../types.js").Chat>,
 *   sections: Array<import("../../types.js").ChatSection>,
 *   publicRooms?: Array<import("../../types.js").Chat>,
 *   people?: Array<{ id: string, name: string }>,
 *   bots?: Array<{ id: string, name: string, isMain?: boolean, createdAt?: string, archivedAt?: string | null }>,
 *   me?: string,
 *   openId?: string,
 *   folded?: { rooms?: boolean, people?: boolean, bots?: boolean },
 *   more?: { rooms?: boolean, people?: boolean, bots?: boolean, archivedBots?: boolean },
 *   hiddenExpanded?: boolean,
 *   archivedExpanded?: boolean,
 *   now?: number
 * }} options `publicRooms` the public rooms the person isn't in (chatsApi.publicRooms); `openId` the chat shown;
 *   `folded` each section folded (per device and home); `more` each "N more" opened (for the visit)
 */
export function buildSidebarModel({
  chats: listed, sections, publicRooms, people, bots, me = "", openId = "", folded = {}, more = {},
  hiddenExpanded = false, archivedExpanded = false, now = Date.now()
}) {
  const all = listed.filter((chat) => !chat.visiting);
  const live = all.filter((chat) => !chat.archivedAt);
  const tiles = live.filter((chat) => chat.pinned && !chat.hidden)
    .sort((a, b) => Number(Boolean(b.everyone)) - Number(Boolean(a.everyone)) || a.pinPosition - b.pinPosition);

  // Rooms: the person's own, by section, then the faded ones.
  const rooms = live.filter(isRoom);
  const needs = (chat) => chat.unread || chat.mentioned || chat.id === openId;
  const unpinned = rooms.filter((chat) => !chat.hidden && !chat.pinned).sort(byActivity);
  const roomsShown = folded.rooms ? unpinned.filter(needs) : unpinned;
  const sectionIds = new Set(sections.map((section) => section.id));
  const groups = (sections.length
    ? [
      ...sections.map((section) => ({
        key: `section-${section.id}`,
        kind: "section",
        section,
        chats: roomsShown.filter((chat) => chat.sectionId === section.id)
      })),
      { key: "unassigned", kind: "unassigned", chats: roomsShown.filter((chat) => !sectionIds.has(chat.sectionId)) }
    ]
    : [{ key: "flat", kind: "flat", chats: roomsShown }])
    .filter((group) => !folded.rooms || group.chats.length);
  const mine = new Set(all.map((chat) => chat.id));
  const unjoined = publicRooms.filter((chat) => !mine.has(chat.id) && !chat.archivedAt && isRoom(chat)).sort(byActivity);
  const fadedOpen = unjoined.length <= FADED_SHOWN || Boolean(more.rooms);
  const faded = folded.rooms ? unjoined.filter((chat) => chat.id === openId) : fadedOpen ? unjoined : [];
  const roomCount = unpinned.length + unjoined.length;
  const roomsHidden = roomCount - groups.reduce((count, group) => count + group.chats.length, 0) - faded.length;

  // People and Bots, each with the person's direct chat with them from the list already loaded.
  const withPerson = new Map(all.filter((chat) => chat.directPerson).map((chat) => [String(chat.directPerson.userId), chat]));
  const withBot = new Map(all.filter((chat) => chat.directBotId).map((chat) => [String(chat.directBotId), chat]));
  const split = (kind) => ({ folded: Boolean(folded[kind]), moreOpen: more[kind], openId, now });
  const personEntries = people.filter((person) => String(person.id) !== String(me)).sort(byName)
    .map((person) => entryOf("person", person, withPerson.get(String(person.id))));
  const botEntries = bots.filter((bot) => !bot.archivedAt)
    .sort((a, b) => Number(Boolean(b.isMain)) - Number(Boolean(a.isMain)) || byName(a, b))
    .map((bot) => entryOf("bot", bot, withBot.get(String(bot.id))));

  const hidden = live.filter((chat) => chat.hidden && isRoom(chat)).sort(byActivity);
  const archived = all.filter((chat) => chat.archivedAt && isRoom(chat))
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt) || Number(b.id) - Number(a.id));
  const model = {
    tiles,
    groups,
    rooms: { faded, fadedMore: folded.rooms || fadedOpen ? 0 : unjoined.length, fadedCount: unjoined.length, hiddenCount: roomsHidden, empty: !roomCount },
    people: splitEntries(personEntries, split("people")),
    bots: {
      ...splitEntries(botEntries, split("bots")),
      archived: bots.filter((bot) => bot.archivedAt).sort(byName),
      archivedOpen: Boolean(more.archivedBots)
    },
    hidden,
    archived
  };
  const order = [
    ...tiles,
    ...groups.flatMap((group) => (group.section?.collapsed ? [] : group.chats)),
    ...faded,
    ...shownEntries(model.people),
    ...shownEntries(model.bots),
    ...(hiddenExpanded ? hidden : []),
    ...(archivedExpanded ? archived : [])
  ].map((item) => item.id);
  return { ...model, visualOrder: [...new Set(order)] };
}

/** People's or Bots' entries as the list shows them: those shown, then the "N more" ones while that's open. */
export function shownEntries(section) {
  return [...section.shown, ...(section.moreOpen ? section.more : [])];
}

// The compact rail: pinned chats, then the rooms (a collapsed section's too: the rail has no headers), people and bots
// as shown, with a divider between non-empty groups.
export function buildRailModel(model) {
  return [
    model.tiles,
    [...model.groups.flatMap((group) => group.chats), ...model.rooms.faded],
    shownEntries(model.people),
    shownEntries(model.bots)
  ].filter((items) => items.length);
}

export function railOrder(model) {
  return [...new Set(buildRailModel(model).flat().map((item) => item.id))];
}

// Tile grid geometry: one or two tiles centred, otherwise three columns.
export function tileLayout(count) {
  if (count === 1) return "single";
  if (count === 2) return "pair";
  return "grid";
}
