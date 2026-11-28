import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/theme/index.js";
import { APP_SCREEN_KEY } from "../../src/components/apps/screenKeys.js";
import AppNode from "../../src/components/apps/AppNode.vue";
import AppCelebration from "../../src/components/apps/AppCelebration.vue";

// A progress bar (D-143): its value out of its most, as a whole percentage the bar and its words show, kept between 0
// and 100 whatever the numbers; nothing done yet (or nothing to do) is 0%.
const runtime = { data: {}, loading: new Set(), evaluate: (value) => (typeof value === "string" ? Number(value.replace(/^=/u, "")) : value), queryTable: () => null };

async function render(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.provide(APP_SCREEN_KEY, runtime);
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return renderToString(app);
}
const percentOf = (html) => /aria-valuenow="(\d+)"/u.exec(html)?.[1];

describe("an app's progress bar", () => {
  it("shows its value out of its most as a whole percentage", async () => {
    const html = await render(AppNode, { node: { type: "progress", value: "=3", max: "=8" }, path: "content/0" });
    expect([percentOf(html), html.includes(">38%<")]).toEqual(["38", true]);
  });

  it("is out of 100 unless it says, and stays between 0 and 100", async () => {
    const percents = [];
    for (const node of [{ value: 40 }, { value: "=12", max: "=8" }, { value: "=-2" }, { value: "=0", max: "=0" }]) {
      percents.push(percentOf(await render(AppNode, { node: { type: "progress", ...node }, path: "content/0" })));
    }
    expect(percents).toEqual(["40", "100", "0", "0"]);
  });
});

// A celebration (D-143): its words, read out to screen readers, with confetti over the app's area.
describe("an app's celebration", () => {
  it("says its words and throws confetti", async () => {
    const html = await render(AppCelebration, { message: "Lesson done!" });
    expect([html.includes('role="status"'), html.includes("Lesson done!"), html.match(/class="app-confetti__piece/gu)?.length]).toEqual([true, true, 24]);
  });
});
