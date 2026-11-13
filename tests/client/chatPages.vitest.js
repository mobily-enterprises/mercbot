import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// A chat's pages: the store opens a chat on its newest page and puts older pages above it as
// the person scrolls up, against a stand-in for the messages route that pages as the server does.
const server = vi.hoisted(() => ({ messages: [], calls: [], finds: [] }));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: {
    update: async () => ({}),
    // Find in chat's count before the oldest message the page has, as the find route answers it.
    find: async (botId, room, text, before) => {
      server.finds.push({ text, before });
      const holding = server.messages.filter((message) => Number(message.id) < Number(before) && message.body.text.includes(text));
      return { count: holding.length, newest: holding.at(-1)?.id ?? null, oldest: holding[0]?.id ?? null };
    },
    messages: async (botId, room, since = null, before = null) => {
      server.calls.push({ since, before });
      if (since) return { messages: server.messages.filter((message) => message.changed >= Number(since)), cursor: String(server.cursor) };
      const older = before ? server.messages.filter((message) => Number(message.id) < Number(before)) : server.messages;
      const page = older.slice(-100);
      const answer = { messages: page, more: older.length > 100, ...(before ? {} : { cursor: String(server.cursor) }) };
      // A read held on its way (server.late) arrives with the chat as it was when it was asked.
      await server.late;
      return answer;
    }
  }
}));
const { useBotMessages } = await import("../../src/components/mercbot/useBotMessages.js");
const { findStep } = await import("../../src/components/mercbot/useFindInChat.js");

const ids = (list) => list.map((message) => Number(message.id));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

function chat(total) {
  server.messages = range(1, total).map((id) => ({ id: String(id), kind: "text", role: id % 2 ? "user" : "bot", body: { text: `Message ${id}` }, changed: 1 }));
  server.cursor = 2;
  server.calls = [];
  server.finds = [];
  server.late = null;
  const bots = ref([{ id: "7", name: "Otto", roomId: null }]);
  return useBotMessages({ bots, currentBotId: () => "7" });
}

describe("a chat's pages", () => {
  it("opens on the newest 100 and reads older pages above them, each message once, in order", async () => {
    const store = chat(250);
    await store.loadMessages("7");
    expect(ids(store.messagesByBot.value["7"])).toEqual(range(151, 250));
    expect(store.olderByBot.value["7"]).toBe(true);

    expect(await store.loadOlder("7")).toBe(true);
    expect(server.calls.at(-1)).toEqual({ since: null, before: "151" });
    expect(await store.loadOlder("7")).toBe(true);
    expect(ids(store.messagesByBot.value["7"])).toEqual(range(1, 250));
    expect(store.olderByBot.value["7"]).toBe(false);

    const reads = server.calls.length;
    expect(await store.loadOlder("7")).toBe(false);
    expect(server.calls.length, "nothing older is asked for").toBe(reads);
  });

  it("a late message from further back is shown once, in its place, when its page loads", async () => {
    const store = chat(150);
    // Message 31's transaction commits after the chat opens (D-15).
    const late = server.messages.splice(30, 1)[0];
    await store.loadMessages("7");
    expect(ids(store.messagesByBot.value["7"])).toEqual(range(51, 150));
    server.messages.splice(30, 0, { ...late, changed: 3 });
    await store.catchUp("7");
    expect(ids(store.messagesByBot.value["7"]), "not at the bottom").toEqual(range(51, 150));
    await store.loadOlder("7");
    expect(ids(store.messagesByBot.value["7"])).toEqual(range(1, 150));
  });

  it("a catch-up updates loaded messages and adds new ones, and leaves older changes to their page", async () => {
    const store = chat(250);
    await store.loadMessages("7");
    server.messages[9] = { ...server.messages[9], body: { text: "Answered further back" }, changed: 3 };
    server.messages[199] = { ...server.messages[199], body: { text: "Answered on screen" }, changed: 3 };
    server.messages.push({ id: "251", kind: "text", role: "bot", body: { text: "News" }, changed: 3 });
    await store.catchUp("7");
    const loaded = store.messagesByBot.value["7"];
    expect(ids(loaded)).toEqual(range(151, 251));
    expect(loaded.find((message) => message.id === "200").body.text).toBe("Answered on screen");

    await store.loadThrough("7", "10");
    const all = store.messagesByBot.value["7"];
    expect(ids(all)).toEqual(range(1, 251));
    expect(all.find((message) => message.id === "10").body.text, "its page brings the changed one").toBe("Answered further back");
  });

  it("a chat that loads late keeps what the page added meanwhile, after the page it read, until it is read again", async () => {
    const store = chat(3);
    let arrive = () => {};
    server.late = new Promise((resolve) => {
      arrive = resolve;
    });
    const loading = store.loadMessages("7");
    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    // The person sends before the chat has loaded: message 4 is saved after the read, and its reply can't be had.
    server.messages.push({ id: "4", kind: "text", role: "user", body: { text: "Sent while loading" }, changed: 3 });
    const failure = { id: "error-1", kind: "error", role: "system", body: { text: "Couldn't get a reply." } };
    store.appendMessages("7", [server.messages[3], failure]);
    arrive();
    await loading;
    const shown = () => store.messagesByBot.value["7"].map((message) => message.id);
    expect(shown()).toEqual(["1", "2", "3", "4", "error-1"]);

    // What showed when a read began (another tab of a shared bot, say) is replaced by it.
    server.late = null;
    await store.reloadMessages("7");
    expect(shown()).toEqual(["1", "2", "3", "4"]);
  });

  it("a message found in search brings the pages down to it, and no further", async () => {
    const store = chat(350);
    await store.loadThrough("7", "120");
    expect(ids(store.messagesByBot.value["7"])[0]).toBe(51);
    expect(store.olderByBot.value["7"]).toBe(true);
    while (await store.loadOlder("7"));
    expect(ids(store.messagesByBot.value["7"])).toEqual(range(1, 350));
  });
});

describe("find in chat", () => {
  it("counts the matches in the pages not loaded on the server, reading no page for it", async () => {
    const store = chat(350);
    await store.loadMessages("7");
    const reads = server.calls.length;
    expect(await store.findOlder("7", "Message 12")).toEqual({ count: 11, newest: "129", oldest: "12" });
    expect(server.finds).toEqual([{ text: "Message 12", before: "251" }]);
    expect(server.calls.length, "no page is read to find").toBe(reads);

    // Going to the newest of them brings the pages down to it, and no further; the rest are counted from there.
    await store.loadThrough("7", "129");
    expect(ids(store.messagesByBot.value["7"])[0]).toBe(51);
    expect(await store.findOlder("7", "Message 12")).toEqual({ count: 1, newest: "12", oldest: "12" });
    expect(server.finds.at(-1)).toEqual({ text: "Message 12", before: "51" });

    while (await store.loadOlder("7"));
    const asked = server.finds.length;
    expect(await store.findOlder("7", "Message 12")).toEqual({ count: 0, newest: null, oldest: null });
    expect(server.finds.length, "with every page loaded nothing is asked").toBe(asked);
  });

  it("numbers the matches oldest first, the older pages' before the page's, and steps into them by bringing pages down", () => {
    const at = (position, step) => findStep({ position, step, olderCount: 2, shownCount: 3 });
    expect(at(4, -1)).toEqual({ index: 1 });
    expect(at(2, 1)).toEqual({ index: 1 });
    expect(at(2, -1), "back from the oldest shown: the newest older match").toEqual({ bringDown: "newest" });
    expect(at(4, 1), "on from the last: wraps round to the very first").toEqual({ bringDown: "oldest" });
    expect(findStep({ position: 0, step: -1, olderCount: 0, shownCount: 3 }), "with nothing older, back wraps to the last").toEqual({ index: 2 });
    expect(findStep({ position: -1, step: 1, olderCount: 0, shownCount: 0 })).toBeNull();
  });
});
