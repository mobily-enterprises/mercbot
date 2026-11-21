import { createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { buildSidebarModel, toChatRow } from "../../src/components/mercbot/chatDirectory.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { hasSeveral } from "../../src/components/mercbot/messageAuthors.js";
import { mentionParts, plainMentions } from "../../src/components/mercbot/mentions.js";

// @-mentioning people in chats (D-114, B3): in a chat of several, @ offers the chat's other people (never the person
// writing) before its bots, a chosen person is sent as <@person:ID>, a message shows a person it mentions by name (the
// person reading marked when it's them, "@someone" for anyone the message doesn't name), and a chat whose place says
// `mentioned` shows an "@" on its row and its tile in place of the unread dot. The skills and apps routes are stand-ins.
vi.mock("../../src/components/mercbot/botsApi.js", () => ({ botsApi: { skills: async () => ({ skills: [] }) } }));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({ pluginsApi: { list: async () => ({ plugins: [] }) } }));
vi.mock("../../src/components/apps/MercbotViewCard.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/MercbotViewViewer.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/MercbotAppDraftCard.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/MercbotFieldRemovalCard.vue", () => ({ default: { render: () => null } }));
const stub = vi.hoisted(() => (vue, name) => ({ default: vue.defineComponent({ name, inheritAttrs: false, setup: () => () => vue.h("div", { "data-stub": name }) }) }));
vi.mock("../../src/components/mercbot/MercbotHomeSwitcher.vue", async () => stub(await import("vue"), "MercbotHomeSwitcher"));
vi.mock("../../src/components/mercbot/MercbotAccountMenu.vue", async () => stub(await import("vue"), "MercbotAccountMenu"));
const { mentionBotsOf, mentionPeopleOf, useComposerTokens } = await import("../../src/components/mercbot/useComposerTokens.js");
const { default: MercbotTimeline } = await import("../../src/components/mercbot/MercbotTimeline.vue");
const { default: MercbotChatList } = await import("../../src/components/mercbot/MercbotChatList.vue");

const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const CARLA = { userId: "3", name: "Carla Bianchi" };
const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false, waitingTask: null };
const KITCHEN = { id: "5", kind: "public", title: "Kitchen reno", directBotId: null, people: [ANNA, BEN, CARLA], bots: [CHEF] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An app's component rendered as the server renders a page, its apostrophes as written, without scoped styles' marks. */
async function rendered(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
}

describe("a person's mention in the text", () => {
  it("reads as the person the message names, and as @someone for anyone it doesn't", () => {
    const people = [{ id: "2", name: "Ben Rossi" }];
    const mentions = [{ id: "2", name: "Chef" }];
    const text = "<@person:2> and <@bot:2>, ask <@person:3>";
    expect(mentionParts(text, mentions, [], people)).toEqual([
      { person: people[0] }, { text: " and " }, { bot: mentions[0] }, { text: ", ask " }, { text: "@someone" }
    ]);
    expect(plainMentions(text, mentions, [], people)).toBe("@Ben Rossi and @Chef, ask @someone");
    expect(plainMentions("<@person:2>", mentions), "a person marker never reads as a bot of the same id").toBe("@someone");
  });
});

describe("@ in the composer", () => {
  /** The composer's tokens in `chat` for Anna (id "1"), with a field whose caret sits at the end of what's typed. */
  function composer(chat) {
    const draft = ref("");
    const field = { selectionStart: 0, selectionEnd: 0, focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
    const tokens = useComposerTokens({
      draft,
      input: ref(field),
      several: ref(hasSeveral(chat)),
      mentionBots: ref(mentionBotsOf(chat)),
      mentionPeople: ref(mentionPeopleOf(chat, "1")),
      chatId: ref(chat.id)
    });
    const type = async (text) => {
      draft.value = text;
      field.selectionStart = field.selectionEnd = text.length;
      tokens.updateMention();
      await settle();
    };
    return { draft, tokens, type };
  }

  it("offers the chat's other people before its bots, never the person writing", async () => {
    const { tokens, type } = composer(KITCHEN);
    await type("@");
    expect(tokens.mentionRows.value.map((row) => `${row.kind}:${row.label}`)).toEqual(["everyone:everyone", "person:Ben Rossi", "person:Carla Bianchi", "bot:Chef"]);
    await type("@an");
    expect(tokens.mentionRows.value, "Anna isn't offered to herself").toEqual([]);
    await type("@ca");
    expect(tokens.mentionRows.value.map((row) => row.label)).toEqual(["Carla Bianchi"]);
  });

  it("sends a chosen person as their marker, beside a bot's", async () => {
    const { draft, tokens, type } = composer(KITCHEN);
    await type("@");
    tokens.insertMention(tokens.mentionRows.value.find((row) => row.label === "Ben Rossi"));
    await settle(); // the caret moves past the token on the next tick, as the person goes on typing after it
    await type(`${draft.value}and @`);
    tokens.insertMention(tokens.mentionRows.value.find((row) => row.label === "Chef"));
    expect(draft.value).toBe("@Ben Rossi and @Chef ");
    expect(tokens.withMarkers(draft.value)).toBe("<@person:2> and <@bot:7> ");
  });

  it("offers no one in a direct chat", async () => {
    const { tokens, type } = composer({ ...KITCHEN, directBotId: "7", people: [ANNA] });
    await type("@");
    expect(tokens.mention.value).toBe(null);
  });
});

describe("a message that mentions people", () => {
  it("shows each by name, the person reading marked", async () => {
    const message = {
      id: "41", kind: "text", role: "user", authorUserId: "3", authorBotId: null, createdAt: "2026-11-22T10:00:00.000Z",
      body: { text: "<@person:1> and <@person:2>, oak?", mentionedPeople: [{ id: "1", name: "Anna Rossi" }, { id: "2", name: "Ben Rossi" }], authorName: "Carla Bianchi" }
    };
    setCurrentHome("rossi");
    const html = await rendered(MercbotTimeline, { me: "1", chat: KITCHEN, messages: [message] });
    // A chip's classes in any order (the page renders a bound class first).
    const chips = [...html.matchAll(/class="([^"]*)"[^>]*>([^<]*)</gu)].map(([, classes, name]) => [classes.split(" "), name])
      .filter(([classes]) => classes.includes("mb-bubble__mention--person"))
      .map(([classes, name]) => `${name}${classes.includes("mb-bubble__mention--me") ? " (me)" : ""}`);
    expect(chips).toEqual(["@Anna Rossi (me)", "@Ben Rossi"]);
  });
});

describe("the chat list's @", () => {
  const listed = (id, title, place) => toChatRow({
    id, kind: "public", title, everyone: false, directBotId: null, archivedAt: null, lastActivityAt: `2026-11-22T10:0${id}:00.000Z`,
    people: [ANNA, BEN], bots: [CHEF], latest: null, place: { pinPosition: null, sectionId: null, hidden: false, unread: false, mentioned: false, ...place }
  });
  /** What each row and tile shows at its end: "@", "unread" or nothing. */
  const markers = (html) => [...html.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/button>/gu)]
    .filter(([, label]) => ["Kitchen", "Garden", "Bathroom", "Party"].includes(label))
    .map(([, label, inside]) => [label, /aria-label="Mentioned you"[^>]*>@</u.test(inside) ? "@" : /aria-label="Unread"/u.test(inside) ? "unread" : ""]);

  it("shows on a chat where someone mentioned the person, unread since, row or tile, in place of the dot", async () => {
    const chats = [
      listed("1", "Kitchen", { unread: true, mentioned: true }),
      listed("2", "Garden", { unread: true }),
      listed("3", "Bathroom", {}),
      listed("4", "Party", { unread: true, mentioned: true, pinPosition: 0 })
    ];
    expect(chats.map((chat) => chat.mentioned)).toEqual([true, false, false, true]);
    const html = await rendered(MercbotChatList, { model: buildSidebarModel({ chats, sections: [] }), sections: [], me: "1" });
    expect(markers(html)).toEqual([["Party", "@"], ["Bathroom", ""], ["Garden", "unread"], ["Kitchen", "@"]]);
  });
});
