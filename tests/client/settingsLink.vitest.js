import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Settings → Mercbot account, while the person approves the link on the hub: the copy checks every few seconds, one
// check at a time, so a check the hub is slow to answer is never overtaken by the next and "This copy is now linked" is
// said once. The link route is a stand-in whose check takes five seconds and answers that the copy is linked.
const hub = vi.hoisted(() => ({ checks: 0 }));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({
  bridgeApi: {
    status: async () => ({ linked: false, pending: true }),
    check: () => {
      hub.checks += 1;
      return new Promise((resolve) => setTimeout(() => resolve({ linked: true }), 5000));
    }
  }
}));
const { default: MercbotSettingsLink } = await import("../../src/components/mercbot/MercbotSettingsLink.vue");

afterEach(() => vi.useRealTimers());

describe("waiting for the hub to approve a link", () => {
  it("checks one at a time and says it's linked once", async () => {
    vi.useFakeTimers();
    const notices = [];
    const app = createSSRApp({ render: () => h(MercbotSettingsLink, { onNotify: (said) => notices.push(said) }) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
    app.mixin({
      serverPrefetch() {
        if (this.$.type === MercbotSettingsLink) this.$.setupState.waitForApproval();
      }
    });
    await renderToString(app);
    await vi.advanceTimersByTimeAsync(20000);
    expect(hub.checks).toBe(1);
    expect(notices).toEqual(["This copy is now linked"]);
  });
});
