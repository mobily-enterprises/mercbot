import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";

// Skills (Ctrl+Alt+W, the sidebar's button, the search palette's command) opens Connect apps on Your apps and skills, at
// Private skills, where a skill opens to be changed. Connect apps itself still opens on its catalogue.
vi.mock("vue-router", () => ({ useRoute: () => reactive({ query: {} }), useRouter: () => ({ replace: () => {} }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({ pluginsApi: {}, openSignIn: () => {} }));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({ botsApi: {} }));
const { useConnectApps } = await import("../../src/components/mercbot/useConnectApps.js");
const { matchShortcut } = await import("../../src/components/mercbot/shortcuts.js");
const { paletteCommands } = await import("../../src/components/mercbot/paletteEntries.js");

describe("Skills", () => {
  it("is Ctrl+Alt+W, and a search palette command after Connect Apps", () => {
    expect(matchShortcut({ code: "KeyW", ctrlKey: true, altKey: true, shiftKey: false })).toEqual({ action: "skills" });
    const titles = paletteCommands({ currentBot: null, settingsSections: [], theme: "system" }).map((command) => command.title);
    expect(titles.slice(titles.indexOf("Connect Apps"), titles.indexOf("Connect Apps") + 2)).toEqual(["Connect Apps", "Skills"]);
  });

  it("opens Connect apps on Your apps and skills; closed, it opens on the catalogue or an app again", async () => {
    const apps = useConnectApps({ reportFailure: () => {}, currentBot: { value: null } });
    apps.openSkills();
    expect(apps.appsOpen.value).toBe(true);
    expect(apps.appsPage.value).toBe("manage");
    await nextTick();

    apps.appsOpen.value = false;
    await nextTick();
    expect(apps.appsPage.value).toBe("");
    apps.openApp("gmail");
    expect(apps.appsPage.value).toBe("");
    expect(apps.appsAppId.value).toBe("gmail");
  });
});
