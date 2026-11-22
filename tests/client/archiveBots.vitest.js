import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MercbotArchivedBotBanner from "../../src/components/mercbot/MercbotArchivedBotBanner.vue";
import MercbotBotArchive from "../../src/components/mercbot/MercbotBotArchive.vue";
import MercbotBotMain from "../../src/components/mercbot/MercbotBotMain.vue";
import { archiveBotQuestion, archiveRefusal, archivedBotLine, leftLine } from "../../src/components/mercbot/archiveBot.js";
import { builderBotId } from "../../src/components/mercbot/builderBot.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";
import { theme } from "../../src/theme/index.js";

// Archiving a whole bot (D-108, plan 5.1): a member of the home that has left. Bots lists it under Archived bots
// (chatList.vitest.js), its card has Resume for whoever may; who may archive it and why not; the question first; the lines it shows; and its direct chat's banner
// in place of the composer. No route is called here.
vi.mock("@jskit-ai/http-runtime/client", () => ({ createHttpClient: () => ({ request: async () => ({}) }) }));

/** A component's HTML, rendered with the app's Vuetify, its apostrophes as written. */
async function rendered(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'");
}

const bot = (id, extra = {}) => ({
  id, name: `Bot ${id}`, color: "#1E86FC", shape: "cloud", isMain: false, madeBy: "1", madeByName: "Kim", template: null,
  archivedAt: null, archivedBy: null, canArchive: true, ...extra
});

beforeEach(() => {
  shellPreferences.language = "en-GB";
});

const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gu)].map(([, inside]) => inside.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim());
const chips = (html) => [...html.matchAll(/data-chip="([^"]*)"/gu)].map(([, chip]) => chip);

describe("the home's main bot and Builder on a bot's card", () => {
  it("shows a chip when the bot is one, and a link to Settings for the home's owners and admins only", async () => {
    builderBotId.value = "3";
    const main = await rendered(MercbotBotMain, { bot: bot("1", { isMain: true }), manages: true });
    expect(chips(main)).toEqual(["main"]);
    expect(buttons(main)).toEqual(["Change in Settings →"]);
    expect(buttons(await rendered(MercbotBotMain, { bot: bot("1", { isMain: true }), manages: false })), "not theirs to choose").toEqual([]);
    expect(chips(await rendered(MercbotBotMain, { bot: bot("3"), manages: false }))).toEqual(["builder"]);
    expect(buttons(await rendered(MercbotBotMain, { bot: bot("2"), manages: true }))).toEqual(["Main bot and Builder in Settings →"]);
    expect(await rendered(MercbotBotMain, { bot: bot("2"), manages: false }), "neither, and not theirs to choose: nothing").not.toContain("mb-bot-main");
    expect(await rendered(MercbotBotMain, { bot: bot("2", { archivedAt: "2026-11-20T10:00:00.000Z" }), manages: true }), "it has left").not.toContain("Settings");
    builderBotId.value = null;
  });
});

describe("who may archive a bot, and why not", () => {
  it("is its maker or an owner or admin, never for the main bot or the Builder", () => {
    expect(archiveRefusal(bot("1"), null)).toBe("");
    expect(archiveRefusal(bot("1", { canArchive: false }), null)).toBe("Only its maker and the home's owners and admins can archive it.");
    expect(archiveRefusal(bot("1", { isMain: true }), null)).toBe("The main bot can't be archived. Make another bot main first.");
    expect(archiveRefusal(bot("1"), "1")).toBe("The Builder can't be archived. Choose another Builder first.");
    expect(archiveRefusal(bot("1"), "2")).toBe("");
  });

  it("asks first, saying it leaves the home's bots for everyone and its chats stay", () => {
    expect(archiveBotQuestion(bot("1"))).toEqual({
      title: "Archive Bot 1?",
      text: "Removes it for everyone. Its chats stay.",
      confirmLabel: "Archive"
    });
  });

  it("says in one line what Archive does, and for the main bot only why it can't be", async () => {
    const plain = await rendered(MercbotBotArchive, { bot: bot("2") });
    expect(plain).toContain("Removes Bot 2 for everyone. Its chats stay.");
    expect(buttons(plain)).toEqual(["Archive Bot 2"]);
    const main = await rendered(MercbotBotArchive, { bot: bot("1", { isMain: true }) });
    expect(main).toContain("The main bot can't be archived. Make another bot main first.");
    expect(main, "not both lines").not.toContain("Removes");
    expect(buttons(main)).toEqual([]);
  });

  it("says who archived it and on which day, and on Team when it left", () => {
    const at = "2026-11-21T10:00:00.000Z";
    expect(archivedBotLine({ archivedAt: at, archivedBy: "Kim" }, "en-GB")).toBe("Archived by Kim on 21 Nov 2026");
    expect(archivedBotLine({ archivedAt: at, archivedBy: "you" }, "en-GB")).toBe("Archived by you on 21 Nov 2026");
    expect(archivedBotLine({ archivedAt: at, archivedBy: null }, "en-GB"), "an account that's gone").toBe("Archived on 21 Nov 2026");
    expect(leftLine({ archivedAt: at }, "en-GB", new Date("2026-12-01T00:00:00Z"))).toBe("Bot · left 21 Nov");
    expect(leftLine({ archivedAt: at }, "en-GB", new Date("2027-02-01T00:00:00Z")), "another year's").toBe("Bot · left 21 Nov 2026");
  });
});

describe("a direct chat with a bot that has left", () => {
  const archived = bot("3", { name: "Ledger", archivedAt: "2026-11-21T10:00:00.000Z", archivedBy: "Kim" });

  it("says so in place of the composer, with Resume for whoever may", async () => {
    const html = await rendered(MercbotArchivedBotBanner, { bot: archived, homeName: "Casa" });
    expect(html).toContain("role=\"status\" aria-label=\"Left the home\"");
    expect(html).toContain("Ledger has left Casa");
    expect(html).toContain("Archived by Kim on 21 Nov 2026. Resume it to talk again.");
    expect(html).toMatch(/<button[^>]*aria-label="Resume Ledger"[^>]*>[\s\S]*Resume <\/button>/u);
    const theirs = await rendered(MercbotArchivedBotBanner, { bot: { ...archived, canArchive: false }, homeName: "Casa" });
    expect(theirs).toContain("Archived by Kim on 21 Nov 2026. The person who made Ledger and the home's owners and admins can resume it.");
    expect(theirs, "no Resume for someone who may not").not.toContain("<button");
  });
});
