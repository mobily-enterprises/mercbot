import { computed, nextTick, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

// Dictation (useDictation.js) with the browser's recognition as a stand-in: the recognition reports its words a moment
// after it's told to stop, so words heard for one message must never land after that message was sent, nor in another
// chat's message box.
vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onBeforeUnmount: () => {} }));
const sessions = [];
vi.mock("../../src/components/mercbot/voice.js", () => ({
  UNSUPPORTED: "unsupported",
  voiceSupported: () => true,
  checkMicrophone: async () => {},
  microphoneProblem: (error) => String(error),
  listen: (handlers) => {
    const session = { ...handlers, stop: vi.fn() };
    sessions.push(session);
    return session;
  }
}));
const { useDictation } = await import("../../src/components/mercbot/useDictation.js");

/** The composer of two chats, each with its own draft, and dictation on it. */
function composer() {
  const drafts = reactive({ a: "", b: "" });
  const chatId = ref("a");
  const draft = computed({ get: () => drafts[chatId.value], set: (text) => { drafts[chatId.value] = text; } });
  const dictation = useDictation({ draft, chatId: () => chatId.value, botId: () => null, focusComposer: () => {}, voiceEnded: () => {} });
  return { drafts, chatId, draft, dictation };
}

/** Starts dictating and answers the recognition that opened. */
async function dictate(dictation) {
  dictation.toggleDictation();
  await vi.waitFor(() => expect(dictation.dictating.value).toBe(true));
  return sessions.at(-1);
}

describe("dictation", () => {
  it("puts the words in the message box as they're heard", async () => {
    const { draft, dictation } = composer();
    const heard = await dictate(dictation);
    heard.onText("Dinner at", " seven");
    expect(draft.value).toBe("Dinner at seven");
    heard.onEnd("Dinner at seven");
    expect([draft.value, dictation.dictating.value]).toEqual(["Dinner at seven", false]);
  });

  it("words heard after another chat opens never land in that chat's message box", async () => {
    const { drafts, chatId, dictation } = composer();
    const heard = await dictate(dictation);
    heard.onText("Dinner at seven", "");
    chatId.value = "b";
    await nextTick();
    expect(heard.stop).toHaveBeenCalled();
    heard.onText("Dinner at seven please", "");
    heard.onEnd("Dinner at seven please");
    expect(drafts.b).toBe("");
    expect(dictation.dictating.value).toBe(false);
  });

  it("words heard after the message was sent don't refill the message box", async () => {
    const { draft, dictation } = composer();
    const heard = await dictate(dictation);
    heard.onText("Dinner at seven", "");
    draft.value = "";
    await nextTick();
    expect(heard.stop).toHaveBeenCalled();
    heard.onText("Dinner at seven please", "");
    heard.onEnd("Dinner at seven please");
    expect([draft.value, dictation.dictating.value]).toEqual(["", false]);
  });
});
