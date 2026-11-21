import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";

// Chat details (plan 4.4): the chat's name, whether it's Public or Private and what that means, its people (you among
// them, marked) and its bots; who may take whom out (its maker and the home's owners and admins, never themselves, and
// no person out of the everyone chat); Leave, Archive, Unarchive and Delete chat as each is theirs; and its tabs, Chat,
// Files and Computers; its routines, each with Edit and Delete for anyone in the chat, and Resume for its maker. The
// routines are a stand-in that answers what the server would; the parts other screens own (the chat's files and its
// computers) are stand-ins that show the chat they were given.
// The chat's routines, as the server lists them.
const routines = vi.hoisted(() => ({ listed: [] }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { routinesIn: async () => ({ routines: routines.listed }) } }));
const stub = vi.hoisted(() => (vue, name) => ({
  default: vue.defineComponent({
    name,
    inheritAttrs: false,
    props: ["chat", "sections"],
    setup: (given) => () => vue.h("div", {
      "data-stub": name,
      "data-chat": typeof given.chat === "object" ? given.chat.id : given.chat,
      "data-sections": given.sections ? given.sections.map((entry) => `${entry.label}:${entry.root}`).join("|") : undefined
    })
  })
}));
vi.mock("../../src/components/files/FileBrowser.vue", async () => stub(await import("vue"), "FileBrowser"));
vi.mock("../../src/components/mercbot/MercbotChatComputers.vue", async () => stub(await import("vue"), "MercbotChatComputers"));

const { default: MercbotChatDetails } = await import("../../src/components/mercbot/MercbotChatDetails.vue");

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
/**
 * Chat details' HTML, rendered with the app's Vuetify, its apostrophes as written, without scoped styles' marks. A
 * server renders it once, as it starts; with `afterReads`, once the routines it asked for as it started have come.
 */
async function details(props, { afterReads = false } = {}) {
  const app = createSSRApp({ render: () => h(MercbotChatDetails, { me: "2", homeName: "Rossi family", ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  if (afterReads) app.mixin({ serverPrefetch() { return this.$.type === MercbotChatDetails ? settled() : undefined; } });
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"").replace(/ data-v-[0-9a-f]+/gu, "");
}
const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
/** Each button, in order: its words, its aria-label and its role. */
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)].map(([, attributes, inside]) => ({
  text: text(inside),
  label: /aria-label="([^"]*)"/u.exec(attributes)?.[1] ?? null,
  role: /role="([^"]*)"/u.exec(attributes)?.[1] ?? null
}));
/** What's inside one of its sections, by its label. */
const section = (html, label) => {
  const start = html.indexOf(`aria-label="${label}">`);
  return start === -1 ? "" : html.slice(start + `aria-label="${label}">`.length, html.indexOf("</section>", start));
};
const membersIn = (html, label) => [...section(html, label).matchAll(/mb-chat-details__member-name">([\s\S]*?)<\/span>/gu)].map(([, name]) => text(name));
const takeOuts = (html) => buttons(html).map((entry) => entry.label).filter((label) => label?.startsWith("Take "));
/** Each routine's row: its words, its switch (its label, and ", held" while it can't be switched) and its buttons. */
const routineRows = (html) => [...section(html, "Routines").matchAll(/<li class="mb-chat-details__routine">([\s\S]*?)<\/li>/gu)].map(([, row]) => {
  const input = /<input[^>]*>/u.exec(row)?.[0] ?? "";
  return {
    words: text(/mb-chat-details__routine-text">([\s\S]*?)<\/span><\/span>/u.exec(row)?.[1] ?? ""),
    toggle: `${/aria-label="([^"]*)"/u.exec(input)?.[1]}${/\sdisabled(?=[\s>=]|$)/u.test(input) ? ", held" : ""}`,
    buttons: buttons(row).map((entry) => entry.label)
  };
});
/** What can be done to the chat itself: Leave chat, Archive, Unarchive, Delete chat. */
const actions = (html) => buttons(section(html, "This chat")).map((entry) => entry.text);

const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const CARA = { userId: "3", name: "Cara Bianchi" };
const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false };
const chatOf = (extra) => ({
  id: "9", kind: "public", title: "Kitchen reno", everyone: false, directBotId: null, archivedAt: null, visiting: false, madeBy: "1",
  people: [ANNA, BEN, CARA], bots: [CHEF], ...extra
});
const KITCHEN = chatOf({});
const EVERYONE = chatOf({ id: "1", title: "Rossi family", everyone: true, madeBy: null });
const DIRECT = chatOf({ id: "12", title: null, directBotId: "7", madeBy: "2", people: [BEN] });

beforeEach(() => {
  shellPreferences.detailsTab = "details";
  routines.listed = [];
});

describe("Chat details", () => {
  it("names the chat, says whether it's Public or Private and what that means, and lists its people, you first, and its bots", async () => {
    const kitchen = await details({ chat: KITCHEN });
    expect(text(/<h2 class="mb-chat-details__title">[\s\S]*?<\/h2>/u.exec(kitchen)[0])).toBe("Kitchen reno");
    expect(text(/<p class="mb-chat-details__kind">[\s\S]*?<\/p>/u.exec(kitchen)[0])).toBe("Public");
    expect(text(/<p class="mb-chat-details__means">[\s\S]*?<\/p>/u.exec(kitchen)[0])).toBe(
      "Everyone in Rossi family can open it, and its bots can use what's said here in other chats."
    );
    expect(membersIn(kitchen, "People")).toEqual(["Ben Rossi (you)", "Anna Rossi", "Cara Bianchi"]);
    expect(membersIn(kitchen, "Bots")).toEqual(["Chef"]);

    const secret = await details({ chat: chatOf({ kind: "private", title: null, people: [ANNA, BEN] }) });
    expect(text(/<h2 class="mb-chat-details__title">[\s\S]*?<\/h2>/u.exec(secret)[0])).toBe("Anna and Chef");
    expect(text(/<p class="mb-chat-details__kind">[\s\S]*?<\/p>/u.exec(secret)[0])).toBe("Private");
    expect(text(/<p class="mb-chat-details__means">[\s\S]*?<\/p>/u.exec(secret)[0])).toBe(
      "Only its members can open it, and nothing in it reaches other chats."
    );
  });

  it("lets the chat's maker take the others out of it, never themselves", async () => {
    expect(takeOuts(await details({ chat: KITCHEN, me: "1" }))).toEqual([
      "Take Ben Rossi out of this chat",
      "Take Cara Bianchi out of this chat",
      "Take Chef out of this chat"
    ]);
  });

  it("lets the home's owners and admins take people out too, and no one else", async () => {
    expect(takeOuts(await details({ chat: KITCHEN, me: "2", manages: true }))).toEqual([
      "Take Anna Rossi out of this chat",
      "Take Cara Bianchi out of this chat",
      "Take Chef out of this chat"
    ]);
    expect(takeOuts(await details({ chat: KITCHEN, me: "2" }))).toEqual([]);
  });

  it("takes no one out of the everyone chat, whoever is looking", async () => {
    const labels = takeOuts(await details({ chat: EVERYONE, me: "1", manages: true }));
    for (const person of [ANNA, BEN, CARA]) expect(labels).not.toContain(`Take ${person.name} out of this chat`);
  });

  it("offers Leave chat in a chat you're in, but not in the everyone chat or in a direct chat", async () => {
    expect(actions(await details({ chat: KITCHEN }))).toContain("Leave chat");
    expect(actions(await details({ chat: EVERYONE }))).not.toContain("Leave chat");
    expect(actions(await details({ chat: DIRECT }))).not.toContain("Leave chat");
  });

  it("says everyone in the home is in the everyone chat, which no one archives or deletes", async () => {
    const html = await details({ chat: EVERYONE, me: "1", manages: true });
    expect(text(section(html, "This chat"))).toBe("Everyone in Rossi family is in this chat, for as long as they're in the home.");
    expect(actions(html)).toEqual([]);
  });

  it("offers Archive and Delete chat to the chat's maker and the home's owners and admins only", async () => {
    expect(actions(await details({ chat: KITCHEN, me: "1" }))).toEqual(["Leave chat", "Archive", "Delete chat"]);
    expect(actions(await details({ chat: KITCHEN, me: "2", manages: true }))).toEqual(["Leave chat", "Archive", "Delete chat"]);
    expect(actions(await details({ chat: KITCHEN, me: "2" }))).toEqual(["Leave chat"]);
  });

  it("offers Hide from sidebar in place of Archive on a private chat, to anyone in it (plan 5.1)", async () => {
    const secret = chatOf({ kind: "private" });
    expect(actions(await details({ chat: secret, me: "1" }))).toEqual(["Leave chat", "Hide from sidebar", "Delete chat"]);
    expect(actions(await details({ chat: secret, me: "2" }))).toEqual(["Leave chat", "Hide from sidebar"]);
    expect(actions(await details({ chat: { ...secret, hidden: true }, me: "2" }))).toEqual(["Leave chat"]);
  });

  it("offers them Unarchive in place of Archive on an archived chat", async () => {
    const archived = chatOf({ archivedAt: "2026-11-21T10:00:00.000Z" });
    expect(actions(await details({ chat: archived, me: "1" }))).toEqual(["Leave chat", "Unarchive", "Delete chat"]);
    expect(actions(await details({ chat: archived, me: "2" }))).toEqual(["Leave chat"]);
  });

  it("lists the routines that run in it, each with Edit and Delete for anyone in the chat, and Resume only for its maker", async () => {
    const routine = (id, name, extra) => ({ id, name, botId: "7", schedule: "Every Monday at 09:00", enabled: true, madeBy: "1", canResume: false, ...extra });
    routines.listed = [
      routine("r1", "Weekly shop", {}),
      routine("r2", "Meal plan", { enabled: false }),
      routine("r3", "Bin day", { enabled: false, madeBy: "2", canResume: true })
    ];
    expect(routineRows(await details({ chat: KITCHEN, me: "2" }, { afterReads: true }))).toEqual([
      { words: "Weekly shop Every Monday at 09:00 · Chef", toggle: "Pause Weekly shop", buttons: ["Edit Weekly shop", "Delete Weekly shop"] },
      { words: "Meal plan Paused · Chef", toggle: "Resume Meal plan, held", buttons: ["Edit Meal plan", "Delete Meal plan"] },
      { words: "Bin day Paused · Chef", toggle: "Resume Bin day", buttons: ["Edit Bin day", "Delete Bin day"] }
    ]);
  });

  it("has the tabs Chat, Files and Computers, and opens the one kept on this device", async () => {
    const shown = {};
    for (const tab of ["details", "files", "computer"]) {
      shellPreferences.detailsTab = tab;
      const html = await details({ chat: KITCHEN });
      expect(buttons(html).filter((entry) => entry.role === "tab").map((entry) => entry.text), tab).toEqual(["Chat", "Files", "Computers"]);
      shown[tab] = [
        ...(section(html, "People") ? ["People"] : []),
        ...[...html.matchAll(/data-stub="([^"]*)" data-chat="([^"]*)"/gu)].map(([, name, chat]) => `${name} of chat ${chat}`)
      ];
    }
    expect(shown).toEqual({ details: ["People"], files: ["FileBrowser of chat 9"], computer: ["MercbotChatComputers of chat 9"] });
  });

  it("shows this chat's folder and the home's in Files, so Move to… reaches the home's", async () => {
    shellPreferences.detailsTab = "files";
    const html = await details({ chat: KITCHEN });
    expect(/data-sections="([^"]*)"/u.exec(html)?.[1]).toBe("This chat:/files/chat|Rossi family:/files/shared");
  });
});
