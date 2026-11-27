import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Behind an app (Details): its versions come a page at a time, with Older versions. A page that didn't load says so
// above the tabs, and a later page that does load takes that alert away. The apps routes are stand-ins.
const api = vi.hoisted(() => ({ older: [] }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("../../src/components/apps/AppLogic.vue", () => ({ default: { name: "AppLogic", render: () => null } }));
vi.mock("../../src/components/apps/AppsActivity.vue", () => ({ default: { name: "AppsActivity", render: () => null } }));
vi.mock("../../src/components/apps/appsApi.js", () => ({
  errorText: (error, fallback) => error?.message || fallback,
  appsApi: {
    versions: async (_slug, after) => (after ? api.older.shift()() : { versions: [{ id: "3", number: 3 }], more: true }),
    tables: async () => ({ tables: [] })
  }
}));
const { default: AppDetailsPanel } = await import("../../src/components/apps/AppDetailsPanel.vue");

const loaded = { app: { id: "1", slug: "orders", name: "Orders" }, definition: { screens: {} }, version: { number: 3 } };

describe("an app's older versions", () => {
  it("takes away the alert of a page that didn't load once a later one does", async () => {
    api.older = [
      async () => { throw new Error("The versions couldn't be read."); },
      async () => ({ versions: [{ id: "2", number: 2 }], more: false })
    ];
    const app = createSSRApp({ render: () => h(AppDetailsPanel, { loaded, home: "casa" }) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
    const seen = [];
    app.mixin({
      async serverPrefetch() {
        if (this.$.type !== AppDetailsPanel) return;
        const setup = this.$.setupState;
        await new Promise((resolve) => setTimeout(resolve, 10));
        await setup.olderVersions();
        seen.push(setup.problem);
        await setup.olderVersions();
        seen.push(setup.problem);
      }
    });
    const html = await renderToString(app);
    expect(seen).toEqual(["The versions couldn't be read.", ""]);
    expect(html).not.toContain("couldn&#39;t be read");
  });
});
