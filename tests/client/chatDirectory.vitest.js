import { describe, expect, it } from "vitest";
import { buildRailModel, buildSidebarModel, railOrder, shownEntries, tileLayout, toChatRow } from "../../src/components/mercbot/chatDirectory.js";

// The sidebar's arrangement (D-112, plan 4.1): pinned tiles with the home's everyone chat first, then Rooms (rows by
// section, then the public rooms the person isn't in, faded), People and Bots (each from the person's direct chat with
// them), hidden and archived rooms apart, folding, "N more", the visual order, the rail, and the tiles' layout. Each
// chat is a ChatView as the server answers it, read into a row by toChatRow.

/** A chat the person is in, as the server answers it; `place` is their own place in it, null for one they only visit. */
function view(id, { place = {}, ...extra } = {}) {
  return {
    id,
    kind: "public",
    title: `Chat ${id}`,
    everyone: false,
    directBotId: null,
    appId: null,
    madeBy: "1",
    onboardingStep: null,
    archivedAt: null,
    lastActivityAt: `2026-10-24T10:0${id}:00Z`,
    people: [{ userId: "1", name: "Kim Lee" }],
    bots: [],
    place: place === null ? null : { readUpTo: null, unread: false, pinPosition: null, sectionId: null, hidden: false, muted: false, ...place },
    latest: null,
    ...extra
  };
}
const chat = (id, options) => toChatRow(view(id, options));
const ids = (chats) => chats.map((entry) => entry.id);

describe("a chat's row", () => {
  it("brings the person's place in the chat up to the row, with the latest message's preview", () => {
    const row = chat("1", { place: { readUpTo: "40", unread: true, pinPosition: 2, sectionId: "s1", hidden: true, muted: true }, latest: { id: "41", preview: "See you at seven" } });
    expect([row.visiting, row.pinned, row.pinPosition, row.sectionId, row.hidden, row.unread, row.muted, row.readUpTo, row.preview])
      .toEqual([false, true, 2, "s1", true, true, true, "40", "See you at seven"]);
    expect([row.title, row.kind], "the chat's own fields stay").toEqual(["Chat 1", "public"]);
  });

  it("marks a public chat the person only visits, with no place of their own, and pins the everyone chat for everyone", () => {
    const visited = chat("1", { place: null });
    expect([visited.visiting, visited.pinned, visited.pinPosition, visited.sectionId, visited.hidden, visited.unread, visited.preview])
      .toEqual([true, false, null, null, false, false, ""]);
    const everyone = chat("2", { everyone: true });
    expect([everyone.pinned, everyone.pinPosition], "pinned, with no pin position of its own").toEqual([true, null]);
  });
});

describe("sidebar model", () => {
  it("puts pinned chats in pin order and the rest newest activity first", () => {
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [], 
      chats: [chat("1", { place: { pinPosition: 1 } }), chat("2", { place: { pinPosition: 0 } }), chat("3"), chat("4")],
      sections: []
    });
    expect(ids(model.tiles)).toEqual(["2", "1"]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].kind).toBe("flat");
    expect(ids(model.groups[0].chats)).toEqual(["4", "3"]);
    expect(model.visualOrder).toEqual(["2", "1", "4", "3"]);
  });

  it("makes the everyone chat the first tile, before every pinned chat", () => {
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [], 
      chats: [chat("1", { place: { pinPosition: 0 } }), chat("2", { place: { pinPosition: 1 } }), chat("3"), chat("4", { everyone: true })],
      sections: []
    });
    expect(ids(model.tiles)).toEqual(["4", "1", "2"]);
    expect(model.visualOrder).toEqual(["4", "1", "2", "3"]);
  });

  it("groups by section, then Unassigned, and skips collapsed groups in the visual order", () => {
    const sections = [{ id: "s1", name: "Work", position: 0, collapsed: false }, { id: "s2", name: "Home", position: 1, collapsed: true }];
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [], 
      chats: [chat("1", { place: { sectionId: "s1" } }), chat("2", { place: { sectionId: "s2" } }), chat("3"), chat("4", { place: { sectionId: "gone" } })],
      sections
    });
    expect(model.groups.map((group) => group.kind)).toEqual(["section", "section", "unassigned"]);
    expect(model.groups.map((group) => ids(group.chats))).toEqual([["1"], ["2"], ["4", "3"]]);
    expect(model.visualOrder).toEqual(["1", "4", "3"]);
  });

  it("keeps hidden chats out of the list until Hidden chats is expanded", () => {
    const chats = [chat("1"), chat("2", { place: { hidden: true } }), chat("3", { place: { hidden: true, pinPosition: 0 } })];
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [],  chats, sections: [] });
    expect([ids(model.tiles), ids(model.groups[0].chats), ids(model.hidden)]).toEqual([[], ["1"], ["3", "2"]]);
    expect(model.visualOrder).toEqual(["1"]);
    expect(buildSidebarModel({ publicRooms: [], people: [], bots: [],  chats, sections: [], hiddenExpanded: true }).visualOrder).toEqual(["1", "3", "2"]);
  });

  it("never lists a public chat the person only visits", () => {
    const chats = [chat("1"), chat("2", { place: null }), chat("3", { place: null, archivedAt: "2026-11-01T10:00:00Z" })];
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [],  chats, sections: [{ id: "s1", name: "Work", position: 0, collapsed: false }], hiddenExpanded: true, archivedExpanded: true });
    expect([ids(model.tiles), model.groups.map((group) => ids(group.chats)), ids(model.hidden), ids(model.archived)]).toEqual([[], [[], ["1"]], [], []]);
    expect(model.visualOrder).toEqual(["1"]);
  });

  it("keeps archived chats in Archived chats alone, newest archived first, whatever their pin, section or hidden state", () => {
    const sections = [{ id: "s1", name: "Work", position: 0, collapsed: false }];
    const chats = [
      chat("1"),
      chat("2", { archivedAt: "2026-11-01T10:00:00Z", place: { pinPosition: 0 } }),
      chat("3", { archivedAt: "2026-11-03T10:00:00Z", place: { sectionId: "s1" } }),
      chat("4", { archivedAt: "2026-11-02T10:00:00Z", place: { hidden: true } })
    ];
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [],  chats, sections });
    expect(ids(model.archived)).toEqual(["3", "4", "2"]);
    expect([ids(model.tiles), model.groups.map((group) => ids(group.chats)), ids(model.hidden)]).toEqual([[], [[], ["1"]], []]);
    expect(model.visualOrder, "until Archived chats is expanded").toEqual(["1"]);
    expect(buildSidebarModel({ publicRooms: [], people: [], bots: [],  chats, sections, archivedExpanded: true }).visualOrder).toEqual(["1", "3", "4", "2"]);
  });

  it("splits the rail into pinned, then rooms, people and bots, and omits hidden and archived chats", () => {
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [], 
      chats: [
        chat("1", { place: { pinPosition: 0 } }), chat("2", { place: { sectionId: "s1" } }), chat("3"), chat("4", { place: { hidden: true } }),
        chat("5", { archivedAt: "2026-11-01T10:00:00Z" }), chat("6", { everyone: true })
      ],
      sections: [{ id: "s1", name: "Work", position: 0, collapsed: true }, { id: "s2", name: "Empty", position: 1, collapsed: false }]
    });
    expect(buildRailModel(model).map(ids), "pinned, then every room, a collapsed section's too").toEqual([["6", "1"], ["2", "3"]]);
    expect(railOrder(model)).toEqual(["6", "1", "2", "3"]);
  });

  it("lays out one or two tiles centred and more as a grid", () => {
    expect([tileLayout(1), tileLayout(2), tileLayout(3), tileLayout(7)]).toEqual(["single", "pair", "grid", "grid"]);
  });
});

describe("Rooms, People and Bots", () => {
  const NOW = Date.parse("2026-11-22T12:00:00Z");
  const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
  const KIM = { id: "1", name: "Kim Lee" };
  const ADA = { id: "2", name: "Ada Byron" };
  const BEA = { id: "3", name: "Bea Cole" };
  const ZOE = { id: "4", name: "Zoe Hart" };
  const bot = (id, name, extra = {}) => ({ id, name, isMain: false, archivedAt: null, ...extra });
  const MAIN = bot("b9", "Mercbot", { isMain: true });
  const OTTO = bot("b1", "Otto");
  const CHEF = bot("b2", "Chef");
  const PULSE = bot("b3", "Pulse", { archivedAt: "2026-11-20T10:00:00Z" });
  const withBot = (id, botId, extra = {}) => chat(id, { kind: "private", title: null, directBotId: botId, ...extra });
  const withPerson = (id, person, extra = {}) => chat(id, { kind: "private", title: null, directPerson: { userId: person.id, name: person.name }, ...extra });
  const visiting = (id, extra = {}) => chat(id, { place: null, ...extra });
  const model = (options) => buildSidebarModel({ publicRooms: [], sections: [], people: [KIM, ADA, BEA, ZOE], bots: [OTTO, CHEF, MAIN, PULSE], me: "1", now: NOW, ...options });
  const names = (entries) => entries.map((entry) => entry.person?.name || entry.bot?.name);

  it("lists only rooms under Rooms: a chat with a bot is under Bots, a chat with a person under People", () => {
    const built = model({ chats: [chat("1"), withBot("2", "b1", { lastActivityAt: daysAgo(1) }), withPerson("3", ADA, { lastActivityAt: daysAgo(2) })] });
    expect(built.groups.map((group) => ids(group.chats))).toEqual([["1"]]);
    expect(built.people.shown.map((entry) => [entry.person.name, entry.id])).toEqual([["Ada Byron", "3"]]);
    expect(built.bots.shown.map((entry) => [entry.bot.name, entry.id])).toEqual([["Mercbot", "bot:b9"], ["Otto", "2"]]);
  });

  it("lists the home's other people by name, and its active bots with the main one first, then by name, the archived apart", () => {
    const built = model({ chats: [], more: { people: true, bots: true } });
    expect(names(shownEntries(built.people)), "never the person looking").toEqual(["Ada Byron", "Bea Cole", "Zoe Hart"]);
    expect(names(shownEntries(built.bots))).toEqual(["Mercbot", "Chef", "Otto"]);
    expect(built.bots.archived.map((entry) => entry.name)).toEqual(["Pulse"]);
    expect(built.bots.archivedOpen).toBe(false);
    expect(model({ chats: [], more: { archivedBots: true } }).bots.archivedOpen).toBe(true);
  });

  it("has no one in People when the person is the home's only one", () => {
    const alone = buildSidebarModel({ publicRooms: [], chats: [], sections: [], people: [KIM], bots: [], me: "1", now: NOW });
    expect([alone.people.count, alone.people.shown, alone.people.more]).toEqual([0, [], []]);
  });

  it("marks a person or a bot unread or mentioned from the direct chat with them, found in the list already read", () => {
    const built = model({ chats: [withPerson("3", ADA, { place: { unread: true } }), withBot("4", "b2", { place: { mentioned: true } })] });
    expect(built.people.shown.map((entry) => [entry.person.name, entry.unread, entry.mentioned])).toEqual([["Ada Byron", true, false]]);
    expect(built.bots.shown.map((entry) => [entry.bot.name, entry.unread, entry.mentioned])).toEqual([["Mercbot", false, false], ["Chef", false, true]]);
  });

  it("shows the people and bots talked with in the last 14 days, the open one and the main bot, and the rest under N more", () => {
    const chats = [
      withPerson("3", ADA, { lastActivityAt: daysAgo(13) }),
      withPerson("4", BEA, { lastActivityAt: daysAgo(15) }),
      withBot("5", "b1", { lastActivityAt: daysAgo(30) }),
      withBot("6", "b2", { lastActivityAt: daysAgo(2) })
    ];
    const built = model({ chats });
    expect([names(built.people.shown), names(built.people.more)]).toEqual([["Ada Byron"], ["Bea Cole", "Zoe Hart"]]);
    expect([names(built.bots.shown), names(built.bots.more)]).toEqual([["Mercbot", "Chef"], ["Otto"]]);
    expect(names(model({ chats, openId: "5" }).bots.shown), "the open one").toEqual(["Mercbot", "Chef", "Otto"]);
    const opened = model({ chats, more: { people: true } });
    expect([opened.people.moreOpen, names(shownEntries(opened.people))]).toEqual([true, ["Ada Byron", "Bea Cole", "Zoe Hart"]]);
  });

  it("lists the public rooms the person isn't in after their own, faded, under N more public rooms past three", () => {
    const rooms = ["21", "22", "23", "24"].map((id, at) => visiting(id, { lastActivityAt: daysAgo(at + 1) }));
    const archived = visiting("25", { archivedAt: "2026-11-21T10:00:00Z" });
    const three = model({ chats: [chat("1"), chat("21")], publicRooms: [...rooms.slice(0, 3), archived] });
    expect(ids(three.rooms.faded), "one they're in now, and an archived one, aren't faded").toEqual(["22", "23"]);
    expect(three.visualOrder).toEqual(["21", "1", "22", "23", "bot:b9"]);
    const four = model({ chats: [chat("1")], publicRooms: rooms });
    expect([ids(four.rooms.faded), four.rooms.fadedMore, four.rooms.fadedCount]).toEqual([[], 4, 4]);
    expect(ids(model({ chats: [chat("1")], publicRooms: rooms, more: { rooms: true } }).rooms.faded)).toEqual(["21", "22", "23", "24"]);
  });

  it("orders what's shown: tiles, rooms, faded rooms, people, bots, then hidden and archived rooms when open", () => {
    const chats = [
      chat("1", { place: { pinPosition: 0 } }),
      chat("2"),
      withPerson("3", ADA, { lastActivityAt: daysAgo(1) }),
      withBot("4", "b2", { lastActivityAt: daysAgo(1) }),
      chat("5", { place: { hidden: true } }),
      chat("6", { archivedAt: "2026-11-01T10:00:00Z" })
    ];
    const built = model({ chats, publicRooms: [visiting("9")], hiddenExpanded: true, archivedExpanded: true });
    expect(built.visualOrder).toEqual(["1", "2", "9", "3", "bot:b9", "4", "5", "6"]);
    expect(railOrder(built)).toEqual(["1", "2", "9", "3", "bot:b9", "4"]);
  });

  it("folds a section to the rows that need the person or are open, counting the rest", () => {
    const chats = [
      chat("1"), chat("2", { place: { unread: true } }), chat("3", { place: { mentioned: true } }), chat("4"),
      withPerson("5", ADA, { lastActivityAt: daysAgo(1), place: { unread: true } }), withPerson("6", BEA, { lastActivityAt: daysAgo(1) }),
      withBot("7", "b2", { lastActivityAt: daysAgo(1) })
    ];
    const built = model({ chats, publicRooms: [visiting("9"), visiting("10")], openId: "4", folded: { rooms: true, people: true, bots: true } });
    expect(built.groups.map((group) => ids(group.chats))).toEqual([["4", "3", "2"]]);
    expect([ids(built.rooms.faded), built.rooms.fadedMore, built.rooms.hiddenCount]).toEqual([[], 0, 3]);
    expect([names(built.people.shown), built.people.hiddenCount, built.people.more]).toEqual([["Ada Byron"], 2, []]);
    expect([names(built.bots.shown), built.bots.hiddenCount]).toEqual([[], 3]);
    expect(built.visualOrder).toEqual(["4", "3", "2", "5"]);
    expect(ids(model({ chats, publicRooms: [visiting("9")], openId: "9", folded: { rooms: true } }).rooms.faded), "the open faded room").toEqual(["9"]);
  });

  it("says Rooms is empty only with no room of the person's and none to join", () => {
    expect(model({ chats: [chat("1", { everyone: true })] }).rooms.empty, "the everyone chat is a tile").toBe(true);
    expect(model({ chats: [], publicRooms: [visiting("9")] }).rooms.empty).toBe(false);
    expect(model({ chats: [chat("2")] }).rooms.empty).toBe(false);
  });
});
