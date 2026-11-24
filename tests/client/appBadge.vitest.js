import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppBadge } from "../../src/components/mercbot/appBadge.js";
import { chatsApi } from "../../src/components/mercbot/chatsApi.js";
import { newsElsewhere } from "../../src/components/mercbot/useChatEvents.js";

// The number on the app's icon with the app open (D-133), one icon a device: this home's chats with news as the page
// has them, muted ones left out, and the person's other homes' as the server counts them (the same rule as a
// notification's number), read as the page opens, as it's shown again and as news comes from another home. The page's
// world (navigator's badge, the document's visibility) and the route are stand-ins.

vi.mock("vue", async (importOriginal) => ({ ...(await importOriginal()), onMounted: (run) => run(), onBeforeUnmount: () => {} }));
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({ chatsApi: { unreadElsewhere: vi.fn() } }));
vi.mock("../../src/components/mercbot/useChatEvents.js", async () => {
  const { ref: vueRef } = await vi.importActual("vue");
  return { newsElsewhere: vueRef(0) };
});

const shown = [];
const listeners = new Map();
vi.stubGlobal("navigator", {
  setAppBadge: async (count) => shown.push(count),
  clearAppBadge: async () => shown.push(0)
});
vi.stubGlobal("document", {
  visibilityState: "visible",
  addEventListener: (type, listener) => listeners.set(type, listener),
  removeEventListener: (type) => listeners.delete(type)
});

/** What the reads started finish, and the badge follows. */
const settled = async () => {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

beforeEach(() => {
  vi.clearAllMocks();
  shown.length = 0;
});

describe("the app's icon with the app open (D-133)", () => {
  it("counts this home's chats with news and the other homes', muted ones left out, as one number", async () => {
    chatsApi.unreadElsewhere.mockResolvedValue({ chats: 2 });
    const chats = ref([{ id: "1", unread: true }, { id: "2", unread: true, muted: true }, { id: "3", unread: false }]);
    useAppBadge(() => chats.value);
    await settled();
    expect(shown.at(-1), "one here and two in other homes").toBe(3);
    chats.value = [{ id: "1", unread: false }, { id: "2", unread: true, muted: true }, { id: "3", unread: false }];
    await settled();
    expect(shown.at(-1), "read here: the other homes' are left").toBe(2);
    expect(chatsApi.unreadElsewhere, "reading here doesn't ask the server").toHaveBeenCalledTimes(1);

    // News in another home: their count is read again.
    chatsApi.unreadElsewhere.mockResolvedValue({ chats: 3 });
    newsElsewhere.value += 1;
    await settled();
    expect(shown.at(-1)).toBe(3);
    // Read elsewhere meanwhile (on another device): read again as the app is shown again.
    chatsApi.unreadElsewhere.mockResolvedValue({ chats: 0 });
    listeners.get("visibilitychange")();
    await settled();
    expect(shown.at(-1), "nothing left anywhere: the badge goes").toBe(0);
  });

  it("keeps the last count when the server can't be asked", async () => {
    chatsApi.unreadElsewhere.mockResolvedValue({ chats: 1 });
    const chats = ref([{ id: "1", unread: true }]);
    useAppBadge(() => chats.value);
    await settled();
    expect(shown.at(-1)).toBe(2);
    chatsApi.unreadElsewhere.mockRejectedValue(Object.assign(new Error("Bad gateway"), { status: 502 }));
    newsElsewhere.value += 1;
    await settled();
    expect(shown.at(-1)).toBe(2);
  });
});
