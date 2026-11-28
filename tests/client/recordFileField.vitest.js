import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/theme/index.js";
import RecordFileField from "../../src/components/apps/RecordFileField.vue";

// A record's file field while its file goes up (D-130): how much has gone, as a bar and in words, once the browser says.
const field = { key: "file", label: "Book file", type: "file", options: {} };
function render(props) {
  const app = createSSRApp({ render: () => h(RecordFileField, { field, ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return renderToString(app);
}

describe("a file field while its file goes up", () => {
  it("shows how much has gone, in words and on its bar", async () => {
    const html = await render({ busy: true, progress: 42 });
    expect(html).toContain("Uploading… 42%");
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="42"/u);
  });

  it("shows a moving bar and no number before the browser has said, and nothing once it's done", async () => {
    const before = await render({ busy: true, progress: null });
    expect(before).not.toContain("Uploading…");
    expect(before).toContain("v-progress-linear__indeterminate");
    expect(await render({ busy: false, progress: 100 })).not.toContain("Uploading…");
  });
});
