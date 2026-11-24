import { computed, reactive, readonly } from "vue";
import { accountApi } from "./accountApi.js";

// Mercbot as an app people install from the website (D-133): the service worker (src/public/sw.js), the browser's
// offer to install (Chrome and Edge give one; on an iPhone or iPad it's Share → Add to Home Screen, which the shell's
// guide shows), and notifications on this device, which need the worker and the person's yes.

const BANNER_KEY = "mercbot.installBanner";
// How long the browser's push service has to answer a subscription.
const SUBSCRIBE_MS = 20000;

const appleDevice = () => /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const runsInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// readable-check: allow module-state - shared resource: the page's one service worker and install offer, which the account menu, the banner and Settings read
const state = reactive({
  installed: false,
  apple: false,
  // The browser's install offer, kept from the moment it comes: it comes once, often before the shell is up.
  offer: null,
  // The iPhone guide, open.
  guideOpen: false
});
// readable-check: allow module-state - shared resource: the page's one service worker registration, null without one
let worker = Promise.resolve(null);

/** Starts the service worker and listens for the install offer: once, as the page starts. */
export function startAppInstall() {
  state.installed = runsInstalled();
  state.apple = appleDevice();
  // readable-check: allow released-listeners - shared resource: the browser's install offer, for the page's whole life
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.offer = event;
  });
  // readable-check: allow released-listeners - shared resource: the page learns it was installed, for its whole life
  window.addEventListener("appinstalled", () => {
    state.installed = true;
    state.offer = null;
  });
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  worker = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
    console.warn("Mercbot couldn't start its service worker; it works on without being installable.", error);
    return null;
  });
}

/** Whether the one-time banner on phones was answered: installed, or put away. */
function bannerAnswered() {
  try {
    return Boolean(localStorage.getItem(BANNER_KEY));
  } catch {
    return true;
  }
}

/** A subscription as the server takes it: its push address and keys, and a name the person recognises the device by. */
function asDevice(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  const agent = navigator.userAgent;
  const browser = /Edg\//u.test(agent) ? "Edge" : /Firefox\//u.test(agent) ? "Firefox" : /Chrome\//u.test(agent) ? "Chrome" : "Safari";
  const system = /Android/u.test(agent) ? "Android" : appleDevice() && navigator.maxTouchPoints > 1 ? "iPhone or iPad"
    : /Mac/u.test(agent) ? "Mac" : /Windows/u.test(agent) ? "Windows" : /Linux/u.test(agent) ? "Linux" : "this device";
  return { endpoint, keys, label: `${runsInstalled() ? "Mercbot app" : browser} on ${system}` };
}

/** The server's key, as PushManager takes it. */
function keyBytes(publicKey) {
  const base64 = publicKey.replace(/-/gu, "+").replace(/_/gu, "/");
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Whether a subscription's key (an ArrayBuffer, or none) is `key`. */
function sameKey(kept, key) {
  if (!kept) return false;
  const held = new Uint8Array(kept);
  return held.length === key.length && held.every((byte, index) => byte === key[index]);
}

/** What turning notifications on tells the person: why it didn't happen, or nothing (allowed, or they said no). */
export function notificationsOutcome(outcome) {
  return outcome === "unavailable" ? "This browser's notification service didn't answer. Try again in a moment, or in another browser." : "";
}

/** The app's install offer and this device's notifications, for the account menu, the banner and Settings. */
export function useAppInstall() {
  // Installable here: not installed yet, and the browser offers it (Chrome, Edge) or the person adds it (iPhone, iPad).
  const canInstall = computed(() => !state.installed && (Boolean(state.offer) || state.apple));
  // Notifications on this device need the worker and PushManager: on an iPhone or iPad, only once it's installed.
  const pushSupported = computed(() => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const needsInstallForPush = computed(() => state.apple && !state.installed && !pushSupported.value);

  /** Installs the app: the browser's own sheet where it has one, else the guide. Answers whether it was installed. */
  async function install() {
    rememberBanner();
    if (!state.offer) {
      state.guideOpen = true;
      return false;
    }
    const offer = state.offer;
    state.offer = null;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    return outcome === "accepted";
  }

  function rememberBanner() {
    try {
      localStorage.setItem(BANNER_KEY, "answered");
    } catch {
      // Storage unavailable: the banner may show again on another visit.
    }
  }

  /** This device's push subscription, or null: not allowed yet, or no worker. */
  async function currentSubscription() {
    const registration = await worker;
    return registration?.pushManager ? registration.pushManager.getSubscription() : null;
  }

  /**
   * Allows notifications on this device: asks the person (the browser's own question), subscribes with the server's key
   * and keeps the device. Answers "allowed", "refused" (now or before) or "unavailable".
   * @param {string} publicKey the server's (GET /push)
   */
  async function allowNotifications(publicKey) {
    const registration = await worker;
    if (!registration?.pushManager || !publicKey) return "unavailable";
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return "refused";
    // The browser's push service may not answer (a browser without one never does): past a while, it's unavailable.
    // A subscription made with another server key (the server's secret changed) can never be sent to: it's replaced.
    const key = keyBytes(publicKey);
    const subscribing = registration.pushManager.getSubscription().then(async (kept) => {
      if (kept && sameKey(kept.options?.applicationServerKey, key)) return kept;
      if (kept) await kept.unsubscribe();
      return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    });
    const subscription = await Promise.race([subscribing, new Promise((resolve) => setTimeout(() => resolve(null), SUBSCRIBE_MS))]);
    if (!subscription) return "unavailable";
    await accountApi.addPushDevice(asDevice(subscription));
    return "allowed";
  }

  /** Stops notifications on this device: the browser forgets its subscription, and the server the device. */
  async function stopNotifications(deviceId) {
    const subscription = await currentSubscription();
    if (subscription) await subscription.unsubscribe();
    if (deviceId) await accountApi.removePushDevice(deviceId);
  }

  /** Shows a notification on this device at once, as a pushed one shows: the test Settings offers. */
  async function testNotification() {
    const registration = await worker;
    if (!registration || Notification.permission !== "granted") return false;
    await registration.showNotification("Mercbot", {
      body: "Notifications work on this device.",
      tag: "mercbot-test",
      icon: "/app-icons/icon-192.png",
      badge: "/app-icons/badge-96.png",
      data: { url: location.pathname + location.search }
    });
    return true;
  }

  return {
    state: readonly(state),
    canInstall,
    pushSupported,
    needsInstallForPush,
    bannerAnswered,
    rememberBanner,
    install,
    openGuide: () => {
      state.guideOpen = true;
    },
    closeGuide: () => {
      state.guideOpen = false;
    },
    currentSubscription,
    allowNotifications,
    stopNotifications,
    testNotification
  };
}
