import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOME_FOR, SHARING_MODES, answerTeamQuestion, chooseHere, homeDefault, makeHome, readHere, teamQuestionWords
} from "../../src/components/mercbot/homeDefault.js";
import { botsApi } from "../../src/components/mercbot/botsApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { useSharingChoice } from "../../src/components/mercbot/useSharingChoice.js";

// A home's default for new bots (D-100) as the page uses it: the New home form's "Who's it for?", Settings → General's
// choice, the question once a second person joins, the bot list's read that brings it, and Who sees what in a home of
// one. The routes are a stand-in that records each call and answers what the server would.
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => ({ next: null, fail: false }));
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url, options = {}) {
      calls.push([options.method || "GET", url, options.body ?? null]);
      if (answers.fail) throw Object.assign(new Error("Only the home's owners and admins choose how new bots are shared."), { status: 403 });
      return typeof answers.next === "function" ? answers.next(url, options) : answers.next;
    }
  })
}));
// Whether the home has anyone else in it, as homesApi reads it: set per test.
const people = vi.hoisted(() => ({ others: false }));
vi.mock("../../src/components/mercbot/homesApi.js", async (importOriginal) => ({
  ...(await importOriginal()),
  hasOthers: async () => people.others
}));

const kept = (newBotSharing, teamQuestion = null) => ({ newBotSharing, chosen: true, teamQuestion });

beforeEach(() => {
  calls.length = 0;
  answers.next = null;
  answers.fail = false;
  setCurrentHome("casa");
  homeDefault.value = { newBotSharing: "mixed", chosen: false, teamQuestion: null };
});

describe("the New home form", () => {
  it("asks who it's for, Just me first, and sets the new home's default after making it", async () => {
    expect(HOME_FOR.map((choice) => [choice.label, choice.sharing])).toEqual([["Just me", "mixed"], ["Me and other people", "shared"]]);
    const made = [];
    const create = async (name) => {
      made.push(name);
      return { slug: "the smiths" };
    };
    answers.next = kept("shared");
    expect(await makeHome(create, "The Smiths", HOME_FOR[1].value)).toEqual({ slug: "the smiths" });
    expect(made).toEqual(["The Smiths"]);
    expect(calls).toEqual([["PATCH", "/api/w/the%20smiths/home-settings", { newBotSharing: "shared" }]]);

    calls.length = 0;
    await makeHome(create, "Just us", HOME_FOR[0].value);
    expect(calls).toEqual([["PATCH", "/api/w/the%20smiths/home-settings", { newBotSharing: "mixed" }]]);
    expect(homeDefault.value.chosen, "another home's default isn't the page's").toBe(false);
  });

  it("still gives the home made when its default doesn't go through: its first conversation asks", async () => {
    answers.fail = true;
    expect(await makeHome(async () => ({ slug: "casa-2" }), "Casa 2", HOME_FOR[1].value)).toEqual({ slug: "casa-2" });
  });
});

describe("Settings → General", () => {
  it("offers the three modes and shows what the server keeps", async () => {
    expect(SHARING_MODES.map((mode) => mode.label)).toEqual(["Private", "Mixed", "Shared"]);
    answers.next = kept("private");
    await chooseHere("private");
    expect(calls).toEqual([["PATCH", "/api/w/casa/home-settings", { newBotSharing: "private" }]]);
    expect(homeDefault.value).toEqual(kept("private"));
    answers.next = kept("shared");
    await readHere();
    expect(calls.at(-1)).toEqual(["GET", "/api/w/casa/home-settings", null]);
    expect(homeDefault.value.newBotSharing).toBe("shared");
  });

  it("keeps the default as it was when the server refuses", async () => {
    answers.fail = true;
    await expect(chooseHere("shared")).rejects.toMatchObject({ status: 403 });
    expect(homeDefault.value.newBotSharing).toBe("mixed");
  });
});

describe("the question once a second person joins", () => {
  it("comes with the bot list's read", async () => {
    const question = { name: "Kim", sharing: "mixed" };
    answers.next = { bots: [], sections: [], home: { newBotSharing: "mixed", chosen: false, teamQuestion: question } };
    await botsApi.list();
    expect(homeDefault.value.teamQuestion).toEqual(question);
    answers.next = { bots: [{ id: "4" }] };
    await botsApi.list();
    expect(homeDefault.value.teamQuestion, "a read without it leaves it").toEqual(question);
  });

  it("names who joined and the mode new bots have, and says bots already there keep theirs", () => {
    expect(teamQuestionWords({ name: "Kim", sharing: "mixed" })).toEqual({
      text: "Kim joined. New bots here are Mixed: each person's own chat, plus the home's notebook. Make new bots Shared, for the whole home?",
      note: "Bots you already have keep their mode; change one in its Details → Who sees what.",
      keep: "Keep Mixed"
    });
    const asPrivate = teamQuestionWords({ name: "Kim", sharing: "private" });
    expect([asPrivate.text, asPrivate.keep]).toEqual([
      "Kim joined. New bots here are Private: each person's own chat. Make new bots Shared, for the whole home?",
      "Keep Private"
    ]);
  });

  it("is answered once, either way, and then gone", async () => {
    homeDefault.value = { newBotSharing: "mixed", chosen: false, teamQuestion: { name: "Kim", sharing: "mixed" } };
    answers.next = kept("shared");
    await answerTeamQuestion("shared");
    expect(calls).toEqual([["POST", "/api/w/casa/home-settings/team-question", { answer: "shared" }]]);
    expect(homeDefault.value).toEqual(kept("shared"));
    answers.next = kept("mixed");
    await answerTeamQuestion("keep");
    expect(calls.at(-1)[2]).toEqual({ answer: "keep" });
    expect(homeDefault.value.teamQuestion).toBe(null);
  });
});

describe("Who sees what in a home of one", () => {
  const shownFor = async (sharing) => {
    const choice = useSharingChoice({ bot: () => ({ name: "Otto", sharing }), home: ref({ slug: "casa", name: "Casa" }), onChoose: () => {} });
    await Promise.resolve();
    await nextTick();
    return choice.shown.value;
  };

  it("is hidden for a bot on the home's default, whatever that is, so a bot can always be set back to it", async () => {
    people.others = false;
    homeDefault.value = kept("shared");
    expect([await shownFor("shared"), await shownFor("mixed"), await shownFor("private")]).toEqual([false, true, true]);
    homeDefault.value = kept("private");
    expect([await shownFor("private"), await shownFor("mixed")]).toEqual([false, true]);
    people.others = true;
    expect(await shownFor("private"), "with anyone else in the home, always shown").toBe(true);
  });
});
