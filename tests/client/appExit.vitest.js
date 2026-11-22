import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { appsAreaOf, exitLabel, exitPlace, insideApp, openerOf } from "../../src/components/apps/appExit.js";
import { useAppExit } from "../../src/components/apps/useAppExit.js";

// The shell's navigation, as JSKIT gives it: the trail of places, the home's paths, and the bar's close (a stand-in that
// keeps the label it's given). The chat a trail names is read through a stand-in of the chat routes.
const shell = vi.hoisted(() => ({ trail: null, closed: null, finished: [] }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => `/w/you${path === "/" ? "" : path}` }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/useShellNavigation", () => ({
  useShellNavigation: () => ({ finish: (target) => shell.finished.push(target) }),
  useShellNavigationRuntime: () => ({ trail: shell.trail })
}));
vi.mock("@jskit-ai/shell-web/client/composables/useShellPageClose", () => ({ useShellPageClose: (close) => { shell.closed = close; } }));
vi.mock("@jskit-ai/shell-web/client/placement", async () => {
  const { ref: vueRef } = await import("vue");
  return { useWebPlacementContext: () => ({ context: vueRef({ user: { id: "1" } }) }) };
});
const VERA = { chatBotId: "30", botId: "3", name: "Vera", color: "#1E86FC", shape: "cloud", archived: false };
const CHATS = {
  7: { id: "7", kind: "public", title: null, directBotId: "3", people: [{ userId: "1", name: "Anna Rossi" }], bots: [VERA] },
  8: { id: "8", kind: "public", title: null, directBotId: null, people: [{ userId: "1", name: "Anna Rossi" }, { userId: "2", name: "Ben Rossi" }], bots: [VERA] }
};
vi.mock("@/components/mercbot/chatsApi.js", () => ({ chatsApi: { get: async (chatId) => ({ chat: CHATS[chatId] }) } }));

// Leaving an app (D-106): the place the app was opened from is the nearest step of JSKIT's trail outside the app,
// however many of the app's places the trail holds after it, and the app's close says where it goes.
const BASE = "/w/you/apps/contacts";
const steps = (...paths) => paths.map((path) => ({ path, scroll: { left: 0, top: 0 } }));

describe("leaving an app", () => {
  it("goes to the place the app was opened from, past every place opened in it", () => {
    const places = Array.from({ length: 16 }, (_, index) => `${BASE}/${index % 2 ? "list" : `edit/${index}`}`);
    expect(openerOf(steps("/w/you", "/w/you?chat=7", BASE, ...places), BASE)).toBe("/w/you?chat=7");
    expect(openerOf(steps("/w/you/apps?tab=data", `${BASE}?version=draft`), BASE)).toBe("/w/you/apps?tab=data");
  });

  it("has no such place after a direct entry, whatever the app's own steps", () => {
    expect(openerOf([], BASE)).toBeNull();
    expect(openerOf(steps(`${BASE}/list`, `${BASE}/edit/2`), BASE)).toBeNull();
    expect(openerOf(undefined, BASE)).toBeNull();
  });

  it("tells the app's own addresses from others", () => {
    expect(insideApp(`${BASE}?version=draft`, BASE)).toBe(true);
    expect(insideApp(`${BASE}/edit/3`, BASE)).toBe(true);
    expect(insideApp(`${BASE}2/list`, BASE)).toBe(false);
    expect(insideApp("/w/you/apps", BASE)).toBe(false);
  });

  it("names where it goes", () => {
    const named = (from, chat) => exitLabel(exitPlace(from, "/w/you"), chat);
    expect(named("/w/you?chat=7", "Vera")).toBe("Back to Vera");
    expect(named("/w/you?chat=7&team=1", "")).toBe("Back to chat");
    expect(named("/w/you/apps?tab=data", "")).toBe("Back to Apps");
    expect(named("/w/you/files", "")).toBe("Back to Files");
    expect(named("/w/you", "")).toBe("Back to Mercbot");
    expect(named("/w/you/apps/data/contacts", "")).toBe("Back to Mercbot");
    expect(named(null, "")).toBe("Back to Mercbot");
    expect(exitPlace("/w/you/?chat=7", "/w/you/")).toEqual({ place: "chat", chatId: "7" });
  });
});

describe("an app's close", () => {
  /** The close's words after leaving for the app from `chatId`. */
  async function closeFrom(chatId) {
    shell.trail = ref([{ path: `/w/you?chat=${chatId}` }, { path: "/w/you/apps/contacts" }]);
    const scope = effectScope();
    scope.run(() => useAppExit());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    scope.stop();
    return shell.closed.label.value;
  }

  it("names the chat it goes back to as the chat list names it: a direct chat by its bot, another by who else is in it", async () => {
    expect(await closeFrom("7")).toBe("Back to Vera");
    expect(await closeFrom("8")).toBe("Back to Ben and Vera");
  });
});

// One close for the whole apps area (D-123): an app's own places replace each other's history entries, and the close of
// an app or of Apps leaves through JSKIT's finish() for the nearest place of the trail outside the area.
const AREA = appsAreaOf("/w/you");
const ROOM = "/w/you?chat=7";

/**
 * A stand-in of the tab's history and JSKIT's trail, as JSKIT keeps them: a push adds an entry and puts the page left
 * on the trail (a top-level page, like a room, starts it again), a replace takes the open entry's place and keeps the
 * trail, and finish() replaces the open entry, its trail cut to the steps before the target.
 */
function tab(start) {
  const entries = [{ path: start, trail: [] }];
  let at = 0;
  const open = () => entries[at];
  const inner = (path) => path.startsWith(`${AREA}`) || path.startsWith("/w/you/files");
  return {
    open,
    entries: () => entries.slice(0, at + 1).map((entry) => entry.path),
    push(path) {
      const trail = inner(path) ? [...open().trail, { path: open().path }] : [];
      entries.splice(at + 1, Infinity, { path, trail });
      at += 1;
    },
    replace(path) {
      entries[at] = { path, trail: open().trail };
    },
    finish(path) {
      const index = open().trail.findIndex((step) => step.path === path);
      entries[at] = { path, trail: index < 0 ? [] : open().trail.slice(0, index) };
    },
    back() {
      at = Math.max(0, at - 1);
    }
  };
}

/** The close as `open` (the app's or Apps') makes it on the tab's open entry: its words and where it finishes. */
async function closeOn(browser) {
  shell.finished = [];
  shell.trail = ref(browser.open().trail);
  const scope = effectScope();
  scope.run(() => useAppExit());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  const label = shell.closed.label.value;
  await shell.closed.close();
  scope.stop();
  return { label, target: shell.finished.at(-1) };
}

describe("the apps area's close", () => {
  it("finds where the area was entered, past Apps, every app and every table", () => {
    const steps = (...paths) => paths.map((path) => ({ path }));
    expect(openerOf(steps(ROOM, AREA, `${AREA}/cats?version=draft`), AREA)).toBe(ROOM);
    expect(openerOf(steps("/w/you/files", `${AREA}?tab=data`, `${AREA}/data/pets`), AREA)).toBe("/w/you/files");
    expect(openerOf(steps(AREA, `${AREA}/cats`), AREA)).toBeNull();
    expect(insideApp("/w/you/appsx", AREA)).toBe(false);
  });

  it("from a room, Apps, the Cats draft and two of its screens, lands on the room in one press, and Back goes at most to Apps", async () => {
    const browser = tab(ROOM);
    browser.push(AREA);
    browser.push(`${AREA}/cats?version=draft`);
    // The app's own screens replace its entry (AppFrame's navigation).
    browser.replace(`${AREA}/cats/next_due?version=draft`);
    browser.replace(`${AREA}/cats/vet_visits?version=draft`);
    expect(browser.entries()).toEqual([ROOM, AREA, `${AREA}/cats/vet_visits?version=draft`]);

    const closed = await closeOn(browser);
    expect(closed).toEqual({ label: "Back to Vera", target: ROOM });
    browser.finish(closed.target);
    expect(browser.entries()).toEqual([ROOM, AREA, ROOM]);
    // Back from the room: Apps, one entry, never the app's screens.
    browser.back();
    expect(browser.open().path).toBe(AREA);

    // Apps' own close lands on the room in one press too.
    const fromApps = await closeOn(browser);
    expect(fromApps).toEqual({ label: "Back to Vera", target: ROOM });
    browser.finish(fromApps.target);
    expect(browser.entries()).toEqual([ROOM, ROOM]);
  });

  it("entered directly, leaves for the home's chats", async () => {
    // A pasted address of Apps, then an app from there.
    const browser = tab(AREA);
    browser.push(`${AREA}/cats`);
    expect(await closeOn(browser)).toEqual({ label: "Back to Mercbot", target: "/w/you" });
  });
});
