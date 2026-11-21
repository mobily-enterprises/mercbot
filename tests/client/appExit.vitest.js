import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { exitLabel, exitPlace, insideApp, openerOf } from "../../src/components/apps/appExit.js";
import { useAppExit } from "../../src/components/apps/useAppExit.js";

// The shell's navigation, as JSKIT gives it: the trail of places, the home's paths, and the bar's close (a stand-in that
// keeps the label it's given). The chat a trail names is read through a stand-in of the chat routes.
const shell = vi.hoisted(() => ({ trail: null, closed: null }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => `/w/you${path === "/" ? "" : path}` }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/useShellNavigation", () => ({
  useShellNavigation: () => ({ finish: () => {} }),
  useShellNavigationRuntime: () => ({ trail: shell.trail })
}));
vi.mock("@jskit-ai/shell-web/client/composables/useShellPageClose", () => ({ useShellPageClose: (close) => { shell.closed = close; } }));
vi.mock("@/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    get: async () => ({ chat: { id: "7", kind: "public", title: null, directBotId: "3", people: [{ userId: "1", name: "Anna Rossi" }], bots: [{ chatBotId: "30", botId: "3", name: "Vera", color: "#1E86FC", shape: "cloud", archived: false }] } })
  }
}));

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
  it("names the chat it goes back to as the chat list names it, a direct chat by its bot", async () => {
    shell.trail = ref([{ path: "/w/you?chat=7" }, { path: "/w/you/apps/contacts" }]);
    const scope = effectScope();
    scope.run(() => useAppExit(ref("contacts")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(shell.closed.label.value).toBe("Back to Vera");
    scope.stop();
  });
});
