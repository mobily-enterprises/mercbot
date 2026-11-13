import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { homePath, requestInHome } from "@/components/mercbot/homeApi.js";

// Client for the Apps routes (packages/apps, D-35). Every app belongs to the current home (D-36);
// writes carry the CSRF token through JSKIT's client.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });
const request = (path, options) => client.request(homePath(`/apps${path}`), options);
const post = (path, body = {}) => request(path, { method: "POST", body });
const app = (slug) => `/${encodeURIComponent(slug)}`;

const queryString = (params) => {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
};
// The message to show for a failed request: the server's own words when it gave any.
export const errorText = (error, fallback) => error?.data?.error || error?.message || fallback;

// A table's records, and one record (`id`), in the Data tab's routes.
const records = (table, id = null) => `/app-data/tables/${encodeURIComponent(table)}/records${id === null ? "" : `/${encodeURIComponent(id)}`}`;

export const appsApi = {
  builder: () => request("/builder"),
  setBuilder: (botId) => request("/builder", { method: "PUT", body: { botId } }),
  // The home's tables with their counts and the apps using them; `{ app }` only that app's, `{ brief: true }` without either.
  tables: (params) => requestInHome(client, `/app-data/tables${queryString(params)}`),
  activity: (filters) => requestInHome(client, `/app-activity${queryString(filters)}`),
  records: (table, params) => requestInHome(client, `${records(table)}${queryString(params)}`),
  createRecord: (table, values) => requestInHome(client, records(table), { method: "POST", body: { values } }),
  updateRecord: (table, id, values) => requestInHome(client, records(table, id), { method: "PATCH", body: { values } }),
  obsoleteRecord: (table, id) => requestInHome(client, `${records(table, id)}/obsolete`, { method: "POST", body: {} }),
  restoreRecord: (table, id) => requestInHome(client, `${records(table, id)}/restore`, { method: "POST", body: {} }),
  recordHistory: (table, id) => requestInHome(client, `${records(table, id)}/history`),
  importRecords: (table, body) => requestInHome(client, `/app-data/tables/${encodeURIComponent(table)}/import`, { method: "POST", body }),
  fieldImpact: (fieldId) => requestInHome(client, `/app-data/fields/${encodeURIComponent(fieldId)}/impact`),
  removeField: (fieldId) => requestInHome(client, `/app-data/fields/${encodeURIComponent(fieldId)}/remove`, { method: "POST", body: {} }),
  watches: (botId) => request(`/watches${queryString({ bot: botId })}`),
  setWatch: (id, enabled) => request(`/watches/${encodeURIComponent(id)}`, { method: "PATCH", body: { enabled } }),
  removeWatch: (id) => request(`/watches/${encodeURIComponent(id)}`, { method: "DELETE" }),
  list: () => request(""),
  setPins: (appIds) => request("/pins", { method: "PUT", body: { appIds } }),
  get: (slug, version) => request(`${app(slug)}${version === "draft" ? "?version=draft" : ""}`),
  // A view as a part of a screen shows it: { app: { id, slug }, screen, tables, style }.
  viewPart: (slug) => request(`${app(slug)}/part`),
  // `options.signal` drops a read the page no longer needs.
  query: (slug, body, options = {}) => request(`${app(slug)}/query`, { method: "POST", body, signal: options.signal }),
  action: (slug, body) => post(`${app(slug)}/action`, body),
  publish: (slug) => post(`${app(slug)}/publish`),
  // A draft preview's practice data starts again from the live records (D-71).
  resetPractice: (slug) => post(`${app(slug)}/practice/reset`),
  // A page of versions, newest first ({ versions, more }); `before` is the last one shown.
  versions: (slug, before) => request(`${app(slug)}/versions${queryString({ before })}`),
  restore: (slug, versionId) => post(`${app(slug)}/restore`, { versionId }),
  retireView: (slug) => post(`${app(slug)}/retire`),
  retiredViews: () => request("/retired"),
  bringBack: (slug) => post(`/retired/${encodeURIComponent(slug)}/bring-back`),
  updateCopy: (slug, screen) => post(`${app(slug)}/copies/${encodeURIComponent(screen)}/update`),
  templates: () => requestInHome(client, "/apps-templates"),
  installTemplate: (key, sample) => requestInHome(client, `/apps-templates/${encodeURIComponent(key)}/install`, { method: "POST", body: { sample } }),
  theme: () => requestInHome(client, "/apps-theme"),
  setTheme: (theme) => requestInHome(client, "/apps-theme", { method: "PUT", body: { theme } }),
  setAppTheme: (slug, theme) => request(`${app(slug)}/theme`, { method: "PUT", body: { theme } }),
  scripts: (slug) => request(`${app(slug)}/scripts`),
  setScriptEnabled: (slug, key, enabled) => request(`${app(slug)}/scripts/${encodeURIComponent(key)}/enabled`, { method: "PUT", body: { enabled } }),
  homeScripts: () => requestInHome(client, "/apps-scripts"),
  setWebAccess: (entries) => requestInHome(client, "/apps-web-access", { method: "PUT", body: { entries } })
};
