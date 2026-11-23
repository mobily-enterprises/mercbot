import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Someone typing in a chat (useChatTyping.js): who the others see typing and for how long, what they read, and how
// often a typing page tells the server, which passes it on (chatsApi.typing is a stand-in here).
const said = vi.hoisted(() => []);
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { typing: async (chatId, typing) => { said.push([chatId, typing]); } } }));
const { heardTyping, typingByChat, typingLine, typingNames, useTypingSignal } = await import("../../src/components/mercbot/useChatTyping.js");

const KITCHEN = { id: "5", people: [{ userId: "1", name: "Anna" }, { userId: "2", name: "Ben" }, { userId: "3", name: "Carla" }] };

beforeEach(() => {
  vi.useFakeTimers();
  said.length = 0;
  typingByChat.value = {};
});
afterEach(() => vi.useRealTimers());

describe("who the others see typing", () => {
  it("shows each person from their first word until they stop, or 7 seconds after their page last said so", () => {
    heardTyping({ chatId: 5, userId: 2, typing: true });
    heardTyping({ chatId: "5", userId: "3", typing: true });
    expect(typingLine(typingNames(KITCHEN, "1"))).toBe("Ben and Carla are typing");
    expect(typingNames(KITCHEN, "2"), "never the person themself").toEqual(["Carla"]);
    heardTyping({ chatId: "5", userId: "3", typing: false });
    expect(typingNames(KITCHEN, "1")).toEqual(["Ben"]);
    vi.advanceTimersByTime(5000);
    heardTyping({ chatId: "5", userId: "2", typing: true });
    vi.advanceTimersByTime(6000);
    expect(typingNames(KITCHEN, "1"), "said again, so still shown").toEqual(["Ben"]);
    vi.advanceTimersByTime(1000);
    expect(typingNames(KITCHEN, "1"), "a page that went quiet").toEqual([]);
    expect(typingByChat.value).toEqual({});
  });

  it("names nobody who isn't in the chat, and reads well for any number", () => {
    heardTyping({ chatId: "5", userId: "9", typing: true });
    expect(typingNames(KITCHEN, "1")).toEqual([]);
    expect(typingNames(null, "1")).toEqual([]);
    expect(typingLine([])).toBe("");
    expect(typingLine(["Anna"])).toBe("Anna is typing");
    expect(typingLine(["Anna", "Ben", "Carla"])).toBe("Anna, Ben and Carla are typing");
    expect(typingLine(["Anna", "Ben", "Carla", "Dan"])).toBe("Several people are typing");
  });
});

describe("telling the others while typing", () => {
  function typing({ alone = false } = {}) {
    const chatId = ref("5");
    const draft = ref("");
    const scope = effectScope();
    scope.run(() => useTypingSignal({ chatId: () => chatId.value, draft: () => draft.value, alone: () => alone }));
    return { chatId, draft, scope };
  }

  it("says so at the first word, again every 3 seconds while typing goes on, and stops on a pause, an empty box or another chat", async () => {
    const { chatId, draft, scope } = typing();
    draft.value = "H";
    await nextTick();
    draft.value = "Hi";
    await nextTick();
    expect(said).toEqual([["5", true]]);
    vi.advanceTimersByTime(3000);
    draft.value = "Hi t";
    await nextTick();
    expect(said).toEqual([["5", true], ["5", true]]);
    vi.advanceTimersByTime(5000);
    expect(said.at(-1), "a pause").toEqual(["5", false]);
    draft.value = "Hi th";
    await nextTick();
    draft.value = "";
    await nextTick();
    expect(said.slice(-2), "sent, or emptied").toEqual([["5", true], ["5", false]]);
    draft.value = "x";
    await nextTick();
    chatId.value = "6";
    draft.value = "a draft kept there";
    await nextTick();
    expect(said.slice(-2), "another chat with a draft isn't typing there").toEqual([["5", true], ["5", false]]);
    draft.value = "a draft kept there!";
    await nextTick();
    scope.stop();
    expect(said.slice(-2), "typing there, then the chat closed").toEqual([["6", true], ["6", false]]);
  });

  it("tells nobody in a chat with nobody else", async () => {
    const { draft } = typing({ alone: true });
    draft.value = "Just me";
    await nextTick();
    vi.advanceTimersByTime(6000);
    expect(said).toEqual([]);
  });
});
