import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { homePath } from "./homeApi.js";

// A home's own website (D-84): where its pages are uploaded and the address they're served at, and each page's place
// on it, with Publish and Unpublish.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });
const pageSite = (botId) => homePath(`/bots/${botId}/pages/website`);
const pagePath = (botId, path) => `${pageSite(botId)}?path=${encodeURIComponent(path)}`;
export const websitesApi = {
  get: () => client.request(homePath("/website")),
  save: (website) => client.request(homePath("/website"), { method: "PUT", body: website }),
  remove: () => client.request(homePath("/website"), { method: "DELETE" }),
  page: (botId, path) => client.request(pagePath(botId, path)),
  publish: (botId, path, confirmed) => client.request(pageSite(botId), { method: "POST", body: { path, confirmed } }),
  unpublish: (botId, path) => client.request(pagePath(botId, path), { method: "DELETE" })
};
