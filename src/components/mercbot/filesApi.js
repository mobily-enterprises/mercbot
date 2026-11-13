import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { homePath } from "./homeApi.js";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

// A bot's files (D-20, D-21, D-47): the file itself, and what the viewer shows for it. Without a
// bot (null), the home's own folder.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });
const query = (path) => `path=${encodeURIComponent(path)}`;
const filesBase = (botId) => homePath(botId ? `/bots/${botId}/files` : "/files");
// What a bot made in a group with several people is in its folder for everyone (D-46).
const inGroup = (group) => (group ? `&group=${encodeURIComponent(group)}` : "");
export const fileUrl = (botId, path, { download = true, group = null } = {}) => `${filesBase(botId)}/content?${query(path)}${download ? "&download=1" : ""}${inGroup(group)}`;
export const previewUrl = (botId, path, group = null) => `${filesBase(botId)}/preview?${query(path)}${inGroup(group)}`;

// The file browsers (D-47): the folders a person sees with a bot, or the home's, and changing them.
export const filesApi = {
  list: (botId, folder) => client.request(`${filesBase(botId)}?folder=${encodeURIComponent(folder)}`),
  folders: (botId) => client.request(`${filesBase(botId)}/folders`),
  move: (botId, from, to) => client.request(`${filesBase(botId)}/move`, { method: "POST", body: { from, to } }),
  makeFolder: (botId, path) => client.request(`${filesBase(botId)}/folder`, { method: "POST", body: { path } }),
  remove: (botId, path) => client.request(`${filesBase(botId)}?${query(path)}`, { method: "DELETE" }),
  // The home's bots, not group chats, as the home's Files page shows them: { id, name, color, shape }.
  homeBots: () => client.request(homePath("/files/bots"))
};

// A bot's HTML pages (D-74): the address its frame loads, ticks, versions with Restore, and a
// standalone copy. Old Markdown pages (.md) tick by line.
const pagesBase = (botId) => homePath(`/bots/${botId}/pages`);
export const isHtmlPage = (path) => /\.html$/u.test(String(path));
export const pageCopyUrl = (botId, path) => `${pagesBase(botId)}/copy?${query(path)}`;
export const pagesApi = {
  frame: (botId, path) => client.request(`${pagesBase(botId)}/frame?${query(path)}`),
  tick: (botId, path, items) => client.request(`${pagesBase(botId)}/ticks`, { method: "POST", body: { path, items } }),
  versions: (botId, path) => client.request(`${pagesBase(botId)}/versions?${query(path)}`),
  restore: (botId, path, versionId) => client.request(`${pagesBase(botId)}/restore`, { method: "POST", body: { path, versionId } })
};

// Ticks or unticks an old Markdown page's checklist item.
export const checkPageItem = (botId, path, line, checked, group = null) => client.request(homePath(`/bots/${botId}/files/check${group ? `?group=${encodeURIComponent(group)}` : ""}`), { method: "POST", body: { path, line, checked } });

// Opens the file in its app on the bot's desktop (D-23).
export const openOnComputer = (botId, path) => client.request(homePath(`/bots/${botId}/computer/open`), { method: "POST", body: { path } });

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

// A file attached in the chat goes into the bot's own folder, with the session's CSRF
// token as JSKIT's own uploads send it.
async function csrfToken() {
  const response = await fetch(AUTH_PATHS.SESSION, { credentials: "include" });
  return String((await response.json().catch(() => ({}))).csrfToken || "");
}

export async function uploadFile(botId, file, folder = "") {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${filesBase(botId)}/upload${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`, {
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
