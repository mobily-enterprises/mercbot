// The person's own Google Drive (D-42), for the bots: their files, folders and
// comments, and copies of the bot's own files kept there. googleApps.js offers these with the rest
// of the Google calls.

import { ConnectedAppError } from "./connectedApps.js";
import { call } from "./googleApi.js";

/** A copy of one of the bot's files in the person's Google Drive, in a Mercbot folder Mercbot made. */
export async function saveFile(key, { name, type, data }) {
  const folderQuery = new URLSearchParams({
    q: "name = 'Mercbot' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id)"
  });
  let [folder] = (await call(key, `https://www.googleapis.com/drive/v3/files?${folderQuery}`)).files || [];
  folder ??= await call(key, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({ name: "Mercbot", mimeType: "application/vnd.google-apps.folder" })
  });
  const boundary = `mercbot${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; ` +
        `charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder.id] })}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const file = await call(key, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body
  });
  return { name: file.name, link: file.webViewLink };
}

// Files in the person's own Drive: the newest few, a new Google Doc at the top
// level, and moving one to the bin. Drive keeps binned files for 30 days.
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const KINDS = {
  "application/vnd.google-apps.document": "a Google Doc",
  "application/vnd.google-apps.spreadsheet": "a Google Sheet",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google-apps.folder": "a folder",
  "application/pdf": "a PDF"
};
const kindOf = (mime = "") =>
  KINDS[mime] ||
  (mime.startsWith("image/")
    ? "a picture"
    : mime.startsWith("video/")
      ? "a video"
      : mime.includes("spreadsheet")
        ? "a spreadsheet"
        : mime.includes("word")
          ? "a document"
          : "");
const toFile = (file) => ({
  id: file.id,
  name: file.name,
  kind: kindOf(file.mimeType),
  modified: file.modifiedTime,
  link: file.webViewLink
});

export async function recentFiles(key, limit = 5) {
  const query = new URLSearchParams({
    q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
    orderBy: "modifiedTime desc",
    pageSize: String(limit),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)"
  });
  return ((await call(key, `${DRIVE}?${query}`)).files || []).map(toFile);
}

/** A Google Doc made from simple HTML (headings, paragraphs, bullet lists), which Drive converts. */
export async function createDocument(key, { name, html }) {
  const boundary = `mercbot${Date.now()}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name, mimeType: "application/vnd.google-apps.document" })}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
  const file = await call(
    key,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body
    }
  );
  return { ...toFile(file), place: "the top level of your Drive" };
}

// With full Drive access (D-42) any of the person's files can be binned; a drive signed in before
// that only lets Mercbot change files it made, until it's signed in again.
const OLD_ACCESS =
  "This Drive was connected before Mercbot asked for full Drive access, so it can only change files Mercbot made. Ask the person to sign Google Drive in again in Connect apps.";
async function changing(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConnectedAppError && /sufficient permissions|insufficient|didn't allow|not found/iu.test(error.message)) {
      throw new ConnectedAppError(OLD_ACCESS);
    }
    throw error;
  }
}

export async function binFile(key, id) {
  const file = await changing(() =>
    call(key, `${DRIVE}/${encodeURIComponent(id)}?fields=id,name`, { method: "PATCH", body: JSON.stringify({ trashed: true }) }));
  return { name: file.name, keptDays: 30 };
}

// The rest of the person's Drive (D-42): finding, reading, downloading and exporting,
// details and sharing, making, changing, moving, copying, and comments.
const FOLDER = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,webViewLink,size,parents";
const quoted = (text) => `'${String(text).replace(/\\/gu, "\\\\").replace(/'/gu, "\\'")}'`;
/** Drive won't sort a search inside files' contents, so those come in its own order of relevance. */
const listed = async (key, q, limit = 20) => {
  const query = new URLSearchParams({
    q: `${q} and trashed = false`,
    ...(q.includes("fullText") ? {} : { orderBy: "folder,modifiedTime desc" }),
    pageSize: String(limit),
    fields: `files(${FILE_FIELDS})`
  });
  return ((await call(key, `${DRIVE}?${query}`)).files || []).map(toFile);
};

export async function searchFiles(key, words, limit = 15) {
  return listed(key, `(name contains ${quoted(words)} or fullText contains ${quoted(words)})`, limit);
}

/** A folder by its id or name; "" is the top of the Drive. */
async function folderOf(key, folder) {
  if (!folder || /^(root|my drive|top)$/iu.test(folder)) return "root";
  const [byName] = await listed(key, `mimeType = '${FOLDER}' and name = ${quoted(folder)}`, 1).catch(() => []);
  return byName?.id || folder;
}

export async function listFolder(key, folder = "") {
  return listed(key, `${quoted(await folderOf(key, folder))} in parents`, 50);
}

export async function fileDetails(key, id) {
  const file = await call(
    key,
    `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,description,` +
      "owners(displayName,emailAddress),shared,permissions(id,type,role,emailAddress,displayName,domain)"
  );
  return {
    ...toFile(file),
    size: file.size ? Number(file.size) : undefined,
    created: file.createdTime,
    description: file.description || undefined,
    owners: (file.owners || []).map((owner) => owner.emailAddress || owner.displayName),
    sharedWith: (file.permissions || [])
      .filter((permission) => permission.role !== "owner")
      .map((permission) => ({
        who:
          permission.emailAddress || permission.domain || (permission.type === "anyone" ? "anyone with the link" : permission.displayName),
        role: permission.role
      }))
  };
}

// Google's own documents are exported; any other file is its bytes.
const EXPORTS = {
  "application/vnd.google-apps.document": {
    text: "text/plain",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    html: "text/html",
    txt: "text/plain"
  },
  "application/vnd.google-apps.spreadsheet": {
    text: "text/csv",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv"
  },
  "application/vnd.google-apps.presentation": {
    text: "text/plain",
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain"
  }
};
async function bytes(key, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) await call(key, url);
  return Buffer.from(await response.arrayBuffer());
}

/** A file's contents as text, for Google's documents and text files. */
export async function readFileText(key, id) {
  const file = await call(key, `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,mimeType`);
  const exported = EXPORTS[file.mimeType]?.text;
  if (!exported && !/^text\/|json|csv|xml|markdown/u.test(file.mimeType)) {
    throw new ConnectedAppError(
      `${file.name} isn't text (${kindOf(file.mimeType) || file.mimeType}); download it and read your copy with read_file.`
    );
  }
  const url = exported
    ? `${DRIVE}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exported)}`
    : `${DRIVE}/${encodeURIComponent(id)}?alt=media`;
  return { name: file.name, text: (await bytes(key, url)).toString("utf8").slice(0, 60000) };
}

/** A file's bytes to keep, as it is or exported to another format (pdf, docx, xlsx, pptx, csv, txt, html). */
export async function downloadFile(key, id, format = "") {
  const file = await call(key, `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,mimeType`);
  const exports = EXPORTS[file.mimeType];
  if (exports) {
    const as = format || Object.keys(exports).find((name) => name !== "text");
    if (!exports[as]) {
      throw new ConnectedAppError(
        `${file.name} can be exported as ${Object.keys(exports)
          .filter((name) => name !== "text")
          .join(", ")}.`
      );
    }
    const name = `${file.name.replace(/\.[a-z0-9]{1,5}$/iu, "")}.${as}`;
    return { name, data: await bytes(key, `${DRIVE}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exports[as])}`) };
  }
  if (file.mimeType === FOLDER) throw new ConnectedAppError(`${file.name} is a folder.`);
  if (format && !file.name.toLowerCase().endsWith(`.${format.toLowerCase()}`)) {
    throw new ConnectedAppError(`Only Google's own documents can be exported; ${file.name} downloads as it is.`);
  }
  return { name: file.name, data: await bytes(key, `${DRIVE}/${encodeURIComponent(id)}?alt=media`) };
}

const ROLES = { view: "reader", comment: "commenter", edit: "writer" };
export async function shareFile(key, id, { email, role = "view", notify = true }) {
  const query = new URLSearchParams({ sendNotificationEmail: String(Boolean(notify)), fields: "id,role,emailAddress" });
  await changing(() =>
    call(key, `${DRIVE}/${encodeURIComponent(id)}/permissions?${query}`, {
      method: "POST",
      body: JSON.stringify({ type: "user", role: ROLES[role] || "reader", emailAddress: email })
    }));
  return fileDetails(key, id);
}

export async function createFolder(key, { name, folder = "" }) {
  const made = await call(key, `${DRIVE}?fields=${FILE_FIELDS}`, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [await folderOf(key, folder)] })
  });
  return toFile(made);
}

/** A plain file made from text (notes.txt, list.csv, page.md…). */
export async function createFile(key, { name, text, folder = "" }) {
  const boundary = `mercbot${Date.now()}`;
  const type = name.endsWith(".csv")
    ? "text/csv"
    : name.endsWith(".md")
      ? "text/markdown"
      : name.endsWith(".html")
        ? "text/html"
        : "text/plain";
  const body =
    `--${boundary}\r\nContent-Type: application/json; ` +
    `charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [await folderOf(key, folder)] })}\r\n--${boundary}\r\nContent-Type: ` +
    `${type}; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const made = await call(key, `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body
  });
  return toFile(made);
}

/** New contents (for a file of text, or a Google Doc, which Drive converts), a new description, or both. */
export async function updateFile(key, id, { text, description }) {
  if (description !== undefined) {
    await changing(() => call(key, `${DRIVE}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ description }) }));
  }
  if (text !== undefined) {
    const file = await call(key, `${DRIVE}/${encodeURIComponent(id)}?fields=mimeType`);
    const type = file.mimeType === "application/vnd.google-apps.document" ? "text/plain" : file.mimeType;
    if (!EXPORTS[file.mimeType] && !/^text\/|json|csv|xml|markdown/u.test(type)) {
      throw new ConnectedAppError("Only text files and Google Docs can have their contents replaced with text.");
    }
    if (EXPORTS[file.mimeType] && file.mimeType !== "application/vnd.google-apps.document") {
      throw new ConnectedAppError("A Google Sheet or Slides can't have its contents replaced with text; use their own app.");
    }
    await changing(() =>
      call(key, `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`, {
        method: "PATCH",
        headers: { "content-type": `${type}; charset=UTF-8` },
        body: text
      }));
  }
  return fileDetails(key, id);
}

/** Moving into a folder, renaming, or both. */
export async function moveFile(key, id, { folder, name }) {
  const query = new URLSearchParams({ fields: FILE_FIELDS });
  if (folder !== undefined) {
    const { parents = [] } = await call(key, `${DRIVE}/${encodeURIComponent(id)}?fields=parents`);
    query.set("addParents", await folderOf(key, folder));
    query.set("removeParents", parents.join(","));
  }
  const moved = await changing(() =>
    call(key, `${DRIVE}/${encodeURIComponent(id)}?${query}`, { method: "PATCH", body: JSON.stringify(name ? { name } : {}) }));
  return toFile(moved);
}

export async function copyFile(key, id, { name, folder }) {
  const copy = await call(key, `${DRIVE}/${encodeURIComponent(id)}/copy?fields=${FILE_FIELDS}`, {
    method: "POST",
    body: JSON.stringify({ ...(name ? { name } : {}), ...(folder !== undefined ? { parents: [await folderOf(key, folder)] } : {}) })
  });
  return toFile(copy);
}

export async function listComments(key, id) {
  const { comments = [] } = await call(
    key,
    `${DRIVE}/${encodeURIComponent(id)}/comments?fields=` +
      "comments(id,content,quotedFileContent/value,resolved,createdTime,author/displayName," +
      "replies(content,author/displayName,createdTime))&pageSize=50"
  );
  return comments.map((comment) => ({
    id: comment.id,
    by: comment.author?.displayName,
    when: comment.createdTime,
    text: comment.content,
    on: comment.quotedFileContent?.value,
    ...(comment.resolved ? { resolved: true } : {}),
    replies: (comment.replies || []).map((reply) => ({ by: reply.author?.displayName, when: reply.createdTime, text: reply.content }))
  }));
}

export async function addComment(key, id, { text, replyTo }) {
  const url = replyTo
    ? `${DRIVE}/${encodeURIComponent(id)}/comments/${encodeURIComponent(replyTo)}/replies?fields=id`
    : `${DRIVE}/${encodeURIComponent(id)}/comments?fields=id`;
  return { id: (await changing(() => call(key, url, { method: "POST", body: JSON.stringify({ content: text }) }))).id };
}
