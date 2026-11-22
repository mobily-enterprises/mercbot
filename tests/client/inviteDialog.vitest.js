import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { inviteChoices } from "../../src/components/mercbot/chatMenus.js";

// Invite (plan 4.6): a private room's Invite offers the home's people and bots not in it yet, as chips in one field; a
// public room's Invite a bot offers its bots only. Who's offered comes from the lists the shell already has, filtered
// here, with no request (inviteChoices); Add waits for a pick.
// The dialog renders its content in place, as it does once it's open in a browser (on the server Vuetify's overlays
// render nothing).
vi.mock("vuetify/components/VDialog", async () => {
  const { defineComponent, h: render } = await import("vue");
  return { VDialog: defineComponent({ name: "VDialog", setup: (_props, { slots }) => () => render("div", { class: "v-dialog" }, slots.default?.()) }) };
});

const { default: MercbotInviteDialog } = await import("../../src/components/mercbot/MercbotInviteDialog.vue");

/** The dialog's HTML, rendered with the app's Vuetify, its apostrophes and quotes as written. */
async function rendered(props) {
  const app = createSSRApp({ render: () => h(MercbotInviteDialog, { modelValue: true, people: PEOPLE, bots: BOTS, me: "1", ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"").replace(/ data-v-[0-9a-f]+/gu, "");
}
const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();

const PEOPLE = [{ id: "1", name: "Anna Rossi" }, { id: "2", name: "Ben Rossi" }, { id: "3", name: "Cara Bianchi" }];
const bot = (id, name, extra = {}) => ({ id, name, color: "#E65100", shape: "cloud", archivedAt: null, ...extra });
const BOTS = [bot("7", "Chef"), bot("8", "Shopper"), bot("9", "Pulse", { archivedAt: "2026-11-20T10:00:00Z" })];
const room = (extra) => ({
  id: "55", kind: "private", title: "Plans", people: [{ userId: "1", name: "Anna Rossi" }, { userId: "2", name: "Ben Rossi" }],
  bots: [{ chatBotId: "70", botId: "7", name: "Chef" }], directBotId: null, directPerson: null, ...extra
});

describe("Invite", () => {
  it("is Invite in a private room, offering its missing people first, then bots, never an archived one or the person", async () => {
    const html = await rendered({ chat: room() });
    expect(html).toContain("aria-label=\"Invite\"");
    expect(html).toMatch(/<h2 class="mb-ctemp__title">Invite<\/h2>/u);
    expect(text(html)).toContain("Whoever you invite to “Plans” sees everything said here, from its start.");
    expect(text(html)).toContain("People and bots");
    expect(inviteChoices(room(), { people: PEOPLE, bots: BOTS, me: "1" }).map((choice) => [choice.kind, choice.title]))
      .toEqual([["person", "Cara Bianchi"], ["bot", "Shopper"]]);
  });

  it("is Invite a bot in a public room, which everyone in the home can open already: bots only", async () => {
    const html = await rendered({ chat: room({ kind: "public", title: "Kitchen reno" }) });
    expect(html).toMatch(/<h2 class="mb-ctemp__title">Invite a bot<\/h2>/u);
    expect(text(html)).toContain("Everyone in the home can open “Kitchen reno” already.");
    expect(inviteChoices(room({ kind: "public" }), { people: PEOPLE, bots: BOTS, me: "1" }).map((choice) => choice.value)).toEqual(["bot:8"]);
  });

  it("waits for a pick before Add", async () => {
    const html = await rendered({ chat: room() });
    expect(html).toMatch(/<button type="submit"[^>]*disabled[^>]*>Add<\/button>/u);
  });
});
