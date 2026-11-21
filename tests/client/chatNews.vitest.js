import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatsApi } from "../../src/components/mercbot/chatsApi.js";
import { useChatEvents } from "../../src/components/mercbot/useChatEvents.js";
import { useChatMessages } from "../../src/components/mercbot/useChatMessages.js";

// What the open page reads from the chat routes when news comes (D-15, D-112): a chat's news reads that chat alone, its
// messages only from where they were read up to, and only a chat the page doesn't know yet brings the whole list. The
// routes are stand-ins that record each call; the page's event stream is a stand-in the test sends events on.

vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onMounted: (run) => run(), onBeforeUnmount: () => {} }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { list: vi.fn(), get: vi.fn() } }));
vi.mock("../../src/components/mercbot/homesApi.js", async () => {
  const { ref: vueRef } = await vi.importActual("vue");
  return { homeChanges: vueRef(0), useHomes: () => ({ current: vueRef(null), load: async () => {} }) };
});

class FakeEvents {
  static opened = [];
  constructor(url) {
    this.url = url;
    this.handlers = new Map();
    FakeEvents.opened.push(this);
  }
  addEventListener(type, handler) {
    this.handlers.set(type, handler);
  }
  close() {}
  send(type, data) {
    return this.handlers.get(type)({ data: JSON.stringify(data) });
  }
}
vi.stubGlobal("EventSource", FakeEvents);

/** The page's chats as useChatMessages keeps them, a stand-in recording what it's given, with chat 4's messages loaded. */
function storeWith(chatIds) {
  const known = new Set(chatIds);
  return {
    knowsChat: (chatId) => known.has(chatId),
    updateChat: vi.fn(),
    dropChat: vi.fn((chatId) => known.delete(chatId)),
    mergeChats: vi.fn(),
    messagesByChat: ref({ 4: [] }),
    catchUp: vi.fn(async () => {})
  };
}

/** The page listening to its news, with what it gave useChatEvents. */
function listening(chatIds) {
  const store = storeWith(chatIds);
  const dropped = [];
  const computers = [];
  const page = {
    store,
    work: { replyNews: vi.fn() },
    team: { load: vi.fn(async () => {}), loadBots: vi.fn(), loadPeople: vi.fn(), dropBot: vi.fn() },
    onDropped: (chatId) => dropped.push(chatId),
    onComputer: (news) => computers.push(news)
  };
  const { computerNews } = useChatEvents(page);
  return { ...page, dropped, computers, computerNews, events: FakeEvents.opened.at(-1) };
}

/** What the news started finishes. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  FakeEvents.opened.length = 0;
});

describe("news of a chat's messages (D-15)", () => {
  it("reads only what changed in that chat, and that chat's row alone", async () => {
    chatsApi.get.mockResolvedValue({ chat: { id: "4", title: "Kitchen", place: null } });
    const { store, work, events } = listening(["4", "5"]);
    events.send("messages", { chatId: 4 });
    await settled();
    expect(store.catchUp.mock.calls).toEqual([["4"]]);
    expect(chatsApi.get.mock.calls).toEqual([["4"]]);
    expect(chatsApi.list).not.toHaveBeenCalled();
    expect(store.updateChat).toHaveBeenCalledWith({ id: "4", title: "Kitchen", place: null });
    expect(work.replyNews, "a reply waiting on the chat hears of it").toHaveBeenCalledWith("4");
  });

  it("brings the whole list for a chat the page doesn't know yet, with when that read began", async () => {
    chatsApi.list.mockResolvedValue({ chats: [{ id: "7", title: "New" }], sections: [], startedAt: 12 });
    const { store, events } = listening(["4"]);
    events.send("messages", { chatId: "7" });
    await settled();
    expect(chatsApi.list).toHaveBeenCalledWith({ hidden: true, archived: true });
    expect(chatsApi.get).not.toHaveBeenCalled();
    expect(store.catchUp).not.toHaveBeenCalled();
    expect(store.mergeChats, "with when the read began").toHaveBeenCalledWith([{ id: "7", title: "New" }], 12);
  });
});

describe("news that a chat changed (D-112)", () => {
  it("reads that chat alone, and takes it off the list once the person can no longer open it", async () => {
    chatsApi.get.mockResolvedValue({ chat: { id: "4", title: "Renamed", place: null } });
    const { store, dropped, events } = listening(["4", "5"]);
    events.send("chat", { chatId: 4, change: "renamed" });
    await settled();
    expect(chatsApi.get.mock.calls).toEqual([["4"]]);
    expect(chatsApi.list).not.toHaveBeenCalled();
    expect(store.updateChat).toHaveBeenCalledWith({ id: "4", title: "Renamed", place: null });
    expect(store.catchUp, "its messages aren't read for it").not.toHaveBeenCalled();

    // Taken out of a private chat: reading it is refused.
    chatsApi.get.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    events.send("chat", { chatId: "5", change: "members" });
    await settled();
    expect([store.dropChat.mock.calls, dropped]).toEqual([[["5"]], ["5"]]);

    // A read that failed for any other reason leaves the chat where it is.
    chatsApi.get.mockRejectedValue(Object.assign(new Error("Bad gateway"), { status: 502 }));
    events.send("chat", { chatId: "4", change: "renamed" });
    await settled();
    expect(store.dropChat).toHaveBeenCalledTimes(1);
  });

  it("drops a deleted chat without reading it, and reads the list for a chat someone started with the person", async () => {
    chatsApi.list.mockResolvedValue({ chats: [{ id: "8" }], sections: [], startedAt: 30 });
    const { store, dropped, events } = listening(["4"]);
    events.send("chat", { chatId: "4", change: "deleted" });
    expect([store.dropChat.mock.calls, dropped]).toEqual([[["4"]], ["4"]]);
    events.send("chat", { chatId: "8", change: "created" });
    await settled();
    expect(chatsApi.get).not.toHaveBeenCalled();
    expect(store.mergeChats).toHaveBeenCalledWith([{ id: "8" }], 30);
  });
});

describe("news of the home's bots and of a bot's computer", () => {
  it("reads the team's bots, not the chats, and counts each computer's news in each chat, with who has it now (D16)", () => {
    const { team, computers, computerNews, events } = listening(["4"]);
    events.send("bot", { botId: 9, change: "updated" });
    events.send("bot", { botId: 9, change: "deleted" });
    expect([team.loadBots.mock.calls.length, team.dropBot.mock.calls]).toEqual([1, [["9"]]]);
    expect([chatsApi.list.mock.calls.length, chatsApi.get.mock.calls.length]).toEqual([0, 0]);
    events.send("computer", { chatId: 4, botId: 9, control: 2 });
    events.send("computer", { chatId: 4, botId: 9, control: null });
    events.send("computer", { chatId: 5, botId: 9 });
    expect(computerNews.value).toEqual({ "4 9": 2, "5 9": 1 });
    expect(computers, "a person's id, or null once its bot has it back").toEqual([
      { chatId: "4", botId: "9", control: "2" }, { chatId: "4", botId: "9", control: null }, { chatId: "5", botId: "9", control: null }
    ]);
  });
});

describe("the list as a read answered it (D-15)", () => {
  /** A chat the person is in, as the server answers it. */
  const chatView = (id, title) => ({
    id, kind: "public", title, everyone: false, lastActivityAt: "2026-11-01T10:00:00Z", people: [], bots: [], place: { pinPosition: null }, latest: null
  });

  it("keeps a chat this page made after the read began, which that read couldn't know", () => {
    const chats = ref([]);
    const store = useChatMessages({ chats, currentChatId: () => "4" });
    store.mergeChats([chatView("4", "Kitchen")]);
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    try {
      store.addChat(chatView("9", "Plans"));
      store.mergeChats([chatView("4", "Kitchen"), chatView("5", "Budget")], 50);
      expect(chats.value.map((chat) => chat.id), "a read begun before the chat was made").toEqual(["4", "5", "9"]);
      store.mergeChats([chatView("4", "Kitchen"), chatView("5", "Budget")]);
      expect(chats.value.map((chat) => chat.id), "a list read just now").toEqual(["4", "5"]);
      store.addChat(chatView("9", "Plans"));
      store.mergeChats([chatView("4", "Kitchen")], 150);
      expect(chats.value.map((chat) => chat.id), "a read begun after the chat was made").toEqual(["4"]);
    } finally {
      now.mockRestore();
    }
  });
});
