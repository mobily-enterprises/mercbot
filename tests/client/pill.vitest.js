import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";

const { default: MercbotPill } = await import("../../src/components/mercbot/MercbotPill.vue");

// Every filled button is the pill (docs/ui-style.md, section 6): one button, `.mb-set-pill` in a tone, a button unless
// told otherwise, its label and whatever it is given passed through.
async function rendered(props = {}, label = "Save") {
  const app = createSSRApp({ render: () => h(MercbotPill, props, () => label) });
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)", component: { render: () => null } }] }));
  return (await renderToString(app)).replace(/ data-v-[0-9a-f]+|<!--[[\]]-->/gu, "");
}

describe("MercbotPill", () => {
  it("is a neutral button pill by default", async () => {
    expect(await rendered()).toBe('<button type="button" class="mb-set-pill">Save</button>');
  });
  it("draws the dark and danger tones, a submit, disabled, and passes attributes through", async () => {
    expect(await rendered({ tone: "dark" })).toContain('class="mb-set-pill mb-set-pill--dark"');
    expect(await rendered({ tone: "danger" })).toContain('class="mb-set-pill mb-set-pill--danger"');
    expect(await rendered({ type: "submit" })).toContain('type="submit"');
    expect(await rendered({ disabled: true })).toContain(" disabled");
    expect(await rendered({ "aria-label": "Save the note" })).toContain('aria-label="Save the note"');
  });
  it("is a link in the app with `to` and a link elsewhere with `href`, in the same look", async () => {
    expect(await rendered({ to: "/alerts", tone: "danger" })).toBe('<a href="/alerts" class="mb-set-pill mb-set-pill--danger">Save</a>');
    expect(await rendered({ href: "/" })).toBe('<a href="/" class="mb-set-pill">Save</a>');
  });
});
