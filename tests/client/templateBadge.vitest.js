import { describe, expect, it } from "vitest";
import { testedBadge, testedMeaning } from "../../src/components/templates/templatesApi.js";

// A template's tested badge (D-43, D-79), as the gallery, its page and the preview before Add bot write it: the day
// its end-to-end check passed, in the person's own way of writing dates, or an honest "Not tested yet".
describe("a template's tested badge", () => {
  it("names the day the check passed, the same day wherever the person is", () => {
    const day = new Date("2026-11-12T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    expect(testedBadge({ tested: "2026-11-12" })).toBe(`Tested ${day}`);
    expect(testedBadge({ tested: "2026-11-12" })).toMatch(/12/u);
    expect(testedMeaning({ tested: "2026-11-12" })).toMatch(/checked this bot end to end/u);
  });

  it("says Not tested yet when there's no passing check for the template as it is", () => {
    for (const template of [{ tested: null }, {}]) {
      expect(testedBadge(template)).toBe("Not tested yet");
      expect(testedMeaning(template)).toMatch(/hasn't checked this bot end to end since it or Mercbot last changed/u);
    }
  });
});
