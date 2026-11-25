import { describe, expect, it } from "vitest";
import { buildRailModel, buildSidebarModel, railOrder, shownEntries, tileLayout, toChatRow } from "../../src/components/mercbot/chatDirectory.js";

// The sidebar's arrangement (D-112, plan 4.1, D-135): the person's pinned chats, then Rooms (the home's everyone chat
// its first row, then rows by section, then the public rooms the person isn't in, faded), People and Bots (each from the
// person's direct chat with them), hidden and archived rooms apart, folding, "N more", the visual order, the rail, and
// the pinned chats' layout. Each chat is a ChatView as the server answers it, read into a row by toChatRow.

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

  it("makes the everyone chat the first row of Rooms, never a pinned tile, before every section", () => {
    const sections = [{ id: "s1", name: "Work", position: 0, collapsed: false }];
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [],
      chats: [chat("1", { place: { pinPosition: 0 } }), chat("2", { place: { pinPosition: 1 } }), chat("3", { place: { sectionId: "s1" } }), chat("4", { everyone: true })],
      sections
    });
    expect(ids(model.tiles)).toEqual(["1", "2"]);
    expect(ids(model.rooms.everyone)).toEqual(["4"]);
    expect(model.groups.map((group) => ids(group.chats)), "in no section").toEqual([["3"], []]);
    expect(model.visualOrder).toEqual(["1", "2", "4", "3"]);
  });

  it("leaves no pinned tiles when the everyone chat is the only pinned chat", () => {
    const model = buildSidebarModel({ publicRooms: [], people: [], bots: [], chats: [chat("1"), chat("2", { everyone: true })], sections: [] });
    expect([ids(model.tiles), ids(model.rooms.everyone), ids(model.groups[0].chats)]).toEqual([[], ["2"], ["1"]]);
    expect(model.visualOrder).toEqual(["2", "1"]);
  });

  it("keeps the everyone chat in a folded Rooms only while it needs the person, and a hidden one under Hidden chats", () => {
    const everyone = (place) => chat("2", { everyone: true, place });
    const folded = (place, openId = "") => buildSidebarModel({ publicRooms: [], people: [], bots: [], chats: [chat("1"), everyone(place)], sections: [], folded: { rooms: true }, openId });
    expect([ids(folded({}).rooms.everyone), folded({}).rooms.hiddenCount], "counted with the rooms folded away").toEqual([[], 2]);
    expect(ids(folded({ unread: true }).rooms.everyone)).toEqual(["2"]);
    expect(ids(folded({}, "2").rooms.everyone)).toEqual(["2"]);
    const hidden = buildSidebarModel({ publicRooms: [], people: [], bots: [], chats: [chat("1"), everyone({ hidden: true })], sections: [] });
    expect([ids(hidden.tiles), ids(hidden.rooms.everyone), ids(hidden.hidden)]).toEqual([[], [], ["2"]]);
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
    expect(buildRailModel(model).map(ids), "pinned, then every room, the everyone chat first and a collapsed section's too").toEqual([["1"], ["6", "2", "3"]]);
    expect(railOrder(model)).toEqual(["1", "6", "2", "3"]);
  });

  it("lays out one pinned chat across the block and more in two columns", () => {
    expect([tileLayout(1), tileLayout(2), tileLayout(3), tileLayout(7)]).toEqual(["single", "columns", "columns", "columns"]);
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
    expect(built.people.shown.map((entry) => [entry.person.name, entry.id])).toEqual([["Ada Byron", "3"], ["Bea Cole", "person:3"], ["Zoe Hart", "person:4"]]);
    expect(built.bots.shown.map((entry) => [entry.bot.name, entry.id])).toEqual([["Mercbot", "bot:b9"], ["Chef", "bot:b2"], ["Otto", "2"]]);
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
    expect(built.people.shown.map((entry) => [entry.person.name, entry.unread, entry.mentioned]))
      .toEqual([["Ada Byron", true, false], ["Bea Cole", false, false], ["Zoe Hart", false, false]]);
    expect(built.bots.shown.map((entry) => [entry.bot.name, entry.unread, entry.mentioned]))
      .toEqual([["Mercbot", false, false], ["Chef", false, true], ["Otto", false, false]]);
  });

  it("shows every person and bot while a section has seven or fewer, however old and untouched", () => {
    const seven = Array.from({ length: 6 }, (_, at) => bot(`o${at}`, `Old ${at}`, { createdAt: daysAgo(90) }));
    const built = model({ chats: [], bots: [MAIN, ...seven] });
    expect([built.bots.shown.length, built.bots.more], "exactly seven").toEqual([7, []]);
    expect([names(built.people.shown), built.people.more]).toEqual([["Ada Byron", "Bea Cole", "Zoe Hart"], []]);
  });

  it("shows a new home's one other person and its eight new bots, all of them", () => {
    const fresh = Array.from({ length: 8 }, (_, at) => bot(`n${at}`, `New ${at}`, { createdAt: daysAgo(0), isMain: at === 0 }));
    const built = buildSidebarModel({ publicRooms: [], chats: [], sections: [], people: [KIM, ADA], bots: fresh, me: "1", now: NOW });
    expect([names(built.people.shown), built.people.more]).toEqual([["Ada Byron"], []]);
    expect([built.bots.shown.length, built.bots.more], "added in the last 14 days, so never tucked away").toEqual([8, []]);
  });

  it("past seven, tucks away only the entries both added and last talked with more than 14 days ago", () => {
    const old = Array.from({ length: 20 }, (_, at) => bot(`o${String(at).padStart(2, "0")}`, `Old ${String(at).padStart(2, "0")}`, { createdAt: daysAgo(60) }));
    const added = bot("n1", "Newcomer", { createdAt: daysAgo(3) });
    const main = bot("m1", "Mercbot", { isMain: true, createdAt: daysAgo(60) });
    const chats = [
      withBot("5", "o01", { lastActivityAt: daysAgo(2) }),
      withBot("6", "o02", { lastActivityAt: daysAgo(30) }),
      withBot("7", "o03", { lastActivityAt: daysAgo(40) }),
      withBot("8", "o04", { lastActivityAt: daysAgo(40), place: { unread: true } })
    ];
    const built = model({ chats, bots: [main, added, ...old] });
    expect(names(built.bots.shown), "the main bot, one talked with lately, one that needs the person, one just added")
      .toEqual(["Mercbot", "Newcomer", "Old 01", "Old 04"]);
    expect(built.bots.more.length).toBe(18);
    expect(names(model({ chats, bots: [main, added, ...old], openId: "7" }).bots.shown), "and the open one")
      .toEqual(["Mercbot", "Newcomer", "Old 01", "Old 03", "Old 04"]);
    const opened = model({ chats, bots: [main, added, ...old], more: { bots: true } });
    expect([opened.bots.moreOpen, shownEntries(opened.bots).length]).toEqual([true, 22]);
  });

  it("judges a person past seven by their chat alone, as the members list carries no join date", () => {
    const many = Array.from({ length: 9 }, (_, at) => ({ id: String(10 + at), name: `Person ${10 + at}` }));
    const chats = [withPerson("3", many[0], { lastActivityAt: daysAgo(13) }), withPerson("4", many[1], { lastActivityAt: daysAgo(15) })];
    const built = model({ chats, people: [KIM, ...many] });
    expect([names(built.people.shown), built.people.more.length]).toEqual([["Person 10"], 8]);
  });

  it("lists the public rooms the person isn't in after their own, faded, under N more public rooms past three", () => {
    const rooms = ["21", "22", "23", "24"].map((id, at) => visiting(id, { lastActivityAt: daysAgo(at + 1) }));
    const archived = visiting("25", { archivedAt: "2026-11-21T10:00:00Z" });
    const three = model({ chats: [chat("1"), chat("21")], publicRooms: [...rooms.slice(0, 3), archived] });
    expect(ids(three.rooms.faded), "one they're in now, and an archived one, aren't faded").toEqual(["22", "23"]);
    expect(three.visualOrder).toEqual(["21", "1", "22", "23", "person:2", "person:3", "person:4", "bot:b9", "bot:b2", "bot:b1"]);
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
    expect(built.visualOrder).toEqual(["1", "2", "9", "3", "person:3", "person:4", "bot:b9", "4", "bot:b1", "5", "6"]);
    expect(railOrder(built)).toEqual(["1", "2", "9", "3", "person:3", "person:4", "bot:b9", "4", "bot:b1"]);
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
    expect(model({ chats: [chat("1", { everyone: true })] }).rooms.empty, "the everyone chat isn't a room of the person's").toBe(true);
    expect(model({ chats: [], publicRooms: [visiting("9")] }).rooms.empty).toBe(false);
    expect(model({ chats: [chat("2")] }).rooms.empty).toBe(false);
  });
});
