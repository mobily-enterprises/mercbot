import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/theme/index.js";
import { APP_SCREEN_KEY } from "../../src/components/apps/screenKeys.js";
import AppNode from "../../src/components/apps/AppNode.vue";

// An app's text in the theme's Material 3 type scale: a headline, a title and body text each take a type role the
// theme sizes (the old text-h5 and text-h6 have no size in it, so they read as body text).
const runtime = { data: {}, loading: new Set(), evaluate: (value) => String(value).replace(/^=/u, ""), queryTable: () => null };

async function render(node) {
  const app = createSSRApp({ render: () => h(AppNode, { node, path: "content/0" }) });
  app.provide(APP_SCREEN_KEY, runtime);
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return renderToString(app);
}

describe("an app's text sizes", () => {
  it("are the theme's headline, title and body roles", async () => {
    expect(await render({ type: "text", value: "Ana Ruiz", size: "headline" })).toContain('class="text-headline-small"');
    expect(await render({ type: "text", value: "To-dos", size: "title" })).toContain('class="text-title-large"');
    expect(await render({ type: "text", value: "Notes" })).toContain('class="text-body-large"');
  });
});
