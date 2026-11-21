import { afterEach, describe, expect, it, vi } from "vitest";
import { ref, toRaw } from "vue";

// Connect apps waiting for a sign-in in its own window (D-31, D-110): at once when that window says it's done, and every
// few seconds besides, the screen asks for the one account, shows how it stands, and says so once it's connected,
// without reading the whole Connect apps list each time.
const server = vi.hoisted(() => ({ calls: [], account: null, listening: new Set() }));
// The sign-in windows of this browser, as signInReturn.js hears them: each listener is a screen waiting for one.
vi.mock("../../src/components/mercbot/signInReturn.js", () => ({
  listenForSignIns: (onConnected) => {
    server.listening.add(onConnected);
    return () => server.listening.delete(onConnected);
  }
}));
const windowConnected = () => [...server.listening].forEach((onConnected) => onConnected());
vi.mock("../../src/components/mercbot/pluginsApi.js", () => ({
  pluginsApi: {
    list: async () => {
      server.calls.push("list");
      return { plugins: [] };
    },
    account: async (accountId) => {
      server.calls.push(`account ${accountId}`);
      return { account: { ...server.account } };
    }
  }
}));
const { useSignInWatch } = await import("../../src/components/mercbot/useSignInWatch.js");

afterEach(() => vi.useRealTimers());

function connectApps() {
  const gmail = { id: "gmail", name: "Gmail", accounts: [{ id: "4", name: "", status: "needs-auth", label: null, addedByYou: true, canChange: true }, { id: "5", name: "work", status: "connected", label: "work@example.com", addedByYou: true, canChange: true }] };
  const outlook = { id: "outlook", name: "Outlook", accounts: [] };
  const plugins = ref([gmail, outlook]);
  const open = ref(true);
  const toasts = [];
  const reloads = [];
  const reload = async () => {
    reloads.push(plugins.value.map((plugin) => plugin.id).join(","));
  };
  return { gmail, outlook, plugins, open, toasts, reloads, watch: useSignInWatch({ open, plugins, showToast: (text) => toasts.push(text), reload }) };
}

describe("waiting for a sign-in (D-31)", () => {
  it("checks the one account and shows how it stands until it's connected", async () => {
    vi.useFakeTimers();
    const { gmail, outlook, plugins, toasts, reloads, watch } = connectApps();
    server.calls = [];
    server.account = { id: "4", name: "", status: "started", label: null, addedByYou: true, canChange: true };
    watch.watchSignIn(gmail, gmail.accounts[0]);

    await vi.advanceTimersByTimeAsync(3000);
    expect(server.calls).toEqual(["account 4"]);
    expect(plugins.value[0].accounts.map((account) => account.status)).toEqual(["started", "connected"]);
    expect(toasts).toEqual([]);

    server.account = { id: "4", name: "", status: "connected", label: "pat@example.com", addedByYou: true, canChange: true };
    await vi.advanceTimersByTimeAsync(3000);
    expect(plugins.value[0].accounts[0]).toEqual(server.account);
    expect(toRaw(plugins.value[1]), "the other apps are left as they were").toBe(outlook);
    expect(toasts).toEqual(["Gmail is connected as pat@example.com."]);

    await vi.advanceTimersByTimeAsync(30000);
    expect(server.calls, "nothing more once it's connected, and never the whole list").toEqual(["account 4", "account 4"]);
    expect(reloads).toEqual([]);
  });

  it("reads the whole list once an app that lists its own actions is connected, for its Tools (D-34)", async () => {
    vi.useFakeTimers();
    const { plugins, toasts, reloads, watch } = connectApps();
    const tasks = { id: "tasks", name: "Tasks", mcp: { url: "https://tasks.example/mcp" }, accounts: [{ id: "7", name: "", status: "needs-auth", label: null, addedByYou: true, canChange: true }] };
    plugins.value = [...plugins.value, tasks];
    server.calls = [];
    server.account = { id: "7", name: "", status: "started", label: null, addedByYou: true, canChange: true };
    watch.watchSignIn(tasks, tasks.accounts[0]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(reloads).toEqual([]);

    server.account = { id: "7", name: "", status: "connected", label: "pat@example.com", addedByYou: true, canChange: true };
    await vi.advanceTimersByTimeAsync(3000);
    expect(toasts).toEqual(["Tasks is connected as pat@example.com."]);
    expect(reloads, "after the account shows connected").toEqual(["gmail,outlook,tasks"]);
    await vi.advanceTimersByTimeAsync(30000);
    expect([server.calls, reloads.length]).toEqual([["account 7", "account 7"], 1]);
  });

  it("reads the account at once when its sign-in window says it's done, then waits no more (D-110)", async () => {
    vi.useFakeTimers();
    const { gmail, toasts, watch } = connectApps();
    server.calls = [];
    server.account = { id: "4", name: "", status: "connected", label: "pat@example.com", addedByYou: true, canChange: true };
    watch.watchSignIn(gmail, gmail.accounts[0]);
    expect(server.listening.size).toBe(1);
    windowConnected();
    await vi.advanceTimersByTimeAsync(0);
    expect([server.calls, toasts]).toEqual([["account 4"], ["Gmail is connected as pat@example.com."]]);
    expect(server.listening.size, "it stops listening once connected").toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    windowConnected();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls, "neither the timer nor another window reads it again").toEqual(["account 4"]);
  });

  it("stops when the screen closes, and has nothing to wait for without an account", async () => {
    vi.useFakeTimers();
    const { gmail, outlook, open, watch } = connectApps();
    server.calls = [];
    server.account = { id: "4", name: "", status: "needs-auth", label: null, addedByYou: true, canChange: true };
    watch.watchSignIn(outlook, undefined);
    await vi.advanceTimersByTimeAsync(9000);
    expect(server.calls).toEqual([]);

    watch.watchSignIn(gmail, gmail.accounts[0]);
    await vi.advanceTimersByTimeAsync(3000);
    open.value = false;
    await vi.advanceTimersByTimeAsync(30000);
    expect(server.calls).toEqual(["account 4"]);
  });
});
