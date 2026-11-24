import { ref } from "vue";
import { createHttpClient, isGenericHttpErrorMessage } from "@jskit-ai/http-runtime/client";
import { homePath } from "./homeApi.js";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

// Client for the account menu's services (packages/account).
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

/** The home's vault as Mercbot names it: "<home>'s vault", or "the home's vault" while the home's name isn't known. */
export const vaultName = (homeName) => (homeName ? `${homeName}'s vault` : "the home's vault");

// readable-check: allow module-state - shared resource: the work this page has seen refused, which a copy's shell parts may follow
export const workRefusals = ref(0);

/**
 * Whether a request failed because this copy refused the work (402): Mercbot itself never does, a copy built on it may,
 * and its message says why. Each one is counted, so a shell part that shows why (extensions.js) reads again.
 * @param {unknown} error
 */
export function refusedWork(error) {
  if (error?.status !== 402) return false;
  workRefusals.value += 1;
  return true;
}

/**
 * What a failed request tells the person: the server's own words when it refused with some (a limit, a missing
 * permission, an outside service that didn't answer), else `fallback`. The transport's wording ("Failed to fetch",
 * "Request failed with status 404.") and a hidden server failure keep the fallback.
 * @param {unknown} error
 * @param {string} fallback
 */
export function saidByServer(error, fallback) {
  const message = String(error?.message || "").trim();
  const answered = Number(error?.status) >= 400 && !isGenericHttpErrorMessage(error) && message !== "Internal server error.";
  return answered && message ? message : fallback;
}

// Money as the provider reports it, e.g. "$21.09" (D-16).
export function money(amount, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: amount < 1 && amount > 0 ? 4 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Spending, which the server keeps in nanodollars (a billionth of a dollar), as money. */
export function nanoMoney(nano) {
  return money((Number(nano) || 0) / 1e9);
}

/** A report's range as its query: its first and last day, "YYYY-MM-DD", UTC's (D-73). */
const ranged = (path, range) => `${homePath(path)}?${new URLSearchParams({ from: range.from, to: range.to })}`;

export const accountApi = {
  usage: () => client.request(homePath("/usage")),
  // Notifications on the person's devices (D-133): their settings and devices, and this device allowed or forgotten.
  push: () => client.request(homePath("/push")),
  savePushSettings: (changes) => client.request(homePath("/push/settings"), { method: "PUT", body: changes }),
  addPushDevice: (subscription) => client.request(homePath("/push/devices"), { method: "POST", body: subscription }),
  removePushDevice: (deviceId) => client.request(homePath(`/push/devices/${encodeURIComponent(deviceId)}`), { method: "DELETE" }),
  spending: (range) => client.request(ranged("/spending", range)),
  /** The address of a report's CSV, which the browser downloads itself. */
  spendingExportUrl: (range) => ranged("/spending/export", range),
  settings: () => client.request("/api/settings"),
  // The home's vault (D-110): its routes are the home's.
  vault: () => client.request(homePath("/vault")),
  addVaultItem: (item) => client.request(homePath("/vault"), { method: "POST", body: item }),
  // Items from a CSV file, all of one kind, each with its row in the file: [{ row, data }].
  importVaultItems: (kind, items) => client.request(homePath("/vault/import"), { method: "POST", body: { kind, items } }),
  // Contact details read from a photo: { fields }, counted as the home's use (D-73).
  readVaultPhoto: (photo) => {
    const form = new FormData();
    form.append("photo", photo, "photo.jpg");
    return client.request(homePath("/vault/read-photo"), { method: "POST", body: form });
  },
  deleteVaultItem: (itemId) => client.request(homePath(`/vault/${encodeURIComponent(itemId)}`), { method: "DELETE" }),
  resetComputers: () => client.request(homePath("/computers/reset"), { method: "POST", body: {} })
};

/* global __MERCBOT_VERSION__, __MERCBOT_BUILT_AT__ */
// What the About dialog shows and copies.
export function versionInfo() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Unknown";
  return {
    version: typeof __MERCBOT_VERSION__ === "string" ? __MERCBOT_VERSION__ : "dev",
    builtAt: typeof __MERCBOT_BUILT_AT__ === "string" ? __MERCBOT_BUILT_AT__ : "",
    channel: import.meta.env.PROD ? "stable" : "development",
    platform
  };
}
