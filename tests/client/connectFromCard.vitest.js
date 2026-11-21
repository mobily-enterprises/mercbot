import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

// Signing in from a bot's connect card (D-110): the explainer ends in the same Add account step as Connect apps, whose
// answer makes the account (the home's, D-111: only a label is sent, never who uses it), then signs it in; the bot is told, so it finishes its task by itself when the app is
// connected. On a phone, where the sign-in takes the tab, the bot is told before it leaves. A card that isn't waiting
// tells nobody.
const server = vi.hoisted(() => ({ calls: [], failToTell: false, phone: false }));
vi.mock("vue-router", () => ({ useRoute: () => reactive({ query: {} }), useRouter: () => ({ replace: () => {} }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("../../src/components/mercbot/signInReturn.js", () => ({ listenForSignIns: () => () => {}, signInInThisTab: () => server.phone }));
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({
  pluginsApi: {
    list: async () => ({ plugins: [{ id: "google-drive", name: "Google Drive", installed: false, accounts: [] }], managesHome: true }),
    addAccount: async (...sent) => {
      const [pluginId, label] = sent;
      server.calls.push(`add ${pluginId} "${label}"${sent.length > 2 ? ` and ${JSON.stringify(sent.slice(2))}` : ""}`);
      return { plugins: [{ id: pluginId, name: "Google Drive", installed: true, accounts: [{ id: "77", name: label }] }], accountId: "77" };
    }
  },
  openSignIn: (_path, plugin, account) => server.calls.push(`sign in ${plugin.id} account ${account.id}`)
}));
vi.mock("../../src/components/mercbot/botsApi.js", () => ({
  botsApi: {
    connectFromCard: async (botId, messageId) => {
      server.calls.push(`tell bot ${botId} card ${messageId}`);
      await Promise.resolve();
      if (server.failToTell) throw new Error("409");
      server.calls.push("bot told");
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
  it("adds the account the Add account step describes, signs it in, and tells the bot, which carries on once it's connected", async () => {
    server.calls = [];
    server.failToTell = false;
    server.phone = false;
    const { apps, failures } = connecting();
    await apps.explainConnect(card("waiting"));
    expect(apps.explainerOpen.value).toBe(true);
    expect(apps).not.toHaveProperty("explainerManagesHome");
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "Work" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apps.explainerOpen.value).toBe(false);
    expect(server.calls).toEqual(['add google-drive "Work"', "tell bot 8 card 41", "sign in google-drive account 77", "bot told"]);
    expect(failures).toEqual([]);

    // Once told, a second sign-in from the explainer doesn't tell it again.
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "" });
    expect(server.calls.slice(-2)).toEqual(['add google-drive ""', "sign in google-drive account 77"]);
  });

  it("on a phone, tells the bot before the sign-in takes the tab", async () => {
    server.calls = [];
    server.phone = true;
    const { apps } = connecting();
    await apps.explainConnect(card("waiting"));
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "" });
    expect(server.calls).toEqual(['add google-drive ""', "tell bot 8 card 41", "bot told", "sign in google-drive account 77"]);
    server.phone = false;
  });

  it("an old card tells nobody, and a bot that can't be told is explained", async () => {
    server.calls = [];
    const { apps } = connecting();
    await apps.explainConnect(card(""));
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "" });
    expect(server.calls).toEqual(['add google-drive ""', "sign in google-drive account 77"]);

    server.calls = [];
    server.failToTell = true;
    const failing = connecting();
    await failing.apps.explainConnect(card("connecting"));
    await failing.apps.continueConnect({ plugin: failing.apps.explainerPlugin.value, label: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing.failures).toEqual(["Your bot won't carry on by itself after you sign in. Ask it once you're connected."]);
  });
});
