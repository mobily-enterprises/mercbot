import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import MercbotPageShare from "../../src/components/mercbot/MercbotPageShare.vue";
import extensions from "../../src/components/mercbot/extensions.js";
import { isHomePage } from "../../src/components/mercbot/filesApi.js";

// What a copy built on Mercbot adds to a web page's Share (pageShareParts) is for a page the server shares
// (pageDocument.js isPagePath): one in a Pages folder of a bot's folder or the home's, never a chat's page.
afterEach(() => {
  extensions.pageShareParts.length = 0;
});

/** How many times the added part was asked whether it shows, with the Share open on `path`. */
async function asked(path) {
  const visible = vi.fn(async () => true);
  extensions.pageShareParts.splice(0, extensions.pageShareParts.length, { component: { render: () => null }, visible });
  const app = createSSRApp({ render: () => h(MercbotPageShare, { modelValue: true, botId: "7", path, title: "Menu", homeName: "Rossi family" }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  await renderToString(app);
  return visible.mock.calls.length;
}

describe("a page's Share", () => {
  it("offers what a copy adds for a page of a bot's folder or the home's, never for a chat's", async () => {
    expect(await asked("/files/bot/Pages/menu.html")).toBe(1);
    expect(await asked("/files/shared/Kitchen/Pages/menu.html")).toBe(1);
    expect(await asked("/files/chat/Pages/menu.html")).toBe(0);
    expect(await asked("/files/bot/menu.html"), "an .html file outside a Pages folder").toBe(0);
  });

  it("knows a home's page as the server does", () => {
    expect(["/files/bot/Pages/menu.html", "/files/shared/Pages/menu.html", "/files/chat/Pages/menu.html", "/files/bot/Pages/menu.md", "/files/bot/Pages/a/menu.html"].map(isHomePage))
      .toEqual([true, true, false, false, false]);
  });
});
