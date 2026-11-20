import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveQuestion, archivedLabel, archivedLine, tabMenuItems } from "../../src/components/mercbot/archiveConversation.js";
import { useChatActions } from "../../src/components/mercbot/useChatActions.js";
import { useRooms } from "../../src/components/mercbot/useRooms.js";

// What the bots API answers, set per test: a value, or an error it throws.
const api = vi.hoisted(() => ({ calls: [], answer: null }));
vi.mock("../../src/components/mercbot/botsApi.js", () => {
  const answering = (name) => async (...args) => {
    api.calls.push([name, ...args]);
    if (api.answer instanceof Error) throw api.answer;
    return api.answer;
  };
  return {
    botsApi: { archiveRoom: answering("archiveRoom"), resumeRoom: answering("resumeRoom"), send: answering("send") },
    notebookChanges: { value: 0 }
  };
});

/** An error as the HTTP client throws a route's refusal. */
const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

// Archiving a conversation (D-101): a tab's menu, the question before it, the Archived (N) button and its list's lines,
// and what Archive and Resume do to the open bot.
const tabs = [
  { id: "21", title: "General", canArchive: false },
  { id: "22", title: "Plans", canArchive: true },
  { id: "23", title: "Budget", canArchive: false },
  { id: "7", title: "You only", own: true, canArchive: true }
];

beforeEach(() => {
  api.calls.length = 0;
  api.answer = null;
});

describe("a tab's menu", () => {
  it("has Rename on a shared tab, and Archive only where the person may", () => {
    const chosen = [];
    const menuOf = (room) => tabMenuItems(room, { rename: (tab) => chosen.push(["rename", tab.id]), archive: (tab) => chosen.push(["archive", tab.id]) });
    expect(tabs.map((room) => menuOf(room).map((item) => item.title))).toEqual([["Rename"], ["Rename", "Archive"], ["Rename"], ["Archive"]]);
    expect(menuOf(tabs[1]).map((item) => item.icon)).toEqual(["$edit", "$archive"]);
    expect(menuOf({ id: "8", title: "You only", own: true }), "nothing to offer: no menu").toEqual([]);
    for (const item of menuOf(tabs[1])) item.run();
    expect(chosen).toEqual([["rename", "22"], ["archive", "22"]]);
  });
});

describe("the question before archiving", () => {
  it("says a shared tab is hidden for everyone in the home, and who can resume it", () => {
    expect(archiveQuestion(tabs[1])).toEqual({
      title: "Archive Plans?",
      text: "It's hidden for everyone in the home, and its routines and watches pause. Anyone who started it, or an owner or admin, can " +
        "resume it from Archived conversations.",
      confirmLabel: "Archive"
    });
  });

  it("says You only is hidden for the person only, and only they resume it", () => {
    const question = archiveQuestion(tabs[3]);
    expect(question.title).toBe("Archive You only?");
    expect(question.text).toBe("It's hidden for you only, and its routines and watches pause. Only you can resume it, from Archived conversations.");
  });
});

describe("Archived (N) and its list", () => {
  it("shows the count while there's anything archived the person sees", () => {
    expect([archivedLabel(0), archivedLabel(undefined), archivedLabel(1), archivedLabel(12)]).toEqual(["", "", "Archived (1)", "Archived (12)"]);
  });

  it("says who archived each one and when", () => {
    const today = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(0, "day");
    const now = new Date().toISOString();
    expect(archivedLine({ archivedBy: "Kim", archivedAt: now })).toBe(`Archived by Kim · ${today}`);
    expect(archivedLine({ archivedBy: "you", archivedAt: now })).toBe(`Archived by you · ${today}`);
    expect(archivedLine({ archivedBy: null, archivedAt: now }), "an account that's gone").toBe(`Archived · ${today}`);
  });
});

describe("Archive and Resume", () => {
  const roomsFor = () => {
    const bot = ref({ id: "4", name: "Otto", sharing: "shared", roomId: "22", rooms: tabs, archived: 0 });
    const changes = [];
    const reloads = [];
    const failures = [];
    const store = {
      updateBot: (listed) => {
        changes.push(listed);
        bot.value = { ...bot.value, ...listed };
      },
      reloadMessages: async (botId) => reloads.push(botId)
    };
    const rooms = useRooms({ currentBot: computed(() => bot.value), store, reportFailure: (message) => failures.push(message) });
    return { bot, rooms, changes, reloads, failures };
  };

  it("take the bot as listed, and reload the open tab's messages when it changed", async () => {
    const { bot, rooms, changes, reloads } = roomsFor();
    api.answer = { bot: { id: "4", roomId: "21", rooms: tabs.filter((room) => room.id !== "22"), archived: 1 } };
    await rooms.archiveRoom("22");
    expect(api.calls).toEqual([["archiveRoom", "4", "22"]]);
    expect(bot.value.rooms.map((room) => room.title)).toEqual(["General", "Budget", "You only"]);
    expect([bot.value.roomId, bot.value.archived]).toEqual(["21", 1]);
    expect(reloads, "the open tab was archived: General's messages").toEqual(["4"]);

    api.answer = { bot: { id: "4", roomId: "22", rooms: tabs, archived: 0 } };
    await rooms.resumeRoom("22");
    expect(api.calls.at(-1)).toEqual(["resumeRoom", "4", "22"]);
    expect([bot.value.roomId, bot.value.archived]).toEqual(["22", 0]);
    expect(reloads, "the resumed tab opens").toEqual(["4", "4"]);

    // Archiving a tab that isn't open leaves the messages shown alone.
    api.answer = { bot: { id: "4", roomId: "22", rooms: tabs.filter((room) => room.id !== "23"), archived: 1 } };
    await rooms.archiveRoom("23");
    expect(reloads).toEqual(["4", "4"]);
    expect(changes).toHaveLength(3);
  });

  it("say why the server refused, else that it didn't work", async () => {
    const { rooms, failures, changes } = roomsFor();
    api.answer = refusal(403, "bots_archive_forbidden", "Only the person who started “Budget” and the home's owners and admins can archive it.");
    await rooms.archiveRoom("23");
    api.answer = refusal(409, "bots_archive_first", "“General” is where everyone lands, so it can't be archived.");
    await rooms.archiveRoom("21");
    api.answer = Object.assign(new Error("Network request failed."), { status: 0 });
    await rooms.resumeRoom("22");
    expect(failures).toEqual([
      "Only the person who started “Budget” and the home's owners and admins can archive it.",
      "“General” is where everyone lands, so it can't be archived.",
      "That conversation couldn't be resumed. Try again."
    ]);
    expect(changes).toEqual([]);
  });

  it("a message to a tab archived meanwhile says so", async () => {
    const bot = ref({ id: "4", kind: "bot", roomId: "22", rooms: tabs });
    const failures = [];
    const messagesByBot = ref({});
    const actions = useChatActions({
      currentBot: computed(() => bot.value),
      picker: ref(null),
      startGroup: async () => {},
      store: { messagesByBot, updateBot: () => {}, appendMessages: () => {}, replaceMessage: () => {}, removeMessage: () => {} },
      work: { playMood: () => {}, requestReply: async () => {}, describeWork: () => {} },
      reportFailure: (message) => failures.push(message),
      notify: () => {}
    });
    api.answer = refusal(409, "bots_conversation_archived", "This conversation is archived. Resume it to continue.");
    await actions.send({ text: "Still there?", quotes: [], attachments: [], replyTo: null });
    expect(api.calls[0][0]).toBe("send");
    expect(api.calls[0][2].room).toBe("22");
    expect(failures).toEqual(["This conversation is archived. Resume it to continue."]);
    api.answer = Object.assign(new Error("Network request failed."), { status: 0 });
    await actions.send({ text: "Again", quotes: [], attachments: [], replyTo: null });
    expect(failures.at(-1)).toBe("Your message didn't send.");
  });
});
