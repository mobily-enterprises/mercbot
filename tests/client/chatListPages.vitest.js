import { describe, expect, it, vi } from "vitest";
import { chatsApi } from "../../src/components/mercbot/chatsApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";

// The chat list is answered a page at a time (packages/bots chatRepository.js ofPerson): the page reads every page,
// following each `next`, so the sidebar and the store's mergeChats always have the whole list. The route is a
// stand-in that answers three pages and records each call.
const calls = vi.hoisted(() => []);
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url) {
      calls.push(url);
      const after = new URL(url, "http://localhost").searchParams.get("after");
      const pages = { "": ["1", "2"], c1: ["3", "4"], c2: ["5"] };
      const next = { "": "c1", c1: "c2", c2: null }[after || ""];
      return { chats: pages[after || ""].map((id) => ({ id })), sections: [{ id: "9", name: "Work" }], next };
    }
  })
}));

describe("the chat list", () => {
  it("is read page by page until the last, with the same choices on every page", async () => {
    setCurrentHome("rossi");
    const listed = await chatsApi.list({ hidden: true, archived: true });
    expect(listed.chats.map((chat) => chat.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(listed.sections).toEqual([{ id: "9", name: "Work" }]);
    expect(typeof listed.startedAt).toBe("number");
    expect(calls).toEqual([
      "/api/w/rossi/chats?hidden=1&archived=1",
      "/api/w/rossi/chats?hidden=1&archived=1&after=c1",
      "/api/w/rossi/chats?hidden=1&archived=1&after=c2"
    ]);
  });
});
