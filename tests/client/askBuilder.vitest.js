import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ask Builder (D-41) opens the app's own chat with the Builder, which the server makes the first time anyone asks
// (POST …/apps/:slug/chat), with the line about the app waiting in its composer; a view's Ask opens the person's direct
// chat with the view's bot the same way.
const asked = vi.hoisted(() => ({ calls: [] }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    appChat: async (slug) => {
      asked.calls.push(["appChat", slug]);
      return { chat: { id: "31", kind: "public", appId: "4", title: "Bookings" } };
    },
    direct: async (botId) => {
      asked.calls.push(["direct", botId]);
      return { chat: { id: "12", kind: "private", directBotId: botId } };
    }
  }
}));
const { askBuilder, askInChat } = await import("../../src/components/apps/askInChat.js");

let stored;
beforeEach(() => {
  asked.calls = [];
  stored = new Map();
  vi.stubGlobal("window", { localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } });
});
afterEach(() => vi.unstubAllGlobals());

const routerOf = () => {
  const pushed = [];
  return { pushed, router: { push: async (to) => pushed.push(to) } };
};
const drafts = () => JSON.parse(stored.get("mercbot.chatDrafts") || "{}");

describe("asking about an app or a view", () => {
  it("Ask Builder opens the app's chat with the line drafted in it", async () => {
    const { pushed, router } = routerOf();
    await askBuilder(router, { chat: "/w/rossi", appSlug: "bookings", line: "About the app \"Bookings\" (bookings): " });
    expect(asked.calls).toEqual([["appChat", "bookings"]]);
    expect(drafts()).toEqual({ 31: "About the app \"Bookings\" (bookings): " });
    expect(pushed).toEqual([{ path: "/w/rossi", query: { chat: "31" } }]);
  });

  it("a view's Ask opens the person's direct chat with the view's bot, with its line", async () => {
    const { pushed, router } = routerOf();
    await askInChat(router, { chat: "/w/rossi", botId: "7", line: "About the view \"Rota\" (rota): " });
    expect(asked.calls).toEqual([["direct", "7"]]);
    expect(drafts()).toEqual({ 12: "About the view \"Rota\" (rota): " });
    expect(pushed).toEqual([{ path: "/w/rossi", query: { chat: "12" } }]);
  });
});
