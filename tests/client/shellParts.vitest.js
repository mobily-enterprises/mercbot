import { describe, expect, it } from "vitest";
import { toChatRow } from "../../src/components/mercbot/chatDirectory.js";
import { addPersonQuestion, chatMenuItems, chatQuestion, chatRights, sectionMenuItems } from "../../src/components/mercbot/chatMenus.js";
import { paletteCommands, paletteEntries } from "../../src/components/mercbot/paletteEntries.js";
import { galleryChips, galleryView } from "../../src/components/templates/galleryView.js";

// The shell's parts that are pure: the chat list's menus and the questions before Archive, Leave and Delete (D-112),
// the search palette's rows, and the template pickers.

const titles = (items) => items.map((item) => (item.divider ? "—" : item.title));
const KIM = { userId: "1", name: "Kim Lee" };
const ADA = { userId: "2", name: "Ada Byron" };

/** A chat row as the list has it: a ChatView from the server, with the person's place in it. */
function chatRow(id, { place = {}, ...extra } = {}) {
  return toChatRow({
    id, kind: "public", title: null, everyone: false, directBotId: null, appId: null, madeBy: "1", onboardingStep: null, archivedAt: null,
    lastActivityAt: "2026-11-01T10:00:00Z", people: [KIM], bots: [],
    place: place === null ? null : { readUpTo: null, unread: false, pinPosition: null, sectionId: null, hidden: false, muted: false, ...place },
    latest: null,
    ...extra
  });
}

describe("chat list menus", () => {
  const kitchen = chatRow("c1", { title: "Kitchen", people: [KIM, ADA] });
  const calls = [];
  const command = (name, args) => calls.push([name, args]);
  const menu = (chat, place, { sections = [], me = "1", manages = false } = {}) => chatMenuItems({
    chat, place, sections, me, manages, command,
    startRename: (renamed) => calls.push(["rename", renamed.id]),
    askDelete: () => calls.push(["delete"]),
    askLeave: () => calls.push(["leave"]),
    askArchive: () => calls.push(["archive"])
  });

  it("offers a row's actions in order, wherever the chat is listed", () => {
    expect(titles(menu(kitchen, "row"))).toEqual([
      "Pin", "Move to new section", "Mark as unread", "—", "Rename chat", "—", "Copy chat ID", "—", "Hide from sidebar", "Leave chat", "Archive", "Delete"
    ]);
    const withSections = titles(menu({ ...kitchen, unread: true }, "row", { sections: [{ id: "s1", name: "Work" }] }));
    expect([withSections[1], withSections[2]]).toEqual(["Move to", "Mark as read"]);
    expect(titles(menu(kitchen, "tile"))).toEqual(["Unpin", "Mark as unread", "—", "Rename chat", "—", "Copy chat ID", "—", "Hide from sidebar", "Leave chat", "Archive", "Delete"]);
    expect(titles(menu(kitchen, "hidden"))).toEqual(["Mark as unread", "—", "Rename chat", "—", "Copy chat ID", "—", "Show in sidebar", "Leave chat", "Archive", "Delete"]);
    expect(titles(menu(kitchen, "archived"))).toEqual(["Unarchive", "—", "Copy chat ID", "—", "Leave chat", "Delete"]);
    expect(menu(kitchen, "row").at(-1).danger).toBe(true);
  });

  it("lets only the chat's maker, or whoever manages the home, rename, archive and delete it", () => {
    expect(titles(menu(kitchen, "row", { me: "2" }))).toEqual(["Pin", "Move to new section", "Mark as unread", "—", "Copy chat ID", "—", "Hide from sidebar", "Leave chat"]);
    expect(titles(menu(kitchen, "archived", { me: "2" })), "nor unarchive it").toEqual(["Copy chat ID", "—", "Leave chat"]);
    expect(titles(menu(kitchen, "row", { me: "2", manages: true }))).toEqual(titles(menu(kitchen, "row")));
    expect(chatRights({ ...kitchen, madeBy: null }, { me: "1", manages: false }), "a chat no one made").toEqual({
      removeMembers: false, rename: false, joinIn: false, archive: false, unarchive: false, remove: false, leave: true, unpin: true
    });
    expect(chatRights(kitchen, { me: "1", manages: false }).joinIn, "its maker switches whether its bots join in").toBe(true);
    expect(chatRights(kitchen, { me: "2", manages: true }).joinIn, "and whoever manages the home").toBe(true);
    expect(chatRights(kitchen, { me: "2", manages: false }).joinIn, "no one else").toBe(false);
    expect(chatRights({ ...kitchen, directBotId: "b1" }, { me: "1", manages: true }).joinIn, "never in a direct chat").toBe(false);
  });

  it("archives only a public chat: a private one is hidden by each person for themselves, and one archived before unarchives (plan 5.1)", () => {
    const secret = { ...kitchen, kind: "private" };
    for (const place of ["row", "tile", "hidden"]) expect(titles(menu(secret, place)), place).not.toContain("Archive");
    expect(titles(menu(secret, "row"))).toContain("Hide from sidebar");
    expect(titles(menu({ ...secret, archivedAt: "2026-11-02T10:00:00Z" }, "archived"))[0]).toBe("Unarchive");
  });

  it("offers no Unpin, Leave, Archive or Delete on the everyone chat, even to whoever manages the home", () => {
    const everyone = chatRow("c0", { title: "Rossi family", everyone: true, madeBy: null, people: [KIM, ADA] });
    expect(titles(menu(everyone, "tile", { manages: true }))).toEqual(["Mark as unread", "—", "Rename chat", "—", "Copy chat ID", "—", "Hide from sidebar"]);
    expect(titles(menu(everyone, "tile", { me: "2" }))).toEqual(["Mark as unread", "—", "Copy chat ID", "—", "Hide from sidebar"]);
  });

  it("offers a direct chat with a bot no Rename and no Leave", () => {
    const direct = chatRow("c2", { directBotId: "b1", bots: [{ chatBotId: "9", botId: "b1", name: "Otto", color: "#1E86FC", shape: "cloud", archived: false, waitingTask: null }] });
    expect(titles(menu(direct, "row"))).toEqual(["Pin", "Move to new section", "Mark as unread", "—", "Copy chat ID", "—", "Hide from sidebar", "Archive", "Delete"]);
    expect(titles(menu(direct, "row", { manages: true })).filter((title) => ["Rename chat", "Leave chat"].includes(title))).toEqual([]);
  });

  it("runs commands, the rename and the questions", () => {
    calls.length = 0;
    const items = menu(kitchen, "row", { sections: [{ id: "s1", name: "Work" }] });
    items[0].run();
    expect(titles(items[1].submenu)).toEqual(["Work", "Unassigned", "—", "Create section"]);
    items[1].submenu[0].run();
    for (const title of ["Mark as unread", "Rename chat", "Copy chat ID", "Hide from sidebar", "Leave chat", "Archive", "Delete"]) items.find((item) => item.title === title).run();
    menu({ ...kitchen, archivedAt: "2026-11-02T10:00:00Z" }, "archived")[0].run();
    expect(calls).toEqual([
      ["pin", { chatId: "c1" }], ["moveChat", { chatId: "c1", sectionId: "s1" }], ["markUnread", { chatId: "c1" }], ["rename", "c1"],
      ["copyId", { chatId: "c1" }], ["hide", { chatId: "c1" }], ["leave"], ["archive"], ["delete"], ["unarchiveChat", { chatId: "c1" }]
    ]);
    const section = sectionMenuItems({ section: { id: "s1" }, index: 0, count: 2, command, startRename: () => {} });
    expect(titles(section)).toEqual(["Rename", "Move up", "Move down", "—", "Delete"]);
    expect(section.map((item) => Boolean(item.disabled))).toEqual([false, true, false, false, false]);
  });

  it("asks before adding a person to a private chat, since they'll read all of it, and not to a public one", () => {
    expect(addPersonQuestion({ ...kitchen, kind: "private" }, "Kitchen", "Ben Rossi")).toEqual({
      title: "Add Ben Rossi to “Kitchen”?", text: "Ben Rossi will see everything said here.", confirmLabel: "Add", danger: false
    });
    expect(addPersonQuestion(kitchen, "Kitchen", "Ben Rossi")).toBeNull();
  });

  it("asks before Archive, Leave and Delete, saying what each does to the chat", () => {
    expect(chatQuestion("archive", kitchen, "Kitchen")).toEqual({
      title: "Archive “Kitchen”?", text: "It stays readable for everyone in it, and no one can write in it until it's unarchived.", confirmLabel: "Archive", danger: false
    });
    expect(chatQuestion("leave", kitchen, "Kitchen").text).toBe("It's public, so you can still open it from New chat and join it again.");
    const plans = { ...kitchen, kind: "private" };
    expect([chatQuestion("leave", plans, "Plans").text, chatQuestion("leave", plans, "Plans").danger])
      .toEqual(["It's private, so you can't open it again unless someone adds you back.", false]);
    const alone = chatQuestion("leave", { ...plans, people: [KIM] }, "Plans");
    expect([alone.title, alone.text, alone.danger]).toEqual(["Leave “Plans”?", "You're the last person in it, so leaving deletes it, with its files and its bots' computers.", true]);
    const removal = chatQuestion("remove", kitchen, "Kitchen");
    expect([removal.title, removal.confirmLabel, removal.danger]).toEqual(["Delete “Kitchen”?", "Delete", true]);
    expect(removal.text).toContain("Its bots stay on your team.");
  });
});

describe("search palette rows", () => {
  const otto = { chatBotId: "9", botId: "b1", name: "Otto", color: "#1E86FC", shape: "cloud", archived: false, waitingTask: null };
  const chats = [
    chatRow("1", { title: "Kitchen", lastActivityAt: "2026-11-01T10:00:00Z" }),
    chatRow("2", { title: "Budget", people: [KIM, ADA], lastActivityAt: "2026-11-02T10:00:00Z" }),
    chatRow("3", { title: "Pinned", lastActivityAt: "2026-10-01T10:00:00Z", place: { pinPosition: 0 } }),
    chatRow("4", { title: "News", lastActivityAt: "2026-09-01T10:00:00Z", place: { unread: true } }),
    chatRow("5", { title: "Hidden kitchen", lastActivityAt: "2026-11-03T10:00:00Z", place: { hidden: true } }),
    chatRow("6", { title: "Rossi family", everyone: true, lastActivityAt: "2026-08-01T10:00:00Z" }),
    chatRow("7", { title: "Old kitchen", archivedAt: "2026-11-05T10:00:00Z", lastActivityAt: "2026-11-04T10:00:00Z" }),
    chatRow("8", { people: [KIM, ADA], bots: [otto], lastActivityAt: "2026-10-15T10:00:00Z" })
  ];
  const bots = [{ id: "b1", name: "Otto", template: null }, { id: "b2", name: "Chef", template: { tag: "kitchen", source: "library" } }];
  const people = [{ id: "1", name: "Kim Lee", role: "owner", roleLabel: "Owner" }, { id: "2", name: "Ada Byron", role: "member", roleLabel: "Member" }, { id: "3", name: "Kit Marlow", role: "admin", roleLabel: "Admin" }];
  const apps = [{ id: "p1", name: "Kitbag", description: "Packing lists" }];
  const routines = [{ id: "r1", name: "Kitchen stock", schedule: "Daily", botName: "Chef", chatName: "Kitchen" }];
  const commands = paletteCommands({ settingsSections: [{ value: "general", title: "General" }], theme: "dark" });
  const rows = (needle) => paletteEntries({ needle, me: "1", chats, bots, people, commands, apps, routines, files: [], messages: [] });
  const shown = (list) => list.map((row) => `${row.kind}:${row.title}`);

  it("lists unread, pinned with the everyone chat first, then recent chats, then the commands, before typing", () => {
    expect(rows("").map((row) => row.title)).toEqual([
      "News", "Rossi family", "Pinned", "Budget", "Kitchen", "Ada and Otto",
      "Add bots", "New chat", "Team", "Keyboard shortcuts", "Settings: General", "Connect Apps", "Skills", "Theme: System", "Theme: Light", "Theme: Dark"
    ]);
    expect(rows("")[0]).toMatchObject({ kind: "chat", key: "chat-4", unread: true });
    expect(commands.find((command) => command.id === "theme:dark").checked).toBe(true);
  });

  it("matches loosely, earliest letter first: chats, the home's bots and people, apps, hidden and archived chats, then routines", () => {
    expect(shown(rows("kit"))).toEqual([
      "chat:Kitchen", "bot:Chef", "person:Kit Marlow", "app:Kitbag", "chat:Old kitchen", "chat:Hidden kitchen", "routine:Kitchen stock"
    ]);
    expect(rows("kit").filter((row) => row.tag).map((row) => row.tag)).toEqual(["archived", "hidden"]);
    expect(rows("kit").find((row) => row.kind === "person").secondary).toBe("Admin");
    expect(rows("kit").find((row) => row.kind === "routine").secondary).toBe("Daily · Chef · Kitchen");
  });

  it("finds a chat by who's in it, after the chats named so, and never offers the person looking", () => {
    expect(shown(rows("ada"))).toEqual(["chat:Ada and Otto", "chat:Budget", "person:Ada Byron"]);
    expect(rows("ada").find((row) => row.title === "Budget").secondary).toBe("Ada");
    expect(shown(rows("kim")), "Kim Lee is the person looking, in every chat as \"you\"").toEqual(["person:Kit Marlow"]);
  });

  // A bot's template tag (D-98) finds it too, after the bots whose names match.
  it("finds a bot by its template's tag, after the names that match", () => {
    const tagged = [
      { id: "6", name: "Kitchen", template: { tag: "meals", source: "library" } },
      { id: "7", name: "Mealtime", template: { tag: "general", source: "library" } },
      { id: "8", name: "Ledger", template: { tag: "bills", source: "home" } }
    ];
    const found = (needle) => paletteEntries({ needle, me: "1", chats: [], bots: tagged, people: [], commands: [], apps: [], routines: [], files: [], messages: [] });
    expect(shown(found("meal"))).toEqual(["bot:Mealtime", "bot:Kitchen"]);
    expect(found("bills").map((row) => row.title)).toEqual(["Ledger"]);
    expect(found("xyz")).toEqual([]);
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
