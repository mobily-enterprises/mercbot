import fs from "node:fs";
import path from "node:path";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { BOT, CHAT, FilesError, SHARED } from "./fileStore.js";
import { UPLOAD_LIMIT, tooBig, writeUpload } from "./uploadedFile.js";
import { READS_AS_SHEET, sheetPreview } from "./sheetPreview.js";

// Types a page may show inline. Anything else (HTML and SVG included) is only ever downloaded.
const INLINE = Object.freeze({
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  wav: "audio/wav",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  json: "text/plain; charset=utf-8"
});

const TEXT_LIMIT = 200000;

/**
 * The files of a chat, a bot and the home, for the chat's file cards, the viewer and the file browsers (D-20, D-21,
 * D-36, D-47, R6). Every route is under /api/w/:home/files and names its place in the query: `?chat=` the chat's folder
 * (/files/chat/…), `?bot=` the bot's (/files/bot/…), both a bot in that chat, with the home's (/files/shared/…) every
 * time; without either, the home's folder alone. A chat the caller can't open, a bot not in the home or not in that
 * chat is a 404. What a person does here is their own doing, so a private chat's wider folders take it (D13). The bots'
 * command line (shell.js) runs on the same folders.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Files} capabilities.files with `transfer` (fileTransfer.js)
 * @param {{ directory: object, chats: object }} capabilities.records mercbot.bots.records: the chats and bots the caller
 *   may read
 * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
 */
export function registerRoutes(http, { files, records, uploads }) {
  const { store, apps, storage, pages } = files;
  const router = http.router;
  // Routes for things a home owns (D-36) live under /api/w/:workspaceSlug/…; JSKIT checks the
  // person belongs to that home and fills request.workspace before the handler runs.
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
  const base = "/api/w/:workspaceSlug/files";

  /** The place the query names (see above), read as the caller: what they can't open is a 404. */
  async function placeOf(request) {
    const options = await request.callOptions();
    const homeId = String(request.workspace.id);
    const given = (name) => (request.query?.[name] == null || request.query[name] === "" ? null : String(request.query[name]));
    const chatId = given("chat");
    const botId = given("bot");
    const notFound = () => new FilesError(404, "That chat or bot isn't here.", { code: "files_place_not_found" });
    if ([chatId, botId].some((id) => id !== null && !/^\d+$/u.test(id))) throw notFound();
    if (chatId && botId) {
      const seat = await records.directory.chatBotOf(botId, chatId, options);
      const found = seat && await records.directory.computerOf(seat.id, options);
      if (!found) throw notFound();
      return store.widened(store.placeFor({ homeId, chatId, chatKind: found.chatKind, botId }));
    }
    if (chatId) {
      const chat = await records.chats.find(chatId, options);
      if (!chat) throw notFound();
      return store.widened(store.placeFor({ homeId, chatId, chatKind: chat.kind }));
    }
    if (botId) {
      if (!(await records.directory.findBot(botId, options))) throw notFound();
      return store.botPlace({ homeId, botId });
    }
    return store.homePlace(homeId);
  }

  async function find(request) {
    const place = await placeOf(request);
    const virtualPath = String(request.query?.path || "");
    const file = await store.existingFile(place, virtualPath);
    return { place, virtualPath, ...file, ext: path.extname(virtualPath).slice(1).toLowerCase(), name: path.basename(virtualPath) };
  }

  function served(work) {
    return async (request, reply) => {
      try {
        await work(request, reply);
      } catch (error) {
        if (!(error instanceof FilesError)) throw error;
        reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
      }
    };
  }

  function headers(reply, { name, type, inline }) {
    const encoded = encodeURIComponent(name);
    reply
      .header("content-type", type)
      .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-cache");
  }

  // The file itself, its preview, uploads, the listing for the file browser, moving or renaming, new folders and
  // deleting, all in the place the query names. The file itself is downloaded unless it's a kind a page can safely show.
  router.register("GET", `${base}/content`, home, served(async function fileContent(request, reply) {
    const file = await find(request);
    const inline = !request.query?.download && Boolean(INLINE[file.ext]);
    headers(reply, { name: file.name, type: inline ? INLINE[file.ext] : "application/octet-stream", inline });
    reply.send(await fs.promises.readFile(file.real));
  }));

  // What the viewer shows: a picture as it is, an .xlsx or .csv as a table per sheet, text as text (the viewer renders
  // Markdown), and other files as pictures of their pages, which every browser can show (phones don't show PDFs inside
  // a page). A spreadsheet that can't be read as a table falls back on those.
  router.register("GET", `${base}/preview`, home, served(async function filePreview(request, reply) {
    const file = await find(request);
    if (INLINE[file.ext]?.startsWith("image/") || INLINE[file.ext]?.startsWith("audio/")) {
      reply.send({ kind: "image" });
      return;
    }
    if (READS_AS_SHEET.has(file.ext)) {
      const sheet = await sheetPreview(file.real, file.ext).catch(() => null);
      if (sheet?.sheets.length) {
        reply.send({ kind: "sheet", ...sheet });
        return;
      }
    }
    if (INLINE[file.ext]?.startsWith("text/")) {
      const text = await fs.promises.readFile(file.real, "utf8");
      reply.send({ kind: "text", text: text.slice(0, TEXT_LIMIT), more: text.length > TEXT_LIMIT });
      return;
    }
    const preview = await apps.pagesOf(file.place, file.virtualPath).catch(() => null);
    if (!preview?.pages.length) {
      throw new FilesError(415, "There's no preview for this kind of file.", { code: "files_preview_unsupported" });
    }
    reply.send({
      kind: "pages",
      pages: preview.pages.map((page) => `data:image/png;base64,${page.toString("base64")}`),
      more: preview.more
    });
  }));

  // An upload: a file the person attaches in the chat goes in Uploads in the chat's folder (a bot's page, the bot's; the
  // home's Files page, the home's); the file browser names the folder (?folder=/files/bot/Invoices). A name already
  // taken gets a number. A copy that checks pictures and videos checks one before it's kept (D-90).
  router.register("POST", `${base}/upload`, home, served(async function uploadFile(request, reply) {
    const place = await placeOf(request);
    const dirs = await store.prepare(place);
    const uploadsFolder = `${dirs.chat ? CHAT : dirs.bot ? BOT : SHARED}/Uploads`;
    const virtualFolder = String(request.query?.folder || uploadsFolder).replace(/\/+$/u, "");
    const roots = { [CHAT]: dirs.chat, [BOT]: dirs.bot, [SHARED]: dirs.shared };
    const folder = roots[virtualFolder] || await store.resolve(place, virtualFolder);
    if (!folder) {
      throw new FilesError(400, "Files can only go in the folders this page shows.", {
        code: "files_file_destination_invalid"
      });
    }
    const part = await uploads.readSingleMultipartFile(request, {
      fieldName: "file",
      label: "File",
      maxBytes: UPLOAD_LIMIT,
      required: true
    });
    const clean = [...path.basename(part.fileName || "file")]
      .filter((char) => char >= " " && char !== "/" && char !== "\\")
      .join("")
      .trim()
      .slice(-120) || "file";
    const { name: stem, ext } = path.parse(clean);
    let name = clean;
    for (let count = 2; fs.existsSync(path.join(folder, name)); count += 1) name = `${stem} (${count})${ext}`;
    const target = path.join(folder, name);
    await writeUpload(part.stream, {
      target,
      media: files.media,
      item: {
        origin: "upload",
        workspaceId: place.homeId,
        userId: request.user.id,
        botId: place.botId ?? null,
        conversationId: place.chatId ?? null,
        // Where it's kept, so a copy's later review can remove it (files.media.remove).
        place,
        path: `${virtualFolder}/${name}`,
        ip: request.ip ?? null
      }
    });
    if (part.stream.truncated) {
      await fs.promises.rm(target, { force: true });
      throw tooBig();
    }
    await store.settle(place.homeId);
    const { size } = await fs.promises.stat(target);
    reply.send({ path: `${virtualFolder}/${name}`, name, size, type: part.mimeType });
  }));

  // The file browser's listing, one folder at a time (?folder=/files/bot/Invoices): its
  // sub-folders and its newest files; and every folder there is, for Move to….
  router.register("GET", base, home, served(async function listFiles(request, reply) {
    reply.send(await store.listFolder(await placeOf(request), String(request.query?.folder || "")));
  }));
  router.register("GET", `${base}/folders`, home, served(async function listFolders(request, reply) {
    reply.send(await store.folderTree(await placeOf(request)));
  }));
  router.register("POST", `${base}/move`, home, served(async function moveFile(request, reply) {
    const place = await placeOf(request);
    const from = String(request.body?.from || "");
    await store.move(place, from, String(request.body?.to || ""));
    await store.settle(place.homeId);
    // A page's versions and link follow it (D-74).
    await pages.pathChanged({ homeId: place.homeId, botId: place.botId, from, to: String(request.body?.to) });
    reply.send({ path: String(request.body?.to) });
  }));
  // Every place the person can open, and Copy to… and Move to… between any two of them (fileTransfer.js): `from` names
  // a place and a path under its own folder, `to` a place and a folder there.
  router.register("GET", `${base}/places`, home, served(async function listPlaces(request, reply) {
    reply.send(await files.transfer.places({ userId: String(request.user.id) }, await request.callOptions()));
  }));
  router.register("POST", `${base}/transfer`, home, served(async function transferFile(request, reply) {
    const body = request.body ?? {};
    reply.send(await files.transfer.transfer({
      homeId: String(request.workspace.id),
      userId: String(request.user.id),
      mode: body.mode,
      from: body.from,
      to: body.to,
      confirmed: body.confirmed === true
    }, await request.callOptions()));
  }));
  router.register("POST", `${base}/folder`, home, served(async function makeFolder(request, reply) {
    const place = await placeOf(request);
    await store.makeFolder(place, String(request.body?.path || ""));
    await store.settle(place.homeId);
    reply.send({ path: String(request.body?.path) });
  }));
  router.register("DELETE", base, home, served(async function removeFile(request, reply) {
    const place = await placeOf(request);
    const removed = String(request.query?.path || "");
    await store.remove(place, removed);
    await store.settle(place.homeId);
    // A page that goes takes its link with it, so a later page there is never opened by it (D-74).
    await pages.pathChanged({ homeId: place.homeId, botId: place.botId, from: removed, to: null });
    reply.send({ removed });
  }));

  // Ticking a checklist item on a page: the page's Markdown line changes.
  router.register("POST", `${base}/check`, home, served(async function checkItem(request, reply) {
    const place = await placeOf(request);
    const virtualPath = String(request.body?.path || "");
    if (!virtualPath.endsWith(".md")) throw new FilesError(400, "Only pages have checklists.", { code: "files_checklist_not_page" });
    const file = await store.existingFile(place, virtualPath, { writing: true });
    const lines = (await fs.promises.readFile(file.real, "utf8")).split("\n");
    const index = Number(request.body?.line);
    const match = /^(\s*[-*] )\[( |x|X)\]/u.exec(lines[index] ?? "");
    if (!match) throw new FilesError(409, "That checklist item has changed.", { code: "files_checklist_item_changed" });
    lines[index] = `${match[1]}[${request.body?.checked ? "x" : " "}]${lines[index].slice(match[0].length)}`;
    await fs.promises.writeFile(file.real, lines.join("\n"));
    await store.settle(place.homeId);
    reply.send({ line: index, checked: Boolean(request.body?.checked) });
  }));

  // The home's bots for the home's Files page, each leading to its files.
  router.register("GET", `${base}/bots`, home, async function homeBots(request, reply) {
    const bots = await records.directory.homeBotFaces(await request.callOptions());
    reply.send({ bots: bots.map(({ id, name, color, shape }) => ({ id, name, color, shape })) });
  });

  // Where the home's files are kept (D-26, D-36). Owners and admins choose it. Settings → Files asks with ?fresh=1, and
  // Mercbot then looks at a Google Drive's folder and space now (D-80); the Files page tells what was last seen.
  router.register("GET", `${base}/storage`, home, served(async function describeStorage(request, reply) {
    reply.send(await storage.describe(await request.callOptions(), { fresh: request.query?.fresh === "1" }));
  }));
  // Choosing other storage moves the home's files there first (D-80); `withoutFiles` switches without them, only when
  // they can't be read where they are. Its move can be cancelled until it switches.
  const managing = (request) => {
    if (!hasPermission(request.permissions, "workspace.settings.update")) {
      throw new FilesError(403, "Only the home's owners and admins can choose where its files are kept.", {
        code: "files_storage_manage_forbidden"
      });
    }
  };
  router.register("PUT", `${base}/storage`, home, served(async function chooseStorage(request, reply) {
    managing(request);
    reply.send(await storage.choose(request.workspace.id, request.body || {}, await request.callOptions()));
  }));
  router.register("DELETE", `${base}/storage/move`, home, served(async function cancelMove(request, reply) {
    managing(request);
    reply.send(await storage.cancelMove(request.workspace.id, await request.callOptions()));
  }));
}
