import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { composerPlaceholder } from "../../src/components/mercbot/composerPlaceholder.js";

// The composer's helpers in a chat (D-112): its placeholder, the @ and "/" menus by who's in the chat, and a voice
// conversation, offered only in a direct chat and counted where it was made. The skills and apps routes are stand-ins.
vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onBeforeUnmount: () => {} }));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: { skills: async () => ({ skills: [{ id: "s1", name: "Weekly menu", description: "Plans the week", own: false }, { id: "s2", name: "My budget", description: "Mine", own: true }] }) }
}));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({
  pluginsApi: { list: async () => ({ plugins: [{ id: "gmail", name: "Gmail", installed: true, accounts: [{ status: "connected" }] }] }) }
}));
const { mentionBotsOf, offersOwnSkills, soleBotOf, useComposerTokens } = await import("../../src/components/mercbot/useComposerTokens.js");
const { useDictation } = await import("../../src/components/mercbot/useDictation.js");
const { hasSeveral } = await import("../../src/components/mercbot/messageAuthors.js");

const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false };
const SHOPPER = { chatBotId: "80", botId: "8", name: "Shopper", color: "#2E7D32", shape: "storm", archived: false };
const PULSE = { chatBotId: "90", botId: "9", name: "Pulse", color: "#1565C0", shape: "rain", archived: true };
const chatOf = (people, bots) => ({ id: "5", people: people.map((name, at) => ({ userId: String(at + 1), name })), bots });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The composer's tokens for `chat`, with a stand-in field whose caret sits at the end of what's typed; `me`, the
 * person looking, decides whether their own skills are offered (offersOwnSkills).
 */
function composer(chat, me = "1") {
  const draft = ref("");
  const field = { selectionStart: 0, selectionEnd: 0, focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  const open = ref(chat);
  const chatId = ref(chat.id);
  const tokens = useComposerTokens({
    draft,
    input: ref(field),
    several: { get value() { return hasSeveral(open.value); } },
    mentionBots: { get value() { return mentionBotsOf(open.value); } },
    chatId,
    ownSkills: () => offersOwnSkills(open.value, me)
  });
  const type = async (text) => {
    draft.value = text;
    field.selectionStart = field.selectionEnd = text.length;
    tokens.updateMention();
    await settle();
  };
  return { draft, tokens, type, open, chatId };
}

describe("the composer's placeholder", () => {
  const choice = (body) => ({ id: "1", kind: "choice", body: { question: "Which?", options: ["A", "B"], ...body } });

  it("invites an answer while the latest card is open for the person looking, and is empty otherwise", () => {
    expect(composerPlaceholder({ messages: [], me: "1" })).toBe("");
    expect(composerPlaceholder({ messages: [choice({})], me: "1" })).toBe("Pick from the card, or tell me in your own words");
    expect(composerPlaceholder({ messages: [choice({ purpose: "bot-name" })], me: "1" })).toBe("Pick a name above, or say whatever's on your mind");
    expect(composerPlaceholder({ messages: [choice({}), choice({ chosen: ["A"] })], me: "1" }), "answered").toBe("");
    expect(composerPlaceholder({ messages: [choice({ for: { id: "1", name: "Anna" } })], me: "1" })).toBe("Pick from the card, or tell me in your own words");
    expect(composerPlaceholder({ messages: [choice({ for: { id: "2", name: "Ben" } })], me: "1" }), "Ben's card").toBe("");
  });
});

describe("@ and / in a chat", () => {
  it("offer no @ in a direct chat, and its one bot's skills under /: Mercbot's, since the chat is public", async () => {
    const { tokens, type } = composer({ ...chatOf(["Anna"], [CHEF]), kind: "public", directBotId: "7" });
    await type("@");
    expect(tokens.mention.value).toBe(null);
    await type("/");
    expect(tokens.skillRows.value.map((row) => row.name)).toEqual(["Weekly menu"]);
  });

  it("offer the person's own skills under / only in a private chat whose one person they are", async () => {
    const alone = { ...chatOf(["Anna"], [CHEF]), kind: "private" };
    const mine = composer(alone);
    await mine.type("/");
    expect(mine.tokens.skillRows.value.map((row) => row.name)).toEqual(["Weekly menu", "My budget"]);
    const someoneElses = composer(alone, "2");
    await someoneElses.type("/");
    expect(someoneElses.tokens.skillRows.value.map((row) => row.name), "not theirs").toEqual(["Weekly menu"]);
    expect(offersOwnSkills({ ...chatOf(["Anna", "Ben"], [CHEF]), kind: "private" }, "1"), "a private chat with others").toBe(false);
  });

  it("know a chat's one answering bot, an archived one not counted", () => {
    expect(soleBotOf(chatOf(["Anna"], [CHEF, PULSE]))).toBe(CHEF);
    expect(soleBotOf(chatOf(["Anna"], [CHEF, SHOPPER]))).toBe(null);
    expect(soleBotOf(chatOf(["Anna"], [PULSE]))).toBe(null);
  });

  it("offer everyone, the chat's bots (never an archived one) and the person's apps under @ in a chat of several, and no /", async () => {
    const { tokens, type } = composer(chatOf(["Anna", "Ben"], [CHEF, SHOPPER, PULSE]));
    await type("@");
    expect(tokens.mentionRows.value.map((row) => `${row.kind}:${row.label}`)).toEqual(["everyone:everyone", "bot:Chef", "bot:Shopper", "app:Gmail"]);
    await type("@sh");
    expect(tokens.mentionRows.value.map((row) => row.label)).toEqual(["Shopper"]);
    await type("/");
    expect(tokens.slash.value, "several bots: no one bot for a skill").toBe(null);
  });

  it("offer / in a chat of people with exactly one bot, and @ there too", async () => {
    const { tokens, type } = composer(chatOf(["Anna", "Ben"], [CHEF, PULSE]));
    await type("/");
    expect(tokens.skillRows.value.map((row) => row.name)).toEqual(["Weekly menu"]);
    await type("@");
    expect(tokens.mentionRows.value.map((row) => row.label)).toEqual(["everyone", "Chef", "Gmail"]);
  });

  it("send a chosen bot as its marker, and forget the tokens when another chat opens", async () => {
    const { draft, tokens, type, chatId } = composer(chatOf(["Anna", "Ben"], [CHEF, SHOPPER]));
    await type("Ask @");
    tokens.insertMention(tokens.mentionRows.value.find((row) => row.label === "Chef"));
    expect(draft.value).toBe("Ask @Chef ");
    expect(tokens.withMarkers(draft.value)).toBe("Ask <@bot:7> ");
    chatId.value = "6";
    await nextTick();
    expect(tokens.tokens.value).toEqual([]);
  });
});

describe("a voice conversation", () => {
  function dictation() {
    const chatId = ref("5");
    const botId = ref("7");
    const ended = [];
    const voice = useDictation({ draft: ref(""), chatId: () => chatId.value, botId: () => botId.value, focusComposer: () => {}, voiceEnded: (call) => ended.push(call) });
    return { voice, chatId, botId, ended };
  }

  it("is offered only in a direct chat, with its bot", () => {
    const { voice, botId } = dictation();
    expect(voice.canCall.value).toBe(true);
    botId.value = null;
    expect(voice.canCall.value).toBe(false);
    voice.startCall();
    expect(voice.calling.value).toBe(false);
  });

  it("stops when another chat opens, and is counted in the chat and with the bot it was made with", async () => {
    const { voice, chatId, botId, ended } = dictation();
    voice.startCall();
    expect(voice.calling.value).toBe(true);
    chatId.value = "6";
    botId.value = "8";
    await nextTick();
    expect(voice.calling.value).toBe(false);
    // The call bar ends the call as it closes.
    voice.callEnded(12);
    expect(ended).toEqual([{ chatId: "5", botId: "7", seconds: 12 }]);
  });
});
