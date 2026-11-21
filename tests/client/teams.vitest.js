import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { addLabel, appsFor, botsToAdd, teamGroups } from "../../src/components/mercbot/teamChoice.js";
import { useNewBot } from "../../src/components/mercbot/useNewBot.js";

// Teams (D-105) and Add bots (D-109) on the page: the team screen lists the teams under For home and life and For
// work, adds the bots ticked that the home hasn't got and sets up each app asked for once. One bot joins the team and
// opens the person's direct chat with it, where it has said hello; Add N bots, a team's or a suggestion's, puts the
// bots on Team as the server answers them ({ bots, added, skipped }) and opens no chat (plan 5.2). The routes are a
// stand-in that records each call and answers what the server would.
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

/** useNewBot with the team and the shell as records of what it did to them. */
function newBot() {
  const done = { updated: [], loaded: 0, opened: [], notes: [] };
  const team = { updateBot: (bot) => done.updated.push(bot.id), loadBots: async () => { done.loaded += 1; } };
  const made = useNewBot({ team, openDirect: async (botId) => { done.opened.push(botId); }, notify: (text) => done.notes.push(text) });
  return { made, done };
}

describe("One bot", () => {
  it("joins the team and opens your direct chat with it, then sets up the app asked for", async () => {
    answers.byUrl.set("POST /api/w/casa/bots", { bot: { id: "12", name: "Chef" } });
    const { made, done } = newBot();
    made.openNewBot("Chef");
    expect([made.newBotOpen.value, made.newBotName.value, made.newBotScreen.value]).toEqual([true, "Chef", "start"]);
    await made.createBot({ name: "Chef", shape: "cloud", color: "#1E86FC", template: { library: "meal-planner" }, app: { key: "meals", name: "Meals" } });
    expect(calls).toEqual([
      ["POST", "/api/w/casa/bots", { name: "Chef", shape: "cloud", color: "#1E86FC", template: { library: "meal-planner" } }],
      ["POST", "/api/w/casa/apps-templates/meals/install", { sample: false }]
    ]);
    expect([done.updated, done.opened, made.newBotOpen.value, made.creating.value]).toEqual([["12"], ["12"], false, false]);
    expect(done.notes).toEqual(["The Meals app is set up as a draft in Apps for you to review and publish."]);
  });

  it("adds a bot a person shared from its link, and says when it couldn't be made, opening nothing", async () => {
    answers.byUrl.set("POST /api/w/casa/bots/from-template", { bot: { id: "13", name: "Otto" } });
    const { made, done } = newBot();
    made.openNewBot("", "otto-abc");
    await made.createBot({ name: "Otto", link: "otto-abc" });
    expect(calls).toEqual([["POST", "/api/w/casa/bots/from-template", { slug: "otto-abc" }]]);
    expect(done.opened).toEqual(["13"]);

    made.openNewBot();
    answers.fail = Object.assign(new Error("Bad gateway"), { status: 502 });
    await made.createBot({ name: "Chef" });
    expect([made.newBotOpen.value, made.createError.value, done.opened]).toEqual([true, "Your bot couldn't be created. Try again.", ["13"]]);
  });
});

describe("Add N bots", () => {
  it("puts a team's bots on Team as the server has them, opens no chat, says how many, then sets up the apps asked for", async () => {
    const listed = { bots: [{ id: "1" }, { id: "8" }, { id: "9" }], added: ["8", "9"], skipped: ["social-post-calendar"] };
    answers.byUrl.set("POST /api/w/casa/teams/shop", listed);
    const { made, done } = newBot();
    made.openTeams();
    expect([made.newBotOpen.value, made.newBotScreen.value]).toEqual([true, "teams"]);
    await made.addTeam({ teamId: "shop", templates: ["shop-stock-keeper", "review-replies"], apps: [{ key: "stock", name: "Stock" }] });
    expect(calls).toEqual([
      ["POST", "/api/w/casa/teams/shop", { templates: ["shop-stock-keeper", "review-replies"] }],
      ["POST", "/api/w/casa/apps-templates/stock/install", { sample: false }]
    ]);
    expect([done.updated, done.opened, made.newBotOpen.value]).toEqual([["1", "8", "9"], [], false]);
    expect(done.notes).toEqual([
      "Added 2 bots to your team. 1 already in this home was left out.",
      "The Stock app is set up as a draft in Apps for you to review and publish."
    ]);
  });

  it("adds a suggestion's bots ticked, with no section, and says a new template's problems when it's refused (D-109)", async () => {
    answers.byUrl.set("POST /api/w/casa/bots/batch", { bots: [{ id: "8" }], added: ["8"], skipped: [] });
    const { made, done } = newBot();
    made.openNewBot();
    const chosen = [{ library: "shop-stock-keeper" }, { draft: { tag: "rota" }, name: "Rota", shape: "storm", color: "#F59312" }];
    await made.addBots({ bots: chosen, apps: [] });
    expect(calls).toEqual([["POST", "/api/w/casa/bots/batch", { bots: chosen }]]);
    expect([made.newBotOpen.value, done.opened, done.notes]).toEqual([false, [], ["Added 1 bot to your team."]]);

    made.openNewBot();
    answers.fail = Object.assign(new Error("The template isn't ready to save: tag: Another template already has this tag."), { status: 422 });
    await made.addBots({ bots: chosen, apps: [] });
    expect([made.newBotOpen.value, made.createError.value]).toEqual([true, "The template isn't ready to save: tag: Another template already has this tag."]);
    answers.fail = Object.assign(new Error("Network request failed."), { status: 0 });
    await made.addBots({ bots: chosen, apps: [] });
    expect(made.createError.value).toBe("The bots couldn't be added. Try again.");
  });

  it("keeps the screen open with the server's words when every bot chosen is there already, and its own otherwise", async () => {
    const { made, done } = newBot();
    made.openTeams();
    answers.fail = Object.assign(new Error("Every bot you chose is already in this home."), { status: 409 });
    await made.addTeam({ teamId: "shop", templates: ["review-replies"] });
    expect([made.newBotOpen.value, made.createError.value, made.creating.value]).toEqual([true, "Every bot you chose is already in this home.", false]);
    answers.fail = Object.assign(new Error("Network request failed."), { status: 0 });
    await made.addTeam({ teamId: "shop", templates: ["review-replies"] });
    expect(made.createError.value).toBe("The team couldn't be added. Try again.");
    expect([done.updated, done.opened, done.notes]).toEqual([[], [], []]);
  });
});
