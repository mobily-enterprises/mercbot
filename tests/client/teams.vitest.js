import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ONBOARDING_TIMING } from "../../src/components/mercbot/botsApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { addLabel, appsFor, botsToAdd, teamGroups } from "../../src/components/mercbot/teamChoice.js";
import { useChatActions } from "../../src/components/mercbot/useChatActions.js";
import { useNewBot } from "../../src/components/mercbot/useNewBot.js";

// Teams (D-105) on the page: the team screen lists the teams under For home and life and For work (D-109), adds the bots
// ticked that the home hasn't got and sets up each app asked for once; Add N bots, a team's or a suggestion's (D-109),
// puts the list and its sections as the server answers them and opens the first new bot; and the first conversation's card opens Add bots on its teams
// without asking the bot for a reply. The routes are a stand-in that records each call and answers what the server
// would.
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => ({ byUrl: new Map(), fail: null }));
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url, options = {}) {
      calls.push([options.method || "GET", url, options.body ?? null]);
      if (answers.fail) throw answers.fail;
      return answers.byUrl.get(`${options.method || "GET"} ${url}`) ?? null;
    }
  })
}));

const shop = {
  id: "shop",
  name: "Small shop",
  bots: [
    { slug: "shop-stock-keeper", name: "Restock", appTemplate: "stock", inHome: false },
    { slug: "social-post-calendar", name: "Chorus", inHome: true },
    { slug: "review-replies", name: "Kindly", inHome: false },
    { slug: "customer-follow-up", name: "Rapport", appTemplate: "crm", inHome: false },
    { slug: "receipts-and-invoices", name: "Docket", appTemplate: "stock", inHome: false }
  ]
};

beforeEach(() => {
  calls.length = 0;
  answers.byUrl = new Map();
  answers.fail = null;
  setCurrentHome("casa");
});

describe("the team screen", () => {
  it("adds the bots ticked that the home hasn't got, in the team's order, and says how many", () => {
    expect(botsToAdd(shop, new Set()).map((bot) => bot.name)).toEqual(["Restock", "Kindly", "Rapport", "Docket"]);
    expect(botsToAdd(shop, new Set(["review-replies"])).map((bot) => bot.name)).toEqual(["Restock", "Rapport", "Docket"]);
    expect(botsToAdd(null, new Set())).toEqual([]);
    expect([addLabel(1, false), addLabel(4, false), addLabel(4, true)]).toEqual(["Add 1 bot", "Add 4 bots", "Adding…"]);
  });

  it("sets up each app asked for once, only for the bots added, and none for someone who may not", () => {
    const apps = new Map([["stock", { key: "stock", name: "Stock" }], ["crm", { key: "crm", name: "Customers" }]]);
    const adding = botsToAdd(shop, new Set());
    expect(appsFor(adding, apps, new Set()).map((app) => app.key)).toEqual(["stock", "crm"]);
    expect(appsFor(adding, apps, new Set(["shop-stock-keeper"])).map((app) => app.key), "Docket, after Rapport, still wants it").toEqual(["crm", "stock"]);
    expect(appsFor(adding, apps, new Set(["shop-stock-keeper", "receipts-and-invoices"])).map((app) => app.key)).toEqual(["crm"]);
    expect(appsFor(adding, new Map(), new Set())).toEqual([]);
  });
});

describe("the list of teams", () => {
  it("lists the teams for home and life, then those for work, each in the gallery's order, and no empty heading", () => {
    const teams = [{ id: "family-home", for: "home" }, { id: "shop", for: "work" }, { id: "just-me", for: "home" }, { id: "sales", for: "work" }];
    expect(teamGroups(teams).map((group) => [group.name, group.teams.map((team) => team.id)])).toEqual([
      ["For home and life", ["family-home", "just-me"]],
      ["For work", ["shop", "sales"]]
    ]);
    expect(teamGroups(teams.filter((team) => team.for === "work")).map((group) => group.name)).toEqual(["For work"]);
  });
});

describe("Add N bots", () => {
  /** useNewBot with its collaborators as records of what it did to them. */
  function newBot() {
    const done = { merged: [], selected: [], notes: [] };
    const bots = ref([{ id: "1", name: "Mercbot" }]);
    const sections = ref([]);
    const picker = ref({ botIds: [] });
    const store = { mergeBots: (list) => done.merged.push(list), addBot: () => {} };
    const made = useNewBot({ bots, sections, store, picker, selectBot: (id) => done.selected.push(id), notify: (text) => done.notes.push(text) });
    return { made, done, sections, picker };
  }

  it("puts the list and its sections as the server has them, opens the first new bot, then sets up the apps asked for", async () => {
    const listed = { bots: [{ id: "1" }, { id: "8" }, { id: "9" }], sections: [{ id: "3", name: "Small shop" }], added: ["8", "9"], skipped: ["social-post-calendar"], sectionId: "3" };
    answers.byUrl.set("POST /api/w/casa/teams/shop", listed);
    const { made, done, sections, picker } = newBot();
    made.openTeams();
    expect([made.newBotOpen.value, made.newBotScreen.value]).toEqual([true, "teams"]);
    await made.addTeam({ teamId: "shop", name: "Small shop", templates: ["shop-stock-keeper", "review-replies"], apps: [{ key: "stock", name: "Stock" }] });
    expect(calls).toEqual([
      ["POST", "/api/w/casa/teams/shop", { templates: ["shop-stock-keeper", "review-replies"] }],
      ["POST", "/api/w/casa/apps-templates/stock/install", { sample: false }]
    ]);
    expect(done.merged).toEqual([listed.bots]);
    expect(sections.value).toEqual(listed.sections);
    expect([made.newBotOpen.value, picker.value, done.selected]).toEqual([false, null, ["8"]]);
    expect(done.notes).toEqual([
      "2 bots added to Small shop. 1 already in this home was left out.",
      "The Stock app is set up as a draft in Apps for you to review and publish."
    ]);
  });

  it("adds a suggestion's bots ticked in the section named, and says a new template's problems when it's refused (D-109)", async () => {
    const listed = { bots: [{ id: "1" }, { id: "8" }, { id: "9" }], sections: [{ id: "4", name: "Shop" }], added: ["8", "9"], skipped: [], sectionId: "4" };
    answers.byUrl.set("POST /api/w/casa/bots/batch", listed);
    const { made, done, sections } = newBot();
    made.openNewBot();
    const chosen = [{ library: "shop-stock-keeper" }, { draft: { tag: "rota" }, name: "Rota", shape: "storm", color: "#F59312" }];
    await made.addBots({ section: "Shop", bots: chosen, apps: [] });
    expect(calls).toEqual([["POST", "/api/w/casa/bots/batch", { section: "Shop", bots: chosen }]]);
    expect([sections.value, made.newBotOpen.value, done.selected, done.notes]).toEqual([listed.sections, false, ["8"], ["2 bots added to Shop."]]);

    made.openNewBot();
    answers.fail = Object.assign(new Error("The template isn't ready to save: tag: Another template already has this tag."), { status: 422 });
    await made.addBots({ section: "Shop", bots: chosen, apps: [] });
    expect([made.newBotOpen.value, made.createError.value]).toEqual([true, "The template isn't ready to save: tag: Another template already has this tag."]);
    answers.fail = Object.assign(new Error("Network request failed."), { status: 0 });
    await made.addBots({ section: "Shop", bots: chosen, apps: [] });
    expect(made.createError.value).toBe("The bots couldn't be added. Try again.");
  });

  it("keeps the screen open with the server's words when every bot chosen is there already, and its own otherwise", async () => {
    const { made, done } = newBot();
    made.openTeams();
    answers.fail = Object.assign(new Error("Every bot you chose is already in this home."), { status: 409 });
    await made.addTeam({ teamId: "shop", name: "Small shop", templates: ["review-replies"] });
    expect([made.newBotOpen.value, made.createError.value, made.creating.value]).toEqual([true, "Every bot you chose is already in this home.", false]);
    answers.fail = Object.assign(new Error("Network request failed."), { status: 0 });
    await made.addTeam({ teamId: "shop", name: "Small shop", templates: ["review-replies"] });
    expect(made.createError.value).toBe("The team couldn't be added. Try again.");
    expect(done.selected).toEqual([]);
  });
});

describe("the first conversation's card", () => {
  it("opens Add bots on its teams and asks the bot for no reply; Not now carries on", async () => {
    const opened = [];
    const replies = [];
    const actions = useChatActions({
      currentBot: computed(() => ({ id: "1", kind: "bot" })),
      picker: ref(null),
      startGroup: async () => {},
      store: { messagesByBot: ref({}), updateBot: () => {}, appendMessages: () => {}, replaceMessage: () => {}, removeMessage: () => {} },
      work: { playMood: () => {}, requestReply: async (botId) => replies.push(botId), describeWork: () => {} },
      reportFailure: () => {},
      notify: () => {},
      openTeams: () => opened.push("teams")
    });
    const card = { id: "40" };
    answers.byUrl.set("POST /api/w/casa/bots/1/choices/40", { bot: { id: "1", onboardingStep: "about" }, messages: [], addBots: "teams" });
    await actions.answerChoice({ message: card, selected: ["Show me ready-made teams"] });
    answers.byUrl.set("POST /api/w/casa/bots/1/choices/40", { bot: { id: "1", onboardingStep: "about" }, messages: [], addBots: null });
    await actions.answerChoice({ message: card, selected: ["Not now"] });
    expect([opened, replies]).toEqual([["teams"], []]);
    expect(ONBOARDING_TIMING["team-offer"], "the card's step runs on its own, as the home's default's does").toBeTruthy();
  });
});
