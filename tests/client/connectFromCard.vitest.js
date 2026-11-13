import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

// Signing in from a bot's connect card: once the sign-in opens, the bot is told, so it
// finishes its task by itself when the app is connected. A card that isn't waiting tells nobody.
const server = vi.hoisted(() => ({ calls: [], failToTell: false }));
vi.mock("vue-router", () => ({ useRoute: () => reactive({ query: {} }), useRouter: () => ({ replace: () => {} }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({
  pluginsApi: {
    list: async () => ({ plugins: [{ id: "google-drive", name: "Google Drive", installed: false }] }),
    install: async (pluginId) => server.calls.push(`install ${pluginId}`)
  },
  openSignIn: (_path, plugin) => server.calls.push(`sign in ${plugin.id}`)
}));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: {
    connectFromCard: async (botId, messageId) => {
      server.calls.push(`tell bot ${botId} card ${messageId}`);
      if (server.failToTell) throw new Error("409");
      return {};
    }
  }
}));
const { useConnectApps } = await import("../../src/components/mercbot/useConnectApps.js");

function connecting() {
  const failures = [];
  const apps = useConnectApps({ reportFailure: (text) => failures.push(text), currentBot: { value: { id: "8" } } });
  return { apps, failures };
}

const card = (status) => ({ id: "41", body: { app: "Google Drive", ...(status ? { status } : {}) } });

describe("signing in from a connect card", () => {
  it("opens the sign-in, then tells the bot, which carries on once the app is connected", async () => {
    server.calls = [];
    server.failToTell = false;
    const { apps, failures } = connecting();
    await apps.explainConnect(card("waiting"));
    expect(apps.explainerOpen.value).toBe(true);
    await apps.continueConnect(apps.explainerPlugin.value);
    await Promise.resolve();
    expect(server.calls).toEqual(["install google-drive", "sign in google-drive", "tell bot 8 card 41"]);
    expect(failures).toEqual([]);

    // Once told, a second sign-in from the explainer doesn't tell it again.
    await apps.continueConnect({ id: "google-drive", installed: true });
    expect(server.calls.at(-1)).toBe("sign in google-drive");
  });

  it("an old card tells nobody, and a bot that can't be told is explained", async () => {
    server.calls = [];
    const { apps } = connecting();
    await apps.explainConnect(card(""));
    await apps.continueConnect({ id: "google-drive", installed: true });
    expect(server.calls).toEqual(["sign in google-drive"]);

    server.calls = [];
    server.failToTell = true;
    const failing = connecting();
    await failing.apps.explainConnect(card("connecting"));
    await failing.apps.continueConnect({ id: "google-drive", installed: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing.failures).toEqual(["Your bot won't carry on by itself after you sign in. Ask it once you're connected."]);
  });
});
