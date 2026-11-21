import { computed, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { botsApi } from "../../src/components/mercbot/botsApi.js";
import { newMessagesAfter, useChatScroll } from "../../src/components/mercbot/useChatScroll.js";
import { MENU_REACTIONS, messageMenuItems, pictureMenuItems } from "../../src/components/mercbot/messageMenus.js";
import { itemAge, itemType, libraryMenuItems, pageAccess, useBotLibrary } from "../../src/components/mercbot/useBotLibrary.js";

// The final sweep's finishing touches, on the page's side: the "new messages" count while scrolled up, the
// right-click menus on messages and pictures, and a bot's Library: its ages, hover card types, who can open a page,
// and "…" menus with a page's delete. The bots routes are stand-ins.

// useChatScroll's own count, outside a component: its resize watching (onMounted) has nothing to watch here.
vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onMounted: () => {}, onBeforeUnmount: () => {} }));

vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  sleep: async () => {},
  botsApi: {
    library: vi.fn(),
    pinItem: vi.fn(),
    deletePage: vi.fn()
  }
}));

const titles = (items) => items.map((item) => (item.divider ? "—" : item.title));
const flush = async () => {
  for (let turn = 0; turn < 4; turn += 1) await nextTick();
};

beforeEach(() => {
  for (const call of Object.values(botsApi)) call.mockReset();
});

describe("new messages while scrolled up", () => {
  // A person's message in a chat names who wrote it (authorUserId), a bot's its bot; the reader is "me".
  const text = (id, author = null) => ({ id, kind: "text", role: author ? "user" : "bot", authorUserId: author, authorBotId: author ? null : "b1", body: { text: id } });

  it("counts what arrived after the last message the reader had, other people's too, but not their own messages or timestamps", () => {
    const list = [text("1", "me"), text("2"), { id: "3", kind: "timestamp", role: "system", authorUserId: null, authorBotId: null, body: {} }, text("4"), text("5", "me"), text("6", "ida"), { id: "7", kind: "page", role: "bot", authorUserId: null, authorBotId: "b1", body: {} }];
    expect(newMessagesAfter(list, "2", "me")).toBe(3);
    expect(newMessagesAfter(list, "7", "me")).toBe(0);
  });

  it("counts nothing when the last message isn't there: another chat opened", () => {
    expect(newMessagesAfter([text("8")], "2", "me")).toBe(null);
    expect(newMessagesAfter([text("8")], null, "me")).toBe(null);
  });

  it("adds up what arrives while scrolled up, and starts again when another chat is shown", async () => {
    const list = ref([text("1"), text("2", "me")]);
    // Scrolled to the top of a long chat, by the reader.
    const element = { scrollHeight: 3000, scrollTop: 0, clientHeight: 600, scrollTo: () => {} };
    const scroll = useChatScroll({ scroller: ref(element), column: ref(null), dock: ref(null), messages: () => list.value, status: () => "", me: () => "me" });
    scroll.updateScrollState();
    list.value = [...list.value, text("3")];
    await flush();
    list.value = [...list.value, text("4", "me"), text("5")];
    await flush();
    expect(scroll.unseen.value, "the reader's own message isn't news").toBe(2);
    // Another chat shown: its messages aren't news, and counting starts again from them.
    list.value = [text("40"), text("41")];
    await flush();
    expect(scroll.unseen.value).toBe(0);
    list.value = [...list.value, text("42")];
    await flush();
    expect(scroll.unseen.value).toBe(1);
    scroll.scrollToBottom("auto");
    expect(scroll.unseen.value).toBe(0);
  });
});

describe("right-click menus on messages and pictures", () => {
  it("offers Reply, Copy and Copy request ID, with six reactions for a bot's message", () => {
    const done = [];
    const message = { id: "41", kind: "text", role: "bot", body: { heading: "Plan", bullets: ["Eggs", "Milk"] } };
    const items = messageMenuItems(message, { reply: (chosen) => done.push(["reply", chosen.id]), copy: (copied) => done.push(["copy", copied]) });
    expect(titles(items)).toEqual(["Reply", "Copy", "Copy request ID"]);
    expect(items.every((item) => item.icon)).toBe(true);
    for (const item of items) item.run();
    expect(done).toEqual([
      ["reply", "41"],
      ["copy", { text: "Plan\nEggs\nMilk", what: "Message" }],
      ["copy", { text: "req_41", what: "Request ID" }]
    ]);
    expect(MENU_REACTIONS).toHaveLength(6);
  });

  it("copies or saves a picture", () => {
    const done = [];
    const picture = { src: "/api/w/home/bots/7/files/content?path=a.png", fileName: "Cake.png" };
    const items = pictureMenuItems(picture, { copyPicture: (src) => done.push(["copy", src]), savePicture: (saved) => done.push(["save", saved]) });
    expect(titles(items)).toEqual(["Copy image", "Save image"]);
    for (const item of items) item.run();
    expect(done).toEqual([["copy", picture.src], ["save", picture]]);
  });
});

describe("the Library's rows", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const ago = (minutes) => new Date(now - minutes * 60000).toISOString();

  it("show each entry's age and type", () => {
    expect([0.5, 5, 180, 4 * 1440, 20 * 1440, 400 * 1440].map((minutes) => itemAge(ago(minutes), now))).toEqual(["now", "5m", "3h", "4d", "2w", "1y"]);
    expect(["page", "view", "chart", "picture", "file"].map((kind) => itemType({ kind }))).toEqual(["Page", "View", "Chart", "Picture", "File"]);
  });

  it("say who can open a page from where it's kept (D12, D13)", () => {
    const where = { chatName: "Kitchen", homeName: "Rossi family" };
    // A chat's folder is for everyone who can open that chat.
    expect(pageAccess("/files/chat/Pages/plan.md", where)).toEqual({
      icon: "$sms", title: "Everyone who can open “Kitchen”", text: "Everyone who can open “Kitchen” can open it.", onlyYou: false
    });
    expect(pageAccess("/files/chat/Pages/plan.md", { homeName: "Rossi family" }).title, "a chat with no name to give").toBe("Everyone who can open its chat");
    // The bot's own folder and the home's are everyone's in the home.
    expect(["/files/bot/Pages/plan.md", "/files/shared/plan.md", "/files/bot/Pages/plan.html"].map((path) => pageAccess(path, where).title))
      .toEqual(["Everyone in Rossi family", "Everyone in Rossi family", "Everyone in Rossi family"]);
    expect(pageAccess("/files/shared/plan.md", { chatName: "Kitchen" }).text).toBe("Everyone in the home can open it.");
    expect(pageAccess("/files/shared/plan.md").title, "nothing named").toBe("Everyone in the home");
    // No page is the person's alone any more.
    expect(["/files/chat/Pages/plan.md", "/files/bot/Pages/plan.md", "/files/shared/plan.md"].some((path) => pageAccess(path, where).onlyYou)).toBe(false);
  });

  it("offer Pin for a file, and Open, Share, Pin and Delete for a page", () => {
    const done = [];
    const actions = Object.fromEntries(["open", "share", "pin", "remove"].map((name) => [name, (item) => done.push([name, item.path])]));
    expect(titles(libraryMenuItems({ kind: "file", path: "/f", pinned: false }, actions))).toEqual(["Pin"]);
    expect(titles(libraryMenuItems({ kind: "picture", path: "/p", pinned: true }, actions))).toEqual(["Unpin"]);
    const page = libraryMenuItems({ kind: "page", path: "/pg", pinned: false }, actions);
    expect(titles(page)).toEqual(["Open", "Share…", "Pin", "—", "Delete"]);
    expect(page.at(-1).danger).toBe(true);
    for (const item of page.filter((entry) => !entry.divider)) item.run();
    expect(done.map(([name]) => name)).toEqual(["open", "share", "pin", "remove"]);
  });

  it("delete a page only once it's confirmed, then show the Library and the page's cards as the server answers", async () => {
    const page = { kind: "page", path: "/files/chat/Pages/plan.md", name: "Plan", chatId: "5", messageId: "12", createdAt: ago(5) };
    const picture = { kind: "picture", path: "/files/chat/Pictures/cake.png", name: "Cake", chatId: "5", messageId: "11", createdAt: ago(9) };
    botsApi.library.mockResolvedValue({ items: [page, picture] });
    botsApi.deletePage.mockResolvedValue({ items: [picture], messages: [{ id: "12", kind: "page", body: { ...page, removed: true } }] });
    const changed = [];
    // The open chat's last activity: the Library is read again as it changes.
    const activity = ref("2026-11-11T11:00:00Z");
    const library = useBotLibrary({
      bot: () => ({ id: "7" }),
      tab: computed(() => "library"),
      activity: () => activity.value,
      onFailure: (error) => { throw error; },
      onMessages: (change) => changed.push(change)
    });
    await flush();
    expect(library.libraryItems.value).toEqual([page, picture]);
    activity.value = "2026-11-11T11:30:00Z";
    await flush();
    expect(botsApi.library.mock.calls, "read again as the open chat's activity changed").toEqual([["7"], ["7"]]);

    const button = { getBoundingClientRect: () => ({ left: 300, bottom: 120 }) };
    library.openItemMenu({ type: "click", currentTarget: button }, page);
    expect(library.itemMenu.value.target).toEqual([300, 120]);
    library.itemMenu.value.items.find((item) => item.title === "Delete").run();
    expect(library.pendingDelete.value).toEqual(page);
    expect(botsApi.deletePage).not.toHaveBeenCalled();

    await library.deletePage();
    expect(botsApi.deletePage).toHaveBeenCalledWith("7", page);
    expect(library.pendingDelete.value).toBe(null);
    expect(library.libraryItems.value).toEqual([picture]);
    expect(changed, "the page's cards, with the chat they're in").toEqual([{ chatId: "5", messages: [{ id: "12", kind: "page", body: { ...page, removed: true } }] }]);

    library.openItemMenu({ type: "contextmenu", clientX: 40, clientY: 50, currentTarget: button }, picture);
    expect(library.itemMenu.value.target, "a right-click opens it at the pointer").toEqual([40, 50]);
    botsApi.pinItem.mockResolvedValue({ items: [{ ...picture, pinned: true }] });
    library.itemMenu.value.items[0].run();
    await flush();
    expect(botsApi.pinItem).toHaveBeenCalledWith("7", picture, true);
    expect(library.libraryItems.value).toEqual([{ ...picture, pinned: true }]);
    library.openItemMenu({ type: "click", currentTarget: button }, page);
    library.itemMenu.value.items.find((item) => item.title === "Share…").run();
    expect(library.sharingItem.value).toEqual(page);
  });
});
