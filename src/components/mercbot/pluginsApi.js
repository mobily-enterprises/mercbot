import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { currentHome, requestInHome } from "./homeApi.js";

// Client for the integrations package (packages/integrations).
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

// Connect apps belongs to the current home (D-37): a person's own accounts and the home's.

export const pluginsApi = {
  list: () => requestInHome(client, "/plugins"),
  install: (pluginId) => requestInHome(client, `/plugins/${pluginId}/install`, { method: "POST", body: {} }),
  uninstall: (pluginId) => requestInHome(client, `/plugins/${pluginId}`, { method: "DELETE" }),
  // `home` adds the account for everyone in the home (owners and admins).
  addAccount: (pluginId, name, home = false) => requestInHome(client, `/plugins/${pluginId}/accounts`, { method: "POST", body: { name, home } }),
  // One account as Connect apps shows it, while the screen waits for its sign-in.
  account: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}`),
  renameAccount: (accountId, name) => requestInHome(client, `/plugin-accounts/${accountId}`, { method: "PATCH", body: { name } }),
  // An action's switch on an app's page.
  setAction: (pluginId, actionId, enabled) => requestInHome(client, `/plugins/${pluginId}/actions/${actionId}`, { method: "PUT", body: { enabled } }),
  removeAccount: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}`, { method: "DELETE" }),
  updateSkill: (skillId, changes) => client.request(`/api/skills/${skillId}`, { method: "PATCH", body: changes }),
  deleteSkill: (skillId) => client.request(`/api/skills/${skillId}`, { method: "DELETE" }),
  connect: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}/connect`, { method: "POST", body: {} }),
  disconnect: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}/connection`, { method: "DELETE" }),
  finishSignIn: (address) => requestInHome(client, "/connections/finish", { method: "POST", body: { address } })
};

// This copy's link to a hub, another Mercbot that connects accounts for it (D-31). Its status
// and unlinking are asked from the current home: its owners and admins may unlink too.
export const bridgeApi = {
  status: () => requestInHome(client, "/bridge/link"),
  link: (name) => client.request("/api/bridge/link", { method: "POST", body: { name } }),
  check: () => client.request("/api/bridge/link/check", { method: "POST", body: {} }),
  unlink: () => requestInHome(client, "/bridge/link", { method: "DELETE" })
};

// Sign-in opens in its own window, which hands over to the provider's consent screen.
// `connectPage` is that window's page, from usePaths().page("/connect", { surface: "account" }).
export function openSignIn(connectPage, plugin, account) {
  const query = new URLSearchParams({ plugin: plugin.id, home: currentHome(), ...(account ? { account: account.id } : {}) });
  window.open(`${connectPage}?${query}`, "_blank", "noopener");
}
