import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatEvents } from "../../src/components/mercbot/useChatEvents.js";
import { useChatWork } from "../../src/components/mercbot/useChatWork.js";

// A bot working in a chat shows on everyone's status line (R9), not only the asker's: the server tells each person in
// the chat ("working" events, chatSeats.js tell), and a page that didn't ask shows the asker's general wording, with
// the working bots' faces, until the last of them stops. The asker's own wording and a status a bot names stay.

vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onMounted: (run) => run(), onBeforeUnmount: () => {} }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { list: vi.fn(), get: vi.fn(async () => ({ chat: { id: "4" } })) }, sleep: async () => {} }));
vi.mock("../../src/components/mercbot/homesApi.js", async () => {
  const { ref: vueRef } = await vi.importActual("vue");
  return { homeChanges: vueRef(0), useHomes: () => ({ current: vueRef(null), load: async () => {} }) };
});

class FakeEvents {
  static opened = [];
  constructor() {
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

/** A person's page in chat 4, its events and its working state. */
function pageIn() {
  const store = {
    knowsChat: () => true,
    chatsNow: () => [],
    updateChat: vi.fn(),
    dropChat: vi.fn(),
    mergeChats: vi.fn(),
    messagesByChat: ref({ 4: [] }),
    catchUp: vi.fn(async () => {})
  };
  const work = useChatWork({ store });
  useChatEvents({
    store,
    work,
    team: { load: vi.fn(async () => {}), loadBots: vi.fn(), loadPeople: vi.fn(), dropBot: vi.fn() },
    onDropped: () => {},
    onComputer: () => {},
    onRooms: () => {}
  });
  const events = FakeEvents.opened.at(-1);
  const working = (botId, isWorking, status) => events.send("working", { chatId: "4", botId, working: isWorking, ...(status ? { status } : {}) });
  return { work, working, line: () => work.workByChat.value["4"] || "", faces: () => work.speakersByChat.value["4"] || [] };
}

beforeEach(() => {
  FakeEvents.opened.length = 0;
});

describe("a bot working, on the page of someone who didn't ask (R9)", () => {
  it("shows the bot working with the asker's wording, and clears once it stops", () => {
    const ben = pageIn();
    ben.working("7", true);
    expect([ben.line(), ben.faces()]).toEqual(["Thinking it over", ["7"]]);
    ben.working("7", false);
    expect([ben.line(), ben.faces()]).toEqual(["", []]);
  });

  it("stays while any bot still works, and clears when the last one stops", () => {
    const ben = pageIn();
    ben.working("7", true);
    ben.working("8", true);
    ben.working("7", false);
    expect([ben.line(), ben.faces()]).toEqual(["Thinking it over", ["8"]]);
    ben.working("8", false);
    expect(ben.line()).toBe("");
  });

  it("shows a status a bot names, which a later start without one doesn't replace", () => {
    const ben = pageIn();
    ben.working("7", true, "Learning the task");
    expect(ben.line()).toBe("Learning the task");
    ben.working("8", true);
    expect(ben.line()).toBe("Learning the task");
  });
});

describe("the asker's own page", () => {
  it("keeps its own wording as the work goes on", () => {
    const anna = pageIn();
    anna.work.setWork("4", "Writing a reply");
    anna.working("7", true);
    expect(anna.line()).toBe("Writing a reply");
  });
});
