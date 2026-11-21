import { describe, expect, it } from "vitest";
import { exitLabel, exitPlace, insideApp, openerOf } from "../../src/components/apps/appExit.js";

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
