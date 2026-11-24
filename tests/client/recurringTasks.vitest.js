import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { nanoMoney } from "../../src/components/mercbot/accountApi.js";
import { EVERYONE_SECTIONS } from "../../src/components/mercbot/settingsSections.js";
import { paletteCommands } from "../../src/components/mercbot/paletteEntries.js";
import { costWords, groupsOf, kept, summaryParts, whenWords } from "../../src/components/mercbot/recurringTasksView.js";

// Settings → Recurring tasks (D-132): every routine, watch and app job the person can see, grouped by bot (apps' jobs
// last), each with its schedule in words, its last and next run, its state and its cost; filters by kind and state, and
// sorted by cost; a top line of counts and the last 30 days' cost; and a line when there's none. The route is a
// stand-in, read before the section renders, as a browser shows it a moment after it opens.
vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal();
  const onMounted = (hook) => (vue.getCurrentInstance()?.type.__name === "MercbotSettingsRecurringTasks" ? vue.onServerPrefetch(hook) : vue.onMounted(hook));
  return { ...vue, onMounted };
});
const listed = vi.hoisted(() => ({ value: null, error: null }));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: { recurringTasks: async () => {
    if (listed.error) throw listed.error;
    return listed.value;
  } }
}));
const { default: MercbotSettingsRecurringTasks } = await import("../../src/components/mercbot/MercbotSettingsRecurringTasks.vue");
const { useSidebarCommands } = await import("../../src/components/mercbot/useSidebarCommands.js");

async function rendered(props = {}) {
  const app = createSSRApp({ render: () => h(MercbotSettingsRecurringTasks, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"");
}

const scout = { id: "1", name: "Scout", color: "#1E86FC", shape: "cloud", archived: false };
const ada = { id: "2", name: "Ada", color: "#1E86FC", shape: "cloud", archived: false };
const task = (fields) => ({
  kind: "routine", id: "1", name: "Weather", bot: scout, where: { chatId: "5", chatTitle: "Team" }, schedule: "Every day at 7:00",
  nextRunAt: null, lastRunAt: null, state: "running", why: null, madeByYou: true, cost: { nano: 80e6, runs: 30 },
  can: { pause: true, resume: false, edit: true, delete: true }, ...fields
});
const TASKS = [
  task({}),
  task({ id: "2", name: "Digest", bot: ada, cost: { nano: 200e6, runs: 4 } }),
  task({ kind: "watch", id: "3", name: "New deals", schedule: "When Deals records are added", state: "failing", why: "Paused after running more than 30 times in an hour", cost: null, can: { pause: false, resume: false, edit: false, delete: true } }),
  task({ kind: "job", id: "s1", name: "Close stale deals", bot: null, where: { appSlug: "crm", appName: "CRM" }, schedule: "Every day at 02:00 (UTC)", cost: null, state: "paused", can: { pause: false, resume: true, edit: false, delete: false } })
];

describe("the recurring tasks' words", () => {
  it("say when in a person's words, from now", () => {
    const now = new Date("2026-11-24T10:00:00");
    expect(whenWords("2026-11-24T10:20:00", now)).toBe("in 20 min");
    expect(whenWords("2026-11-24T07:00:00", now)).toBe("3 h ago");
    expect(whenWords(new Date("2026-11-25T07:00:00").toISOString(), now)).toMatch(/^tomorrow /u);
    expect(whenWords(new Date("2026-11-23T07:00:00").toISOString(), now)).toMatch(/^yesterday /u);
    expect(whenWords(null, now)).toBe("");
  });

  it("say a task's cost and runs, or that a job runs without AI, or nothing the person can't see", () => {
    expect(costWords(TASKS[0])).toBe(`${nanoMoney(80e6)} · 30 runs`);
    expect(costWords(TASKS[2])).toBe("");
    expect(costWords(task({ cost: { nano: 0, runs: 0 } }))).toBe("No cost yet");
    expect(costWords(TASKS[3])).toBe("Runs without AI");
  });

  it("count the running, paused and failing tasks, and add up what the person sees", () => {
    const { parts, spent } = summaryParts({ tasks: TASKS, others: { count: 1, costNano: 20e6 }, notListedNano: 0 });
    expect(parts).toEqual(["2 running", "1 paused", "1 needs attention"]);
    expect(spent).toBe(nanoMoney(300e6));
  });

  it("group by bot, apps' jobs last; filter by kind or state; sort by cost", () => {
    expect(groupsOf(TASKS, { filter: "all", bot: "", sort: "bot" }).map((group) => [group.title, group.tasks.map((entry) => entry.name)])).toEqual([
      ["Ada", ["Digest"]],
      ["Scout", ["New deals", "Weather"]],
      ["Apps' jobs", ["Close stale deals"]]
    ]);
    expect(groupsOf(TASKS, { filter: "all", bot: "1", sort: "bot" }).map((group) => group.title)).toEqual(["Scout"]);
    expect(TASKS.filter((entry) => kept(entry, "failing")).map((entry) => entry.name)).toEqual(["New deals"]);
    expect(TASKS.filter((entry) => kept(entry, "job")).map((entry) => entry.name)).toEqual(["Close stale deals"]);
    expect(groupsOf(TASKS, { filter: "all", bot: "", sort: "cost" })[0].tasks.map((entry) => entry.name).slice(0, 2)).toEqual(["Digest", "Weather"]);
  });
});

describe("Settings → Recurring tasks", () => {
  it("is a section everyone has, which the search palette finds by its name or by routines", () => {
    expect(EVERYONE_SECTIONS.map((section) => section.value)).toContain("recurring-tasks");
    const entry = paletteCommands({ settingsSections: EVERYONE_SECTIONS, theme: "system" }).find((command) => command.id === "settings:recurring-tasks");
    expect(entry.title).toBe("Settings: Recurring tasks");
    expect(entry.keywords).toContain("routines");
  });

  it("lists the tasks grouped by bot, with their schedule, cost, state and controls", async () => {
    listed.value = { tasks: TASKS, costScope: "home", others: { count: 2, costNano: 10e6 }, notListedNano: 0 };
    const html = await rendered();
    expect(html).toContain("2 running · 1 paused · 1 needs attention");
    expect(html).toContain(`${nanoMoney(290e6)} in the last 30 days`);
    for (const text of ["Weather", "Digest", "New deals", "Close stale deals", "Every day at 7:00", "When Deals records are added", "Paused after running more than 30 times in an hour", "Runs without AI", "Apps' jobs", "CRM", "Team"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("2 more tasks in chats you can't open");
    expect(html).toContain('aria-label="Pause Weather"');
    expect(html).toContain('aria-label="Resume Close stale deals"');
  });

  it("offers a filter chip only for what the list has", async () => {
    listed.value = { tasks: [TASKS[0], TASKS[1]], costScope: "home", others: null, notListedNano: 0 };
    const chips = [...(await rendered()).matchAll(/mb-tasks__chip[^>]*>(?:<[^>]*>)*\s*([^<]+?)\s*</gu)].map(([, label]) => label);
    expect(chips).toEqual(["All", "Routines"]);
  });

  it("tells a member they see their own tasks' costs", async () => {
    listed.value = { tasks: [TASKS[0]], costScope: "own", others: null, notListedNano: 0 };
    const html = await rendered();
    expect(html).toContain("on tasks that run as you");
    expect(html).not.toContain("in chats you can't open");
  });

  it("is one card with an example to ask for when there's none", async () => {
    listed.value = { tasks: [], costScope: "home", others: null, notListedNano: 0 };
    const html = await rendered();
    expect(html).toContain("No recurring tasks yet");
    expect(html).toContain("Check the weather every morning at 7.");
    expect(html).not.toContain("By bot");
  });

  it("a bot's card's link opens it at that bot", async () => {
    const opened = [];
    const { runCommand } = useSidebarCommands({ open: { settings: (section, how) => opened.push([section, how.bot]) }, reportFailure: () => {} });
    await runCommand({ name: "openSettings", args: { section: "recurring-tasks", bot: "7" } });
    expect(opened).toEqual([["recurring-tasks", "7"]]);
  });

  it("offers every task again when a filter leaves none", async () => {
    listed.value = { tasks: TASKS, costScope: "home", others: null, notListedNano: 0 };
    const html = await rendered({ bot: "99" });
    expect(html).toContain("Nothing here with this filter.");
    expect(html).toContain("Show every task");
  });

  it("says a running task's overdue next run is due now, not that it was", async () => {
    const overdue = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    listed.value = { tasks: [task({ nextRunAt: overdue })], costScope: "home", others: null, notListedNano: 0 };
    const html = await rendered();
    expect(html).toContain("Next: due now");
    expect(html).not.toMatch(/Next 1 h ago/u);
  });

  it("says why a cost isn't shown, to everyone and to screen readers", async () => {
    listed.value = { tasks: [task({ cost: null })], costScope: "own", others: null, notListedNano: 0 };
    const html = await rendered();
    expect(html).toContain('aria-label="Cost not shown: it runs as someone else"');
  });

  it("keeps the server's words in place when the list can't load, with Try again", async () => {
    listed.error = Object.assign(new Error("Recurring tasks are resting for a minute."), { status: 503 });
    try {
      const html = await rendered();
      expect(html).toContain("Recurring tasks are resting for a minute.");
      expect(html).toContain("Try again");
      expect(html).not.toContain("Check your connection");
    } finally {
      listed.error = null;
    }
  });

  it("opens filtered to one bot from its card", async () => {
    listed.value = { tasks: TASKS, costScope: "home", others: null, notListedNano: 0 };
    const html = await rendered({ bot: "1" });
    expect(html).toContain("Only Scout");
    expect(html).toContain("1 running · 1 needs attention");
    expect(html).not.toContain("Digest");
  });
});
