import { computed, createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// New chat (plan 4.3, D15): who it's with, Public (the default, whoever is on the To: line) or Private, each with what
// it means and fixed once the chat has started, and an optional title; starting it makes the chat from those choices
// and sends the first message there, and a chat with no one else isn't started. Below, the public chats to join
// instead. The chat routes are a stand-in that notes each call and answers what the server would.
const log = vi.hoisted(() => []);
// The public chats to join, and the chat a create makes.
const answers = vi.hoisted(() => ({ publicChats: { chats: [] }, made: null }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    publicChats: async () => answers.publicChats,
    create: async (choice) => {
      log.push(["create", choice]);
      return { chat: answers.made };
    }
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
});
