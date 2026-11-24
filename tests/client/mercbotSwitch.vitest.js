import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import MercbotSwitch from "../../src/components/mercbot/MercbotSwitch.vue";

// A settings switch that's disabled, for good or while its change saves, reads as disabled to a screen reader
// (aria-disabled) and keeps its place in the keyboard's order: it has no disabled attribute, which would drop the
// keyboard's focus to the page as soon as it's set. Its look and its ignoring clicks, Space and Enter are the browser's
// to show (installed-app.spec.ts, notifications).
const render = (props) => renderToString(createSSRApp({ render: () => h(MercbotSwitch, { label: "Quiet hours", ...props }) }));

describe("a settings switch", () => {
  it("disabled, reads as disabled and stays focusable", async () => {
    const html = await render({ disabled: true, modelValue: true });
    expect(html).toMatch(/role="switch"/u);
    expect(html).toMatch(/aria-checked="true"/u);
    expect(html).toMatch(/aria-disabled="true"/u);
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/u);
  });

  it("enabled, says nothing of being disabled", async () => {
    const html = await render({ modelValue: false });
    expect(html).toMatch(/aria-checked="false"/u);
    expect(html).not.toMatch(/aria-disabled|\sdisabled(=|\s|>)/u);
  });
});
