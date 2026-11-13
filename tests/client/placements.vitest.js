import { describe, expect, it } from "vitest";
import getPlacements from "../../src/placement.js";

describe("account app placement composition", () => {
  it("exposes account controls and settings sections", () => {
    const ids = getPlacements().map((placement) => placement.id);

    expect(ids).toContain("auth.profile.widget");
    expect(ids).toContain("users.profile.menu.settings");
    expect(ids).toContain("users.account.settings.profile");
    expect(ids).toContain("users.account.settings.preferences");
    expect(ids).not.toContain("users.account.settings.notifications");
  });

  // A person's own copy (D-81) is opened with its key: nobody signs in or out of it. A copy built on Mercbot adds its
  // own links (src/placementExtensions.js).
  it("offers no signing in or out", () => {
    const menu = getPlacements().filter((placement) => placement.target === "auth.profile-menu");
    expect(menu.map((placement) => placement.props?.label)).toEqual(["Account settings"]);
  });
});
