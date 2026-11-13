import { computed, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { botsApi } from "../../src/components/mercbot/botsApi.js";
import { newMessagesAfter, useChatScroll } from "../../src/components/mercbot/useChatScroll.js";
import { MENU_REACTIONS, messageMenuItems, pictureMenuItems } from "../../src/components/mercbot/messageMenus.js";
import { itemAge, itemType, libraryMenuItems, pageAccess, useBotLibrary } from "../../src/components/mercbot/useBotLibrary.js";

// The final sweep's finishing touches, on the page's side: the "new messages" count while scrolled up, the
// right-click menus on messages and pictures, and the Library's ages, hover card types and "…" menus with a page's
// delete. The bots routes are stand-ins.

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
  const text = (id, role, from = null) => ({ id, kind: "text", role, body: { text: id, ...(from ? { from: { id: from } } : {}) } });

  it("counts what arrived after the last message the reader had, but not their own messages or timestamps", () => {
    const list = [text("1", "user"), text("2", "bot"), { id: "3", kind: "timestamp", role: "system", body: {} }, text("4", "bot"), text("5", "user", "me"), text("6", "user", "ida"), { id: "7", kind: "page", role: "bot", body: {} }];
    expect(newMessagesAfter(list, "2", "me")).toBe(3);
    expect(newMessagesAfter(list, "7", "me")).toBe(0);
  });

  it("counts nothing when the last message isn't there: another chat or room opened", () => {
    expect(newMessagesAfter([text("8", "bot")], "2", "me")).toBe(null);
    expect(newMessagesAfter([text("8", "bot")], null, "me")).toBe(null);
  });

  it("adds up what arrives while scrolled up, and starts again when the chat shows another room", async () => {
    const list = ref([text("1", "bot"), text("2", "user")]);
    // Scrolled to the top of a long chat, by the reader.
    const element = { scrollHeight: 3000, scrollTop: 0, clientHeight: 600, scrollTo: () => {} };
    const scroll = useChatScroll({ scroller: ref(element), column: ref(null), dock: ref(null), messages: () => list.value, status: () => "", me: () => "me" });
    scroll.updateScrollState();
    list.value = [...list.value, text("3", "bot")];
    await flush();
    list.value = [...list.value, text("4", "user"), text("5", "bot")];
    await flush();
    expect(scroll.unseen.value, "the reader's own message isn't news").toBe(2);
    // A room switch (useRooms) reads the other room's messages and leaves the reader where they were.
    list.value = [text("40", "bot"), text("41", "bot")];
    await flush();
    expect(scroll.unseen.value).toBe(0);
    list.value = [...list.value, text("42", "bot")];
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

  it("say who can open a page from where it's kept", () => {
    const mixed = { name: "Otto", sharing: "mixed" };
    const titleOf = (bot, path) => pageAccess(bot, path, "Rossi family").title;
    expect(titleOf(mixed, "/files/mine/Pages/plan.md")).toBe("Only you");
    expect(pageAccess(mixed, "/files/mine/Pages/plan.md", "Rossi family").onlyYou).toBe(true);
    expect(titleOf(mixed, "/files/bot/Pages/plan.md")).toBe("Everyone using Otto");
    expect(titleOf(mixed, "/files/shared/plan.md")).toBe("Everyone in Rossi family");
    expect(titleOf({ name: "Otto", sharing: "shared" }, "/files/mine/Pages/plan.md"), "a shared bot's folders are everyone's").toBe("Everyone in Rossi family");
    expect(pageAccess(mixed, "/files/shared/plan.md", "").text).toBe("Everyone in the home can open it.");
    // A web page is the home's wherever it's kept (D-74).
    expect(["/files/mine/Pages/plan.html", "/files/bot/Pages/plan.html"].map((path) => titleOf(mixed, path))).toEqual(["Everyone in Rossi family", "Everyone in Rossi family"]);
    expect(pageAccess(mixed, "/files/mine/Pages/plan.html", "Rossi family").onlyYou).toBeFalsy();
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
    const page = { kind: "page", path: "/files/mine/Pages/plan.md", name: "Plan", messageId: "12", createdAt: ago(5) };
    const picture = { kind: "picture", path: "/files/mine/Pictures/cake.png", name: "Cake", messageId: "11", createdAt: ago(9) };
    botsApi.library.mockResolvedValue({ items: [page, picture] });
    botsApi.deletePage.mockResolvedValue({ items: [picture], messages: [{ id: "12", kind: "page", body: { ...page, removed: true } }] });
    const changed = [];
    const library = useBotLibrary({
      bot: () => ({ id: "7", lastActivityAt: 1 }),
      isGroup: computed(() => false),
      tab: computed(() => "library"),
      onFailure: (error) => { throw error; },
      onMessages: (change) => changed.push(change)
    });
    await flush();
    expect(library.libraryItems.value).toEqual([page, picture]);

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
    expect(changed).toEqual([{ botId: "7", messages: [{ id: "12", kind: "page", body: { ...page, removed: true } }] }]);

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
