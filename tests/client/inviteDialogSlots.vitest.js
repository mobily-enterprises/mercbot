import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Invite's options and chips as the field draws them in a browser: Vuetify 4 hands its item and chip slots the option
// itself as `item` (its wrapper is `internalItem`), so each row and chip names the person or bot, a bot with its face.
// On the server the field's menu never opens, so a stand-in field draws both slots for every option, as Vuetify calls them.
vi.mock("vuetify/components/VDialog", async () => {
  const { defineComponent: component, h: render } = await import("vue");
  return { VDialog: component({ name: "VDialog", setup: (_props, { slots }) => () => render("div", slots.default?.()) }) };
});
vi.mock("@jskit-ai/http-web/client/components/SelectField", () => ({
  default: defineComponent({
    name: "SelectField",
    props: { items: { type: Array, default: () => [] } },
    setup: (props, { slots }) => () => h("div", props.items.flatMap((item, index) => [
      h("div", { class: "row" }, slots.item?.({ item, internalItem: { raw: item }, index, props: { title: item.title } })),
      h("div", { class: "chip" }, slots.chip?.({ item, internalItem: { raw: item }, index, props: {} }))
    ]))
  })
}));

const { default: MercbotInviteDialog } = await import("../../src/components/mercbot/MercbotInviteDialog.vue");

const room = { id: "55", kind: "private", title: "Plans", people: [{ userId: "1", name: "Anna Rossi" }], bots: [], directBotId: null, directPerson: null };
const PEOPLE = [{ id: "1", name: "Anna Rossi" }, { id: "2", name: "Ben Rossi" }];
const BOTS = [{ id: "7", name: "Chef", color: "#E65100", shape: "cloud", archivedAt: null }];

describe("Invite's options and chips", () => {
  it("name each person and bot the field offers, a bot as a bot", async () => {
    const app = createSSRApp({ render: () => h(MercbotInviteDialog, { modelValue: true, chat: room, people: PEOPLE, bots: BOTS, me: "1" }) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
    const html = await renderToString(app);
    const rows = [...html.matchAll(/<div class="row"[^>]*>([\s\S]*?)<\/div><div class="chip"/gu)].map((row) => row[1].replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim());
    expect(rows).toEqual([expect.stringContaining("Ben Rossi"), expect.stringContaining("Chef")]);
    expect(rows[0]).toContain("Person");
    expect(rows[1]).toContain("Bot");
  });
});
