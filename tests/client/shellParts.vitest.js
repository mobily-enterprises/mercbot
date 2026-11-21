import { describe, expect, it } from "vitest";
import { botMenuItems, sectionMenuItems } from "../../src/components/mercbot/botMenus.js";
import { composerPlaceholder } from "../../src/components/mercbot/composerPlaceholder.js";
import { paletteCommands, paletteEntries } from "../../src/components/mercbot/paletteEntries.js";
import { galleryChips, galleryView } from "../../src/components/templates/galleryView.js";

const titles = (items) => items.map((item) => (item.divider ? "—" : item.title));

describe("composer placeholder (D-36)", () => {
  const bot = { name: "Otto", roomId: null };
  const choice = (body) => ({ kind: "choice", body });

  it("names the bots chosen in the group picker", () => {
    expect(composerPlaceholder({ pickerNames: [], messages: [], bot, homeName: "Home" })).toBe("Write a message");
    expect(composerPlaceholder({ pickerNames: ["Ada", "Bo"], messages: [], bot, homeName: "Home" })).toBe("Message Ada and Bo");
    expect(composerPlaceholder({ pickerNames: ["Ada", "Bo", "Cy"], messages: [], bot, homeName: "Home" })).toBe("Message Ada, Bo, and Cy");
  });

  it("invites an answer while the latest question card is open", () => {
    expect(composerPlaceholder({ pickerNames: null, messages: [], bot, homeName: "Home" })).toBe("");
    expect(composerPlaceholder({ pickerNames: null, messages: [choice({ purpose: "bot-name" })], bot, homeName: "Home" }))
      .toBe("Pick a name above, or say whatever's on your mind");
    expect(composerPlaceholder({ pickerNames: null, messages: [choice({}), choice({ chosen: ["a"] })], bot, homeName: "Home" })).toBe("");
    expect(composerPlaceholder({ pickerNames: null, messages: [choice({ chosen: ["a"] }), choice({})], bot, homeName: "Home" }))
      .toBe("Pick from the card, or tell me in your own words");
  });

  it("says a shared room is seen by the whole home unless a card is open", () => {
    const shared = { name: "Otto", roomId: "r1" };
    expect(composerPlaceholder({ pickerNames: null, messages: [], bot: shared, homeName: "Casa" })).toBe("Message Otto · everyone in Casa sees this");
    expect(composerPlaceholder({ pickerNames: null, messages: [choice({})], bot: shared, homeName: "Casa" }))
      .toBe("Pick from the card, or tell me in your own words");
  });
});

describe("bot list menus", () => {
  const otto = { id: "b1", name: "Otto", kind: "bot", sectionId: null };
  const model = { tiles: [], groups: [{ bots: [otto, { id: "b2", name: "Ida", kind: "bot" }] }], hidden: [] };
  const calls = [];
  const command = (name, args) => calls.push([name, args]);
  const menu = (bot, place, sections = []) => botMenuItems({ bot, place, sections, model, command, startRename: () => calls.push(["rename"]), askDelete: () => calls.push(["delete"]) });

  it("offers a row's actions in order", () => {
    expect(titles(menu(otto, "row"))).toEqual(["Pin", "Move to new section", "Mark as unread", "—", "Rename bot", "—", "Copy conversation ID", "—", "Hide from sidebar", "Delete"]);
    expect(titles(menu({ ...otto, unread: true }, "row", [{ id: "s1", name: "Work" }]))[1]).toBe("Move to");
    expect(titles(menu(otto, "tile"))).toEqual(["Unpin", "Mark as unread", "—", "Copy conversation ID", "—", "Hide from sidebar", "Delete"]);
    expect(titles(menu(otto, "hidden"))).toEqual(["Mark as unread", "—", "Rename bot", "—", "Copy conversation ID", "—", "Show in sidebar", "Delete"]);
  });

  it("lets another bot replace the main bot instead of deleting it", () => {
    const items = menu({ ...otto, isMain: true }, "row");
    expect(titles(items)).toEqual(["Pin", "Move to new section", "Mark as unread", "—", "Copy conversation ID", "—", "Hide from sidebar", "Replace with a different bot"]);
    expect(titles(items.at(-1).submenu)).toEqual(["Ida"]);
  });

  it("runs commands, the rename and the delete question", () => {
    calls.length = 0;
    const items = menu(otto, "row", [{ id: "s1", name: "Work" }]);
    items[0].run();
    items[1].submenu[0].run();
    items.find((item) => item.title === "Rename bot").run();
    items.at(-1).run();
    expect(calls).toEqual([["pin", { botId: "b1" }], ["moveBot", { botId: "b1", sectionId: "s1" }], ["rename"], ["delete"]]);
    const section = sectionMenuItems({ section: { id: "s1" }, index: 0, count: 2, command, startRename: () => {} });
    expect(titles(section)).toEqual(["Rename", "Move up", "Move down", "—", "Delete"]);
    expect(section.map((item) => Boolean(item.disabled))).toEqual([false, true, false, false, false]);
  });
});

describe("search palette rows", () => {
  const bots = [
    { id: "1", name: "Otto", lastActivityAt: "2026-11-01T10:00:00Z", pinPosition: null },
    { id: "2", name: "Ada", lastActivityAt: "2026-11-02T10:00:00Z", pinPosition: null },
    { id: "3", name: "Pinned", lastActivityAt: "2026-10-01T10:00:00Z", pinPosition: 0 },
    { id: "4", name: "News", unread: true, lastActivityAt: "2026-09-01T10:00:00Z", pinPosition: null },
    { id: "5", name: "Hidden Otto", hidden: true, lastActivityAt: "2026-11-03T10:00:00Z", pinPosition: null }
  ];
  const commands = paletteCommands({ currentBot: null, settingsSections: [{ value: "general", title: "General" }], theme: "dark" });
  const rows = (needle) => paletteEntries({ needle, bots, commands, apps: [], routines: [], files: [], messages: [] });

  it("lists unread, pinned, then recent bots, then the commands, before typing", () => {
    expect(rows("").map((row) => row.title)).toEqual([
      "News", "Pinned", "Ada", "Otto",
      "Add bots", "New group chat", "Keyboard shortcuts", "Settings: General", "Connect Apps", "Skills", "Theme: System", "Theme: Light", "Theme: Dark"
    ]);
    expect(commands.find((command) => command.id === "theme:dark").checked).toBe(true);
  });

  it("matches loosely, earliest letter first, hidden bots after apps", () => {
    expect(rows("ot").map((row) => `${row.kind}:${row.title}`)).toEqual([
      "conversation:Otto", "conversation:Hidden Otto", "command:Connect Apps", "command:Keyboard shortcuts", "command:Add bots", "command:New group chat"
    ]);
    expect(rows("ot").find((row) => row.title === "Hidden Otto").tag).toBe("hidden");
  });
  // A bot's template tag (D-98) finds it too, after the bots whose names match.
  it("finds a bot by its template's tag, after the names that match", () => {
    const tagged = [
      { id: "6", name: "Kitchen", template: { tag: "meals", source: "library" }, lastActivityAt: "2026-11-01T10:00:00Z", pinPosition: null },
      { id: "7", name: "Mealtime", template: { tag: "general", source: "library" }, lastActivityAt: "2026-11-01T10:00:00Z", pinPosition: null },
      { id: "8", name: "Ledger", template: { tag: "bills", source: "home" }, lastActivityAt: "2026-11-01T10:00:00Z", pinPosition: null }
    ];
    const found = paletteEntries({ needle: "meal", bots: tagged, commands: [], apps: [], routines: [], files: [], messages: [] });
    expect(found.map((row) => row.title)).toEqual(["Mealtime", "Kitchen"]);
    expect(paletteEntries({ needle: "bills", bots: tagged, commands: [], apps: [], routines: [], files: [], messages: [] }).map((row) => row.title)).toEqual(["Ledger"]);
    expect(paletteEntries({ needle: "xyz", bots: tagged, commands: [], apps: [], routines: [], files: [], messages: [] })).toEqual([]);
  });
});

describe("template pickers (D-98)", () => {
  const gallery = {
    categories: [{ id: "home", name: "Home" }],
    templates: [
      { slug: "weekly-meal-planner", tag: "meals", name: "Pantry", creator: "the Mercbot team", team: true, featured: true, category: "home", description: "Plans dinners." },
      { slug: "bill-tracker", tag: "bills", name: "Ledger", creator: "the Mercbot team", team: true, category: "home", description: "Tracks bills." }
    ]
  };
  const home = [{ id: "4", tag: "kitchen", description: "Our own dinners." }];

  it("lists the home's own templates first under All, keyed by id, never in an area", () => {
    const all = galleryView(gallery, { chip: "all", query: "", home });
    expect(all.order.map((row) => row.key)).toEqual(["home:4", "featured:weekly-meal-planner", "featured:bill-tracker", "home:weekly-meal-planner", "home:bill-tracker"]);
    expect(all.home[0].template.home).toBe(true);
    expect(galleryView(gallery, { chip: "home", query: "", home }).home).toEqual([]);
  });

  // Calmer in a picker (D-109): no featured templates, and an area menu without the Mercbot team; the page keeps both.
  it("shows a picker no featured templates and no Mercbot team, and the page both", () => {
    const picked = galleryView(gallery, { chip: "all", query: "", home, picking: true });
    expect(picked.order.map((row) => row.key)).toEqual(["home:4", "home:weekly-meal-planner", "home:bill-tracker"]);
    expect(picked.featured).toEqual([]);
    expect(galleryChips(gallery, { picking: true })).toEqual([{ id: "all", name: "All areas" }, { id: "home", name: "Home" }]);
    expect(galleryChips(gallery).map((chip) => chip.name)).toEqual(["All", "Mercbot team", "Home"]);
  });

  it("searches tags, the home's first", () => {
    expect(galleryView(gallery, { chip: "all", query: "bills", home }).found.map((row) => row.key)).toEqual(["found:bill-tracker"]);
    expect(galleryView(gallery, { chip: "all", query: "dinners", home }).found.map((row) => row.key)).toEqual(["home:4", "found:weekly-meal-planner"]);
  });
});
