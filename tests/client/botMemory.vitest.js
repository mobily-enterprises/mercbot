import { computed, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { KIND_MEANS, publicNotice, readersLine, remembersLine } from "../../src/components/mercbot/chatView.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { madeLine, noteLine, useBotMemory } from "../../src/components/mercbot/useBotMemory.js";

// What the bots remember, as people see it (D-113): a public chat's composer and first-time notice say who reads it and
// which bots remember it, a private chat's say only its members read it; a bot's card reads its memory and the home's
// notes, pages through older notes and removes one. The routes are a stand-in that records each call.
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => new Map());
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url, options = {}) {
      calls.push([options.method || "GET", url]);
      const answer = [...answers].find(([pattern]) => pattern.test(url));
      if (!answer) throw new Error(`No answer for ${url}`);
      return typeof answer[1] === "function" ? answer[1](url) : answer[1];
    }
  })
}));

const ANNA = { userId: "1", name: "Anna Rossi" };
const BEN = { userId: "2", name: "Ben Rossi" };
const bot = (name, id) => ({ chatBotId: `7${id}`, botId: id, name });
const chat = (kind, bots) => ({ id: "5", kind, people: [ANNA, BEN], bots });

describe("who reads a chat, and which bots remember it", () => {
  it("names a public chat's bots, which remember it", () => {
    const where = { me: "1", homeName: "Rossi family" };
    expect(readersLine(chat("public", [bot("Chef", "1")]), where)).toBe("Everyone in Rossi family can read this · Chef remembers it");
    expect(readersLine(chat("public", [bot("Chef", "1"), bot("Ada", "2")]), where)).toBe("Everyone in Rossi family can read this · Chef and Ada remember it");
    const four = [bot("Chef", "1"), bot("Ada", "2"), bot("Otto", "3"), bot("Lia", "4")];
    expect(remembersLine(chat("public", four))).toBe("Chef, Ada and 2 more remember it");
    expect(readersLine(chat("public", []), where), "no bots, nothing remembered").toBe("Everyone in Rossi family can read this");
    expect(remembersLine(chat("public", [bot("Chef", "1"), { ...bot("Ada", "2"), archived: true }])), "an archived bot remembers nothing new").toBe("Chef remembers it");
    expect(readersLine(chat("public", [bot("Chef", "1")]), { ...where, short: true }), "a phone's composer").toBe("Everyone can read this");
    expect(readersLine(chat("private", [bot("Chef", "1")]), where), "a private chat names its members only").toBe("Only you, Ben and Chef can read this");
  });

  it("says so once above a public chat's composer, and where a chat's kind is chosen", () => {
    expect(publicNotice("Rossi family", chat("public", [bot("Chef", "1")]))).toEqual({
      title: "This chat is public",
      text: "Everyone in Rossi family can read this · Chef remembers it. Its bots remember what's said here in every chat they're in. " +
        "For something only some of you should see, start a private chat."
    });
    expect(KIND_MEANS.public("Rossi family")).toBe("Everyone in Rossi family can open it, and its bots remember what's said here in their other chats.");
  });
});

describe("a bot's Memory on its card", () => {
  it("says when a memory was made and who asked for a note", () => {
    expect(madeLine("2026-11-22T14:05:00.000Z")).toMatch(/^22 Nov, \d\d:05$/u);
    expect(madeLine("not a time")).toBe("");
    expect(noteLine({ by: { id: "2", name: "Ben" }, viaBot: { id: "7", name: "Chef" } })).toBe("Ben, via Chef");
    expect(noteLine({ by: null, viaBot: null })).toBe("Someone");
  });

  it("reads the bot's memory and the home's notes, pages through older ones and removes one", async () => {
    setCurrentHome("casa");
    calls.length = 0;
    const note = (id) => ({ id, text: `Note ${id}`, by: { id: "2", name: "Ben" }, viaBot: null, createdAt: "2026-11-22T10:00:00.000Z", canRemove: true });
    answers.clear();
    answers.set(/\/bots\/7\/memory$/u, { memory: { text: "## Garden\n- [Garden · Anna] tomatoes", madeAt: "2026-11-22T14:05:00.000Z", tokens: 9 } });
    answers.set(/\/home-notes\?after=/u, { notes: [note("1")], next: null });
    answers.set(/\/home-notes$/u, { notes: [note("3"), note("2")], next: "2" });
    answers.set(/\/home-notes\/\d+$/u, { removed: true });
    const failures = [];
    const memory = useBotMemory({ bot: () => ({ id: "7", name: "Chef" }), tab: computed(() => "details"), onFailure: (error) => failures.push(error) });
    await nextTick();
    await vi.waitFor(() => expect(memory.loaded.value).toBe(true));
    expect(memory.hasMemory.value).toBe(true);
    expect(memory.notes.value.map((kept) => kept.id)).toEqual(["3", "2"]);
    await memory.loadMore();
    expect(memory.notes.value.map((kept) => kept.id)).toEqual(["3", "2", "1"]);
    expect(memory.next.value).toBeNull();
    memory.removing.value = memory.notes.value[1];
    await memory.confirmRemove();
    expect(memory.notes.value.map((kept) => kept.id)).toEqual(["3", "1"]);
    expect(calls).toEqual([
      ["GET", "/api/w/casa/bots/7/memory"],
      ["GET", "/api/w/casa/home-notes"],
      ["GET", "/api/w/casa/home-notes?after=2"],
      ["DELETE", "/api/w/casa/home-notes/2"]
    ]);
    expect(failures).toEqual([]);
  });
});
