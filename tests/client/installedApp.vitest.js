import { afterEach, describe, expect, it, vi } from "vitest";

// Mercbot as an installed app on this device (D-133): turning notifications on, and what another app shares in.
vi.mock("../../src/components/mercbot/accountApi.js", () => ({ accountApi: { addPushDevice: vi.fn(async () => ({})) } }));
const { accountApi } = await import("../../src/components/mercbot/accountApi.js");

const KEY_A = "BAkUeuac9-mtKwQPsxI_4J2wmv11h0JXynKFtLmkwduTWLe8PLAVm71MIM-mL2avFegHG4xk5GTFIMpV_iqVu34";
const KEY_B = "BPvREK_t_yfNMmXT-eyNwc4cZSuCR6_v8hfoQ_1psB75AdYuUB3JuTqfaHz4RtQ9KU8FTboDLZ-R1k4UuYY3LH4";
const bytes = (key) => Uint8Array.from(atob(key.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0));

/** A browser whose push service holds `kept` (subscribed with `keptKey`), as the app sees it. */
async function browserWith(kept, keptKey) {
  vi.resetModules();
  let subscription = kept ? { endpoint: "https://fcm.googleapis.com/fcm/send/old", options: { applicationServerKey: bytes(keptKey).buffer }, unsubscribe: vi.fn(async () => { subscription = null; return true; }), toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/old", keys: {} }) } : null;
  const old = subscription;
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: vi.fn(async ({ applicationServerKey }) => {
      subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/new", options: { applicationServerKey: applicationServerKey.buffer }, toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: {} }) };
      return subscription;
    })
  };
  vi.stubGlobal("window", { isSecureContext: true, matchMedia: () => ({ matches: false }), addEventListener() {}, PushManager: {}, Notification: {} });
  vi.stubGlobal("navigator", { userAgent: "Chrome/130", platform: "Linux", maxTouchPoints: 0, serviceWorker: { register: async () => ({ pushManager }) } });
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: async () => "granted" });
  vi.stubGlobal("PushManager", {});
  const { startAppInstall, useAppInstall } = await import("../../src/components/mercbot/appInstall.js");
  startAppInstall();
  return { app: useAppInstall(), pushManager, old };
}

afterEach(() => {
  vi.unstubAllGlobals();
  accountApi.addPushDevice.mockClear();
});

describe("turning notifications on", () => {
  it("keeps a subscription made with the server's key", async () => {
    const { app, pushManager } = await browserWith(true, KEY_A);
    expect(await app.allowNotifications(KEY_A)).toBe("allowed");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(accountApi.addPushDevice.mock.calls[0][0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/old");
  });

  it("subscribes again when the server's key changed: the old subscription can never be sent to", async () => {
    const { app, pushManager, old } = await browserWith(true, KEY_A);
    expect(await app.allowNotifications(KEY_B)).toBe("allowed");
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(accountApi.addPushDevice.mock.calls[0][0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/new");
  });
});

describe("what turning notifications on tells the person", () => {
  it("says why when it didn't happen, and nothing when they said no", async () => {
    const { notificationsOutcome } = await import("../../src/components/mercbot/appInstall.js");
    expect(notificationsOutcome("allowed")).toBe("");
    expect(notificationsOutcome("refused")).toBe("");
    expect(notificationsOutcome("unavailable")).toMatch(/didn't answer/u);
  });
});
