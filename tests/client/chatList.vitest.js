import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { buildSidebarModel, toChatRow } from "../../src/components/mercbot/chatDirectory.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";

// The sidebar as it renders (D-112, plan 4.1): the everyone chat first among the pinned tiles and never dragged, then
// the other pinned chats; then Rooms (each section's rows, then the public rooms the person isn't in, faded), People and
// Bots, each with its + and folding by its title; every row one line, its latest message in its description; archived
// bots under Archived bots, archived rooms under Archived chats, read-only, and hidden ones under Hidden chats, each
// listed once opened; and the top row of Search, Files and Apps with no Team and no "New chat or bots". The sidebar's
// own entries (home switcher, Files, Apps, the account) are stand-ins; what the menus offer is shellParts' to test.
const stub = vi.hoisted(() => (vue, name) => ({ default: vue.defineComponent({ name, inheritAttrs: false, setup: () => () => vue.h("div", { "data-stub": name }) }) }));
vi.mock("../../src/components/mercbot/MercbotHomeSwitcher.vue", async () => stub(await import("vue"), "MercbotHomeSwitcher"));
vi.mock("../../src/components/mercbot/MercbotAccountMenu.vue", async () => stub(await import("vue"), "MercbotAccountMenu"));
vi.mock("../../src/components/files/MercbotFilesEntry.vue", async () => stub(await import("vue"), "MercbotFilesEntry"));
vi.mock("../../src/components/apps/MercbotAppsEntry.vue", async () => stub(await import("vue"), "MercbotAppsEntry"));

const { default: MercbotChatList } = await import("../../src/components/mercbot/MercbotChatList.vue");
const { default: MercbotSidebar } = await import("../../src/components/mercbot/MercbotSidebar.vue");

/** A component's HTML, rendered with the app's Vuetify, its apostrophes as written, without scoped styles' marks. */
async function rendered(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"").replace(/ data-v-[0-9a-f]+/gu, "");
}
const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
/** Each button, in order: its words, its aria-label, its classes and the rest of its attributes. */
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)].map(([, attributes, inside]) => ({
  attributes,
  inside,
  text: text(inside),
  label: /aria-label="([^"]*)"/u.exec(attributes)?.[1] ?? null,
  classes: (/class="([^"]*)"/u.exec(attributes)?.[1] ?? "").split(" ")
}));
/** The list from the top, in order: each tile, section, heading and row, as "tile <name>", "section <name>", "heading
 * <name>", "row <name>", and the "N more" and "+ …" buttons as "more <words>". */
const outline = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>|<span class="mb-header__label">([^<]*)</gu)].flatMap(([, attributes, inside, heading]) => {
  if (heading !== undefined) return [`heading ${heading}`];
  const [entry] = buttons(`<button${attributes}>${inside}</button>`);
  if (entry.classes.includes("mb-section__title")) return [`section ${/mb-section__label">([^<]*)</u.exec(inside)?.[1]}`];
  if (entry.classes.includes("mb-header")) return [`heading ${/mb-header__label">([^<]*)</u.exec(inside)?.[1]}`];
  if (entry.classes.includes("mb-tile")) return [`tile ${entry.label}`];
  if (entry.classes.includes("mb-row")) return [`row ${entry.label}${entry.classes.includes("mb-row--faded") ? " (faded)" : ""}`];
  if (entry.classes.includes("mb-more") || entry.classes.includes("mb-foot")) return [`more ${entry.text}`];
  return [];
});
/** Each row's name and its description (what it says on hover): its full name, then its latest message. */
const tips = (html) => buttons(html).filter((entry) => entry.classes.includes("mb-row"))
  .map((entry) => [entry.label, /title="([^"]*)"/u.exec(entry.attributes)?.[1] ?? ""]);
/** Each section's + by its label. */
const pluses = (html) => buttons(html).filter((entry) => ["New room", "Add bots", "Invite people"].includes(entry.label)).map((entry) => entry.label);

const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false, waitingTask: null };
const SECTIONS = [{ id: "s1", name: "Renovations", collapsed: false }];
let minute = 10;
/** A chat as the server lists it, with the person's own place in it. */
const listed = (id, title, { place = {}, ...extra } = {}) => toChatRow({
  id, kind: "public", title, everyone: false, directBotId: null, archivedAt: null, lastActivityAt: `2026-11-22T10:${minute++}:00.000Z`,
  people: [ANNA, BEN], bots: [CHEF], latest: null, place: { pinPosition: null, sectionId: null, hidden: false, unread: false, ...place }, ...extra
});
const said = (author, preview) => ({ latest: { id: "m1", authorUserId: author.userId ?? null, authorBotId: author.botId ?? null, preview } });
const EVERYONE = listed("1", "Rossi family", { everyone: true });
const KITCHEN = listed("2", "Kitchen reno", { place: { pinPosition: 0 } });
const PARTY = listed("3", "Saturday party", { kind: "private", place: { pinPosition: 1 } });
const BATHROOM = listed("4", "Bathroom", { place: { sectionId: "s1" }, ...said(ANNA, "see you there") });
const GARDEN = listed("5", "Garden", said(BEN, "oak it is"));
const QUOTES = listed("6", "Quotes", said(CHEF, "three quotes in"));
const DIRECT = listed("7", null, { directBotId: "7", people: [ANNA], ...said(CHEF, "here's the plan") });
const BOILER = listed("8", "Boiler", { place: { hidden: true } });
const OLD_FLAT = listed("9", "Old flat", { archivedAt: "2026-11-20T10:00:00.000Z" });

const PEOPLE = [{ id: "1", name: "Anna Rossi" }, { id: "2", name: "Ben Rossi" }];
const BOTS = [{ id: "7", name: "Chef", color: "#E65100", shape: "cloud", isMain: true, archivedAt: null }];
const PULSE = { id: "9", name: "Pulse", color: "#1E86FC", shape: "cloud", isMain: false, archivedAt: `${new Date().getFullYear()}-11-20T10:00:00.000Z` };

/** The list, as the sidebar shows it for `chats` in a home of Anna (looking) and Ben, with Chef. */
function list(chats, { sections = [], hiddenExpanded = false, archivedExpanded = false, people = PEOPLE, bots = BOTS, publicRooms = [], folded = {}, more = {}, ...props } = {}) {
  const model = buildSidebarModel({ chats, sections, publicRooms, people, bots, me: "1", folded, more, hiddenExpanded, archivedExpanded });
  return rendered(MercbotChatList, { model, sections, me: "1", hiddenExpanded, archivedExpanded, folded, homeName: "Rossi family", ...props });
}

describe("the chat list", () => {
  it("shows the everyone chat as the first tile, which can't be dragged, then the other pinned chats, then Rooms, People and Bots", async () => {
    const html = await list([DIRECT, BATHROOM, PARTY, KITCHEN, EVERYONE], { sections: SECTIONS });
    expect(outline(html)).toEqual([
      "tile Rossi family",
      "tile Kitchen reno",
      "tile Saturday party, private",
      "section Rooms",
      "heading Renovations",
      "row Bathroom",
      "heading Unassigned",
      "section People",
      "more 1 more",
      "section Bots",
      "row Chef"
    ]);
    const draggable = Object.fromEntries(buttons(html).filter((entry) => entry.classes.includes("mb-tile"))
      .map((entry) => [entry.label, /draggable="([^"]*)"/u.exec(entry.attributes)?.[1]]));
    expect(draggable).toEqual({ "Rossi family": "false", "Kitchen reno": "true", "Saturday party, private": "true" });
  });

  it("draws each row on one line, its latest message with who wrote it in its description, but in a direct chat", async () => {
    const html = await list([BATHROOM, GARDEN, QUOTES, DIRECT]);
    expect(tips(html)).toEqual([
      ["Quotes", "Quotes\nChef: three quotes in"],
      ["Garden", "Garden\nBen: oak it is"],
      ["Bathroom", "Bathroom\nYou: see you there"],
      ["Chef", "Chef\nhere's the plan"]
    ]);
    expect(html, "no preview line").not.toContain("mb-row__preview");
  });

  it("gives Rooms its New room and Bots its Add bots, with a + … row while each is empty, and People the + a copy gives", async () => {
    const empty = await list([], { bots: [] });
    expect(pluses(empty)).toEqual(["New room", "Add bots"]);
    expect(outline(empty)).toEqual(["section Rooms", "more + New room", "section People", "more 1 more", "section Bots", "more + Add bots"]);
    const invite = { component: { props: { homeName: String }, render() { return h("button", { "aria-label": "Invite people", "data-home": this.homeName }); } } };
    const withInvite = await list([KITCHEN], { peopleActions: [invite] });
    expect(pluses(withInvite)).toEqual(["New room", "Invite people", "Add bots"]);
    expect(withInvite).toContain("data-home=\"Rossi family\"");
  });

  it("has no People when the person is the home's only one, unless a copy's + lets them invite someone", async () => {
    const alone = await list([KITCHEN], { people: [PEOPLE[0]] });
    expect(outline(alone)).not.toContain("section People");
    const invite = { component: { render: () => h("button", { "aria-label": "Invite people" }) } };
    expect(outline(await list([KITCHEN], { people: [PEOPLE[0]], peopleActions: [invite] }))).toContain("section People");
  });

  it("lists the public rooms the person isn't in after their own, faded, and more than three under N more public rooms", async () => {
    const rooms = ["21", "22", "23", "24"].map((id) => listed(id, `Room ${id}`, { place: null }));
    expect(outline(await list([GARDEN], { publicRooms: rooms.slice(0, 2), bots: [] })).slice(0, 4))
      .toEqual(["section Rooms", "row Garden", "row Room 22 (faded)", "row Room 21 (faded)"]);
    const four = outline(await list([GARDEN], { publicRooms: rooms, bots: [] }));
    expect(four.slice(0, 3)).toEqual(["section Rooms", "row Garden", "more 4 more public rooms"]);
    const opened = outline(await list([GARDEN], { publicRooms: rooms, bots: [], more: { rooms: true } }));
    expect(opened.slice(0, 7)).toEqual(["section Rooms", "row Garden", "row Room 24 (faded)", "row Room 23 (faded)", "row Room 22 (faded)", "row Room 21 (faded)", "more Show fewer"]);
  });

  it("folds a section by its title, keeping what needs the person and counting the rest", async () => {
    const news = listed("10", "News", { place: { unread: true } });
    const html = await list([GARDEN, QUOTES, news], { folded: { rooms: true, bots: true } });
    expect(outline(html)).toEqual(["section Rooms", "row News", "section People", "more 1 more", "section Bots"]);
    const titles = buttons(html).filter((entry) => entry.classes.includes("mb-section__title"));
    expect(titles.map((entry) => [entry.text, /aria-expanded="([^"]*)"/u.exec(entry.attributes)?.[1]])).toEqual([
      ["Rooms 2", "false"], ["People", "true"], ["Bots 1", "false"]
    ]);
  });

  it("keeps the bots that have left under Archived bots, closed until opened, each opening its card", async () => {
    shellPreferences.language = "en-GB";
    const closed = await list([KITCHEN], { bots: [...BOTS, PULSE] });
    expect(outline(closed).slice(-2)).toEqual(["row Chef", "more Archived bots 1"]);
    const opened = await list([KITCHEN], { bots: [...BOTS, PULSE], more: { archivedBots: true } });
    expect(outline(opened).slice(-2)).toEqual(["more Archived bots", "row Pulse, archived (faded)"]);
    expect(tips(opened).at(-1)).toEqual(["Pulse, archived", "Pulse\nBot · left 20 Nov"]);
  });

  // A home of just Anna and no bots: the tiles and what's after the three sections.
  const apart = (html) => outline(html).filter((entry) => !/^(section|more) /u.test(entry));

  it("lists archived chats under Archived chats once it's opened, each read-only", async () => {
    const closed = await list([KITCHEN, OLD_FLAT], { people: [PEOPLE[0]], bots: [] });
    expect(apart(closed)).toEqual(["tile Kitchen reno", "heading Archived chats"]);
    expect(text(closed)).toContain("Archived chats 1");
    const opened = await list([KITCHEN, OLD_FLAT], { people: [PEOPLE[0]], bots: [], archivedExpanded: true });
    expect(apart(opened)).toEqual(["tile Kitchen reno", "heading Archived chats", "row Old flat, archived (faded)"]);
    expect(tips(opened)).toEqual([["Old flat, archived", "Old flat\nArchived · read-only"]]);
  });

  it("lists hidden chats under Hidden chats once it's opened", async () => {
    const closed = await list([KITCHEN, BOILER], { people: [PEOPLE[0]], bots: [] });
    expect(apart(closed)).toEqual(["tile Kitchen reno", "heading Hidden chats"]);
    expect(text(closed)).toContain("Hidden chats 1");
    expect(apart(await list([KITCHEN, BOILER], { people: [PEOPLE[0]], bots: [], hiddenExpanded: true })))
      .toEqual(["tile Kitchen reno", "heading Hidden chats", "row Boiler"]);
  });
});

describe("the sidebar", () => {
  const sidebar = (chats, props = {}) => rendered(MercbotSidebar, {
    model: buildSidebarModel({ publicRooms: [], chats, sections: [], people: PEOPLE, bots: BOTS, me: "1" }), sections: [], me: "1", width: 280,
    displayName: "Anna Rossi", initials: "AR", ...props
  });

  it("has the home switcher, Search, Files and Apps in its top row, and no Team or New chat or bots", async () => {
    const html = await sidebar([KITCHEN]);
    const top = /<div class="mb-sidebar__actions">([\s\S]*?)<div class="mb-sidebar__bots">/u.exec(html)?.[1] ?? "";
    expect([...top.matchAll(/data-stub="([^"]*)"|aria-label="([^"]*)"/gu)].map(([, stub, label]) => stub || label))
      .toEqual(["MercbotHomeSwitcher", "Search", "MercbotFilesEntry", "MercbotAppsEntry"]);
    for (const gone of ["Team", "New chat or bots", "No chats yet."]) expect(html).not.toContain(gone);
  });

  it("keeps a face for each room, person and bot shown in the compact rail, with no + of its own", async () => {
    const html = await sidebar([KITCHEN, GARDEN], { compact: true });
    const rail = [...html.matchAll(/<button type="button" class="mb-bot[^"]*"[^>]*aria-label="([^"]*)"/gu)].map(([, label]) => label);
    expect(rail, "Ben, not talked with lately, is under People's N more").toEqual(["Kitchen reno", "Garden", "Chef"]);
    expect(html).not.toContain("New chat or bots");
  });
});
