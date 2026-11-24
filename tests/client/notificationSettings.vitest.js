import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Settings → General → Notifications (D-133) before its settings arrive: rows in the shape of what comes, so nothing
// jumps when they do.
vi.mock("../../src/components/mercbot/accountApi.js", () => ({ accountApi: { push: () => new Promise(() => {}) }, saidByServer: (_error, words) => words }));
const { default: MercbotSettingsNotifications } = await import("../../src/components/mercbot/MercbotSettingsNotifications.vue");

describe("notification settings while they load", () => {
  it("shows placeholder rows, not a line of text", async () => {
    const app = createSSRApp({ render: () => h(MercbotSettingsNotifications) });
    app.use(createVuetify(createMaterialVuetifyOptions(theme)));
    const html = await renderToString(app);
    expect(html).toContain("v-skeleton-loader");
    expect(html).not.toContain("Loading…");
    expect(html).toContain('aria-busy="true"');
  });
});
