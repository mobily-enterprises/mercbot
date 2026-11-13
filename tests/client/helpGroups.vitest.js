import { describe, expect, it } from "vitest";
import { helpGroups } from "../../src/components/help/helpGroups.js";

// The help centre's list: Mercbot's own groups (help/index.json), then the pages a copy built on Mercbot adds
// (help/extensions.json), into Mercbot's group of the same name or a group of their own after Mercbot's.
describe("the help centre's groups", () => {
  const own = () => ({
    groups: [
      { name: "Getting started", pages: [{ slug: "quick-start", title: "Quick start" }] },
      { name: "Settings", pages: [{ slug: "settings", title: "Settings" }] }
    ]
  });

  it("are Mercbot's own when a copy adds none", () => {
    expect(helpGroups(own(), { groups: [] })).toEqual(own().groups);
  });

  it("take a copy's pages into Mercbot's group of the same name, and its own groups after Mercbot's", () => {
    const mercbot = own();
    const added = {
      groups: [
        { name: "Legal", pages: [{ slug: "terms", title: "Terms" }] },
        { name: "Settings", pages: [{ slug: "settings-more", title: "More settings" }] }
      ]
    };
    expect(helpGroups(mercbot, added)).toEqual([
      { name: "Getting started", pages: [{ slug: "quick-start", title: "Quick start" }] },
      { name: "Settings", pages: [{ slug: "settings", title: "Settings" }, { slug: "settings-more", title: "More settings" }] },
      { name: "Legal", pages: [{ slug: "terms", title: "Terms" }] }
    ]);
    // Mercbot's own list is left as it was.
    expect(mercbot).toEqual(own());
  });

  it("refuse a page listed twice, which would move or rename it", () => {
    expect(() => helpGroups(own(), { groups: [{ name: "Legal", pages: [{ slug: "settings", title: "Not Mercbot's" }] }] }))
      .toThrow('help/extensions.json lists the help page "settings" a second time.');
    expect(() => helpGroups(own(), { groups: [{ name: "Legal", pages: [{ slug: "terms", title: "Terms" }, { slug: "terms", title: "Again" }] }] }))
      .toThrow('"terms" a second time');
  });
});
