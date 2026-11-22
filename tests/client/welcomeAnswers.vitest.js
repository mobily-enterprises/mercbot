import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

// The welcome chat's "What is this home for?" (D-109, B's onboarding.js): the card's answer says where Add bots opens,
// "describe" (Describe what you need) or "teams" (the ready-made teams), or null for Not now; the welcome chat carries
// on by itself, so no reply is asked for.
const answered = vi.hoisted(() => ({ result: null, replies: 0 }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    answer: async () => answered.result,
    reply: async () => {
      answered.replies += 1;
      return { messages: [] };
    }
  }
}));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({ botsApi: {} }));
const { useChatActions } = await import("../../src/components/mercbot/useChatActions.js");

function actions() {
  const opened = [];
  const chat = ref({ id: "9", kind: "private", directBotId: "1", onboardingStep: "home-for", people: [{ userId: "2", name: "Anna" }], bots: [] });
  const made = useChatActions({
    currentChat: chat,
    store: { messagesByChat: ref({}), updateChat: () => {}, appendMessages: () => {}, replaceMessage: () => {}, removeMessage: () => {} },
    work: { playMood: () => {}, requestReply: async () => { answered.replies += 1; }, describeWork: () => {} },
    reportFailure: (text, error) => { throw error || new Error(text); },
    notify: () => {},
    openAddBots: (screen) => opened.push(screen),
    me: () => "2"
  });
  return { made, opened };
}

describe("what the home is for", () => {
  it("opens Add bots on Describe what you need, or on its teams, as the answer says, and asks for no reply", async () => {
    answered.replies = 0;
    for (const addBots of ["describe", "teams"]) {
      const { made, opened } = actions();
      answered.result = { messages: [], addBots };
      await made.answerChoice({ message: { id: "5" }, selected: ["x"] });
      expect(opened).toEqual([addBots]);
    }
    expect(answered.replies).toBe(0);
  });

  it("opens nothing for Not now", async () => {
    const { made, opened } = actions();
    answered.result = { messages: [], addBots: null };
    await made.answerChoice({ message: { id: "5" }, selected: ["later"] });
    expect(opened).toEqual([]);
  });
});
