import { createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MercbotArchivedBotBanner from "../../src/components/mercbot/MercbotArchivedBotBanner.vue";
import { theme } from "../../src/theme/index.js";
import { archiveBotQuestion, archiveRefusal, archivedBotLine } from "../../src/components/mercbot/archiveBot.js";
import { buildRailModel, buildSidebarModel } from "../../src/components/mercbot/botDirectory.js";
import { botMenuItems } from "../../src/components/mercbot/botMenus.js";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";
import { useGroupMembers } from "../../src/components/mercbot/useGroupMembers.js";
import { useSidebarCommands } from "../../src/components/mercbot/useSidebarCommands.js";

// What the bots API answers, set per test: a value, or an error it throws.
const api = vi.hoisted(() => ({ calls: [], answer: null }));
vi.mock("../../src/components/mercbot/botsApi.js", () => {
  const answering = (name) => async (...args) => {
    api.calls.push([name, ...args]);
    if (api.answer instanceof Error) throw api.answer;
    return api.answer;
  };
  return { botsApi: { archiveBot: answering("archiveBot"), unarchiveBot: answering("unarchiveBot") }, notebookChanges: { value: 0 } };
});
vi.mock("../../src/components/mercbot/homesApi.js", () => ({ peopleApi: { list: async () => ({ people: [] }) } }));

/** A component's HTML, rendered with the app's Vuetify, its apostrophes as written. */
async function rendered(component, props) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'");
}

/** An error as the HTTP client throws a route's refusal. */
const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

// Archiving a whole bot (D-108): the sidebar's Archived bots, the menus that archive and unarchive, who may and why
// not, the question first, an archived bot's line, what the commands do, and the pickers that leave it out.
const bot = (id, extra = {}) => ({
  id, name: `Bot ${id}`, kind: "bot", pinPosition: null, sectionId: null, hidden: false, archivedAt: null, canArchive: true,
  lastActivityAt: `2026-11-21T10:0${id}:00Z`, ...extra
});

beforeEach(() => {
  api.calls.length = 0;
  api.answer = null;
  shellPreferences.archivedExpanded = false;
});

describe("the sidebar's Archived bots", () => {
  const sections = [{ id: "s1", name: "Money", position: 0, collapsed: false }];
  const bots = [
    bot("1", { pinPosition: 0 }),
    bot("2", { sectionId: "s1" }),
    bot("3", { pinPosition: 1, archivedAt: "2026-11-20T09:00:00.000Z" }),
    bot("4", { sectionId: "s1", hidden: true, archivedAt: "2026-11-21T09:00:00.000Z" }),
    bot("5", { hidden: true })
  ];

  it("holds the archived bots alone, newest archived first, whatever their pin, section or hidden state", () => {
    const model = buildSidebarModel({ bots, sections, hiddenExpanded: true });
    expect(model.archived.map((entry) => entry.id)).toEqual(["4", "3"]);
    expect(model.tiles.map((entry) => entry.id)).toEqual(["1"]);
    expect(model.groups.flatMap((group) => group.bots).map((entry) => entry.id)).toEqual(["2"]);
    expect(model.hidden.map((entry) => entry.id)).toEqual(["5"]);
  });

  it("keeps them out of the order the keys walk and of the rail until it's opened", () => {
    expect(buildSidebarModel({ bots, sections, hiddenExpanded: true }).visualOrder).toEqual(["1", "2", "5"]);
    expect(buildSidebarModel({ bots, sections, archivedExpanded: true }).visualOrder, "opened, last").toEqual(["1", "2", "4", "3"]);
    const rail = buildRailModel(buildSidebarModel({ bots, sections, archivedExpanded: true }));
    expect(rail.flat().map((entry) => entry.id)).toEqual(["1", "2"]);
  });

  it("is empty when nothing is archived, and an unarchived bot is back in its pin and section", () => {
    const back = bots.map((entry) => ({ ...entry, archivedAt: null }));
    const model = buildSidebarModel({ bots: back, sections });
    expect(model.archived).toEqual([]);
    expect(model.tiles.map((entry) => entry.id)).toEqual(["1", "3"]);
    expect(model.hidden.map((entry) => entry.id), "hidden as before, newest activity first").toEqual(["5", "4"]);
  });
});

describe("who may archive a bot, and why not", () => {
  it("is its maker or an owner or admin, never for the main bot, the Builder or a group chat", () => {
    expect(archiveRefusal(bot("1"), null)).toBe("");
    expect(archiveRefusal(bot("1", { canArchive: false }), null)).toBe("Only the person who made Bot 1 and the home's owners and admins can archive it.");
    expect(archiveRefusal(bot("1", { isMain: true }), null)).toBe("Bot 1 is this home's main bot, so it can't be archived. Make another bot the main bot first.");
    expect(archiveRefusal(bot("1"), "1")).toBe("Bot 1 builds this home's apps, so it can't be archived. Choose another Builder in Apps first.");
    expect(archiveRefusal(bot("1"), "2")).toBe("");
    expect(archiveRefusal(bot("9", { kind: "group" }), null)).toBe("A group chat can't be archived. Leave it or delete it instead.");
  });

  it("asks first, saying it's for everyone and comes back", () => {
    expect(archiveBotQuestion(bot("1"))).toEqual({
      title: "Archive Bot 1?",
      text: "It moves to Archived bots for everyone in this home: its chats become read-only, and its routines and watches pause. " +
        "Nothing is deleted. Whoever made it, or an owner or admin, can unarchive it.",
      confirmLabel: "Archive"
    });
  });

  it("says who archived it and on which day", () => {
    const at = "2026-11-21T10:00:00.000Z";
    expect(archivedBotLine({ archivedAt: at, archivedBy: "Kim" }, "en-GB")).toBe("Archived by Kim on 21 Nov 2026");
    expect(archivedBotLine({ archivedAt: at, archivedBy: "you" }, "en-GB")).toBe("Archived by you on 21 Nov 2026");
    expect(archivedBotLine({ archivedAt: at, archivedBy: null }, "en-GB"), "an account that's gone").toBe("Archived on 21 Nov 2026");
  });
});

describe("a bot's menu", () => {
  const menuOf = (entry, place, builderId = null) => {
    const asked = [];
    const commands = [];
    const items = botMenuItems({
      bot: entry,
      place,
      sections: [],
      model: { tiles: [], groups: [], hidden: [] },
      command: (name, args) => commands.push([name, args]),
      startRename: () => {},
      askDelete: () => asked.push("delete"),
      askArchive: () => asked.push("archive"),
      builderId
    });
    return { titles: items.filter((item) => item.title).map((item) => item.title), items, asked, commands };
  };

  it("offers Archive, asking first, on a row, a tile and a hidden bot, where it would work", () => {
    for (const place of ["row", "tile", "hidden"]) {
      const { titles, items, asked } = menuOf(bot("1"), place);
      expect(titles).toContain("Archive");
      items.find((item) => item.title === "Archive").run();
      expect(asked).toEqual(["archive"]);
    }
    expect(menuOf(bot("1", { canArchive: false }), "row").titles).not.toContain("Archive");
    expect(menuOf(bot("1", { isMain: true }), "row").titles).not.toContain("Archive");
    expect(menuOf(bot("1"), "row", "1").titles, "the Builder").not.toContain("Archive");
    expect(menuOf(bot("9", { kind: "group" }), "row").titles).not.toContain("Archive");
  });

  it("on an archived bot is Unarchive, Copy and Delete, and no pin, section or rename", () => {
    const archived = bot("3", { archivedAt: "2026-11-21T09:00:00.000Z" });
    const { titles, items, commands } = menuOf(archived, "archived");
    expect(titles).toEqual(["Unarchive", "Copy conversation ID", "Delete"]);
    items[0].run();
    expect(commands).toEqual([["unarchiveBot", { botId: "3" }]]);
    expect(menuOf({ ...archived, canArchive: false }, "archived").titles, "someone who may not").toEqual(["Copy conversation ID", "Delete"]);
  });
});

describe("the archive commands", () => {
  const commands = () => {
    const updated = [];
    const failures = [];
    const { runCommand } = useSidebarCommands({
      bots: ref([]),
      sections: ref([]),
      editingSectionId: ref(""),
      store: { updateBot: (entry) => updated.push(entry), mergeBots: () => {} },
      currentBotId: () => "1",
      mainBotId: () => null,
      firstBotId: () => null,
      reopen: () => {},
      dropBot: () => {},
      open: {},
      copy: () => {},
      reportFailure: (message) => failures.push(message)
    });
    return { runCommand, updated, failures };
  };

  it("archive and unarchive, taking the bot as the server lists it now", async () => {
    const { runCommand, updated, failures } = commands();
    api.answer = { bot: bot("1", { archivedAt: "2026-11-21T10:00:00.000Z", archivedBy: "you" }) };
    await runCommand({ name: "archiveBot", args: { botId: "1" } });
    api.answer = { bot: bot("1") };
    await runCommand({ name: "unarchiveBot", args: { botId: "1" } });
    expect(api.calls).toEqual([["archiveBot", "1"], ["unarchiveBot", "1"]]);
    expect(updated.map((entry) => entry.archivedAt)).toEqual(["2026-11-21T10:00:00.000Z", null]);
    expect(failures).toEqual([]);
  });

  it("say the server's reason a bot can't be archived, and a plain failure otherwise", async () => {
    const { runCommand, failures } = commands();
    api.answer = refusal(409, "bots_archive_main", "Bot 1 is this home's main bot, so it can't be archived. Make another bot the main bot first.");
    await runCommand({ name: "archiveBot", args: { botId: "1" } });
    api.answer = refusal(502, "", "Bad gateway");
    await runCommand({ name: "unarchiveBot", args: { botId: "1" } });
    expect(failures).toEqual(["Bot 1 is this home's main bot, so it can't be archived. Make another bot the main bot first.", "That didn't work. Try again."]);
  });

  it("open and close Archived bots, remembered on this device", async () => {
    const { runCommand } = commands();
    await runCommand({ name: "toggleArchived", args: {} });
    expect(shellPreferences.archivedExpanded).toBe(true);
    await runCommand({ name: "toggleArchived", args: {} });
    expect(shellPreferences.archivedExpanded).toBe(false);
  });
});

describe("an archived bot's chat", () => {
  const archived = bot("3", { name: "Ledger", archivedAt: "2026-11-21T10:00:00.000Z", archivedBy: "Kim" });

  it("shows who archived it and when in place of the composer, with Unarchive for whoever may", async () => {
    const html = await rendered(MercbotArchivedBotBanner, { bot: archived });
    expect(html).toContain('role="status" aria-label="Archived"');
    expect(html).toContain(archivedBotLine(archived));
    expect(html).toContain("Its chats are read-only, and its routines and watches are paused. Unarchive it to talk to it again.");
    expect(html).toMatch(/<button[^>]*mb-archived-bot__unarchive[^>]*>[\s\S]*Unarchive <\/button>/u);
    const theirs = await rendered(MercbotArchivedBotBanner, { bot: { ...archived, canArchive: false } });
    expect(theirs).toContain("Its chats are read-only. The person who made Ledger and the home's owners and admins can unarchive it.");
    expect(theirs, "no Unarchive for someone who may not").not.toContain("<button");
  });
});

describe("a group's Add a bot", () => {
  it("never offers an archived bot", () => {
    const group = bot("9", { kind: "group", members: [{ id: "1", name: "Bot 1" }] });
    const { addable } = useGroupMembers({
      bot: () => group,
      allBots: () => [group, bot("1"), bot("2"), bot("3", { archivedAt: "2026-11-21T09:00:00.000Z" })],
      me: () => "7",
      home: ref(null),
      manages: ref(false),
      onAddMember: () => {},
      onAddPerson: () => {},
      onFailure: () => {}
    });
    expect(addable.value.map((entry) => entry.id)).toEqual(["2"]);
  });
});
