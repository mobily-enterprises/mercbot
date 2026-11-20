import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOIN_IN, chooseJoinIn, homeDefault } from "../../src/components/mercbot/homeDefault.js";
import { botsApi } from "../../src/components/mercbot/botsApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { useBotWork } from "../../src/components/mercbot/useBotWork.js";
import { useChatActions } from "../../src/components/mercbot/useChatActions.js";

// Bots decide when to join in (D-102) as the page has it: Settings → General's switch and its words, and a Shared
// bot's shared tab, where a message may be left to the people, so the page shows the bot working, and asks what it's
// doing, only once the server says it started; a reply with nothing in it shows nothing, and the reply after a card's
// answer says so. The routes are a stand-in that records each call and answers what the server would.
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => ({ next: null }));
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url, options = {}) {
      calls.push([options.method || "GET", url, options.body ?? null]);
      return typeof answers.next === "function" ? answers.next(url, options) : answers.next;
    }
  })
}));

const SHARED = { id: "7", kind: "bot", name: "Ledger", sharing: "shared", rooms: [{ id: "21", title: "General" }, { id: "30", own: true }] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls.length = 0;
  answers.next = null;
  setCurrentHome("casa");
  homeDefault.value = { newBotSharing: "mixed", chosen: false, teamQuestion: null, botsJoinIn: true };
});
afterEach(() => vi.restoreAllMocks());

describe("Settings → General's switch", () => {
  it("is named, says what each position means, and turns joining in off and on for the home", async () => {
    expect(JOIN_IN).toEqual({
      label: "Bots decide when to join in",
      on: "In shared tabs, bots answer when it makes sense, without being called.",
      off: "In shared tabs, bots answer only when named, @-mentioned or replied to."
    });
    answers.next = (_url, options) => ({ newBotSharing: "mixed", chosen: false, teamQuestion: null, ...options.body });
    expect((await chooseJoinIn(false)).botsJoinIn).toBe(false);
    expect(homeDefault.value.botsJoinIn, "the page shows what the server keeps").toBe(false);
    await chooseJoinIn(true);
    expect(calls).toEqual([
      ["PATCH", "/api/w/casa/home-settings", { botsJoinIn: false }],
      ["PATCH", "/api/w/casa/home-settings", { botsJoinIn: true }]
    ]);
    expect(homeDefault.value.botsJoinIn).toBe(true);
  });
});

/** The page's bot work for one Shared bot open on `roomId`, its store a stand-in that records what it was given. */
function pageWith(roomId = "21") {
  const bots = ref([{ ...SHARED, roomId }]);
  const appended = [];
  const updated = [];
  const store = {
    messagesByBot: ref({ 7: [{ id: "100", kind: "text", role: "user", body: { text: "Yes, see you at seven." } }] }),
    roomOf: () => roomId,
    updateBot: (bot) => updated.push(bot),
    appendMessages: (_botId, messages) => appended.push(...messages)
  };
  return { bots, store, appended, updated, work: useBotWork({ bots, store }) };
}

describe("a reply in a shared tab", () => {
  it("left to the people shows nothing: no mood, no working line, no message", async () => {
    vi.useFakeTimers();
    try {
      const { work, appended, updated } = pageWith();
      const reply = vi.spyOn(botsApi, "reply").mockResolvedValue({ bot: { id: "7", lastActivityAt: "now" }, messages: [] });
      const onStart = vi.fn();
      const done = work.requestReply("7", { untilStarted: true, onStart });
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(reply).toHaveBeenCalledWith("7", "100", "21", { afterCard: false });
      expect([work.moodByBot.value[7], work.workByBot.value[7], onStart.mock.calls.length]).toEqual([undefined, undefined, 0]);
      expect(appended).toEqual([]);
      expect(updated).toEqual([{ id: "7", lastActivityAt: "now" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the bot working once the server says it started there, then its answer", async () => {
    vi.useFakeTimers();
    try {
      const { work, appended } = pageWith();
      let answer;
      vi.spyOn(botsApi, "reply").mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const onStart = vi.fn();
      const done = work.requestReply("7", { untilStarted: true, onStart });
      await vi.advanceTimersByTimeAsync(1000);
      expect([work.moodByBot.value[7], work.workByBot.value[7]], "nothing yet").toEqual([undefined, undefined]);
      work.workStarted("7");
      expect([work.moodByBot.value[7], onStart.mock.calls.length]).toEqual(["attention", 1]);
      await vi.advanceTimersByTimeAsync(300);
      expect(work.workByBot.value[7]).toBe("Thinking it over");
      work.workStarted("7");
      expect(onStart.mock.calls.length, "once").toBe(1);
      answer({ bot: { id: "7" }, messages: [{ id: "101", kind: "text", role: "bot", body: { text: "The shop opens at 10." } }] });
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(appended.map((message) => message.id)).toEqual(["101"]);
      expect(work.workByBot.value[7]).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("in the person's own chat shows it working at once, as before", async () => {
    vi.useFakeTimers();
    try {
      const { work } = pageWith("30");
      vi.spyOn(botsApi, "reply").mockReturnValue(new Promise(() => {}));
      work.requestReply("7");
      expect(work.moodByBot.value[7]).toBe("attention");
      await vi.advanceTimersByTimeAsync(300);
      expect(work.workByBot.value[7]).toBe("Thinking it over");
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The chat's actions for `bot`, its work a stand-in that records what it was asked. */
function actionsFor(bot) {
  const asked = [];
  const described = [];
  const work = {
    playMood: () => {},
    requestReply: async (botId, options) => asked.push([botId, options]),
    describeWork: (botId, messageId) => described.push([botId, messageId])
  };
  const store = {
    messagesByBot: ref({}),
    updateBot: () => {},
    appendMessages: () => {},
    replaceMessage: () => {},
    removeMessage: () => {}
  };
  const actions = useChatActions({
    currentBot: ref(bot), picker: ref(null), startGroup: async () => {}, store, work, reportFailure: () => {}, notify: () => {}
  });
  return { actions, asked, described };
}

describe("sending", () => {
  it("in a shared tab asks what the bot is doing only once it started", async () => {
    vi.spyOn(botsApi, "send").mockResolvedValue({ bot: { id: "7" }, messages: [{ id: "101", kind: "text", role: "user", body: { text: "Hi" } }] });
    const { actions, asked, described } = actionsFor({ ...SHARED, roomId: "21" });
    await actions.send({ text: "Hi" });
    expect(asked.map(([botId, options]) => [botId, options.untilStarted])).toEqual([["7", true]]);
    expect(described, "not yet").toEqual([]);
    asked[0][1].onStart();
    expect(described).toEqual([["7", "101"]]);
  });

  it("in You only, a Private or Mixed bot's chat or a group, as before", async () => {
    vi.spyOn(botsApi, "send").mockResolvedValue({ bot: { id: "7" }, messages: [{ id: "101", kind: "text", role: "user", body: { text: "Hi" } }] });
    for (const bot of [{ ...SHARED, roomId: "30" }, { id: "7", kind: "bot", sharing: "mixed", roomId: null }]) {
      const { actions, asked, described } = actionsFor(bot);
      await actions.send({ text: "Hi" });
      expect([asked, described]).toEqual([[["7", undefined]], [["7", "101"]]]);
    }
    const group = actionsFor({ id: "9", kind: "group", sharing: "private", roomId: null });
    await group.actions.send({ text: "Hi" });
    expect([group.asked, group.described]).toEqual([[["9", undefined]], []]);
  });

  it("a card's answer asks for the reply that always follows it", async () => {
    vi.spyOn(botsApi, "answer").mockResolvedValue({ bot: { id: "7" }, messages: [] });
    const { actions, asked } = actionsFor({ ...SHARED, roomId: "21" });
    await actions.answerChoice({ message: { id: "90" }, selected: ["Yes"] });
    await settle();
    expect(asked).toEqual([["7", { afterCard: true }]]);
  });
});
