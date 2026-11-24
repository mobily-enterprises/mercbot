import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/theme/index.js";

// A record's file or picture field in a form (D-130): what it holds, as a fixed-size thumbnail with the file's name as
// its text, Remove naming what it takes away, and, while a file goes up, the field itself showing it and taking no other.
const { default: RecordFileField } = await import("../../src/components/apps/RecordFileField.vue");

const picture = { key: "picture", label: "Picture", type: "image", options: {} };
const current = { path: "/files/db/tables/graphics/5/picture/poster.png", name: "poster.png", size: 2048, type: "image/png" };

async function rendered(props) {
  const app = createSSRApp({ render: () => h(RecordFileField, { field: picture, ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
}

describe("a record's picture field", () => {
  it("shows the picture at a fixed size with its name as its text, and Remove names what it takes away", async () => {
    const html = await rendered({ current });
    expect(html).toMatch(/<div class="v-responsive v-img[^"]*" style="height:72px;width:72px;" aria-label="poster.png" role="img">/u);
    expect(html).toMatch(/<button[^>]*aria-label="Remove poster.png"[^>]*>/u);
    expect(html).toContain("Replace picture");
  });

  it("while its file goes up, shows it in the field and takes no other, Remove too; another field only takes none", async () => {
    const html = await rendered({ current, busy: true });
    expect(html).toContain("v-input--disabled");
    expect(html).toContain("v-field--loading");
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Remove poster.png"|<button[^>]*aria-label="Remove poster.png"[^>]*disabled/u);
    const other = await rendered({ current, disabled: true });
    expect(other).toContain("v-input--disabled");
    expect(other).not.toContain("v-field--loading");
    const idle = await rendered({ current });
    expect(idle).not.toContain("v-input--disabled");
  });
});
