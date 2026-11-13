import { describe, expect, it } from "vitest";
import { buildRailModel, buildSidebarModel, railOrder, tileLayout } from "../../src/components/mercbot/botDirectory.js";

const bot = (id, extra = {}) => ({ id, name: `Bot ${id}`, pinPosition: null, sectionId: null, hidden: false, lastActivityAt: `2026-10-24T10:0${id}:00Z`, ...extra });

describe("sidebar model", () => {
  it("puts pinned bots in pin order and the rest newest activity first", () => {
    const model = buildSidebarModel({
      bots: [bot("1", { pinPosition: 1 }), bot("2", { pinPosition: 0 }), bot("3"), bot("4")],
      sections: []
    });
    expect(model.tiles.map((entry) => entry.id)).toEqual(["2", "1"]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].kind).toBe("flat");
    expect(model.groups[0].bots.map((entry) => entry.id)).toEqual(["4", "3"]);
    expect(model.visualOrder).toEqual(["2", "1", "4", "3"]);
  });

  it("groups by section, then Unassigned, and skips collapsed groups in the visual order", () => {
    const sections = [{ id: "s1", name: "Work", position: 0, collapsed: false }, { id: "s2", name: "Home", position: 1, collapsed: true }];
    const model = buildSidebarModel({
      bots: [bot("1", { sectionId: "s1" }), bot("2", { sectionId: "s2" }), bot("3")],
      sections
    });
    expect(model.groups.map((group) => group.kind)).toEqual(["section", "section", "unassigned"]);
    expect(model.groups[1].bots.map((entry) => entry.id)).toEqual(["2"]);
    expect(model.visualOrder).toEqual(["1", "3"]);
  });

  it("keeps hidden bots out of the list until Hidden bots is expanded", () => {
    const bots = [bot("1"), bot("2", { hidden: true })];
    expect(buildSidebarModel({ bots, sections: [] }).visualOrder).toEqual(["1"]);
    expect(buildSidebarModel({ bots, sections: [], hiddenExpanded: true }).visualOrder).toEqual(["1", "2"]);
  });

  it("splits the rail into pinned, then each non-empty group, and omits hidden bots", () => {
    const model = buildSidebarModel({
      bots: [bot("1", { pinPosition: 0 }), bot("2", { sectionId: "s1" }), bot("3"), bot("4", { hidden: true })],
      sections: [{ id: "s1", name: "Work", position: 0, collapsed: true }, { id: "s2", name: "Empty", position: 1, collapsed: false }]
    });
    expect(buildRailModel(model).map((group) => group.map((entry) => entry.id))).toEqual([["1"], ["2"], ["3"]]);
    expect(railOrder(model)).toEqual(["1", "2", "3"]);
  });

  it("lays out one or two tiles centred and more as a grid", () => {
    expect([tileLayout(1), tileLayout(2), tileLayout(3), tileLayout(7)]).toEqual(["single", "pair", "grid", "grid"]);
  });
});
