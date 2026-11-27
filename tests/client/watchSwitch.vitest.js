import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// A bot's watches on its card (Apps): anyone who can open a watch's chat pauses it, and only whoever set it up resumes
// it, as it runs as them (canResume; the server answers 403 apps_watch_resume_forbidden to anyone else). The apps
// routes are stand-ins; the section reads them before it renders, as a browser shows them a moment after it opens.
vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal();
  const onMounted = (hook) => (vue.getCurrentInstance()?.type.__name === "MercbotAppsSection" ? vue.onServerPrefetch(hook) : vue.onMounted(hook));
  return { ...vue, onMounted };
});
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
const watch = (id, name, extra) => ({ id, name, on: "create", table: "Orders", condition: null, enabled: true, canResume: false, ...extra });
const refusal = vi.hoisted(() => Object.assign(new Error("Only whoever set this watch up can resume it."), { status: 403 }));
vi.mock("../../src/components/apps/appsApi.js", () => ({
  appsApi: {
    builder: async () => ({ builder: null, canManage: false }),
    setWatch: async () => { throw refusal; },
    removeWatch: async () => { throw refusal; },
    watches: async () => ({
      watches: [
        watch("1", "New orders", {}),
        watch("2", "Big orders", { enabled: false }),
        watch("3", "Late orders", { enabled: false, canResume: true })
      ]
    })
  }
}));
const { default: MercbotAppsSection } = await import("../../src/components/apps/MercbotAppsSection.vue");

describe("a bot's watches", () => {
  it("can be paused by anyone, and resumed only by whoever set it up", async () => {
    const app = createSSRApp({ render: () => h(MercbotAppsSection, { bot: { id: "7", name: "Chef" } }) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
    const html = await renderToString(app);
    const switches = [...html.matchAll(/<input[^>]*>/gu)].map(([input]) => `${/aria-label="([^"]*)"/u.exec(input)?.[1]}${/\sdisabled(?=[\s>=]|$)/u.test(input) ? ", held" : ""}`);
    expect(switches).toEqual(["Pause New orders", "Resume Big orders, held", "Resume Late orders"]);
  });

  it("passes a refused pause or remove on to the card, keeping the watch as it was", async () => {
    const failures = [];
    const unhandled = [];
    const app = createSSRApp({ render: () => h(MercbotAppsSection, { bot: { id: "7", name: "Chef" }, onFailure: (error) => failures.push(error) }) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
    const kept = watch("1", "New orders", {});
    app.mixin({
      async serverPrefetch() {
        if (this.$.type !== MercbotAppsSection) return;
        await this.$.setupState.toggle(kept).catch((error) => unhandled.push(error));
        await this.$.setupState.remove(kept).catch((error) => unhandled.push(error));
      }
    });
    const html = await renderToString(app);
    expect(unhandled, "nothing is left unhandled").toEqual([]);
    expect(failures).toEqual([refusal, refusal]);
    expect(kept.enabled).toBe(true);
    expect(html).toContain("aria-label=\"Pause New orders\"");
  });
});
