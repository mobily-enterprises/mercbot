import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// A file shown large, with Edit on computer: when the bot's computer can't open it, the file stays shown and the
// computer's answer is said beside the button. Opening it on the computer is a stand-in that refuses.
vi.mock("../../src/components/mercbot/filesApi.js", async (importOriginal) => ({
  ...(await importOriginal()),
  openOnComputer: async () => { throw new Error("The computer is asleep."); }
}));
const { default: MercbotFileViewer } = await import("../../src/components/mercbot/MercbotFileViewer.vue");

describe("Edit on computer in the file viewer", () => {
  it("keeps the file shown and says why the computer couldn't open it, beside the button", async () => {
    const opened = [];
    const app = createSSRApp({
      render: () => h(MercbotFileViewer, { botId: "7", chatId: "5", file: { path: "/files/report.pdf", name: "report.pdf" }, onOpened: (where) => opened.push(where) })
    });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
    app.mixin({
      async serverPrefetch() {
        if (this.$.type !== MercbotFileViewer) return;
        // The preview as it loaded (the page's own fetch runs in a browser only).
        Object.assign(this.$.setupState, { preview: { kind: "pages", pages: ["/p1.png"], more: false }, loading: false });
        await this.$.setupState.edit();
      }
    });
    const html = (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
    expect(opened).toEqual([]);
    expect(html, "the file is still shown").toContain("alt=\"Page 1\"");
    expect(html).not.toContain("mb-viewer__problem");
    const bar = html.slice(html.indexOf("mb-viewer__bar"), html.indexOf("mb-viewer__body"));
    expect(bar).toContain("The computer is asleep.");
  });
});
