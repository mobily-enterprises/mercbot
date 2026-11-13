import { describe, expect, it } from "vitest";
import { actionLabel, availability, signsIn } from "../../src/components/mercbot/appsCatalogue.js";

// Connect apps' words for an app people sign in to: through Google, Microsoft or GitHub (`oauth`), or through the
// app's own connection point (`mcp`, the general connector, D-34), which is connected like any other once built.
const info = { availability: "Coming soon" };
const notion = (fields = {}) => ({ id: "notion", mcp: { url: "https://mcp.notion.com/mcp" }, info, accounts: [], installed: false, ...fields });

describe("an app that hosts its own connection point", () => {
  it("is signed in to, so it says Connect and follows its accounts", () => {
    expect(signsIn(notion())).toBe(true);
    expect(signsIn({ oauth: { provider: "google" } })).toBe(true);
    expect(signsIn({ id: "trello", soon: true })).toBe(false);
    expect(actionLabel(notion())).toBe("Connect");
    expect(availability(notion())).toBe("Not added yet");
    expect(availability(notion({ installed: true, accounts: [{ status: "needs-auth" }] }))).toBe("Added; needs sign-in");
    expect(availability(notion({ installed: true, accounts: [{ status: "connected" }, { status: "connected" }] }))).toBe("Connected (2 accounts)");
    expect(availability({ id: "trello", soon: true, info, accounts: [] })).toBe("Coming soon");
  });
});
