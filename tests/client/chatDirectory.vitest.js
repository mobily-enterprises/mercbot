import { describe, expect, it } from "vitest";
import { buildRailModel, buildSidebarModel, railOrder, tileLayout, toChatRow } from "../../src/components/mercbot/chatDirectory.js";

// The sidebar's arrangement of the person's chats (D-112, plan 4.1): pinned tiles with the home's everyone chat first,
// rows by section, hidden and archived chats apart, the rail, and the tiles' layout. Each chat is a ChatView as the
// server answers it, read into a row by toChatRow.

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
    const model = buildSidebarModel({
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
    const model = buildSidebarModel({
      chats: [chat("1", { place: { pinPosition: 0 } }), chat("2", { place: { pinPosition: 1 } }), chat("3"), chat("4", { everyone: true })],
      sections: []
    });
    expect(ids(model.tiles)).toEqual(["4", "1", "2"]);
    expect(model.visualOrder).toEqual(["4", "1", "2", "3"]);
  });

  it("groups by section, then Unassigned, and skips collapsed groups in the visual order", () => {
    const sections = [{ id: "s1", name: "Work", position: 0, collapsed: false }, { id: "s2", name: "Home", position: 1, collapsed: true }];
    const model = buildSidebarModel({
      chats: [chat("1", { place: { sectionId: "s1" } }), chat("2", { place: { sectionId: "s2" } }), chat("3"), chat("4", { place: { sectionId: "gone" } })],
      sections
    });
    expect(model.groups.map((group) => group.kind)).toEqual(["section", "section", "unassigned"]);
    expect(model.groups.map((group) => ids(group.chats))).toEqual([["1"], ["2"], ["4", "3"]]);
    expect(model.visualOrder).toEqual(["1", "4", "3"]);
  });

  it("keeps hidden chats out of the list until Hidden chats is expanded", () => {
    const chats = [chat("1"), chat("2", { place: { hidden: true } }), chat("3", { place: { hidden: true, pinPosition: 0 } })];
    const model = buildSidebarModel({ chats, sections: [] });
    expect([ids(model.tiles), ids(model.groups[0].chats), ids(model.hidden)]).toEqual([[], ["1"], ["3", "2"]]);
    expect(model.visualOrder).toEqual(["1"]);
    expect(buildSidebarModel({ chats, sections: [], hiddenExpanded: true }).visualOrder).toEqual(["1", "3", "2"]);
  });

  it("never lists a public chat the person only visits", () => {
    const chats = [chat("1"), chat("2", { place: null }), chat("3", { place: null, archivedAt: "2026-11-01T10:00:00Z" })];
    const model = buildSidebarModel({ chats, sections: [{ id: "s1", name: "Work", position: 0, collapsed: false }], hiddenExpanded: true, archivedExpanded: true });
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
    const model = buildSidebarModel({ chats, sections });
    expect(ids(model.archived)).toEqual(["3", "4", "2"]);
    expect([ids(model.tiles), model.groups.map((group) => ids(group.chats)), ids(model.hidden)]).toEqual([[], [[], ["1"]], []]);
    expect(model.visualOrder, "until Archived chats is expanded").toEqual(["1"]);
    expect(buildSidebarModel({ chats, sections, archivedExpanded: true }).visualOrder).toEqual(["1", "3", "4", "2"]);
  });

  it("splits the rail into pinned, then each non-empty group, and omits hidden and archived chats", () => {
    const model = buildSidebarModel({
      chats: [
        chat("1", { place: { pinPosition: 0 } }), chat("2", { place: { sectionId: "s1" } }), chat("3"), chat("4", { place: { hidden: true } }),
        chat("5", { archivedAt: "2026-11-01T10:00:00Z" }), chat("6", { everyone: true })
      ],
      sections: [{ id: "s1", name: "Work", position: 0, collapsed: true }, { id: "s2", name: "Empty", position: 1, collapsed: false }]
    });
    expect(buildRailModel(model).map(ids)).toEqual([["6", "1"], ["2"], ["3"]]);
    expect(railOrder(model)).toEqual(["6", "1", "2", "3"]);
  });

  it("lays out one or two tiles centred and more as a grid", () => {
    expect([tileLayout(1), tileLayout(2), tileLayout(3), tileLayout(7)]).toEqual(["single", "pair", "grid", "grid"]);
  });
});
