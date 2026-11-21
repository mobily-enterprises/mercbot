import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { computerLine } from "../../src/components/mercbot/chatView.js";
import { MERCBOT_CHAT_KEY } from "../../src/components/mercbot/shellChat.js";

// A bot's computer in a chat (D14, D16; the owner: "The UI needs to be clear about this, and users must be able to take
// over still"): each bot in the chat has one, "<Bot>'s computer", which belongs to the chat; who can watch it and use
// what's signed in on it; what is; Watch always, Take over while nobody has control, Hand back while you have it, and
// whom to wait for while someone else has it. Then the live view's header and its control bar. The statuses are a
// stand-in that notes each read and answers what the server would; the live view's screen stream is never opened.
const computer = vi.hoisted(() => ({ reads: [], answers: new Map() }));
vi.mock("../../src/components/mercbot/computerApi.js", async () => {
  const { ref } = await import("vue");
  return {
    computerApi: {
      // By bot id: a status, an Error it fails with, or none (it never comes).
      status: (target) => {
        computer.reads.push(target);
        const answer = computer.answers.get(target.id);
        if (answer instanceof Error) return Promise.reject(answer);
        return answer ? Promise.resolve(answer) : new Promise(() => {});
      },
      wake: () => Promise.resolve({})
    },
    useComputerStream: () => ({ state: ref("awake"), url: ref(""), error: ref("") })
  };
});
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: {} }));
vi.mock("../../src/components/mercbot/MercbotVncScreen.vue", () => ({ default: { name: "MercbotVncScreen", render: () => null } }));

const { default: MercbotChatComputer } = await import("../../src/components/mercbot/MercbotChatComputer.vue");
const { default: MercbotChatComputers } = await import("../../src/components/mercbot/MercbotChatComputers.vue");
const { default: MercbotLiveView } = await import("../../src/components/mercbot/MercbotLiveView.vue");

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
/**
 * A component's HTML, rendered with the app's Vuetify, its apostrophes and quotes as written, without scoped styles'
 * marks. A server renders a component once, as it starts; with `afterReads`, it renders once what that component (and
 * only it) asked for as it started has come, as a browser shows it a moment later.
 */
async function rendered(component, props, { afterReads = null } = {}) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  app.provide(MERCBOT_CHAT_KEY, { appendMessages: () => {}, reportFailure: () => {} });
  if (afterReads) app.mixin({ serverPrefetch() { return this.$.type === afterReads ? settled() : undefined; } });
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"").replace(/ data-v-[0-9a-f]+/gu, "");
}
/** The words on screen, without tags, spaces collapsed. */
const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
/** Each button, in order: its words and whether it's disabled. */
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)]
  .map(([, attributes, inside]) => ({ text: text(inside), disabled: /\sdisabled(?=[\s>=]|$)/u.test(attributes) }));
const button = (html, words) => buttons(html).find((entry) => entry.text === words);
const names = (html) => [...html.matchAll(/mb-chat-computer__name">([^<]*)</gu)].map(([, name]) => name);
/** One computer's part of a chat's computers, by its name. */
const computerIn = (html, name) => html.split("<li class=\"mb-chat-computer\"").find((part) => part.includes(`aria-label="${name}"`)) ?? "";

const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false };
const SHOPPER = { chatBotId: "80", botId: "8", name: "Shopper", color: "#2E7D32", shape: "storm", archived: false };
const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const KITCHEN = { id: "9", kind: "public", title: "Kitchen reno", directBotId: null, people: [ANNA, BEN], bots: [CHEF, SHOPPER] };
const SECRET = { ...KITCHEN, id: "10", kind: "private", title: "Anna's birthday" };
const status = (extra = {}) => ({ state: "awake", url: "", error: "", signIns: [], control: null, ...extra });

beforeEach(() => {
  computer.reads = [];
  computer.answers = new Map();
});

describe("a chat's computers", () => {
  const computers = (props, options) => rendered(MercbotChatComputers, { me: "2", homeName: "Rossi family", ...props }, options);

  it("lists each bot's computer in the chat by the bot's name, and reads each one's status in this chat", async () => {
    const html = await computers({ chat: KITCHEN });
    expect(names(html)).toEqual(["Chef's computer", "Shopper's computer"]);
    expect(computer.reads).toEqual([{ id: "7", chat: "9" }, { id: "8", chat: "9" }]);
  });

  it("shows only one bot's computer for that bot's card", async () => {
    const html = await computers({ chat: KITCHEN, onlyBotId: "8" });
    expect(names(html)).toEqual(["Shopper's computer"]);
    expect(computer.reads).toEqual([{ id: "8", chat: "9" }]);
  });

  it("says a chat with no bots has no computers", async () => {
    const html = await computers({ chat: { ...KITCHEN, bots: [] } });
    expect(text(html)).toBe("No bots in this chat, so no computers.");
    expect(computer.reads).toEqual([]);
  });

  it("says Loading… until a computer's status comes, with Watch and Take over held", async () => {
    const html = await computers({ chat: KITCHEN, onlyBotId: "7" });
    expect(text(html)).toContain("Loading…");
    expect(html).not.toContain("Signed in on it");
    expect(button(html, "Take over")).toEqual({ text: "Take over", disabled: true });
    expect(button(html, "Watch")).toEqual({ text: "Watch", disabled: false });
  });

  it("shows each computer's status once it comes, with Take over ready while nobody has control", async () => {
    computer.answers.set("7", status({ signIns: [{ label: "Google", kind: "site" }] }));
    computer.answers.set("8", status());
    const html = await computers({ chat: KITCHEN }, { afterReads: MercbotChatComputers });
    for (const name of ["Chef's computer", "Shopper's computer"]) {
      const part = computerIn(html, name);
      expect(part, name).toContain("Awake");
      expect(part, name).not.toContain("Loading…");
      expect(button(part, "Take over"), name).toEqual({ text: "Take over", disabled: false });
    }
    expect(text(computerIn(html, "Chef's computer"))).toContain("Signed in on it Google");
  });

  it("says when a computer's status didn't load, holds its Take over, and passes the failure on", async () => {
    const down = Object.assign(new Error("down"), { status: 503 });
    computer.answers.set("7", down);
    computer.answers.set("8", status());
    const failures = [];
    const html = await computers({ chat: KITCHEN, onFailure: (error) => failures.push(error) }, { afterReads: MercbotChatComputers });
    const chef = computerIn(html, "Chef's computer");
    expect(text(chef)).toContain("Its status didn't load.");
    expect(chef).not.toContain("Loading…");
    expect(button(chef, "Take over")).toEqual({ text: "Take over", disabled: true });
    expect(text(computerIn(html, "Shopper's computer"))).not.toContain("didn't load");
    expect(failures).toEqual([down]);
  });
});

describe("resetting a chat's computers", () => {
  const computers = (props) => rendered(MercbotChatComputers, { me: "2", homeName: "Rossi family", ...props }, { afterReads: MercbotChatComputers });
  const resets = (html) => [...html.split("<li class=\"mb-chat-computer\"").slice(1)].map((part) => button(part, "Reset")?.disabled ?? "none");

  it("is for the chat's maker and the home's owners and admins, and in a direct chat for its person", async () => {
    computer.answers.set("7", status());
    computer.answers.set("8", status());
    expect(resets(await computers({ chat: KITCHEN })), "neither its maker nor a manager").toEqual(["none", "none"]);
    expect(resets(await computers({ chat: { ...KITCHEN, madeBy: "2" } })), "its maker").toEqual([false, false]);
    expect(resets(await computers({ chat: KITCHEN, manages: true })), "an owner or admin").toEqual([false, false]);
    const bens = { ...KITCHEN, title: null, directBotId: "7", madeBy: "2", people: [BEN], bots: [CHEF] };
    expect(resets(await computers({ chat: bens })), "Ben's own chat with one bot").toEqual([false]);
    expect(resets(await computers({ chat: bens, me: "1" })), "Anna opening Ben's chat with Chef (it's public)").toEqual(["none"]);
    expect(resets(await computers({ chat: bens, me: "1", manages: true })), "an owner or admin").toEqual([false]);
  });

  it("is held while someone else has the computer", async () => {
    computer.answers.set("7", status({ control: { userId: "1", name: "Anna Rossi", since: "2026-11-22T10:00:00Z" } }));
    computer.answers.set("8", status());
    expect(resets(await computers({ chat: KITCHEN, manages: true }))).toEqual([true, false]);
  });
});

describe("one bot's computer in a chat", () => {
  const chef = (props) => rendered(MercbotChatComputer, { chat: KITCHEN, member: CHEF, me: "2", homeName: "Rossi family", ...props });
  const lineIn = (html) => /mb-chat-computer__line">([^<]*)</u.exec(html)?.[1];

  it("says it belongs to the chat, and who can watch it and use what's signed in on it", async () => {
    expect(lineIn(await chef({ status: status() }))).toBe(
      "It belongs to this chat. The chat is public, so everyone in Rossi family can watch it and use what's signed in on it."
    );
    expect(lineIn(await chef({ chat: SECRET, status: status() }))).toBe(
      "It belongs to this chat. Only the chat's members can watch it and use what's signed in on it."
    );
  });

  it("lists what's signed in on it, a coding sign-in marked, or says Nothing yet.", async () => {
    const signedIn = await chef({ status: status({ signIns: [{ label: "Google", kind: "site" }, { label: "GitHub", kind: "coding" }] }) });
    expect([...signedIn.matchAll(/<li>([^<]*)<\/li>/gu)].map(([, label]) => label)).toEqual(["Google", "GitHub (coding)"]);
    expect(signedIn).not.toContain("Nothing yet.");
    expect(text(await chef({ status: status() }))).toContain("Signed in on it Nothing yet.");
  });

  it("while you have control, says so and offers Hand back in place of Take over", async () => {
    const html = await chef({ status: status({ control: { userId: "2", name: "Ben Rossi", since: "2026-11-22T10:00:00Z" } }) });
    expect(text(html)).toContain("Awake · You have control");
    expect(button(html, "Hand back")).toEqual({ text: "Hand back", disabled: false });
    expect(button(html, "Take over")).toBeUndefined();
    expect(html).not.toContain("Wait until");
  });

  it("while someone else has control, says who and offers Take over from them and Hand back to the bot, as the server allows", async () => {
    const html = await chef({ status: status({ control: { userId: "1", name: "Anna Rossi", since: "2026-11-22T10:00:00Z" } }) });
    expect(text(html)).toContain("Anna has control of Chef's computer. You can still take it over, or hand it back to Chef.");
    expect(button(html, "Take over")).toEqual({ text: "Take over", disabled: false });
    expect(button(html, "Hand back")).toEqual({ text: "Hand back", disabled: false });
    expect(button(html, "Watch")).toEqual({ text: "Watch", disabled: false });
  });
});

describe("the live view of a bot's computer", () => {
  const whose = computerLine(KITCHEN, "Rossi family");
  const live = (props) => rendered(MercbotLiveView, { bot: { id: "7", name: "Chef", color: "#E65100", shape: "cloud" }, chatId: "9", whose, ...props });

  it("is headed by the computer's name and whose it is", async () => {
    const html = await live({});
    expect(/<p class="mb-live__title">([\s\S]*?)<\/p>/u.exec(html)?.[1]).toBe(
      `<span class="mb-live__name">Chef's computer</span><span class="mb-live__whose">${whose}</span>`
    );
  });

  it("while you have control, says the bot waits until you hand it back, with Hand back", async () => {
    const html = await live({ inControl: true });
    expect(text(html)).toContain("You have control. Chef waits until you hand it back.");
    expect(button(html, "Hand back")).toBeDefined();
    expect(button(html, "Take over")).toBeUndefined();
  });

  it("while you watch, offers Take over", async () => {
    const html = await live({});
    expect(text(html)).toContain("Watching");
    expect(button(html, "Take over")).toBeDefined();
    expect(button(html, "Hand back")).toBeUndefined();
  });
});
