import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import MercbotDrawer from "../../src/components/mercbot/MercbotDrawer.vue";
import { swipeCloses } from "../../src/components/mercbot/drawerSwipe.js";

// The phone's chat drawer (MercbotDrawer.vue): a swipe toward its edge closes it past a third of its width or as a quick
// flick, anything less springs back; on a phone it has a backdrop and its own sliding panel, elsewhere the list alone.
describe("swiping the chat drawer", () => {
  it("closes past a third of its width, or with a quick flick", () => {
    expect(swipeCloses({ dragged: -110, width: 300, ms: 900 })).toBe(true);
    expect(swipeCloses({ dragged: -60, width: 300, ms: 80 })).toBe(true);
  });

  it("springs back from a short or slow pull, a wobble, or a pull the other way", () => {
    expect(swipeCloses({ dragged: -90, width: 300, ms: 900 })).toBe(false);
    expect(swipeCloses({ dragged: -20, width: 300, ms: 10 })).toBe(false);
    expect(swipeCloses({ dragged: 0, width: 300, ms: 100 })).toBe(false);
    expect(swipeCloses({ dragged: 40, width: 300, ms: 50 })).toBe(false);
  });
});

/** The drawer around a stand-in list, as the page renders it. */
const render = async (props) => (await renderToString(createSSRApp({ render: () => h(MercbotDrawer, props, () => h("nav", "Chats")) })))
  .replaceAll(/<!--[^>]*-->/gu, "");

describe("the chat drawer", () => {
  it("on a phone, open: the list in its panel over a backdrop", async () => {
    const html = await render({ phone: true, open: true });
    expect(html).toContain("mb-drawer__scrim");
    expect(html).toMatch(/class="mb-drawer"[^>]*><nav>Chats<\/nav>/u);
  });

  it("on a phone, closed: no backdrop, and the panel hidden", async () => {
    const html = await render({ phone: true, open: false });
    expect(html).not.toContain("mb-drawer__scrim");
    expect(html).toMatch(/class="mb-drawer"[^>]*style="[^"]*display:\s*none/u);
  });

  it("elsewhere: the list alone, in its place", async () => {
    expect(await render({ phone: false, open: false })).toBe("<nav>Chats</nav>");
  });
});
