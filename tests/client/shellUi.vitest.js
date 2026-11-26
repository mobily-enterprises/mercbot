import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { provideShellUi, SHELL_UI_KEY } from "@jskit-ai/shell-web/client/ui";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/theme/index.js";
import { shellUi } from "../../src/shellUi.js";
import MercbotDialogFrame from "../../src/components/mercbot/MercbotDialogFrame.vue";
import MercbotUiButton from "../../src/components/mercbot/MercbotUiButton.vue";

// JSKIT's own screens in Mercbot's look (src/shellUi.js, docs/ui-style.md section 6): the kit JSKIT's shell-web takes, with
// Mercbot's button, dialog frame and a class on its type scale for every text role, and the button drawing each emphasis
// and tone as Mercbot's pill or its text button, with whatever a JSKIT view gives it passed through.
async function button(props = {}, label = "Sign in") {
  const app = createSSRApp({ render: () => h(MercbotUiButton, props, () => label) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replace(/ data-v-[0-9a-f]+|<!--[[\]]-->/gu, "");
}

describe("Mercbot's UI kit for JSKIT's screens", () => {
  it("passes shell-web's own check, with Mercbot's button and frame and a scale class for every text role", () => {
    const provided = new Map();
    provideShellUi({ provide: (key, value) => provided.set(key, value) }, shellUi);
    const kit = provided.get(SHELL_UI_KEY);
    expect(kit.Button).toBe(MercbotUiButton);
    expect(kit.Dialog).toBe(MercbotDialogFrame);
    expect(Object.keys(kit.text).sort()).toEqual(["body", "caption", "heading", "lead", "strong", "subheading", "title"]);
    for (const classes of Object.values(kit.text)) {
      expect(classes).toMatch(/^mb-text-(12|13|14|15|18|22)( mb-text-strong)?$/u);
    }
  });

  it("draws a main action as the dark pill, a medium or subtle one as the neutral pill and a danger one as the danger pill", async () => {
    expect(await button({ emphasis: "high" })).toContain('class="mb-set-pill mb-set-pill--dark"');
    expect(await button({ emphasis: "high", tone: "neutral", size: "large" })).toContain('class="mb-set-pill mb-set-pill--dark"');
    expect(await button()).toContain('<button type="button" class="mb-set-pill">');
    expect(await button({ emphasis: "subtle", tone: "neutral" })).toContain('class="mb-set-pill"');
    expect(await button({ emphasis: "high", tone: "danger" })).toContain('class="mb-set-pill mb-set-pill--danger"');
  });

  it("draws a low-emphasis action as a text button, in the error colour when it is a danger", async () => {
    expect(await button({ emphasis: "low" })).toMatch(/<button[^>]*class="v-btn[^"]*v-btn--variant-text/u);
    expect(await button({ emphasis: "low", tone: "danger" })).toMatch(/class="v-btn[^"]*text-error/u);
  });

  it("is a submit for another form, a link, the container's width, disabled, with an icon, as a view asks", async () => {
    expect(await button({ emphasis: "high", type: "submit", form: "code-form" })).toContain('<button type="submit" class="mb-set-pill mb-set-pill--dark" form="code-form">');
    expect(await button({ href: "/auth/login" })).toContain('<a href="/auth/login" class="mb-set-pill">');
    expect(await button({ emphasis: "low", href: "/" })).toMatch(/^<a [^>]*href="\/"/u);
    expect(await button({ emphasis: "high", block: true })).toContain('class="mb-set-pill mb-set-pill--dark mb-set-pill--block"');
    expect(await button({ disabled: true })).toContain(" disabled");
    expect(await button({ icon: "$refresh" })).toMatch(/^<button type="button" class="mb-set-pill"><i [^>]*class="[^"]*v-icon[^>]*><svg/u);
    expect(await button({ "data-testid": "auth-submit", "aria-label": "Sign in now" })).toContain('data-testid="auth-submit" aria-label="Sign in now"');
  });
});
