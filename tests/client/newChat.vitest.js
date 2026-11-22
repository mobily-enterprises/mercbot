import { computed, createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// New room (plan 4.3, D15): Public (the default) or Private, each with what it means and fixed once the room has
// started, and a Name it needs, with no To: line, no bots and no first message. Create makes the room with the person
// alone in it and opens it; a private room then opens Invite; what the server says of the name shows under it. Continue
// with others (D-114) opens it from a direct chat: Public, the bot coming along, and its note put in the new room's
// composer unless the person wrote there. The chat routes are a stand-in that notes each call and answers what the
// server would.
const log = vi.hoisted(() => []);
// The chat a create makes (or the error it answers), and the hand-over note.
const answers = vi.hoisted(() => ({ made: null, note: null }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    create: async (choice) => {
      log.push(["create", choice]);
      if (answers.made instanceof Error) throw answers.made;
      return { chat: answers.made };
    },
    handOverNote: async (chatId) => {
      log.push(["handOverNote", chatId]);
      if (answers.note instanceof Error) throw answers.note;
      return { note: answers.note };
    }
  }
}));
// The dialog renders its content in place, as it does once it's open in a browser (on the server Vuetify's overlays
// render nothing).
vi.mock("vuetify/components/VDialog", async () => {
  const { defineComponent, h: render } = await import("vue");
  return { VDialog: defineComponent({ name: "VDialog", setup: (_props, { slots }) => () => render("div", { class: "v-dialog" }, slots.default?.()) }) };
});

const { default: MercbotNewChat } = await import("../../src/components/mercbot/MercbotNewChat.vue");
const { useNewChat } = await import("../../src/components/mercbot/useNewChat.js");

/** New room's HTML, rendered with the app's Vuetify, its apostrophes as written, without scoped styles' marks. */
async function rendered(props) {
  const app = createSSRApp({ render: () => h(MercbotNewChat, { bots: BOTS, homeName: "Rossi family", ...props }) });
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

const bot = (id, name) => ({ id, name, color: "#E65100", shape: "cloud", isMain: false, isBuilder: false, archivedAt: null });
const BOTS = [bot("7", "Chef"), bot("8", "Shopper")];
const choice = (extra = {}) => ({ kind: "public", name: "", problem: "", ...extra });
const MADE = { id: "55", kind: "public", title: "Kitchen reno", people: [], bots: [] };

beforeEach(() => {
  log.length = 0;
  answers.made = MADE;
  answers.note = null;
});

describe("New room", () => {
  it("offers Public, chosen, then Private, each with what it means, fixed once the room has started", async () => {
    const html = await rendered({ choice: choice() });
    expect(text(html)).toContain("New room");
    expect([...html.matchAll(/mb-new-chat__kind-name">([^<]*)<\/span><span class="mb-new-chat__kind-line">([^<]*)</gu)]
      .map(([, name, means]) => [name, means])).toEqual([
      ["Public", "Everyone in Rossi family can open it, and its bots remember what's said here in their other chats."],
      ["Private", "Only its members can open it, and nothing in it reaches other chats."]
    ]);
    expect(checked(html, "public")).toBe(true);
    expect(checked(html, "private")).toBe(false);
    expect(text(html)).toContain("You can't change this once the room has started.");
  });

  it("asks for a Name and nothing else: no To: line, no bots, no public chats to join, no first message", async () => {
    const html = await rendered({ choice: choice() });
    expect(html).toMatch(/<label class="mb-new-chat__label" for="mb-new-chat-name">Name<\/label>/u);
    expect(html).toMatch(/<input id="mb-new-chat-name"[^>]*aria-required="true"/u);
    for (const gone of ["To:", "Title (optional)", "Or join a public chat", "First message", "Start"]) expect(text(html)).not.toContain(gone);
    expect(buttons(html).map((entry) => entry.text).filter(Boolean)).toEqual(["Cancel", "Create"]);
  });

  it("shows what the server said of the name under it, and Creating… while it's made", async () => {
    const refused = await rendered({ choice: choice({ name: " ", problem: "Give the room a name." }) });
    expect(refused).toMatch(/<input id="mb-new-chat-name"[^>]*aria-invalid="true"[^>]*aria-describedby="mb-new-chat-problem"/u);
    expect(refused).toContain("<p id=\"mb-new-chat-problem\" class=\"mb-new-chat__problem\" role=\"alert\">Give the room a name.</p>");
    const making = buttons(await rendered({ choice: choice({ name: "Kitchen reno" }), starting: true }));
    expect(making.find((entry) => entry.text === "Creating…")?.disabled).toBe(true);
    expect(making.find((entry) => entry.text === "Cancel")?.disabled).toBe(true);
  });

  it("says, carrying a direct chat on, that its bot comes along with its note", async () => {
    const html = await rendered({ choice: choice({ continuing: { chatId: "31", botId: "7" } }) });
    expect(text(html)).toContain("Chef comes along, and its note for the others is ready to send.");
    expect(checked(html, "public")).toBe(true);
  });
});

describe("making a room", () => {
  const DIRECT = { id: "31", kind: "private", directBotId: "7", people: [{ userId: "1", name: "Anna Rossi" }], bots: [] };
  /** New room's flow, with the open chat following showChat and each chat's draft kept, as the shell has them. */
  function newChatFlow() {
    const open = ref(DIRECT);
    const drafts = ref({});
    const currentDraft = computed({
      get: () => drafts.value[open.value?.id] || "",
      set: (value) => { drafts.value = { ...drafts.value, [open.value.id]: value }; }
    });
    const store = { addChat: (chat) => log.push(["addChat", chat.id]) };
    const flow = useNewChat({
      currentChat: computed(() => open.value),
      currentDraft,
      store,
      showChat: async (chatId) => {
        log.push(["showChat", chatId]);
        open.value = { ...MADE, id: chatId };
      },
      onPrivate: (chat) => log.push(["invite", chat.id]),
      reportFailure: (words, cause) => log.push(["reportFailure", words, cause])
    });
    return { ...flow, drafts, currentDraft };
  }

  it("opens as a public room with no name yet", () => {
    const flow = newChatFlow();
    flow.openNewChat();
    expect(flow.newChat.value).toEqual({ kind: "public", name: "", problem: "" });
  });

  it("won't make a room without a name, and says so under the field", async () => {
    const flow = newChatFlow();
    flow.openNewChat();
    flow.changeNewChat({ name: "   " });
    await flow.startNewChat();
    expect(log).toEqual([]);
    expect(flow.newChat.value.problem).toBe("Give the room a name.");
    flow.changeNewChat({ name: "K" });
    expect(flow.newChat.value.problem, "typing clears it").toBe("");
  });

  it("makes the room with the person alone in it, once, and opens it; a public one opens nothing else", async () => {
    const flow = newChatFlow();
    flow.openNewChat();
    flow.changeNewChat({ name: "  Kitchen reno " });
    await Promise.all([flow.startNewChat(), flow.startNewChat()]);
    expect(log).toEqual([
      ["create", { kind: "public", title: "Kitchen reno", people: [], bots: [] }],
      ["addChat", "55"],
      ["showChat", "55"]
    ]);
    expect(flow.newChat.value).toBeNull();
  });

  it("opens Invite right after a private room is made", async () => {
    answers.made = { ...MADE, id: "56", kind: "private" };
    const flow = newChatFlow();
    flow.openNewChat();
    flow.changeNewChat({ kind: "private", name: "Plans" });
    await flow.startNewChat();
    expect(log).toEqual([
      ["create", { kind: "private", title: "Plans", people: [], bots: [] }],
      ["addChat", "56"],
      ["showChat", "56"],
      ["invite", "56"]
    ]);
  });

  it("keeps New room open with the server's words under the name when it refuses the name", async () => {
    answers.made = Object.assign(new Error("Give the room a name."), { status: 400, code: "bots_chat_needs_title" });
    const flow = newChatFlow();
    flow.openNewChat();
    flow.changeNewChat({ name: "x" });
    await flow.startNewChat();
    expect(flow.newChat.value).toEqual({ kind: "public", name: "x", problem: "Give the room a name." });
    expect(log.filter(([what]) => what === "reportFailure")).toEqual([]);
  });
});

describe("Continue with others", () => {
  function flowWith(note) {
    answers.note = note;
    return newChatFlowFor();
  }
  const DIRECT = { id: "31", kind: "private", directBotId: "7", people: [{ userId: "1", name: "Anna Rossi" }], bots: [] };
  function newChatFlowFor() {
    const open = ref(DIRECT);
    const drafts = ref({ 31: "my own draft in the direct chat" });
    const currentDraft = computed({
      get: () => drafts.value[open.value?.id] || "",
      set: (value) => { drafts.value = { ...drafts.value, [open.value.id]: value }; }
    });
    const flow = useNewChat({
      currentChat: computed(() => open.value),
      currentDraft,
      store: { addChat: (chat) => log.push(["addChat", chat.id]) },
      showChat: async (chatId) => {
        log.push(["showChat", chatId]);
        open.value = { ...MADE, id: chatId };
      },
      onPrivate: (chat) => log.push(["invite", chat.id]),
      reportFailure: (words, cause) => log.push(["reportFailure", words, cause])
    });
    return { ...flow, drafts, currentDraft };
  }

  it("opens New room, Public, with the direct chat's bot coming along, and asks the bot for its note", async () => {
    const flow = flowWith("Continuing from my chat with Chef: dinner for six.");
    flow.continueWithOthers(DIRECT);
    expect(flow.newChat.value).toEqual({ kind: "public", name: "", problem: "", continuing: { chatId: "31", botId: "7" } });
    expect(log).toEqual([["handOverNote", "31"]]);
  });

  it("makes the room with the bot, opens it and puts the note in its composer; the direct chat isn't changed", async () => {
    const flow = flowWith("Continuing from my chat with Chef: dinner for six.");
    flow.continueWithOthers(DIRECT);
    flow.changeNewChat({ name: "Dinner" });
    await flow.startNewChat();
    expect(log).toEqual([
      ["handOverNote", "31"],
      ["create", { kind: "public", title: "Dinner", people: [], bots: ["7"] }],
      ["addChat", "55"],
      ["showChat", "55"]
    ]);
    expect(flow.drafts.value).toEqual({ 31: "my own draft in the direct chat", 55: "Continuing from my chat with Chef: dinner for six." });
  });

  it("leaves what the person wrote in the new room, and says so when the note doesn't come", async () => {
    const flow = flowWith("A note");
    flow.continueWithOthers(DIRECT);
    flow.changeNewChat({ name: "Dinner" });
    flow.drafts.value = { ...flow.drafts.value, 55: "I'll write it myself" };
    await flow.startNewChat();
    expect(flow.drafts.value[55]).toBe("I'll write it myself");

    log.length = 0;
    const failed = flowWith(Object.assign(new Error("Chef is archived. Unarchive it to continue."), { status: 409 }));
    failed.continueWithOthers(DIRECT);
    failed.changeNewChat({ name: "Dinner" });
    await failed.startNewChat();
    expect(log.find(([what]) => what === "reportFailure")).toEqual(["reportFailure", "Chef is archived. Unarchive it to continue.", expect.any(Error)]);
    expect(failed.drafts.value[55]).toBeUndefined();
  });
});
