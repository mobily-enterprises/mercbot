import { computed, createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// New chat (plan 4.3, D15): who it's with, Public (the default, whoever is on the To: line) or Private, each with what
// it means and fixed once the chat has started, and an optional title; starting it makes the chat from those choices
// and sends the first message there, files attached before it was made going in its folder first, and a chat with no
// one else isn't started. Below, the public chats to join instead. Continue with others (D-114) opens it from a direct
// chat with its bot and the bot's note, and starts once someone else is on the To: line. The chat and upload routes are
// stand-ins that note each call and answer what the server would.
const log = vi.hoisted(() => []);
// The public chats to join, and the chat a create makes.
const answers = vi.hoisted(() => ({ publicChats: { chats: [] }, made: null, note: null }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    publicChats: async () => answers.publicChats,
    create: async (choice) => {
      log.push(["create", choice]);
      return { chat: answers.made };
    },
    handOverNote: async (chatId) => {
      log.push(["handOverNote", chatId]);
      if (answers.note instanceof Error) throw answers.note;
      return { note: answers.note };
    }
  }
}));
// An upload keeps the file in the chat's folder, but one named "refused" (as a copy's picture check would, D-90).
vi.mock("../../src/components/mercbot/filesApi.js", async (importOriginal) => ({
  ...(await importOriginal()),
  uploadFile: async (botId, file, folder, chat) => {
    log.push(["upload", file.name, folder, chat, botId]);
    if (file.name.startsWith("refused")) throw Object.assign(new Error("This file can't be used."), { status: 422, code: "media_blocked" });
    return { path: `${folder}/${file.name}` };
  }
}));
// New chat reads the public chats to join once it's on the page, which a page rendered on the server never is: here it
// reads them before it renders, as a browser shows them a moment after it opens. Every other part mounts as it does.
vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal();
  const onMounted = (hook) => (vue.getCurrentInstance()?.type.__name === "MercbotNewChat" ? vue.onServerPrefetch(hook) : vue.onMounted(hook));
  return { ...vue, onMounted };
});

const { default: MercbotNewChat } = await import("../../src/components/mercbot/MercbotNewChat.vue");
const { useNewChat } = await import("../../src/components/mercbot/useNewChat.js");

/** New chat's HTML, rendered with the app's Vuetify, its apostrophes as written, without scoped styles' marks. */
async function rendered(props) {
  const app = createSSRApp({ render: () => h(MercbotNewChat, { me: "1", people: PEOPLE, bots: BOTS, homeName: "Rossi family", ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"").replace(/ data-v-[0-9a-f]+/gu, "");
}
const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
/** Each button, in order: its words, its aria-label and whether it's disabled. */
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)].map(([, attributes, inside]) => ({
  text: text(inside),
  label: /aria-label="([^"]*)"/u.exec(attributes)?.[1] ?? null,
  disabled: /\sdisabled(?=[\s>=]|$)/u.test(attributes)
}));
/** The kind radio's <input> for `value`, and whether it's checked. */
const checked = (html, value) => /\schecked(?=[\s>=]|$)/u.test(new RegExp(`<input[^>]*value="${value}"[^>]*>`, "u").exec(html)?.[0] ?? "");

const PEOPLE = [{ id: "1", name: "Anna Rossi" }, { id: "2", name: "Ben Rossi" }, { id: "3", name: "Cara Bianchi" }];
const bot = (id, name) => ({ id, name, color: "#E65100", shape: "cloud", isMain: false, isBuilder: false, archivedAt: null });
const BOTS = [bot("7", "Chef"), bot("8", "Shopper")];
const choice = (extra = {}) => ({ kind: "public", people: [], bots: [], title: "", ...extra });
const MADE = { id: "55", kind: "private", title: "Kitchen reno", people: [], bots: [] };

beforeEach(() => {
  log.length = 0;
  answers.publicChats = { chats: [] };
  answers.made = MADE;
  answers.note = null;
});

describe("New chat", () => {
  it("offers Public, chosen, then Private, each with what it means, fixed once the chat has started", async () => {
    const html = await rendered({ choice: choice() });
    expect([...html.matchAll(/mb-new-chat__kind-name">([^<]*)<\/span><span class="mb-new-chat__kind-line">([^<]*)</gu)]
      .map(([, name, means]) => [name, means])).toEqual([
      ["Public", "Everyone in Rossi family can open it, and its bots can use what's said here in other chats."],
      ["Private", "Only its members can open it, and nothing in it reaches other chats."]
    ]);
    expect(checked(html, "public")).toBe(true);
    expect(checked(html, "private")).toBe(false);
    expect(text(html)).toContain("You can't change this once the chat has started.");
  });

  it("shows who's on the To: line, people and bots, each as a chip", async () => {
    const html = await rendered({ choice: choice({ people: ["2"], bots: ["7"] }) });
    const chips = [...html.matchAll(/<span class="mb-new-chat__chip">([\s\S]*?)<button/gu)].map(([, chip]) => text(chip));
    expect(chips).toEqual(["BR Ben Rossi", "Chef"]);
    expect(buttons(html).map((entry) => entry.label).filter((label) => label?.startsWith("Remove "))).toEqual(["Remove Ben Rossi", "Remove Chef"]);
  });

  it("asks for a title only as an option: Start is ready once someone is on the To: line", async () => {
    const someone = await rendered({ choice: choice({ bots: ["7"] }) });
    expect(text(someone)).toContain("Title (optional)");
    expect(buttons(someone).find((entry) => entry.text === "Start")?.disabled).toBe(false);
    expect(buttons(await rendered({ choice: choice() })).find((entry) => entry.text === "Start")?.disabled).toBe(true);
  });

  it("lists the public chats to join instead", async () => {
    answers.publicChats = {
      chats: [{ id: "60", kind: "public", title: "Saturday party", directBotId: null, people: [{ userId: "2", name: "Ben Rossi" }, { userId: "3", name: "Cara Bianchi" }], bots: [] }]
    };
    const html = await rendered({ choice: choice() });
    expect(text(html)).toContain("Or join a public chat");
    const joins = buttons(html).filter((entry) => entry.label?.startsWith("Join "));
    expect(joins.map((entry) => entry.label)).toEqual(["Join Saturday party"]);
    expect(joins[0].text, "its name, how many people are in it, and Join").toMatch(/Saturday party 2 Join$/u);
  });
});

describe("starting a new chat", () => {
  function newChatFlow() {
    const store = { addChat: (chat) => log.push(["addChat", chat.id]), messagesByChat: ref({}) };
    return useNewChat({
      currentChat: computed(() => null),
      currentDraft: ref(""),
      store,
      showChat: async (chatId) => { log.push(["showChat", chatId]); },
      send: async (payload) => { log.push(["send", payload]); },
      botById: (botId) => BOTS.find((entry) => entry.id === botId) || null,
      reportFailure: (words, cause) => log.push(["reportFailure", words, cause])
    });
  }

  it("opens as a public chat, whoever is on its To: line", () => {
    const flow = newChatFlow();
    flow.openNewChat();
    expect(flow.newChat.value).toEqual({ kind: "public", people: [], bots: [], title: "" });
    flow.openNewChat({ people: [2], bots: [7] });
    expect(flow.newChat.value).toEqual({ kind: "public", people: ["2"], bots: ["7"], title: "" });
  });

  it("won't start a chat with no one on its To: line, and says who to add", async () => {
    const flow = newChatFlow();
    flow.openNewChat();
    await flow.startNewChat({ text: "Anyone there?" });
    expect(log).toEqual([["reportFailure", "Add someone to the chat first: a person or a bot.", null]]);
    expect(flow.newChat.value).not.toBeNull();
  });

  it("makes the chat from its choices once, opens it and sends the first message there", async () => {
    const flow = newChatFlow();
    flow.openNewChat({ people: ["2"], bots: ["7"] });
    flow.changeNewChat({ kind: "private", title: "  Kitchen reno " });
    await flow.startNewChat({ text: "Oak or walnut?" });
    expect(log).toEqual([
      ["create", { kind: "private", title: "Kitchen reno", people: ["2"], bots: ["7"] }],
      ["addChat", "55"],
      ["showChat", "55"],
      ["send", { text: "Oak or walnut?" }]
    ]);
    expect(flow.newChat.value).toBeNull();
  });

  it("keeps files attached before the chat was made in its folder once it is, leaving out one refused, then sends", async () => {
    const flow = newChatFlow();
    flow.openNewChat({ people: ["2"], bots: ["7"] });
    const picture = new File(["x"], "oak.png", { type: "image/png" });
    const refused = new File(["x"], "refused.png", { type: "image/png" });
    await flow.startNewChat({ text: "Like this?", attachments: [
      { name: "oak.png", size: 1, type: "image/png", file: picture },
      { name: "refused.png", size: 1, type: "image/png", file: refused },
      { name: "notes.txt", size: 4, type: "text/plain", text: "oak", path: "/files/chat/Uploads/notes.txt" }
    ] });
    expect(log.filter(([what]) => what !== "addChat")).toEqual([
      ["create", { kind: "public", title: null, people: ["2"], bots: ["7"] }],
      ["showChat", "55"],
      ["upload", "oak.png", "/files/chat/Uploads", "55", null],
      ["upload", "refused.png", "/files/chat/Uploads", "55", null],
      ["reportFailure", "This file can't be used.", expect.any(Error)],
      ["send", { text: "Like this?", attachments: [
        { name: "oak.png", size: 1, type: "image/png", path: "/files/chat/Uploads/oak.png" },
        { name: "notes.txt", size: 4, type: "text/plain", text: "oak", path: "/files/chat/Uploads/notes.txt" }
      ] }]
    ]);
  });
});

describe("Continue with others", () => {
  const DIRECT = { id: "31", kind: "public", directBotId: "7", people: [{ userId: "1", name: "Anna Rossi" }], bots: [] };
  function flowWith(note) {
    answers.note = note;
    const store = { addChat: (chat) => log.push(["addChat", chat.id]), messagesByChat: ref({}) };
    return useNewChat({
      currentChat: computed(() => DIRECT),
      currentDraft: ref("my own draft in the direct chat"),
      store,
      showChat: async (chatId) => { log.push(["showChat", chatId]); },
      send: async (payload) => { log.push(["send", payload]); },
      botById: (botId) => BOTS.find((entry) => entry.id === botId) || null,
      reportFailure: (words, cause) => log.push(["reportFailure", words, cause])
    });
  }

  it("opens New chat with the direct chat's bot, Public, and its note as the first message to change and send", async () => {
    const flow = flowWith("Continuing from my chat with Chef: dinner for six.");
    const asked = flow.continueWithOthers(DIRECT);
    expect(flow.newChat.value).toEqual({ kind: "public", people: [], bots: ["7"], title: "", continuing: { chatId: "31", botId: "7", writing: true } });
    await asked;
    expect(log).toEqual([["handOverNote", "31"]]);
    expect(flow.chatDraft.value).toBe("Continuing from my chat with Chef: dinner for six.");
    expect(flow.newChat.value.continuing.writing).toBe(false);
  });

  it("leaves what the person wrote meanwhile, and says so when the note doesn't come", async () => {
    const flow = flowWith("A note");
    const asked = flow.continueWithOthers(DIRECT);
    flow.chatDraft.value = "I'll write it myself";
    await asked;
    expect(flow.chatDraft.value).toBe("I'll write it myself");
    const failed = flowWith(Object.assign(new Error("Chef is archived. Unarchive it to continue."), { status: 409 }));
    await failed.continueWithOthers(DIRECT);
    expect(log.at(-1)).toEqual(["reportFailure", "Chef is archived. Unarchive it to continue.", expect.any(Error)]);
    expect([failed.chatDraft.value, failed.newChat.value.continuing.writing]).toEqual(["", false]);
  });

  it("starts only once someone besides the bot is on the To: line, as a new chat; the direct chat isn't changed", async () => {
    const flow = flowWith("Continuing from my chat with Chef.");
    await flow.continueWithOthers(DIRECT);
    await flow.startNewChat({ text: "Continuing from my chat with Chef." });
    expect(log.at(-1)).toEqual(["reportFailure", "Add the people or bots to continue with first.", null]);
    flow.changeNewChat({ people: ["2"] });
    await flow.startNewChat({ text: "Continuing from my chat with Chef. Ben?" });
    expect(log.slice(-4)).toEqual([
      ["create", { kind: "public", title: null, people: ["2"], bots: ["7"] }],
      ["addChat", "55"],
      ["showChat", "55"],
      ["send", { text: "Continuing from my chat with Chef. Ben?" }]
    ]);
  });

  it("says in New chat what it carries on, and what Start waits for", async () => {
    const writing = await rendered({ choice: choice({ bots: ["7"], continuing: { chatId: "31", botId: "7", writing: true } }) });
    expect(text(writing)).toContain("Continue with others");
    expect(text(writing)).toContain("Chef is writing a note of your chat for the others…");
    const written = await rendered({ choice: choice({ bots: ["7"], continuing: { chatId: "31", botId: "7", writing: false } }) });
    expect(text(written)).toContain("Your chat with Chef stays as it is.");
    expect(text(written)).toContain("Add the people or bots to continue with.");
    expect(buttons(written).find((entry) => entry.text === "Start").disabled).toBe(true);
    const ready = await rendered({ choice: choice({ people: ["2"], bots: ["7"], continuing: { chatId: "31", botId: "7", writing: false } }) });
    expect(buttons(ready).find((entry) => entry.text === "Start").disabled).toBe(false);
  });
});
