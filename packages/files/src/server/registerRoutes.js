import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { BOT, FilesError, MINE, SHARED } from "./fileStore.js";

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
const UPLOAD_LIMIT = 25 * 1024 * 1024;

/**
 * A bot's files for the chat's file cards, the viewer and the file browsers (D-20, D-21, D-36,
 * D-47). Every bot route checks the bot is in the request's home and works on the person's own
 * files with it (/files/mine/…), the bot's (/files/bot/…) and the home's (/files/shared/…); the
 * home's routes (/api/w/:home/files/…) work on the home's folder alone. The bots' command line
 * (shell.js) runs on the same folders.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Files} capabilities.files
 * @param {object} capabilities.directory records.directory: the bots the request's home holds
 * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
 */
export function registerRoutes(http, { files, directory, uploads }) {
  const { store, apps, storage, pages } = files;
  const router = http.router;
  // Routes for things a home owns (D-36) live under /api/w/:workspaceSlug/…; JSKIT checks the
  // person belongs to that home and fills request.workspace before the handler runs.
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });

  /**
   * The bot named in the route, in the request's home, and where its files are for this person.
   * In a group with several people (?group=), a member bot's files are its everyone folder, the
   * same place its turns there use, and only for the group's people (D-46).
   */
  async function placeOf(request) {
    const options = await request.callOptions();
    const bot = /^\d+$/u.test(String(request.params.botId)) ? await directory.findBot(String(request.params.botId), options, { kind: "bot" }) : null;
    if (!bot) throw new FilesError(404, "Bot not found.", { code: "files_bot_not_found" });
    const homeId = request.workspace.id;
    if (request.query?.group) {
      const member = /^\d+$/u.test(String(request.query.group)) && await directory.isGroupMember(String(request.query.group), bot.id, options);
      if (!member) throw new FilesError(404, "Bot not found.", { code: "files_bot_not_found" });
      return { homeId, botId: bot.id, everyone: true };
    }
    return store.placeFor({ id: bot.id, workspace_id: homeId, sharing: bot.sharing }, request.user.id);
  }

  const homePlaceOf = async (request) => store.homePlace(request.workspace.id);

  async function find(request, where = placeOf) {
    const place = await where(request);
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

  // The same file routes for a bot's folders and for the home's own: the file itself, its
  // preview, uploads, the listing for the file browser, moving or renaming, new folders and
  // deleting.
  for (const [base, where] of [["/api/w/:workspaceSlug/bots/:botId/files", placeOf], ["/api/w/:workspaceSlug/files", homePlaceOf]]) {
    // The file itself; downloaded unless it's a kind a page can safely show.
    router.register("GET", `${base}/content`, home, served(async function fileContent(request, reply) {
      const file = await find(request, where);
      const inline = !request.query?.download && Boolean(INLINE[file.ext]);
      headers(reply, { name: file.name, type: inline ? INLINE[file.ext] : "application/octet-stream", inline });
      reply.send(await fs.promises.readFile(file.real));
    }));

    // What the viewer shows: a picture as it is, text as text, and other files as pictures of
    // their pages, which every browser can show (phones don't show PDFs inside a page).
    router.register("GET", `${base}/preview`, home, served(async function filePreview(request, reply) {
      const file = await find(request, where);
      if (INLINE[file.ext]?.startsWith("image/") || INLINE[file.ext]?.startsWith("audio/")) {
        reply.send({ kind: "image" });
        return;
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

    // An upload: a file the person attaches in the chat goes in Uploads in the bot's
    // folder for them; the file browser names the folder (?folder=/files/bot/Invoices). A name
    // already taken gets a number.
    router.register("POST", `${base}/upload`, home, served(async function uploadFile(request, reply) {
      const place = await where(request);
      const dirs = await store.prepare(place);
      const uploadsFolder = `${place.home ? SHARED : dirs.personal ? MINE : BOT}/Uploads`;
      const virtualFolder = String(request.query?.folder || uploadsFolder).replace(/\/+$/u, "");
      const roots = { [MINE]: dirs.personal ? dirs.mine : null, [BOT]: dirs.bot, [SHARED]: dirs.shared };
      const folder = roots[virtualFolder] || await store.resolve(place, virtualFolder);
      if (!folder) {
        throw new FilesError(400, "Files can only go in /files/mine, /files/bot or /files/shared.", {
          code: "files_file_destination_invalid"
        });
      }
      const part = await uploads.readSingleMultipartFile(request, {
        fieldName: "file",
        label: "File",
        maxBytes: UPLOAD_LIMIT,
        required: true
      });
      await fs.promises.mkdir(folder, { recursive: true });
      const clean = [...path.basename(part.fileName || "file")]
        .filter((char) => char >= " " && char !== "/" && char !== "\\")
        .join("")
        .trim()
        .slice(-120) || "file";
      const { name: stem, ext } = path.parse(clean);
      let name = clean;
      for (let count = 2; fs.existsSync(path.join(folder, name)); count += 1) name = `${stem} (${count})${ext}`;
      const target = path.join(folder, name);
      await pipeline(part.stream, fs.createWriteStream(target));
      if (part.stream.truncated) {
        await fs.promises.rm(target, { force: true });
        throw new FilesError(413, "That file is too big; the limit is 25 MB.", { code: "files_upload_too_big", params: { limitMb: 25 } });
      }
      await store.settle(place.homeId);
      const { size } = await fs.promises.stat(target);
      reply.send({ path: `${virtualFolder}/${name}`, name, size, type: part.mimeType });
    }));

    // The file browser's listing, one folder at a time (?folder=/files/bot/Invoices): its
    // sub-folders and its newest files; and every folder there is, for Move to….
    router.register("GET", base, home, served(async function listFiles(request, reply) {
      reply.send(await store.listFolder(await where(request), String(request.query?.folder || "")));
    }));
    router.register("GET", `${base}/folders`, home, served(async function listFolders(request, reply) {
      reply.send(await store.folderTree(await where(request)));
    }));
    router.register("POST", `${base}/move`, home, served(async function moveFile(request, reply) {
      const place = await where(request);
      const from = String(request.body?.from || "");
      await store.move(place, from, String(request.body?.to || ""));
      await store.settle(place.homeId);
      // A page's versions and link follow it (D-74).
      await pages.pathChanged({ homeId: place.homeId, botId: place.botId, from, to: String(request.body?.to) });
      reply.send({ path: String(request.body?.to) });
    }));
    router.register("POST", `${base}/folder`, home, served(async function makeFolder(request, reply) {
      const place = await where(request);
      await store.makeFolder(place, String(request.body?.path || ""));
      await store.settle(place.homeId);
      reply.send({ path: String(request.body?.path) });
    }));
    router.register("DELETE", base, home, served(async function removeFile(request, reply) {
      const place = await where(request);
      const removed = String(request.query?.path || "");
      await store.remove(place, removed);
      await store.settle(place.homeId);
      // A page that goes takes its link with it, so a later page there is never opened by it (D-74).
      await pages.pathChanged({ homeId: place.homeId, botId: place.botId, from: removed, to: null });
      reply.send({ removed });
    }));
  }

  // Ticking a checklist item on a page: the page's Markdown line changes.
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/files/check", home, served(async function checkItem(request, reply) {
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

  // The home's bots (not group chats) for the home's Files page, each leading to its files.
  router.register("GET", "/api/w/:workspaceSlug/files/bots", home, async function homeBots(request, reply) {
    reply.send({ bots: await directory.homeBotFaces(await request.callOptions()) });
  });

  // Where the home's files are kept (D-26, D-36). Owners and admins choose it. Settings → Files asks with ?fresh=1, and
  // Mercbot then looks at a Google Drive's folder and space now (D-80); the Files page tells what was last seen.
  router.register("GET", "/api/w/:workspaceSlug/files/storage", home, served(async function describeStorage(request, reply) {
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
  router.register("PUT", "/api/w/:workspaceSlug/files/storage", home, served(async function chooseStorage(request, reply) {
    managing(request);
    reply.send(await storage.choose(request.workspace.id, request.body || {}, await request.callOptions()));
  }));
  router.register("DELETE", "/api/w/:workspaceSlug/files/storage/move", home, served(async function cancelMove(request, reply) {
    managing(request);
    reply.send(await storage.cancelMove(request.workspace.id, await request.callOptions()));
  }));
}
