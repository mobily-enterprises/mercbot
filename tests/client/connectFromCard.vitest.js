import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

// Signing in from a bot's connect card in a chat (D-110, D-112): the explainer ends in the same Add account step as
// Connect apps, whose answer makes the account (the home's, D-111: only a label is sent, never who uses it), then signs
// it in; the card's chat is told, so its bot finishes its task by itself when the app is connected. On a phone, where
// the sign-in takes the tab, the chat is told before it leaves. A card that isn't waiting, or one with no chat open,
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
vi.mock("../../src/components/mercbot/chatsApi.js", () => ({
  chatsApi: {
    connectFromCard: async (chatId, messageId) => {
      server.calls.push(`tell chat ${chatId} card ${messageId}`);
      await Promise.resolve();
      if (server.failToTell) throw new Error("409");
      server.calls.push("chat told");
      return {};
    }
  }
}));
const { useConnectApps } = await import("../../src/components/mercbot/useConnectApps.js");

/** Connect apps with chat 8 open, or no chat. */
function connecting(currentChat = { id: "8", title: "Kitchen" }) {
  const failures = [];
  const apps = useConnectApps({ reportFailure: (text) => failures.push(text), currentChat: { value: currentChat } });
  return { apps, failures };
}

const card = (status) => ({ id: "41", body: { app: "Google Drive", ...(status ? { status } : {}) } });

describe("signing in from a connect card", () => {
  it("adds the account the Add account step describes, signs it in, and tells the card's chat, whose bot carries on once it's connected", async () => {
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
    expect(server.calls).toEqual(['add google-drive "Work"', "tell chat 8 card 41", "sign in google-drive account 77", "chat told"]);
    expect(failures).toEqual([]);

    // Once told, a second sign-in from the explainer doesn't tell it again.
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "" });
    expect(server.calls.slice(-2)).toEqual(['add google-drive ""', "sign in google-drive account 77"]);
  });

  it("on a phone, tells the chat before the sign-in takes the tab", async () => {
    server.calls = [];
    server.phone = true;
    const { apps } = connecting();
    await apps.explainConnect(card("waiting"));
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "" });
    expect(server.calls).toEqual(['add google-drive ""', "tell chat 8 card 41", "chat told", "sign in google-drive account 77"]);
    server.phone = false;
  });

  it("an old card, or one with no chat open, tells nobody, and a bot that can't be told is explained", async () => {
    server.calls = [];
    const { apps } = connecting();
    await apps.explainConnect(card(""));
    await apps.continueConnect({ plugin: apps.explainerPlugin.value, label: "" });
    expect(server.calls).toEqual(['add google-drive ""', "sign in google-drive account 77"]);

    server.calls = [];
    const nowhere = connecting(null);
    await nowhere.apps.explainConnect(card("waiting"));
    await nowhere.apps.continueConnect({ plugin: nowhere.apps.explainerPlugin.value, label: "" });
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
