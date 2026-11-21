import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { homePath } from "./homeApi.js";
import { placeQuery } from "./chatPlace.js";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

// The files a person sees (D-20, D-21, D-47, D-112 R6): the file itself, and what the viewer shows for it. Every route is
// /files…, naming where: a chat and a bot in it (the chat's folder, the bot's and the home's shared one: listed as
// chat, bot and shared), a chat alone, a bot alone (its own folder and the shared one), or neither (the home's folder).
// A chat not given is the one open here (chatPlace.js); null names none.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });
const query = (path) => `path=${encodeURIComponent(path)}`;
const filesBase = () => homePath("/files");
const placeParts = (botId, chat) => [placeQuery({ chat }), botId ? `bot=${encodeURIComponent(botId)}` : ""].filter(Boolean).join("&");
const and = (botId, chat) => {
  const part = placeParts(botId, chat);
  return part ? `&${part}` : "";
};
const first = (botId, chat) => {
  const part = placeParts(botId, chat);
  return part ? `?${part}` : "";
};
export const fileUrl = (botId, path, { download = true, chat } = {}) =>
  `${filesBase()}/content?${query(path)}${download ? "&download=1" : ""}${and(botId, chat)}`;
export const previewUrl = (botId, path, chat = undefined) => `${filesBase()}/preview?${query(path)}${and(botId, chat)}`;

// The file browsers (D-47): the folders a person sees with a bot in a chat, or the home's, and changing them.
export const filesApi = {
  list: (botId, folder, chat) => client.request(`${filesBase()}?folder=${encodeURIComponent(folder)}${and(botId, chat)}`),
  folders: (botId, chat) => client.request(`${filesBase()}/folders${first(botId, chat)}`),
  move: (botId, from, to, chat) => client.request(`${filesBase()}/move${first(botId, chat)}`, { method: "POST", body: { from, to } }),
  makeFolder: (botId, path, chat) => client.request(`${filesBase()}/folder${first(botId, chat)}`, { method: "POST", body: { path } }),
  remove: (botId, path, chat) => client.request(`${filesBase()}?${query(path)}${and(botId, chat)}`, { method: "DELETE" }),
  // The home's bots, as the home's Files page shows them: { id, name, color, shape }.
  homeBots: () => client.request(homePath("/files/bots"))
};

// A bot's HTML pages (D-74): the address its frame loads, ticks, versions with Restore, and a standalone copy. A page in
// a chat's folder (/files/chat/…) names the chat (`chat`, else the open one); one in the bot's own folder needs none.
// Old Markdown pages (.md) tick by line.
const pagesBase = (botId) => homePath(`/bots/${botId}/pages`);
const pageQuery = (path, chat) => `${query(path)}${(() => {
  const part = placeQuery({ chat });
  return part ? `&${part}` : "";
})()}`;
export const isHtmlPage = (path) => /\.html$/u.test(String(path));
/**
 * A page the home can share beyond its viewer (D-74, pageDocument.js isPagePath): an .html file in a Pages folder of a
 * bot's folder for everyone or of the home's. A page in a chat's folder is that chat's only.
 */
export const isHomePage = (path) => /^\/files\/(bot|shared)\/(.+\/)?Pages\/[^/]+\.html$/u.test(String(path));
export const pageCopyUrl = (botId, path, chat = undefined) => `${pagesBase(botId)}/copy?${pageQuery(path, chat)}`;
export const pagesApi = {
  frame: (botId, path, chat = undefined) => client.request(`${pagesBase(botId)}/frame?${pageQuery(path, chat)}`),
  tick: (botId, path, items, chat = undefined) => {
    const where = placeQuery({ chat });
    return client.request(`${pagesBase(botId)}/ticks${where ? `?${where}` : ""}`, { method: "POST", body: { path, items } });
  },
  versions: (botId, path, chat = undefined) => client.request(`${pagesBase(botId)}/versions?${pageQuery(path, chat)}`),
  restore: (botId, path, versionId, chat = undefined) => {
    const where = placeQuery({ chat });
    return client.request(`${pagesBase(botId)}/restore${where ? `?${where}` : ""}`, { method: "POST", body: { path, versionId } });
  }
};

// Ticks or unticks an old Markdown page's checklist item.
export const checkPageItem = (botId, path, line, checked, chat = undefined) => client.request(`${filesBase()}/check${first(botId, chat)}`, { method: "POST", body: { path, line, checked } });

// Opens the file in its app on the bot's desktop (D-23): its computer in the chat the file is in (D14).
export const openOnComputer = (botId, path, chat = undefined) => {
  const where = placeQuery({ chat });
  return client.request(homePath(`/bots/${botId}/computer/open${where ? `?${where}` : ""}`), { method: "POST", body: { path } });
};

// Kinds the desktop's apps open.
export const EDITABLE = new Set(["docx", "doc", "odt", "rtf", "xlsx", "xls", "xlsm", "ods", "pptx", "pdf"]);

const KINDS = [
  { exts: ["docx", "doc", "odt", "rtf", "md", "txt"], label: "Document", icon: "$description" },
  { exts: ["xlsx", "xls", "xlsm", "ods", "csv"], label: "Spreadsheet", icon: "$tableView" },
  { exts: ["pptx"], label: "Presentation", icon: "$slideshow" },
  { exts: ["pdf"], label: "PDF", icon: "$pictureAsPdf" },
  { exts: ["png", "jpg", "jpeg", "gif", "webp"], label: "Image", icon: "$image" }
];

export function fileKind(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return KINDS.find((kind) => kind.exts.includes(ext)) || { label: ext ? ext.toUpperCase() : "File", icon: "$draft" };
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Where the home keeps its files (D-26, D-36). `fresh` (Settings → Files) has Mercbot look at a Google Drive's folder
// and space now (D-80); without it, what was last seen. Choosing other storage starts moving the files there, which
// owners and admins can cancel until it switches; `withoutFiles` switches without them when they can't be read.
export const storageApi = {
  get: ({ fresh = false } = {}) => client.request(homePath(`/files/storage${fresh ? "?fresh=1" : ""}`)),
  choose: (choice) => client.request(homePath("/files/storage"), { method: "PUT", body: choice }),
  cancelMove: () => client.request(homePath("/files/storage/move"), { method: "DELETE" })
};

// A file attached in the chat goes into the chat's folder (its Uploads, unless `folder` says), with the session's CSRF token
// as JSKIT's own uploads send it.
async function csrfToken() {
  const response = await fetch(AUTH_PATHS.SESSION, { credentials: "include" });
  return String((await response.json().catch(() => ({}))).csrfToken || "");
}

export async function uploadFile(botId, file, folder = "", chat = undefined) {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${filesBase()}/upload?folder=${encodeURIComponent(folder)}${and(botId, chat)}`, {
    method: "POST",
    credentials: "include",
    headers: { "csrf-token": await csrfToken() },
    body: form
  });
  const body = await response.json().catch(() => ({}));
  // With the refusal's code, as the HTTP client's errors carry it (a Drive to sign in again, D-80).
  if (!response.ok) throw Object.assign(new Error(body.error || "That file didn't upload."), { status: response.status, code: body.code || null });
  return body;
}
