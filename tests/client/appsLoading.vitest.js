import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Connect apps while its list is on its way: the loading state shows, never the sentences of an empty list, which are
// only for a home whose answer really is empty.
const list = vi.hoisted(() => ({ answer: null }));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({
  // The list's answer: held open (a promise that never settles) or given.
  pluginsApi: new Proxy({ list: () => list.answer }, { get: (api, name) => api[name] || (async () => ({})) }),
  openSignIn: () => {}
}));
vi.mock("../../src/components/mercbot/homesApi.js", async () => {
  const { computed } = await import("vue");
  return { useHomes: () => ({ current: computed(() => ({ name: "Rossi family", role: "owner" })) }) };
});
vi.mock("vue-router", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), useRoute: () => ({ query: {} }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
// The modal's dialog renders its content in place, as it does once it's open in a browser (on the server Vuetify's
// overlays render nothing).
vi.mock("vuetify/components/VDialog", async () => {
  const { defineComponent, h: render } = await import("vue");
  return { VDialog: defineComponent({ name: "VDialog", setup: (_props, { slots }) => () => render("div", { class: "v-dialog" }, slots.default?.()) }) };
});

const { default: MercbotAppsModal } = await import("../../src/components/mercbot/MercbotAppsModal.vue");

async function rendered(props) {
  const app = createSSRApp({ render: () => h(MercbotAppsModal, { modelValue: true, ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'");
}

const EMPTY_SENTENCES = ["No apps added yet.", "Skills your bots learn will show up here.", "Nothing here yet."];
const settled = (html) => EMPTY_SENTENCES.filter((sentence) => html.includes(sentence));

describe("Connect apps while its list loads", () => {
  it("shows the loading state on Your apps and skills, and none of the empty sentences", async () => {
    list.answer = new Promise(() => {});
    const html = await rendered({ startPage: "manage" });
    expect(html).toContain("Your apps and skills");
    expect(html).toContain("mb-apps-modal__skeleton");
    expect(settled(html)).toEqual([]);
  });

  it("shows the loading state on the catalogue, with no empty section", async () => {
    list.answer = new Promise(() => {});
    const html = await rendered({});
    expect(html).toContain("mb-apps-modal__skeleton");
    expect(settled(html)).toEqual([]);
  });
});
