import { computed, createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MercbotMemberCard from "../../src/components/mercbot/MercbotMemberCard.vue";
import MercbotTeamPage from "../../src/components/mercbot/MercbotTeamPage.vue";
import extensions from "../../src/components/mercbot/extensions.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";
import { pageAccess } from "../../src/components/mercbot/useBotLibrary.js";
import { canSwitchRoutine, routineMenuItems, useBotRoutines } from "../../src/components/mercbot/useBotRoutines.js";
import { theme } from "../../src/theme/index.js";

// Team (D3, plan 4.2) and a member's card: the home's people and bots alike, in every state the page has (loading,
// failed, just you, people and bots, archived bots with Resume for whoever may), and the card of a person and of a
// bot, with a bot's sections as they are now: no sharing, notebook, rooms or groups; its files by chat; its computer
// in the chat, or on Team where to find one; its routines by chat. The routes are a stand-in that records each call
// and answers what the server would; the parts other screens own are stand-ins that show what they were given.
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => ({ byUrl: new Map() }));
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url, options = {}) {
      calls.push([options.method || "GET", url]);
      const answer = answers.byUrl.get(`${options.method || "GET"} ${url}`);
      if (answer instanceof Error) throw answer;
      return answer ?? {};
    }
  })
}));
// A part another screen owns, shown as a <div> naming it and the props it was given, each as JSON.
const stub = vi.hoisted(() => (vue, name, props = []) => ({
  default: vue.defineComponent({
    name,
    props,
    setup: (given) => () => vue.h("div", {
      "data-stub": name,
      ...Object.fromEntries(props.map((key) => [`data-${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`, JSON.stringify(given[key] ?? null)]))
    })
  })
}));
vi.mock("../../src/components/files/FileBrowser.vue", async () => stub(await import("vue"), "FileBrowser", ["botId", "chat", "sections"]));
vi.mock("../../src/components/mercbot/MercbotChatComputers.vue", async () => stub(await import("vue"), "MercbotChatComputers", ["chat", "me", "homeName", "onlyBotId"]));
vi.mock("../../src/components/apps/MercbotAppsSection.vue", async () => stub(await import("vue"), "MercbotAppsSection", ["bot"]));
vi.mock("../../src/components/apps/MercbotViewViewer.vue", async () => stub(await import("vue"), "MercbotViewViewer"));
vi.mock("../../src/components/mercbot/MercbotChangeTemplateDialog.vue", async () => stub(await import("vue"), "MercbotChangeTemplateDialog"));
vi.mock("../../src/components/mercbot/MercbotFileViewer.vue", async () => stub(await import("vue"), "MercbotFileViewer"));
vi.mock("../../src/components/mercbot/MercbotPageShare.vue", async () => stub(await import("vue"), "MercbotPageShare"));

/** A component's HTML, rendered with the app's Vuetify, its apostrophes and quotes as written, without scoped styles' marks. */
async function rendered(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"").replace(/ data-v-[0-9a-f]+/gu, "");
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const count = (html, text) => html.split(text).length - 1;

const thisYear = new Date().getFullYear();
const anna = { id: "1", name: "Anna Rossi", role: "owner", roleLabel: "Owner" };
const ben = { id: "2", name: "Ben Rossi", role: "member", roleLabel: "Member" };
const bot = (id, name, extra = {}) => ({
  id, name, color: "#1E86FC", shape: "cloud", isMain: false, isBuilder: false, madeBy: "1", madeByName: "Anna Rossi",
  template: { tag: "meals", source: "library", description: "plans our meals" }, hasAdditions: false, additionsLine: "",
  archivedAt: null, archivedBy: null, canArchive: true, ...extra
});
const chef = bot("7", "Chef");
const shopper = bot("8", "Shopper", { madeBy: "2", madeByName: "Ben Rossi", template: { tag: "shop", source: "library", description: "does the shopping" } });
const pulse = bot("9", "Pulse", { archivedAt: `${thisYear}-11-20T10:00:00.000Z`, archivedBy: "Anna Rossi" });
const theirs = bot("10", "Ledger", { archivedAt: `${thisYear}-11-19T10:00:00.000Z`, canArchive: false });
const chatRow = (id, title, people, bots, extra = {}) => ({
  id, kind: "public", title, everyone: false, directBotId: null, archivedAt: null, lastActivityAt: `2026-11-2${id.length}T10:00:00Z`,
  people: people.map((person) => ({ userId: person.id, name: person.name })),
  bots: bots.map((entry) => ({ chatBotId: `cb${entry.id}`, botId: entry.id, name: entry.name, color: entry.color, shape: entry.shape, archived: false })),
  ...extra
});
const kitchen = chatRow("55", "Kitchen reno", [ben, anna], [chef]);
const party = chatRow("56", "Saturday party", [ben, anna], [shopper], { kind: "private" });
const direct = chatRow("57", null, [ben], [chef], { directBotId: "7" });

beforeEach(() => {
  calls.length = 0;
  answers.byUrl = new Map();
  setCurrentHome("casa");
  shellPreferences.language = "en-GB";
  shellPreferences.detailsTab = "details";
});

describe("the Team page", () => {
  const page = (props) => rendered(MercbotTeamPage, { me: "2", homeName: "Casa", ...props });

  it("shows the rows' shapes while it loads, and no empty words", async () => {
    const html = await page({ bots: null, people: [ben] });
    expect(html).toContain("aria-busy=\"true\"");
    expect(count(html, "mb-team-row--skeleton")).toBe(4);
    expect(html).not.toContain("Just you");
    expect(html).not.toContain("didn't load");
    expect(html, "nobody listed yet").not.toContain("Ben Rossi");
    expect(html).toContain("Team<span class=\"mb-team-page__home\"> · Casa</span>");
    expect(html).toMatch(/<button[^>]*mb-team-page__add[^>]*>[\s\S]*Add bots <\/button>/u);
  });

  it("says when the team didn't load, with Try again", async () => {
    const html = await page({ bots: null, people: null, failed: true });
    expect(html).toContain("role=\"alert\"");
    expect(html).toMatch(/Your team didn't load\.\s*<button[^>]*>Try again<\/button>/u);
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("Just you");
  });

  it("lists a home of just you, with nobody to message, and asks for bots", async () => {
    const html = await page({ bots: [], people: [ben] });
    expect(html).toContain("Ben Rossi<span class=\"mb-team-row__you\"> (you)</span>");
    expect(html).toContain("Member");
    expect(html).not.toContain("aria-label=\"Message");
    expect(html).toContain("Just you here so far. Add bots to start your team.");
    expect(html).not.toContain(">Archived<");
  });

  it("lists people, then bots, alike: [Message] on each but yourself, a bot's maker and what it does", async () => {
    const html = await page({ bots: [chef, shopper], people: [anna, ben], selected: "bot:7" });
    const order = ["Anna Rossi", "Ben Rossi", "Chef", "Shopper"].map((name) => html.indexOf(`aria-label="${name}`));
    expect(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), "people first, then bots").toBe(true);
    expect(html).toContain("aria-label=\"Anna Rossi, Owner\"");
    expect(html).toContain("aria-label=\"Message Anna Rossi\"");
    expect(html, "never yourself").not.toContain("aria-label=\"Message Ben Rossi\"");
    expect(html).toContain("aria-label=\"Message Chef\"");
    expect(html).toContain("aria-label=\"Message Shopper\"");
    expect(html).toContain("Bot · made by Anna Rossi<span class=\"mb-team-row__does\"> · plans our meals</span>");
    expect(html, "made by the person looking").toContain("Bot · made by you<span class=\"mb-team-row__does\"> · does the shopping</span>");
    expect(html).toContain("mb-ttag");
    expect(html).toMatch(/aria-label="Chef, Bot · made by Anna Rossi" aria-current="true"/u);
    expect(count(html, "aria-current"), "only the open card's row").toBe(1);
    expect(html).not.toContain("Just you");
  });

  it("lists the bots that have left under Archived, with Resume only for whoever may, and no [Message]", async () => {
    const html = await page({ bots: [chef, pulse, theirs], people: [anna, ben] });
    const archived = html.slice(html.indexOf(">Archived<"));
    expect(archived).toContain("Pulse");
    expect(archived).toContain("Bot · left 20 Nov");
    expect(archived).toContain("Bot · left 19 Nov");
    expect(archived).toContain("aria-label=\"Resume Pulse\"");
    expect(archived, "someone else's, for a member").not.toContain("aria-label=\"Resume Ledger\"");
    expect(html).not.toContain("aria-label=\"Message Pulse\"");
    expect(html).not.toContain("aria-label=\"Message Ledger\"");
    expect(html.indexOf("Pulse"), "after the active bots").toBeGreaterThan(html.indexOf("aria-label=\"Message Chef\""));
  });

  it("shows what a copy built on Mercbot adds beside Add bots, given the home's name", async () => {
    extensions.teamActions.push({ component: { props: { homeName: String }, render() { return h("button", { "data-invite": this.homeName }, "Invite a person"); } } });
    try {
      const html = await page({ bots: [chef], people: [anna, ben] });
      expect(html).toMatch(/<button data-invite="Casa">Invite a person<\/button>[\s\S]*Add bots/u);
    } finally {
      extensions.teamActions.pop();
    }
  });
});

describe("a person's card", () => {
  const card = (person, props = {}) =>
    rendered(MercbotMemberCard, { member: { kind: "person", person }, chats: [kitchen, party, direct], me: "2", homeName: "Casa", allBots: [chef, shopper], ...props });

  it("has their face, name and role, [Message], and the chats you share, and reads nothing of a bot's", async () => {
    const html = await card(anna);
    await settled();
    expect(html).toContain(">AR</span>");
    expect(html).toContain("Anna Rossi");
    expect(html).toContain("Owner");
    expect(html).toContain("aria-label=\"Message Anna Rossi\"");
    expect(html).toContain("Chats you share");
    expect(html).toContain("aria-label=\"Kitchen reno, Public\"");
    expect(html).toContain("aria-label=\"Saturday party, Private\"");
    expect(html, "a direct chat she isn't in").not.toContain("aria-label=\"Chef, Public\"");
    expect(html).not.toContain("role=\"tablist\"");
    expect(calls).toEqual([]);
  });

  it("is yours without [Message] or chats to share", async () => {
    const html = await card(ben);
    expect(html).toContain("Ben Rossi<span class=\"mb-card__you\"> (you)</span>");
    expect(html).not.toContain("aria-label=\"Message");
    expect(html).not.toContain("Chats you share");
  });
});

describe("a bot's card", () => {
  const card = (props = {}) =>
    rendered(MercbotMemberCard, { member: { kind: "bot", bot: chef }, chats: [kitchen, party, direct], me: "2", homeName: "Casa", allBots: [chef, shopper], ...props });
  const FORMER = ["Who sees what", "notebook", "Conversations", "Members", "You only", "Just me", "Everyone using", "group"];

  it("has its face, name, template, maker, [Message], the chats you share and its four sections, and none of the old ones", async () => {
    const html = await card();
    expect(html).toContain("aria-label=\"Rename Chef\"");
    expect(html).toContain("Bot · made by Anna Rossi");
    expect(html).toContain("aria-label=\"Message Chef\"");
    expect(html).toContain("aria-label=\"Kitchen reno, Public\"");
    expect(html).toContain("aria-label=\"Chef, Public\"");
    expect(html, "a chat without Chef").not.toContain("Saturday party");
    expect([...html.matchAll(/role="tab"[^>]*>\s*([^<]+?)\s*</gu)].map((match) => match[1])).toEqual(["Details", "Files", "Library", "Computer"]);
    expect(html).toContain("Archive Chef");
    expect(html).toContain("data-stub=\"MercbotAppsSection\"");
    for (const word of FORMER) expect(html, word).not.toContain(word);
  });

  it("reads its routines in every chat on Team, and this chat's from a chat", async () => {
    await card();
    await settled();
    expect(calls).toContainEqual(["GET", "/api/w/casa/bots/7/routines"]);
    expect(calls).toContainEqual(["GET", "/api/w/casa/bots/7/instructions"]);
    calls.length = 0;
    await card({ chat: kitchen });
    await settled();
    expect(calls).toContainEqual(["GET", "/api/w/casa/chats/55/routines"]);
    expect(calls).not.toContainEqual(["GET", "/api/w/casa/bots/7/routines"]);
  });

  it("has no [Message] in its own direct chat, or once it has left", async () => {
    expect(await card({ chat: direct })).not.toContain("aria-label=\"Message Chef\"");
    const left = await card({ member: { kind: "bot", bot: pulse }, allBots: [pulse] });
    expect(left).not.toContain("aria-label=\"Message Pulse\"");
    expect(left).toContain("Bot · left 20 Nov");
    expect(left).toContain("Resume Pulse");
  });

  it("shows the bot as the team has it now", async () => {
    expect(await card({ allBots: [{ ...chef, name: "Chef Anna" }] })).toContain("aria-label=\"Rename Chef Anna\"");
  });

  it("lets only its maker and the home's owners and admins rename it", async () => {
    const html = await card({ member: { kind: "bot", bot: { ...chef, canArchive: false } }, allBots: [] });
    expect(html).not.toContain("Rename Chef");
    expect(html).toMatch(/<h2 class="mb-card__name"[^>]*>Chef/u);
    expect(await card({ member: { kind: "bot", bot: { ...chef, canArchive: false } }, allBots: [], manages: true })).toContain("Rename Chef");
  });

  it("has its own files and the home's on Team, and this chat's first from a chat", async () => {
    shellPreferences.detailsTab = "files";
    const team = await card();
    expect(team).toContain("data-chat=\"null\"");
    expect(team).toContain("data-bot-id=\"\"7\"\"");
    expect(team).toContain("data-sections=\"[{\"key\":\"bot\",\"label\":\"Chef's files\",\"root\":\"/files/bot\"},{\"key\":\"shared\",\"label\":\"Casa\",\"root\":\"/files/shared\"}]\"");
    const inChat = await card({ chat: kitchen });
    expect(inChat).toContain("data-chat=\"\"55\"\"");
    expect(inChat).toContain("data-sections=\"[{\"key\":\"chat\",\"label\":\"This chat\",\"root\":\"/files/chat\"},{\"key\":\"bot\"");
  });

  it("says on Team where its computers are, with the chats to open; from a chat, its computer there", async () => {
    shellPreferences.detailsTab = "computer";
    const team = await card();
    expect(team).toContain("Chef has its own computer in each chat it's in. Open one from that chat's details.");
    expect(team).toContain("aria-label=\"Open Kitchen reno\"");
    expect(team).toContain("aria-label=\"Open Chef\"");
    expect(team).not.toContain("data-stub=\"MercbotChatComputers\"");
    const inChat = await card({ chat: kitchen });
    expect(inChat).toContain("data-stub=\"MercbotChatComputers\"");
    expect(inChat).toContain("data-only-bot-id=\"\"7\"\"");
    expect(inChat).toContain("data-home-name=\"\"Casa\"\"");
    expect(inChat).not.toContain("has its own computer in each chat");
  });
});

describe("a bot's routines on its card", () => {
  const routine = (id, extra = {}) => ({ id, name: `Routine ${id}`, schedule: "Every Monday", enabled: true, botId: "7", chatId: "55", chatTitle: "Kitchen reno", madeBy: "1", canResume: false, ...extra });

  it("can be paused by anyone, resumed only by its maker, and deleted only by its maker", () => {
    expect(canSwitchRoutine(routine("1"))).toBe(true);
    expect(canSwitchRoutine(routine("1", { enabled: false }))).toBe(false);
    expect(canSwitchRoutine(routine("1", { enabled: false, canResume: true }))).toBe(true);
    const titles = (entry, me) => routineMenuItems(entry, me, { toggle() {}, edit() {}, remove() {} }).filter((item) => item.title).map((item) => item.title);
    expect(titles(routine("1"), "2")).toEqual(["Pause", "Edit"]);
    expect(titles(routine("1", { enabled: false }), "2")).toEqual(["Edit"]);
    expect(titles(routine("1", { enabled: false, canResume: true, madeBy: "2" }), "2")).toEqual(["Resume", "Edit", "Delete"]);
  });

  it("are the bot's in every chat on Team, and only this bot's in a chat", async () => {
    answers.byUrl.set("GET /api/w/casa/bots/7/routines", { routines: [routine("1"), routine("2", { chatId: "56", chatTitle: "Saturday party" })] });
    answers.byUrl.set("GET /api/w/casa/chats/55/routines", { routines: [routine("1"), routine("3", { botId: "8" })] });
    const failures = [];
    const options = (chat) => ({ bot: () => chef, chat: () => chat, me: () => "2", tab: computed(() => "details"), onEdit: () => {}, onFailure: (error) => failures.push(error) });
    const onTeam = useBotRoutines(options(null));
    const inChat = useBotRoutines(options(kitchen));
    await settled();
    expect(onTeam.routines.value.map((entry) => entry.chatTitle)).toEqual(["Kitchen reno", "Saturday party"]);
    expect(inChat.routines.value.map((entry) => entry.id), "Shopper's is left out").toEqual(["1"]);
    expect(failures).toEqual([]);
  });
});

describe("who can open a page in a bot's Library", () => {
  it("is everyone who can open its chat for a chat's page, and everyone in the home for the bot's or the home's", () => {
    expect(pageAccess("/files/chat/menu.html", { chatName: "Kitchen reno", homeName: "Casa" })).toMatchObject({
      title: "Everyone who can open “Kitchen reno”", text: "Everyone who can open “Kitchen reno” can open it.", onlyYou: false
    });
    expect(pageAccess("/files/chat/menu.md", { homeName: "Casa" }).title).toBe("Everyone who can open its chat");
    expect(pageAccess("/files/bot/menu.html", { chatName: "Kitchen reno", homeName: "Casa" }).title).toBe("Everyone in Casa");
    expect(pageAccess("/files/shared/menu.md", { homeName: "Casa" })).toMatchObject({ title: "Everyone in Casa", onlyYou: false });
  });
});

afterEach(() => {
  shellPreferences.detailsTab = "details";
});
