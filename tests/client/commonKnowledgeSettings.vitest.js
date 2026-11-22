import { createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Settings → Bots' common knowledge (D-113, D-119): the home's list, newest first, each with who asked and when, and a
// bin only on the entries the server says the person may remove (its author, the home's owners and admins); one line
// when there is none. Each bot's card has one link line to it, with the count, and the link opens Settings there.
// The routes are stand-ins; the section reads them before it renders, as a browser shows them a moment after it opens.
vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal();
  const onMounted = (hook) => (vue.getCurrentInstance()?.type.__name === "MercbotSettingsCommonKnowledge" ? vue.onServerPrefetch(hook) : vue.onMounted(hook));
  return { ...vue, onMounted };
});
const listed = vi.hoisted(() => ({ value: { entries: [], next: null } }));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: { commonKnowledge: async () => listed.value }
}));
// The card's section reads its rooms memory and the count; here, already read.
vi.mock("../../src/components/mercbot/useRoomsMemory.js", async (importOriginal) => ({
  ...(await importOriginal()),
  useRoomsMemory: () => ({
    roomsMemory: ref(null), commonCount: ref("50+"), loaded: ref(true), loadFailed: ref(false), hasRoomsMemory: ref(false), load: () => {}
  })
}));
const { default: MercbotSettingsCommonKnowledge } = await import("../../src/components/mercbot/MercbotSettingsCommonKnowledge.vue");
const { default: MercbotRoomsMemorySection } = await import("../../src/components/mercbot/MercbotRoomsMemorySection.vue");
const { useSidebarCommands } = await import("../../src/components/mercbot/useSidebarCommands.js");

async function rendered(component, props = {}) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return (await renderToString(app)).replaceAll("&#39;", "'").replaceAll("&quot;", "\"");
}
const bins = (html) => [...html.matchAll(/aria-label="Remove from common knowledge: ([^"]*)"/gu)].map(([, text]) => text);
const entry = (id, canRemove) => ({
  id, text: `Entry ${id}`, by: { id: "2", name: "Ben" }, viaBot: { id: "7", name: "Chef" }, createdAt: "2026-11-22T10:00:00.000Z", canRemove
});

describe("Settings' Bots' common knowledge", () => {
  it("lists every entry with who asked, and a bin only where the person may remove it", async () => {
    listed.value = { entries: [entry("3", true), entry("2", false)], next: "2" };
    const html = await rendered(MercbotSettingsCommonKnowledge);
    expect(html).toContain("Entry 3");
    expect(html).toContain("Entry 2");
    expect(html).toContain("Ben, via Chef");
    expect(bins(html), "someone else's entry has no bin for a member").toEqual(["Entry 3"]);
    expect(html).toContain("Show older");
  });

  it("is one line when there is none, with nothing older", async () => {
    listed.value = { entries: [], next: null };
    const html = await rendered(MercbotSettingsCommonKnowledge);
    expect(html).toContain("No common knowledge yet.");
    expect(bins(html)).toEqual([]);
    expect(html).not.toContain("Show older");
  });
});

describe("a bot card's link to the home's common knowledge", () => {
  it("is one line with the count", async () => {
    const html = await rendered(MercbotRoomsMemorySection, { bot: { id: "7", name: "Chef" }, tab: "details" });
    expect(html).toMatch(/data-common-knowledge[^>]*>\s*Chef also knows the home's common knowledge \(50\+\) →\s*</u);
  });

  it("opens Settings at that section; with none named, at General", async () => {
    const opened = [];
    const { runCommand } = useSidebarCommands({ open: { settings: (section) => opened.push(section) }, reportFailure: () => {} });
    await runCommand({ name: "openSettings", args: { section: "common-knowledge" } });
    await runCommand({ name: "openSettings", args: { section: "main-bot" } });
    await runCommand({ name: "openSettings" });
    expect(opened).toEqual(["common-knowledge", "main-bot", "general"]);
  });
});
