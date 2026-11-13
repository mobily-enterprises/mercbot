import { describe, expect, it } from "vitest";
import { computeShellGeometry } from "../../src/components/mercbot/shellGeometry.js";
import { resolveAccent } from "../../src/components/mercbot/accent.js";
import { isUpKey, matchShortcut } from "../../src/components/mercbot/shortcuts.js";
import { uploadedPicture } from "../../src/components/mercbot/shellInitials.js";

const defaults = { compact: false, sidebarWidth: 280, detailsOpen: false, detailsWidth: 320 };

describe("shell geometry", () => {
  it("uses the default sidebar and a capped, centred column", () => {
    const at1040 = computeShellGeometry({ ...defaults, viewportWidth: 1040 });
    expect(at1040).toMatchObject({ compact: false, sidebarWidth: 280, chatWidth: 760, columnWidth: 728 });
    const at1440 = computeShellGeometry({ ...defaults, viewportWidth: 1440 });
    expect(at1440).toMatchObject({ sidebarWidth: 280, columnWidth: 960 });
  });

  it("forces the rail below 704 and honours the choice from 704", () => {
    expect(computeShellGeometry({ ...defaults, viewportWidth: 702 }).compact).toBe(true);
    expect(computeShellGeometry({ ...defaults, viewportWidth: 703 }).compact).toBe(true);
    expect(computeShellGeometry({ ...defaults, viewportWidth: 704 }).compact).toBe(false);
    expect(computeShellGeometry({ ...defaults, compact: true, viewportWidth: 1040 }).sidebarWidth).toBe(88);
  });

  it("keeps the rail layout from 600, and below it fills a phone with the chat", () => {
    expect(computeShellGeometry({ ...defaults, viewportWidth: 600 })).toMatchObject({ phone: false, chatWidth: 512, columnWidth: 480 });
    expect(computeShellGeometry({ ...defaults, detailsOpen: true, viewportWidth: 390 }))
      .toMatchObject({ phone: true, chatWidth: 390, columnWidth: 366, sidebarWidth: 342, detailsVisible: false });
  });

  it("clamps the sidebar width to 240–400", () => {
    expect(computeShellGeometry({ ...defaults, sidebarWidth: 100, viewportWidth: 1040 }).sidebarWidth).toBe(240);
    expect(computeShellGeometry({ ...defaults, sidebarWidth: 900, viewportWidth: 1440 }).sidebarWidth).toBe(400);
  });

  it("shrinks Details toward 280, then hides it while the chat keeps 424", () => {
    const open = { ...defaults, detailsOpen: true };
    expect(computeShellGeometry({ ...open, viewportWidth: 1100 })).toMatchObject({ detailsVisible: true, detailsWidth: 320 });
    expect(computeShellGeometry({ ...open, viewportWidth: 1000 })).toMatchObject({ detailsVisible: true, detailsWidth: 296, chatWidth: 424 });
    expect(computeShellGeometry({ ...open, viewportWidth: 984 })).toMatchObject({ detailsVisible: true, detailsWidth: 280 });
    expect(computeShellGeometry({ ...open, viewportWidth: 983 }).detailsVisible).toBe(false);
  });
});

describe("accent", () => {
  // The inverse surfaces of Mercbot's light and dark schemes.
  const light = { "inverse-surface": "#2e3036", "inverse-on-surface": "#f0f0f7" };
  const dark = { "inverse-surface": "#e2e2e9", "inverse-on-surface": "#2e3036" };

  it("inverts black to near-white in dark", () => {
    expect(resolveAccent({ botColor: "#1C1C1C", accentSetting: "bot", colors: light })).toEqual({ primary: "#2e3036", onPrimary: "#f0f0f7" });
    expect(resolveAccent({ botColor: "#000000", accentSetting: "bot", colors: dark })).toEqual({ primary: "#e2e2e9", onPrimary: "#2e3036" });
  });

  it("follows the bot colour unless Black is chosen", () => {
    expect(resolveAccent({ botColor: "#E5484D", accentSetting: "bot", colors: light })).toEqual({ primary: "#E5484D", onPrimary: "#FFFFFF" });
    expect(resolveAccent({ botColor: "#E5484D", accentSetting: "black", colors: dark }).primary).toBe("#e2e2e9");
  });
});

describe("shortcuts (D-2)", () => {
  const key = (code, modifiers = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers });

  it("maps spec keys and our replacements", () => {
    expect(matchShortcut(key("KeyK", { ctrlKey: true }))).toEqual({ action: "search" });
    expect(matchShortcut(key("KeyF", { ctrlKey: true, shiftKey: true }))).toEqual({ action: "search" });
    expect(matchShortcut(key("KeyF", { ctrlKey: true }))).toEqual({ action: "find" });
    expect(matchShortcut(key("KeyN", { ctrlKey: true, altKey: true }))).toEqual({ action: "newBot" });
    expect(matchShortcut(key("KeyW", { ctrlKey: true, altKey: true }))).toEqual({ action: "skills" });
    expect(matchShortcut(key("KeyB", { ctrlKey: true }))).toEqual({ action: "toggleCompact" });
    expect(matchShortcut(key("KeyB", { ctrlKey: true, altKey: true }))).toEqual({ action: "toggleDetails" });
    expect(matchShortcut(key("Digit3", { ctrlKey: true, altKey: true }))).toEqual({ action: "goToBot", index: 2 });
    expect(matchShortcut(key("ArrowDown", { altKey: true }))).toEqual({ action: "nextBot" });
    expect(matchShortcut(key("Slash", { ctrlKey: true }))).toEqual({ action: "shortcuts" });
  });

  it("leaves browser-reserved and unmodified keys alone", () => {
    expect(matchShortcut(key("KeyN", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("Digit1", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("KeyK"))).toBeNull();
  });

  it("keeps Ctrl+[ for the shell's Up and binds no back or forward (D-64)", () => {
    expect(isUpKey(key("BracketLeft", { ctrlKey: true }))).toBe(true);
    expect(isUpKey(key("BracketLeft", { metaKey: true }))).toBe(true);
    expect(isUpKey(key("BracketLeft", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUpKey(key("BracketRight", { ctrlKey: true }))).toBe(false);
    expect(matchShortcut(key("BracketLeft", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("BracketRight", { ctrlKey: true }))).toBeNull();
  });
});

describe("the account button's picture", () => {
  it("is the picture the person uploaded, and none for JSKIT's Gravatar stand-in or no address", () => {
    expect(uploadedPicture({ avatarUrl: "/api/settings/profile/avatar?v=3" })).toBe("/api/settings/profile/avatar?v=3");
    expect(uploadedPicture({ avatarUrl: "/api/settings/profile/avatar" })).toBe("/api/settings/profile/avatar");
    expect(uploadedPicture({ avatarUrl: "https://www.gravatar.com/avatar/abc?d=mp&s=64" })).toBe("");
    expect(uploadedPicture({ avatarUrl: "" })).toBe("");
    expect(uploadedPicture({})).toBe("");
    expect(uploadedPicture(null)).toBe("");
  });
});
