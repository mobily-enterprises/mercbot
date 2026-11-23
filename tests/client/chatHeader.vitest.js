import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";

// The open chat's header and composer (plan 4.4, 4.6): a private room's Invite and a public room's Invite a bot, neither
// in a direct chat (with a bot or a person), which says it's Private, only you and the other; and a public room the
// person isn't in opens with the composer, no Join, so writing there puts them in it. The timeline is a stand-in.
vi.mock("../../src/components/mercbot/MercbotTimeline.vue", async () => {
  const { defineComponent, h: render } = await import("vue");
  return { default: defineComponent({ name: "MercbotTimeline", setup: () => () => render("div", { "data-stub": "MercbotTimeline" }) }) };
});

const { default: MercbotChatPanel } = await import("../../src/components/mercbot/MercbotChatPanel.vue");

/** The panel's HTML for `chat`, as Anna sees it, its apostrophes and quotes as written. */
async function panel(chat) {
  const props = { chat, messages: [], me: "1", homeName: "Rossi family", columnWidth: 640, loadOlder: async () => {}, findOlder: async () => ({}), loadThrough: async () => {} };
  const app = createSSRApp({ render: () => h(MercbotChatPanel, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"");
}
const labels = (html) => [...html.matchAll(/aria-label="([^"]*)"/gu)].map(([, label]) => label);
const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();

const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const CHEF = { chatBotId: "70", botId: "7", name: "Chef", color: "#E65100", shape: "cloud", archived: false, waitingTask: null };
const room = (extra) => ({
  id: "9", kind: "public", title: "Kitchen reno", everyone: false, directBotId: null, directPerson: null, archivedAt: null, visiting: false,
  madeBy: "2", people: [ANNA, BEN], bots: [CHEF], ...extra
});

describe("the chat's header", () => {
  it("offers Invite to a room's people, public or private, and Invite a bot to someone reading a public room", async () => {
    shellPreferences.publicNoticeSeen = true;
    expect(labels(await panel(room({ kind: "private" })))).toContain("Invite");
    const open = labels(await panel(room()));
    expect(open).toContain("Invite");
    expect(open).not.toContain("Invite a bot");
    const reading = labels(await panel(room({ visiting: true, people: [BEN] })));
    expect(reading).toContain("Invite a bot");
    expect(reading).not.toContain("Invite");
  });

  it("offers neither in a direct chat, with a bot or a person, which says it's private to the two of you", async () => {
    const withChef = await panel(room({ kind: "private", title: null, directBotId: "7", people: [ANNA] }));
    expect(labels(withChef).filter((label) => label.startsWith("Invite"))).toEqual([]);
    expect(labels(withChef)).toContain("Continue with others…");
    expect(text(withChef)).toContain("Private · only you and Chef");
    expect(text(withChef)).not.toContain("This room is public");
    const withBen = await panel(room({ kind: "private", title: null, directPerson: { userId: "2", name: "Ben Rossi" }, bots: [] }));
    expect(labels(withBen).filter((label) => label.startsWith("Invite") || label.startsWith("Continue"))).toEqual([]);
    expect(text(withBen)).toContain("Private · only you and Ben Rossi");
  });

  it("opens a public room the person isn't in with the composer, and no Join", async () => {
    const html = await panel(room({ visiting: true, people: [BEN] }));
    expect(labels(html)).toContain("Message Kitchen reno");
    expect(text(html)).not.toContain("Join");
    expect(text(html)).not.toContain("You're reading a public chat");
  });
});
