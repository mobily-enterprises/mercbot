import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { currentHome, requestInHome } from "./homeApi.js";
import { rememberWayBack, signInInThisTab } from "./signInReturn.js";

// Client for the integrations package (packages/integrations).
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

// Connect apps belongs to the current home (D-37): a person's own accounts and the home's.

export const pluginsApi = {
  list: () => requestInHome(client, "/plugins"),
  install: (pluginId) => requestInHome(client, `/plugins/${pluginId}/install`, { method: "POST", body: {} }),
  uninstall: (pluginId) => requestInHome(client, `/plugins/${pluginId}`, { method: "DELETE" }),
  // An account of the home, for everyone in it (D-111); the label may be empty (D-110).
  addAccount: (pluginId, name) => requestInHome(client, `/plugins/${pluginId}/accounts`, { method: "POST", body: { name } }),
  // One account as Connect apps shows it, while the screen waits for its sign-in.
  account: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}`),
  renameAccount: (accountId, name) => requestInHome(client, `/plugin-accounts/${accountId}`, { method: "PATCH", body: { name } }),
  // An account's Request pace (D-96): "gentle", "normal" or "fast".
  choosePace: (accountId, pace) => requestInHome(client, `/plugin-accounts/${accountId}/pace`, { method: "PUT", body: { pace } }),
  // An action's switch on an app's page.
  setAction: (pluginId, actionId, enabled) => requestInHome(client, `/plugins/${pluginId}/actions/${actionId}`, { method: "PUT", body: { enabled } }),
  removeAccount: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}`, { method: "DELETE" }),
  updateSkill: (skillId, changes) => client.request(`/api/skills/${skillId}`, { method: "PATCH", body: changes }),
  deleteSkill: (skillId) => client.request(`/api/skills/${skillId}`, { method: "DELETE" }),
  connect: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}/connect`, { method: "POST", body: {} }),
  finishSignIn: (address) => requestInHome(client, "/connections/finish", { method: "POST", body: { address } }),
  // A sign-in this copy lends a copy linked to the person's account, begun here signed in (D-97): `{ url, app }`.
  beginLentSignIn: (state) => client.request("/api/connections/lent/begin", { method: "POST", body: { state } }),
  // An app connected with the home's API credentials (D-93): entering them, and who each person is at the app.
  enterCredentials: (accountId, values) => requestInHome(client, `/plugin-accounts/${accountId}/credentials`, { method: "POST", body: values }),
  appPerson: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}/people/me`),
  appPeople: (accountId) => requestInHome(client, `/plugin-accounts/${accountId}/people`),
  appUsers: (accountId, words) => requestInHome(client, `/plugin-accounts/${accountId}/app-users?${new URLSearchParams({ q: words })}`),
  pickAppUser: (accountId, appUserId) => requestInHome(client, `/plugin-accounts/${accountId}/people/me`, { method: "PUT", body: { appUserId } }),
  confirmAppPerson: (accountId, userId) => requestInHome(client, `/plugin-accounts/${accountId}/people/${userId}/confirm`, { method: "POST", body: {} }),
  forgetAppPerson: (accountId, userId) => requestInHome(client, `/plugin-accounts/${accountId}/people/${userId}`, { method: "DELETE" }),
  // The person's own GitHub repositories Mercbot's GitHub App reaches, whose name holds `words`, a page at a time, for a bot's
  // card (D-128): { repositories: [{ id, fullName, private, write }], next, installUrl }.
  githubRepositories: (words = "", after = null) =>
    requestInHome(client, `/github/repositories?${new URLSearchParams({ q: words, ...(after ? { after } : {}) })}`)
};

// This copy's link to a hub, another Mercbot that connects accounts for it (D-31). Its status
// and unlinking are asked from the current home: its owners and admins may unlink too.
export const bridgeApi = {
  status: () => requestInHome(client, "/bridge/link"),
  link: (name) => client.request("/api/bridge/link", { method: "POST", body: { name } }),
  check: () => client.request("/api/bridge/link/check", { method: "POST", body: {} }),
  unlink: () => requestInHome(client, "/bridge/link", { method: "DELETE" })
};

// Sign-in opens in a window of its own on a computer, which hands over to the provider's consent screen and closes once
// it's done; on a phone it takes this tab, through the router, and comes back (D-110, signInReturn.js). `connectPage` is
// its page, from usePaths().page("/connect", { surface: "account" }); `router` the caller's.
export function openSignIn(connectPage, plugin, account, router) {
  const query = new URLSearchParams({ plugin: plugin.id, home: currentHome(), ...(account ? { account: account.id } : {}) });
  const address = `${connectPage}?${query}`;
  if (signInInThisTab()) {
    rememberWayBack(plugin.id);
    router.push(address);
  } else {
    window.open(address, "_blank", "popup,width=520,height=720,noopener");
  }
}
