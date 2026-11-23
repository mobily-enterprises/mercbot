import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatsApi } from "../../src/components/mercbot/chatsApi.js";
import { joinsOnOpen, useRoomJoin } from "../../src/components/mercbot/useRoomJoin.js";

// Opening a faded public room joins it (the owner, 23 Nov 2026), so its news reaches the person live; nothing else is
// joined by opening, and a room just left while still open stays left until it's opened again.
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { join: vi.fn() } }));

const room = (id, extra = {}) => ({ id, kind: "public", visiting: true, directBotId: null, directPerson: null, everyone: false, archivedAt: null, ...extra });
let scope;

function opening(first) {
  const currentChat = ref(first);
  const store = { updateChat: vi.fn() };
  const reportFailure = vi.fn();
  scope = effectScope();
  scope.run(() => useRoomJoin({ currentChat, store, reportFailure }));
  return { currentChat, store, reportFailure };
}
const settled = async () => { await nextTick(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.clearAllMocks();
  chatsApi.join.mockImplementation(async (chatId) => ({ chat: { id: chatId, visiting: false } }));
});
afterEach(() => scope?.stop());

describe("opening a room", () => {
  it("joins a faded public room once, and takes the joined row", async () => {
    const { store } = opening(room("4"));
    await settled();
    expect(chatsApi.join.mock.calls).toEqual([["4"]]);
    expect(store.updateChat).toHaveBeenCalledWith({ id: "4", visiting: false });
  });

  it("joins nothing else: an archived room, the everyone chat, a private room, a direct chat, a room the person is in", () => {
    expect(joinsOnOpen(room("1", { archivedAt: "2026-11-23" }))).toBe(false);
    expect(joinsOnOpen(room("2", { everyone: true }))).toBe(false);
    expect(joinsOnOpen(room("3", { kind: "private" }))).toBe(false);
    expect(joinsOnOpen(room("4", { directPerson: { id: "9" } }))).toBe(false);
    expect(joinsOnOpen(room("5", { visiting: false }))).toBe(false);
    expect(joinsOnOpen(null)).toBe(false);
  });

  it("leaves a room just left alone while it's open, and joins it when it's opened again", async () => {
    const { currentChat } = opening(room("4", { visiting: false }));
    await settled();
    // Leave: the same room, now faded, still open.
    currentChat.value = room("4");
    await settled();
    expect(chatsApi.join).not.toHaveBeenCalled();
    currentChat.value = room("7", { visiting: false });
    await settled();
    currentChat.value = room("4");
    await settled();
    expect(chatsApi.join.mock.calls).toEqual([["4"]]);
  });

  it("says so when joining fails, and leaves the room open to read", async () => {
    chatsApi.join.mockRejectedValue(new Error("Bad gateway"));
    const { reportFailure, store } = opening(room("4"));
    await settled();
    expect(reportFailure).toHaveBeenCalledWith("That room couldn't be joined. Try again.", expect.any(Error));
    expect(store.updateChat).not.toHaveBeenCalled();
  });
});
