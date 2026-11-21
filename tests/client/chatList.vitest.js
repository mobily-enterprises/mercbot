import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { buildSidebarModel, toChatRow } from "../../src/components/mercbot/chatDirectory.js";

// The sidebar's chats as they render (D-112, plan 4.1): the everyone chat first among the pinned tiles and never
// dragged, then the other pinned chats, then each section's rows; each row's preview line, saying who wrote the latest
// message but in a direct chat; archived chats under Archived chats, read-only, and hidden ones under Hidden chats,
// each listed once opened; and, for someone with no chats yet, where to start, under the Team entry. The sidebar's
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
/** The list from the top, in order: each tile, section heading and row, as "tile <name>", "heading <name>", "row <name>". */
const outline = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>|<span class="mb-header__label">([^<]*)</gu)].flatMap(([, attributes, inside, heading]) => {
  if (heading !== undefined) return [`heading ${heading}`];
  const [entry] = buttons(`<button${attributes}>${inside}</button>`);
  if (entry.classes.includes("mb-header")) return [`heading ${/mb-header__label">([^<]*)</u.exec(inside)?.[1]}`];
  if (entry.classes.includes("mb-tile")) return [`tile ${entry.label}`];
  if (entry.classes.includes("mb-row")) return [`row ${entry.label}`];
  return [];
});
/** Each row's name and preview line. */
const previews = (html) => buttons(html).filter((entry) => entry.classes.includes("mb-row"))
  .map((entry) => [entry.label, text(/class="mb-row__preview[^"]*">([\s\S]*?)<\/span>/u.exec(entry.inside)?.[1] ?? "")]);

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

/** The chat list, as the sidebar shows it for `chats`. */
function list(chats, { sections = [], hiddenExpanded = false, archivedExpanded = false } = {}) {
  const model = buildSidebarModel({ chats, sections, hiddenExpanded, archivedExpanded });
  return rendered(MercbotChatList, { model, sections, me: "1", hiddenExpanded, archivedExpanded });
}

describe("the chat list", () => {
  it("shows the everyone chat as the first tile, which can't be dragged, then the other pinned chats, then each section", async () => {
    const html = await list([DIRECT, BATHROOM, PARTY, KITCHEN, EVERYONE], { sections: SECTIONS });
    expect(outline(html)).toEqual([
      "tile Rossi family",
      "tile Kitchen reno",
      "tile Saturday party, private",
      "heading Renovations",
      "row Bathroom",
      "heading Unassigned",
      "row Chef"
    ]);
    const draggable = Object.fromEntries(buttons(html).filter((entry) => entry.classes.includes("mb-tile"))
      .map((entry) => [entry.label, /draggable="([^"]*)"/u.exec(entry.attributes)?.[1]]));
    expect(draggable).toEqual({ "Rossi family": "false", "Kitchen reno": "true", "Saturday party, private": "true" });
  });

  it("previews each chat's latest message with who wrote it, but in a direct chat", async () => {
    expect(previews(await list([BATHROOM, GARDEN, QUOTES, DIRECT]))).toEqual([
      ["Chef", "here's the plan"],
      ["Quotes", "Chef: three quotes in"],
      ["Garden", "Ben: oak it is"],
      ["Bathroom", "You: see you there"]
    ]);
  });

  it("lists archived chats under Archived chats once it's opened, each read-only", async () => {
    const closed = await list([KITCHEN, OLD_FLAT]);
    expect(outline(closed)).toEqual(["tile Kitchen reno", "heading Archived chats"]);
    expect(text(closed)).toContain("Archived chats 1");
    const opened = await list([KITCHEN, OLD_FLAT], { archivedExpanded: true });
    expect(outline(opened)).toEqual(["tile Kitchen reno", "heading Archived chats", "row Old flat, archived"]);
    expect(previews(opened)).toEqual([["Old flat, archived", "Archived · read-only"]]);
  });

  it("lists hidden chats under Hidden chats once it's opened", async () => {
    const closed = await list([KITCHEN, BOILER]);
    expect(outline(closed)).toEqual(["tile Kitchen reno", "heading Hidden chats"]);
    expect(text(closed)).toContain("Hidden chats 1");
    expect(outline(await list([KITCHEN, BOILER], { hiddenExpanded: true }))).toEqual(["tile Kitchen reno", "heading Hidden chats", "row Boiler"]);
  });
});

describe("the sidebar", () => {
  const sidebar = (chats, props = {}) => rendered(MercbotSidebar, {
    model: buildSidebarModel({ chats, sections: [] }), sections: [], me: "1", width: 280, displayName: "Anna Rossi", initials: "AR", ...props
  });

  it("says No chats yet. and offers Start a chat only while the person has no chats", async () => {
    const empty = await sidebar([]);
    expect(text(/<div class="mb-sidebar__empty">[\s\S]*?<\/div>/u.exec(empty)?.[0] ?? "")).toBe("No chats yet. Start a chat");
    expect(buttons(empty).filter((entry) => entry.text === "Start a chat")).toHaveLength(1);
    for (const chats of [[KITCHEN], [BOILER], [OLD_FLAT]]) {
      expect(await sidebar(chats), chats[0].title).not.toContain("No chats yet.");
    }
  });

  it("has a Team entry, marked as the page while Team is open", async () => {
    const team = (html) => buttons(html).filter((entry) => entry.label === "Team").map((entry) => [entry.text, /aria-current="([^"]*)"/u.exec(entry.attributes)?.[1] ?? null]);
    expect(team(await sidebar([]))).toEqual([["Team", null]]);
    expect(team(await sidebar([], { teamOpen: true }))).toEqual([["Team", "page"]]);
  });
});
