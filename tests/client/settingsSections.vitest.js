import { describe, expect, it } from "vitest";
import extensions from "../../src/components/mercbot/extensions.js";
import { EVERYONE_SECTIONS, SETTINGS_SECTIONS, listedSections } from "../../src/components/mercbot/settingsSections.js";

// Settings' section list: Mercbot's own sections, then the ones a copy built on Mercbot adds
// (extensions.js), each listed when it's for everyone or its `visible` check said yes, right after the section its
// `after` names; one with the value of a section of Mercbot's own takes that section's place. Mercbot adds none itself.
const OWN = ["general", "computer", "permissions", "files", "website", "memory", "vault", "usage", "link", "about"];

describe("Settings' sections", () => {
  it("are Mercbot's own, with no Home, and nothing added: a person's own copy has nobody to invite", () => {
    expect(extensions).toEqual({
      settingsSections: [],
      templateParts: [],
      accountMenu: [],
      generalActions: [],
      shellParts: [],
      helpPageTools: [],
      aboutUpdates: null,
      appParts: [],
      pageShareParts: [],
      botActions: [],
      messageCards: []
    });
    expect(listedSections(extensions.settingsSections, new Set()).map((entry) => entry.title)).toEqual([
      "General",
      "Computer",
      "Permissions",
      "Files",
      "Website",
      "Memory",
      "Vault",
      "Spending",
      "Mercbot account",
      "About"
    ]);
    expect(EVERYONE_SECTIONS).toEqual(SETTINGS_SECTIONS);
  });

  it("list an added section after Mercbot's own when it's for everyone, or once its check said yes", () => {
    const added = [
      { value: "checked", title: "Checked", visible: async () => true },
      { value: "everyone", title: "Everyone" },
      { value: "refused", title: "Refused", visible: async () => false }
    ];
    const listed = (shown) => listedSections(added, new Set(shown));
    expect(listed([]).slice(0, SETTINGS_SECTIONS.length)).toEqual(SETTINGS_SECTIONS);
    expect(listed([]).slice(SETTINGS_SECTIONS.length).map((entry) => entry.value)).toEqual(["everyone"]);
    expect(listed(["checked"]).slice(SETTINGS_SECTIONS.length).map((entry) => entry.value)).toEqual(["checked", "everyone"]);
  });

  it("put an added section right after the one its `after` names, or at the end when there is none such", () => {
    const added = [
      { value: "people", title: "People", after: "general" },
      { value: "elsewhere", title: "Elsewhere", after: "no-such-section" }
    ];
    expect(listedSections(added, new Set()).map((entry) => entry.value)).toEqual(["general", "people", ...OWN.slice(1), "elsewhere"]);
  });

  it("put an added section with the value of one of Mercbot's own in that section's place, once its check said yes", () => {
    const own = SETTINGS_SECTIONS.find((entry) => entry.value === "usage");
    const everyone = { value: "usage", title: "Spending", component: { name: "Replacement" } };
    const checked = { value: "vault", title: "Vault", component: { name: "Checked" }, visible: async () => true };
    const after = { value: "extra", title: "Extra" };
    const listed = (added, shown) => listedSections(added, new Set(shown));

    const replaced = listed([everyone, after], []);
    expect(replaced.map((entry) => entry.value)).toEqual([...OWN, "extra"]);
    expect(replaced[OWN.indexOf("usage")]).toBe(everyone);
    expect(replaced).not.toContain(own);
    // Hidden while its check hasn't said yes, or said no: Mercbot's own shows in its place.
    expect(listed([checked], [])).toEqual(SETTINGS_SECTIONS);
    expect(listed([checked], ["vault"])[OWN.indexOf("vault")]).toBe(checked);
  });
});
