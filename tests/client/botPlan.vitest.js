import { describe, expect, it } from "vitest";
import { firstQuestions, useBotPlan } from "../../src/components/mercbot/useBotPlan.js";

// Add bots' suggestions on the page (D-109): a plan shows at once, every bot ticked but those already in the home, and
// each new bot's template is written one call each, all at once; Add waits for the ones ticked; one that couldn't be
// written says why, to try again or remove; a change keeps the templates written for the new bots it keeps, and a
// template that answers after its plan changed is dropped. The routes are a stand-in whose answers each test releases.

/** A stand-in for the two routes: each call waits until the test answers it. */
function routes() {
  const asked = [];
  const call = (route) => (body) => new Promise((resolve, reject) => asked.push({ route, body, resolve, reject }));
  return { asked, api: { suggestBots: call("plan"), draftTemplate: call("draft") } };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const bot = (key, extra = {}) => ({ key, name: key.split(":")[1], tag: key.split(":")[1].slice(0, 10), description: `Does ${key}.`, shape: "cloud", color: "#1E86FC", inHome: false, ...extra });
const PLAN = {
  name: "Shop",
  summary: "Stock and a rota",
  question: null,
  bots: [
    bot("library:shop-stock-keeper", { library: "shop-stock-keeper" }),
    bot("library:review-replies", { library: "review-replies", inHome: true }),
    bot("new:rota", { new: true }),
    bot("new:payroll", { new: true })
  ],
  covered: []
};
const draftOf = (tag) => ({ tag, description: "A job.", greeting: "Hi {firstName}.", instructions: "You do it. Ask before anything leaves this chat.", skills: [] });

describe("a suggestion on the page", () => {
  it("shows the plan at once, writes every new bot's template at the same time, and Add waits for those ticked", async () => {
    const { asked, api } = routes();
    const planner = useBotPlan({ api });
    const suggesting = planner.suggest("a shop with a rota");
    expect(planner.asking.value).toBe(true);
    asked[0].resolve({ plan: PLAN });
    await suggesting;
    expect(asked[0].body).toEqual({ describe: "a shop with a rota" });
    expect([planner.describe.value, planner.section.value, planner.asking.value]).toEqual(["a shop with a rota", "Shop", false]);
    expect(planner.adding.value.map((entry) => entry.key), "all but the one in the home").toEqual(["library:shop-stock-keeper", "new:rota", "new:payroll"]);
    expect(asked.slice(1).map((call) => [call.route, call.body.bot.name]), "both at once").toEqual([["draft", "rota"], ["draft", "payroll"]]);
    expect(asked[1].body).toEqual({
      purpose: "plan-bot",
      describe: "a shop with a rota",
      bot: { name: "rota", tag: "rota", description: "Does new:rota." },
      team: PLAN.bots.filter((entry) => entry.key !== "new:rota").map((entry) => ({ name: entry.name, description: entry.description }))
    });
    expect(planner.drafts.value["new:rota"].state).toBe("writing");
    expect(planner.ready.value).toBe(false);

    asked[1].resolve({ draft: draftOf("rota") });
    await settled();
    expect(planner.ready.value, "payroll is still being written").toBe(false);
    asked[2].resolve({ draft: draftOf("payroll") });
    await settled();
    expect(planner.ready.value).toBe(true);
    expect(planner.batch.value).toEqual({
      section: "Shop",
      bots: [
        { library: "shop-stock-keeper" },
        { draft: draftOf("rota"), name: "rota", shape: "cloud", color: "#1E86FC" },
        { draft: draftOf("payroll"), name: "payroll", shape: "cloud", color: "#1E86FC" }
      ]
    });
    planner.section.value = "  ";
    expect(planner.ready.value, "a section's name is needed").toBe(false);
  });

  it("says when a template couldn't be written, to try again or remove; Edit's template takes its place", async () => {
    const { asked, api } = routes();
    const planner = useBotPlan({ api });
    const suggesting = planner.suggest("a shop");
    asked[0].resolve({ plan: PLAN });
    await suggesting;
    asked[1].reject(Object.assign(new Error("Couldn't write a template from that. Try different words."), { status: 422 }));
    asked[2].reject(Object.assign(new Error("Bad gateway"), { status: 502 }));
    await settled();
    expect([planner.drafts.value["new:rota"], planner.drafts.value["new:payroll"]]).toEqual([
      { state: "failed", message: "Couldn't write a template from that. Try different words." },
      { state: "failed", message: "It couldn't be written just now." }
    ]);
    planner.tick("new:payroll");
    expect(planner.adding.value.map((entry) => entry.key)).toEqual(["library:shop-stock-keeper", "new:rota"]);
    planner.write("new:rota");
    expect(planner.drafts.value["new:rota"].state).toBe("writing");
    asked[3].resolve({ draft: draftOf("rota") });
    await settled();
    expect(planner.ready.value).toBe(true);
    planner.useDraft("new:rota", draftOf("rota2"));
    expect(planner.batch.value.bots[1].draft.tag).toBe("rota2");
  });

  it("a change keeps the templates written for the new bots it keeps; one answering after the plan changed is dropped", async () => {
    const { asked, api } = routes();
    const planner = useBotPlan({ api });
    const first = planner.suggest("a shop");
    asked[0].resolve({ plan: PLAN });
    await first;
    asked[1].resolve({ draft: draftOf("rota") });
    await settled();

    const changed = { ...PLAN, bots: [PLAN.bots[0], PLAN.bots[2], bot("new:hiring", { new: true })] };
    const changing = planner.suggest("a shop", "and hiring, no payroll");
    expect(asked[3].body).toEqual({ describe: "a shop", plan: PLAN, change: "and hiring, no payroll" });
    asked[3].resolve({ plan: changed });
    await changing;
    expect(planner.describe.value, "what was described stays").toBe("a shop");
    expect(asked.slice(4).map((call) => call.body.bot.name), "only the new one is written").toEqual(["hiring"]);
    expect(planner.drafts.value["new:rota"]).toEqual({ state: "ready", draft: draftOf("rota") });
    asked[2].resolve({ draft: draftOf("payroll") });
    await settled();
    expect(planner.drafts.value["new:payroll"], "payroll's plan is gone").toBeUndefined();
  });

  it("a question is shown, with nothing to write, and a failure says why", async () => {
    const { asked, api } = routes();
    const planner = useBotPlan({ api });
    const asking = planner.suggest("my business");
    asked[0].resolve({ plan: { name: "New bots", summary: "", question: "What do you sell?", bots: [], covered: [] } });
    expect(await asking).toMatchObject({ question: "What do you sell?" });
    expect([planner.question.value, asked.length, planner.ready.value]).toEqual(["What do you sell?", 1, false]);

    const refused = planner.suggest("x");
    asked[1].reject(Object.assign(new Error("That's longer than 600 characters. Say it more briefly."), { status: 400 }));
    expect(await refused).toBe(null);
    expect(planner.failure.value).toBe("That's longer than 600 characters. Say it more briefly.");
    const failed = planner.suggest("x");
    asked[2].reject(Object.assign(new Error("Bad gateway"), { status: 502 }));
    await failed;
    expect(planner.failure.value).toBe("Mercbot couldn't suggest bots just now. Try again.");
  });
});

describe("what a new bot asks first", () => {
  it("is its Setup interview's first three steps, each its first clause, without Ask", () => {
    const draft = {
      skills: [
        { name: "Weekly rota", instructions: "1. Ask nothing." },
        { name: "Setup interview", instructions: "1. Ask about the opening hours (days and times).\n2. Ask the person who works when; save it.\n3. Ask them how far ahead to plan?\n4. Ask more." }
      ]
    };
    expect(firstQuestions(draft)).toEqual(["The opening hours", "Who works when", "How far ahead to plan"]);
    expect(firstQuestions({ skills: [] })).toEqual([]);
    expect(firstQuestions(null)).toEqual([]);
  });
});
