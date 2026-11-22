import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Settings → Main bot and Builder (D-119): the home's owners and admins choose the main bot and the Builder from the
// home's bots (the server's rules as before); everyone else reads them. The routes are stand-ins; the section reads them
// before it renders, as a browser shows them a moment after it opens.
vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal();
  const onMounted = (hook) => (vue.getCurrentInstance()?.type.__name === "MercbotSettingsMainBot" ? vue.onServerPrefetch(hook) : vue.onMounted(hook));
  return { ...vue, onMounted };
});
const canBuild = vi.hoisted(() => ({ value: true }));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: {
    list: async () => ({
      bots: [
        { id: "1", name: "Otto", isMain: true, archivedAt: null },
        { id: "2", name: "Chef", isMain: false, archivedAt: null },
        { id: "3", name: "Gone", isMain: false, archivedAt: "2026-11-20T10:00:00.000Z" }
      ]
    })
  }
}));
vi.mock("../../src/components/apps/appsApi.js", () => ({
  appsApi: { builder: async () => ({ builder: { id: "2", name: "Chef" }, canManage: canBuild.value }) }
}));
const { default: MercbotSettingsMainBot } = await import("../../src/components/mercbot/MercbotSettingsMainBot.vue");

async function rendered(props) {
  const app = createSSRApp({ render: () => h(MercbotSettingsMainBot, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'");
}
const pickers = (html) => [...html.matchAll(/<button[^>]*class="mb-select"[^>]*aria-label="([^"]*)"/gu)].map(([, label]) => label);

describe("Settings' main bot and Builder", () => {
  it("lets the home's owners and admins pick the main bot and the Builder", async () => {
    canBuild.value = true;
    const html = await rendered({ manages: true });
    expect(pickers(html)).toEqual(["Main bot", "Builder"]);
    expect(html).toContain("Otto");
    expect(html).not.toContain("Only the home's owners and admins can change these.");
  });

  it("shows everyone else which bots they are, with nothing to change", async () => {
    canBuild.value = false;
    const html = await rendered({ manages: false });
    expect(pickers(html)).toEqual([]);
    expect(html).toMatch(/data-main-bot[^>]*>Otto</u);
    expect(html).toMatch(/data-builder[^>]*>Chef</u);
    expect(html).toContain("Only the home's owners and admins can change these.");
  });
});
