import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatsApi } from "../../src/components/mercbot/chatsApi.js";
import { useChatActions } from "../../src/components/mercbot/useChatActions.js";
import { useChatWork } from "../../src/components/mercbot/useChatWork.js";

// How a chat's bots answer what's written (R3, D-112), as the page has it: in a chat of one person every bot answers,
// so the page shows them working at once; with several people only the bots called answer, and maybe none, so the page
// shows a bot working, and asks what it's doing, only once the server says one started; a reply with nothing in it shows
// nothing; a chat of people only asks for no reply; and the reply after a card's answer says so. The chat routes are
// stand-ins that record each call.
vi.mock("@jskit-ai/http-runtime/client", () => ({ createHttpClient: () => ({ request: async () => ({}) }) }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  chatsApi: { reply: vi.fn(), activity: vi.fn(), send: vi.fn(), answer: vi.fn() }
}));

const KIM = { userId: "1", name: "Kim Lee" };
const ADA = { userId: "2", name: "Ada Byron" };
const member = (botId, name, extra = {}) => ({ chatBotId: `m${botId}`, botId, name, color: "#1E86FC", shape: "cloud", archived: false, waitingTask: null, ...extra });
const OTTO = member("b1", "Otto");
const VERA = member("b2", "Vera");

/** Chat 7, with Kim and Ada and Otto unless told otherwise. */
const chatOf = (extra = {}) => ({ id: "7", kind: "public", title: "Kitchen", everyone: false, directBotId: null, onboardingStep: null, people: [KIM, ADA], bots: [OTTO], ...extra });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => vi.clearAllMocks());

/** The page's work for chat 7, its store a stand-in that records what it was given. */
function pageWith() {
  const appended = [];
  const updated = [];
  const store = {
    messagesByChat: ref({ 7: [{ id: "100", kind: "text", role: "user", authorUserId: "1", authorBotId: null, body: { text: "Yes, see you at seven." } }] }),
    updateChat: (chat) => updated.push(chat),
    appendMessages: (_chatId, messages) => appended.push(...messages),
    replaceMessage: () => {}
  };
  return { appended, updated, work: useChatWork({ store }) };
}

describe("a reply in a chat where only the bots called answer", () => {
  it("left to the people shows nothing: no mood, no working line, no message", async () => {
    vi.useFakeTimers();
    try {
      const { work, appended, updated } = pageWith();
      chatsApi.reply.mockResolvedValue({ chat: { id: "7", lastActivityAt: "now" }, messages: [] });
      const onStart = vi.fn();
      const done = work.requestReply("7", { untilStarted: true, onStart });
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(chatsApi.reply).toHaveBeenCalledWith("7", "100", { afterCard: false });
      expect([work.moodByChat.value[7], work.workByChat.value[7], onStart.mock.calls.length]).toEqual([undefined, undefined, 0]);
      expect(appended).toEqual([]);
      expect(updated).toEqual([{ id: "7", lastActivityAt: "now" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the bot working once the server says one started there, then its answer", async () => {
    vi.useFakeTimers();
    try {
      const { work, appended } = pageWith();
      let answer;
      chatsApi.reply.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const onStart = vi.fn();
      const done = work.requestReply("7", { untilStarted: true, onStart });
      await vi.advanceTimersByTimeAsync(1000);
      expect([work.moodByChat.value[7], work.workByChat.value[7]], "nothing yet").toEqual([undefined, undefined]);
      work.workStarted("7");
      expect([work.moodByChat.value[7], onStart.mock.calls.length]).toEqual(["attention", 1]);
      await vi.advanceTimersByTimeAsync(300);
      expect(work.workByChat.value[7]).toBe("Thinking it over");
      work.workStarted("7");
      expect(onStart.mock.calls.length, "once").toBe(1);
      answer({ chat: { id: "7" }, messages: [{ id: "101", kind: "text", role: "bot", authorUserId: null, authorBotId: "b1", body: { text: "The shop opens at 10." } }] });
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(appended.map((message) => message.id)).toEqual(["101"]);
      expect(work.workByChat.value[7]).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("in a chat of one person shows it working at once", async () => {
    vi.useFakeTimers();
    try {
      const { work } = pageWith();
      chatsApi.reply.mockReturnValue(new Promise(() => {}));
      work.requestReply("7");
      expect(work.moodByChat.value[7]).toBe("attention");
      await vi.advanceTimersByTimeAsync(300);
      expect(work.workByChat.value[7]).toBe("Thinking it over");
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The open chat's actions, its work a stand-in that records what it was asked. */
function actionsFor(chat) {
  const asked = [];
  const described = [];
  const work = {
    playMood: () => {},
    requestReply: async (chatId, options) => asked.push([chatId, options]),
    describeWork: (chatId, messageId) => described.push([chatId, messageId])
  };
  const store = {
    messagesByChat: ref({}),
    updateChat: () => {},
    appendMessages: () => {},
    replaceMessage: () => {},
    removeMessage: () => {}
  };
  const actions = useChatActions({
    currentChat: ref(chat), store, work,
    reportFailure: () => {}, notify: () => {}, openAddBots: () => {}, me: () => "1"
  });
  return { actions, asked, described };
}

const sent = { messages: [{ id: "101", kind: "text", role: "user", authorUserId: "1", authorBotId: null, body: { text: "Hi" } }] };

describe("sending", () => {
  it("with several people in the chat, asks what the bot is doing only once one started", async () => {
    chatsApi.send.mockResolvedValue(sent);
    const { actions, asked, described } = actionsFor(chatOf());
    await actions.send({ text: "Hi" });
    expect(chatsApi.send.mock.calls[0][0]).toBe("7");
    expect(asked.map(([chatId, options]) => [chatId, options.untilStarted])).toEqual([["7", true]]);
    expect(described, "not yet").toEqual([]);
    asked[0][1].onStart();
    expect(described).toEqual([["7", "101"]]);
  });

  it("with one person, asks every bot at once, says what one bot is doing straight away, and asks a chat of people only for nothing", async () => {
    chatsApi.send.mockResolvedValue(sent);
    const alone = actionsFor(chatOf({ people: [KIM] }));
    await alone.actions.send({ text: "Hi" });
    expect([alone.asked, alone.described]).toEqual([[["7", undefined]], [["7", "101"]]]);

    const twoBots = actionsFor(chatOf({ people: [KIM], bots: [OTTO, VERA] }));
    await twoBots.actions.send({ text: "Hi" });
    expect([twoBots.asked, twoBots.described]).toEqual([[["7", undefined]], []]);

    for (const bots of [[], [member("b3", "Pip", { archived: true })]]) {
      const people = actionsFor(chatOf({ bots }));
      await people.actions.send({ text: "Hi" });
      expect([people.asked, people.described], "no bot to answer").toEqual([[], []]);
    }
  });

  it("a card's answer asks for the reply that always follows it, unless the welcome chat carries on by itself", async () => {
    chatsApi.answer.mockResolvedValue({ messages: [] });
    const { actions, asked } = actionsFor(chatOf());
    await actions.answerChoice({ message: { id: "90" }, selected: ["Yes"] });
    await settle();
    expect(chatsApi.answer).toHaveBeenCalledWith("7", "90", ["Yes"]);
    expect(asked).toEqual([["7", { afterCard: true }]]);

    const welcome = actionsFor(chatOf({ onboardingStep: "name" }));
    await welcome.actions.answerChoice({ message: { id: "91" }, selected: ["Otto"] });
    await settle();
    expect(welcome.asked).toEqual([]);
  });
});
