import { describe, expect, it, vi } from "vitest";

// A bot card's Files tab (D-119): this chat's folder and the bot's own, never the home's, which is on the Files page; but
// Move to… still offers the home's folder, so moving a chat's file to the home stays one step.
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("@jskit-ai/http-runtime/client", () => ({ createHttpClient: () => ({ request: async () => ({}) }) }));
const { HOME_FILES, botFileSections } = await import("../../src/components/mercbot/MercbotMemberCard.vue");
const { moveDestinations } = await import("../../src/components/files/FileBrowser.vue");

describe("a bot card's Files tab", () => {
  it("lists this chat's folder and the bot's own, not the home's, and Move to… offers Home files", () => {
    const sections = botFileSections("Chef", true);
    expect(sections.map((section) => section.label)).toEqual(["This chat", "Chef's files"]);
    expect(sections.some((section) => section.root === "/files/shared"), "the home's folder isn't listed").toBe(false);
    const tree = { chat: ["/files/chat/Notes"], bot: [], shared: ["/files/shared/Recipes"] };
    expect(moveDestinations([...sections, ...HOME_FILES], tree).map((folder) => folder.title)).toEqual([
      "This chat", "This chat / Notes", "Chef's files", "Home files", "Home files / Recipes"
    ]);
    expect(botFileSections("Chef", false).map((section) => section.label), "beside another chat: its own only").toEqual(["Chef's files"]);
  });
});
