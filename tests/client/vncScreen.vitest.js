import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// A bot's screen over VNC: a ticket is asked for the bot shown, then noVNC opens the screen with it. A change of bot or of
// whether its computer is awake (the screen's watch: disconnect, then connect again if awake), or leaving (disconnect),
// while a ticket is on its way never opens the screen that ticket was for: the screen asked for since opens, or nothing
// does. The ticket route, noVNC and the socket are stand-ins; the screen's own connect and disconnect are called as its
// watch and its leaving call them, on a stand-in for the element it draws in.
const vnc = vi.hoisted(() => ({ tickets: [], opened: [] }));
vi.mock("../../src/components/mercbot/computerApi.js", () => ({
  computerApi: { ticket: () => new Promise((resolve) => vnc.tickets.push(resolve)) }
}));
vi.mock("@novnc/novnc", () => ({
  default: class {
    constructor(target, channel) {
      vnc.opened.push(new URL(channel.url).searchParams.get("ticket"));
    }
    addEventListener() {}
    disconnect() {}
  }
}));
const { default: MercbotVncScreen } = await import("../../src/components/mercbot/MercbotVncScreen.vue");

/** Renders the screen, awake, once `act(setup)` has run on its own state and functions. */
async function screen(act) {
  const app = createSSRApp({ render: () => h(MercbotVncScreen, { botId: "7", awake: true }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  app.mixin({
    async serverPrefetch() {
      if (this.$.type !== MercbotVncScreen) return;
      this.$.setupState.target = { querySelector: () => null };
      await act(this.$.setupState);
    }
  });
  await renderToString(app);
}
// Answers the tickets asked for so far, in order: "first", "second", ...
const answerTickets = async () => {
  vnc.tickets.forEach((resolve, at) => resolve({ ticket: ["first", "second", "third"][at] }));
  await new Promise((resolve) => setTimeout(resolve, 20));
};

beforeEach(() => {
  vnc.tickets = [];
  vnc.opened = [];
  vi.stubGlobal("window", { location: { protocol: "http:", host: "mercbot.test" } });
  vi.stubGlobal("WebSocket", class { constructor(url) { this.url = url; } });
});
afterEach(() => vi.unstubAllGlobals());

describe("a bot's screen while its ticket is on its way", () => {
  it("opens the screen asked for since, with its own ticket, when the bot changes", async () => {
    await screen(async (setup) => {
      setup.connect();
      setup.disconnect();
      setup.connect();
      await answerTickets();
    });
    expect(vnc.tickets.length, "the new bot's ticket is asked for").toBe(2);
    expect(vnc.opened).toEqual(["second"]);
  });

  it("opens nothing once the computer is asleep or the screen is gone", async () => {
    await screen(async (setup) => {
      setup.connect();
      setup.disconnect();
      await answerTickets();
    });
    expect(vnc.opened).toEqual([]);
  });
});
