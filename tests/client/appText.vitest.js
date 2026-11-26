import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/theme/index.js";
import { APP_SCREEN_KEY } from "../../src/components/apps/screenKeys.js";
import AppNode from "../../src/components/apps/AppNode.vue";

// An app's text on Mercbot's type scale (docs/ui-style.md, section 2), not Material 3's type roles: a headline is a
// page's title (22px), a title a section's (18px) and body text reading text (14px), each with its size's name for the
// app's own CSS.
const runtime = { data: {}, loading: new Set(), evaluate: (value) => String(value).replace(/^=/u, ""), queryTable: () => null };

async function render(node) {
  const app = createSSRApp({ render: () => h(AppNode, { node, path: "content/0" }) });
  app.provide(APP_SCREEN_KEY, runtime);
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return renderToString(app);
}

describe("an app's text sizes", () => {
  it("are the scale's page title, section title and reading text, each named for the app's CSS", async () => {
    expect(await render({ type: "text", value: "Ana Ruiz", size: "headline" })).toContain('class="app-text--headline mb-text-22"');
    expect(await render({ type: "text", value: "To-dos", size: "title" })).toContain('class="app-text--title mb-text-18"');
    expect(await render({ type: "text", value: "Notes" })).toContain('class="app-text--body mb-text-14"');
  });
});
