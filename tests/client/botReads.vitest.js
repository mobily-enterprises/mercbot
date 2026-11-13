import { computed, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { botsApi, notebookChanges } from "../../src/components/mercbot/botsApi.js";
import { useBotEvents } from "../../src/components/mercbot/useBotEvents.js";
import { useBotMessages } from "../../src/components/mercbot/useBotMessages.js";
import { useBotNotebook } from "../../src/components/mercbot/useBotNotebook.js";

// What the open page reads from the bots routes when news comes (D-15, D-36): a bot whose sharing or tabs changed is
// read alone, and the home notebook is read on the Details tab only, a page at a time. The routes are stand-ins that
// record each call; the page's event stream is a stand-in the test sends events on.

vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onMounted: (run) => run(), onBeforeUnmount: () => {} }));
vi.mock("../../src/components/mercbot/botsApi.js", async () => {
  const { ref: vueRef } = await vi.importActual("vue");
  return { notebookChanges: vueRef(0), botsApi: { list: vi.fn(), bot: vi.fn(), notebook: vi.fn(), removeNote: vi.fn() } };
});
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

/** The page's bots as useBotMessages keeps them, with the chat of bot 4 loaded. */
function storeWith(bots) {
  const known = new Map(bots.map((bot) => [bot.id, { ...bot }]));
  return {
    knowsBot: (botId) => known.has(botId),
    roomOf: (botId) => known.get(botId)?.roomId ?? null,
    updateBot: vi.fn((bot) => known.set(bot.id, { ...known.get(bot.id), ...bot })),
    mergeBots: vi.fn((list) => list.forEach((bot) => known.set(bot.id, bot))),
    messagesByBot: ref({ 4: [] }),
    reloadMessages: vi.fn(async () => {}),
    catchUp: vi.fn(async () => {})
  };
}

/** Watchers run, then what they started finishes. */
async function settled() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEvents.opened.length = 0;
});

describe("news that a bot changed (D-36)", () => {
  it("reads that bot alone, and its chat again when the tab it shows changed", async () => {
    botsApi.bot.mockResolvedValue({ bot: { id: "4", sharing: "shared", roomId: "9" } });
    const store = storeWith([{ id: "4", sharing: "mixed", roomId: null }]);
    useBotEvents({ store, work: {}, dropBot: () => {} });
    await FakeEvents.opened[0].send("changed", { botId: "4" });
    expect(botsApi.bot).toHaveBeenCalledWith("4");
    expect(botsApi.list).not.toHaveBeenCalled();
    expect(store.updateBot).toHaveBeenCalledWith({ id: "4", sharing: "shared", roomId: "9" });
    expect(store.reloadMessages).toHaveBeenCalledWith("4");
  });

  it("brings the whole list for a bot the page doesn't know yet, or can no longer read alone", async () => {
    botsApi.list.mockResolvedValue({ bots: [{ id: "7", name: "New" }], startedAt: 12 });
    const store = storeWith([{ id: "5", roomId: null }]);
    useBotEvents({ store, work: {}, dropBot: () => {} });
    await FakeEvents.opened[0].send("changed", { botId: "7" });
    expect(botsApi.bot).not.toHaveBeenCalled();
    expect(store.mergeBots, "with when the read began").toHaveBeenCalledWith([{ id: "7", name: "New" }], 12);
    botsApi.bot.mockRejectedValue(new Error("gone"));
    await FakeEvents.opened[0].send("changed", { botId: "5" });
    expect(botsApi.list).toHaveBeenCalledTimes(2);
  });
});

describe("the list as a read answered it (D-15)", () => {
  it("keeps a bot this page made after the read began, which that read couldn't know", () => {
    const bots = ref([{ id: "4", name: "Otto" }]);
    const store = useBotMessages({ bots, currentBotId: () => "4" });
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    try {
      store.addBot({ id: "9", name: "Pip" });
      store.mergeBots([{ id: "4", name: "Otto" }, { id: "5", name: "Vera" }], 50);
      expect(bots.value.map((bot) => bot.id), "a read begun before the bot was made").toEqual(["4", "5", "9"]);
      store.mergeBots([{ id: "4", name: "Otto" }, { id: "5", name: "Vera" }]);
      expect(bots.value.map((bot) => bot.id), "a list read just now").toEqual(["4", "5"]);
      store.addBot({ id: "9", name: "Pip" });
      store.mergeBots([{ id: "4", name: "Otto" }], 150);
      expect(bots.value.map((bot) => bot.id), "a read begun after the bot was made").toEqual(["4"]);
    } finally {
      now.mockRestore();
    }
  });
});

describe("the home notebook (D-36)", () => {
  // `count` notes from id `from` down, and the next page's cursor.
  const page = (from, count, next) => ({ notes: Array.from({ length: count }, (_, index) => ({ id: String(from - index), text: `Note ${from - index}` })), next });

  it("is read on the Details tab only, a page at a time, and again on news there", async () => {
    botsApi.notebook.mockImplementation(async (_botId, after) => (after ? page(50, 50, null) : page(100, 50, "cursor-1")));
    const bot = ref({ id: "4", sharing: "mixed", lastActivityAt: "1" });
    const tab = ref("files");
    const { notes, notesLoaded, notesNext, moreNotes } = useBotNotebook({ bot: () => bot.value, isGroup: computed(() => false), tab, onFailure: (error) => { throw error; } });
    await settled();
    bot.value = { ...bot.value, lastActivityAt: "2" };
    await settled();
    expect(botsApi.notebook, "news while another tab is shown").not.toHaveBeenCalled();

    tab.value = "details";
    await settled();
    expect(botsApi.notebook).toHaveBeenCalledTimes(1);
    expect([notes.value.length, notesNext.value, notesLoaded.value]).toEqual([50, "cursor-1", true]);
    await moreNotes();
    expect(botsApi.notebook).toHaveBeenLastCalledWith("4", "cursor-1");
    expect(notes.value.map((note) => note.id).slice(48, 52)).toEqual(["52", "51", "50", "49"]);
    expect(notesNext.value).toBe(null);

    // A new note: the newest page is read again, and the older notes already shown stay.
    botsApi.notebook.mockImplementation(async () => page(101, 50, "cursor-2"));
    bot.value = { ...bot.value, lastActivityAt: "3" };
    await settled();
    expect(botsApi.notebook).toHaveBeenCalledTimes(3);
    expect([notes.value.length, notes.value[0].id, notes.value.at(-1).id, notesNext.value]).toEqual([101, "101", "1", null]);
    notebookChanges.value += 1;
    await settled();
    expect(botsApi.notebook).toHaveBeenCalledTimes(4);
  });
});
