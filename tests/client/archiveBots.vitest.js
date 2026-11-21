import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MercbotArchivedBotBanner from "../../src/components/mercbot/MercbotArchivedBotBanner.vue";
import MercbotTeamPage from "../../src/components/mercbot/MercbotTeamPage.vue";
import { archiveBotQuestion, archiveRefusal, archivedBotLine, leftLine } from "../../src/components/mercbot/archiveBot.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";
import { theme } from "../../src/theme/index.js";

// Archiving a whole bot (D-108, plan 5.1): a member of the home that has left. Team lists it under Archived with Resume
// for whoever may; who may archive it and why not; the question first; the lines it shows; and its direct chat's banner
// in place of the composer. No route is called here.
vi.mock("@jskit-ai/http-runtime/client", () => ({ createHttpClient: () => ({ request: async () => ({}) }) }));

/** A component's HTML, rendered with the app's Vuetify, its apostrophes as written. */
async function rendered(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'");
}

const thisYear = new Date().getFullYear();
const bot = (id, extra = {}) => ({
  id, name: `Bot ${id}`, color: "#1E86FC", shape: "cloud", isMain: false, madeBy: "1", madeByName: "Kim", template: null,
  archivedAt: null, archivedBy: null, canArchive: true, ...extra
});

beforeEach(() => {
  shellPreferences.language = "en-GB";
});

describe("Team's Archived", () => {
  const people = [{ id: "1", name: "Kim Lee", role: "owner", roleLabel: "Owner" }];

  it("lists the bots that have left, after the team, each with when it left and Resume for whoever may", async () => {
    const html = await rendered(MercbotTeamPage, {
      me: "1",
      homeName: "Casa",
      people,
      bots: [
        bot("1"),
        bot("2", { archivedAt: `${thisYear}-11-20T10:00:00.000Z`, archivedBy: "Kim" }),
        bot("3", { archivedAt: `${thisYear}-11-21T10:00:00.000Z`, canArchive: false })
      ]
    });
    const [team, archived] = html.split(">Archived<");
    expect(team).toContain("aria-label=\"Message Bot 1\"");
    expect(team).not.toContain("Bot 2");
    expect(archived).toContain("aria-label=\"Bot 2, Bot · left 20 Nov\"");
    expect(archived).toContain("aria-label=\"Resume Bot 2\"");
    expect(archived).toContain("aria-label=\"Bot 3, Bot · left 21 Nov\"");
    expect(archived, "not theirs to resume").not.toContain("aria-label=\"Resume Bot 3\"");
    expect(archived, "a bot that has left takes no messages").not.toContain("aria-label=\"Message");
  });

  it("isn't there when nobody has left", async () => {
    const html = await rendered(MercbotTeamPage, { me: "1", homeName: "Casa", people, bots: [bot("1")] });
    expect(html).not.toContain(">Archived<");
    expect(html).not.toContain("Resume");
  });
});

describe("who may archive a bot, and why not", () => {
  it("is its maker or an owner or admin, never for the main bot or the Builder", () => {
    expect(archiveRefusal(bot("1"), null)).toBe("");
    expect(archiveRefusal(bot("1", { canArchive: false }), null)).toBe("Only the person who made Bot 1 and the home's owners and admins can archive it.");
    expect(archiveRefusal(bot("1", { isMain: true }), null)).toBe("Bot 1 is this home's main bot, so it can't be archived. Make another bot the main bot first.");
    expect(archiveRefusal(bot("1"), "1")).toBe("Bot 1 builds this home's apps, so it can't be archived. Choose another Builder in Apps first.");
    expect(archiveRefusal(bot("1"), "2")).toBe("");
  });

  it("asks first, saying it leaves the team for everyone and comes back", () => {
    expect(archiveBotQuestion(bot("1"))).toEqual({
      title: "Archive Bot 1?",
      text: "It leaves the team for everyone in this home. It stays in its chats but no longer answers there, and its routines " +
        "and watches pause. Nothing is deleted. Whoever made it, or an owner or admin, can resume it.",
      confirmLabel: "Archive"
    });
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
