import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { FilesError } from "./fileStore.js";
import {
  cssAddresses,
  describePage,
  isPagePath,
  newPageKey,
  pageKeyOf,
  pageNames,
  prepareForSave,
  readPage,
  rewriteCss,
  setTicks,
  visitLoads,
  withoutForbidden,
  withoutScripts,
  withPublishedPolicy,
  withShell,
  withStandalonePolicy,
  writePage
} from "./pageDocument.js";
import { pageHeaders } from "./pageHeaders.js";
import { LIMITS as PAGE_LIMITS, PAGE_FILE_TYPES, createPageFiles } from "./pageFiles.js";

// Rich HTML pages (D-40, D-63, D-74): HTML files in a bot's folder for everyone (or the home's), which
// belong to the whole home like every file there. Saving copies in what a page loads from outside
// (pageFiles.js) and keeps every version (page_versions); a page is shown in a sealed frame from a
// page-only address that carries a signed token, since the frame has no cookies. Opened on its own, outside its
// viewer, a page shows without its scripts, and only while its file still carries the key it was opened by.

const SHELL_CSS = readFileSync(new URL("./page-shell/shell.css", import.meta.url), "utf8");
const HELPER = readFileSync(new URL("./page-shell/helper.js", import.meta.url), "utf8");
// A frame's address works for half a day: long enough for an open viewer, short enough that one
// seen once doesn't open the page for good.
const FRAME_SECONDS = 12 * 60 * 60;
const VERSIONS_SHOWN = 50;
const VERSION_FIELDS = Object.freeze(["botId", "path", "pageKey", "kind", "userId", "createdAt"]);

/** A page's address names only its own document and the files in its folder: which one, or null. */
function partOf(pagePath, rest) {
  const { name, folder } = pageNames(pagePath);
  let wanted;
  try {
    wanted = decodeURIComponent(String(rest || ""));
  } catch {
    return null;
  }
  if (wanted === name) return { document: true };
  if (!wanted.startsWith(`${folder}/`) || wanted.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const ext = path.posix.extname(wanted).slice(1).toLowerCase();
  return PAGE_FILE_TYPES[ext] ? { file: path.posix.join(path.posix.dirname(pagePath), wanted), ext } : null;
}

const gone = () => new FilesError(404, "This page isn't here.", { code: "files_page_not_found" });

/** What a save took out of the page, for the bot: the tags pages never hold, then what couldn't be copied in. */
const takenOut = (forbidden, removed) => [...forbidden.map((tag) => ({ address: `<${tag}>`, why: "pages never hold it" })), ...removed];

/**
 * @param {object} dependencies
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {{ pageVersions: object }} dependencies.resources this feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {boolean} [dependencies.insecure] Tests only: copies files from local addresses too.
 */
export function createPages({ store, resources, systemContext, env, insecure = false }) {
  const { pageVersions } = resources;
  const files = createPageFiles({ store, insecure });
  const pagePlace = (homeId, botId) => ({ homeId: String(homeId), botId: String(botId), everyone: true });
  /** The options of a bot's own saves, which run on no request, in the home they're in. */
  const inHome = (homeId) => ({ context: systemContext("keep the versions of the pages bots save in their home").forWorkspace(String(homeId)) });

  function frameKey() {
    const secret = String(env.AUTH_LOCAL_SESSION_SECRET || "");
    if (!secret) throw new FilesError(503, "Pages can't be shown on this server right now.", { code: "files_pages_unavailable" });
    return createHmac("sha256", secret).update("mercbot page frames").digest();
  }
  const sealOf = (body) => createHmac("sha256", frameKey()).update(body).digest();

  /** A signed, expiring token naming one page: every server can check it (D-15). */
  function frameToken({ homeId, botId, path: pagePath }) {
    const body = Buffer.from(JSON.stringify({ h: String(homeId), b: String(botId), p: pagePath, x: Math.floor(Date.now() / 1000) + FRAME_SECONDS })).toString("base64url");
    return `${body}.${sealOf(body).toString("base64url")}`;
  }
  function readFrameToken(token) {
    const [body, seal, extra] = String(token || "").split(".");
    if (!body || !seal || extra !== undefined) return null;
    const given = Buffer.from(seal, "base64url");
    const expected = sealOf(body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let claims;
    try {
      claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (!(Number(claims.x) > Date.now() / 1000) || !isPagePath(claims.p)) return null;
    return { homeId: String(claims.h), botId: String(claims.b), path: claims.p };
  }

  /** The page's file and document; `writing` when it's then changed in place, refused while the home's files move (D-80). */
  async function readDocument(place, pagePath, { writing = false } = {}) {
    const file = await store.existingFile(place, pagePath, { writing }).catch((error) => {
      if (error?.code === "files_storage_moving") throw error;
      return null;
    });
    if (!file) throw gone();
    const text = await fs.readFile(file.real, "utf8");
    return { file, text, document: readPage(text) };
  }

  /** A page file rewritten only while it still holds `was`: never one deleted or changed since it was read. */
  async function rewriteIfUnchanged(real, was, html) {
    const handle = await fs.open(real, "r+").catch(() => null);
    if (!handle) throw gone();
    try {
      if ((await handle.readFile("utf8")) !== was) return false;
      await handle.truncate(0);
      await handle.write(html, 0);
      return true;
    } finally {
      await handle.close();
    }
  }

  async function writeFile(place, pagePath, html) {
    const real = await store.resolve(place, pagePath);
    if (!real) throw new FilesError(400, "Pages live in /files/bot or /files/shared.", { code: "files_page_path_invalid" });
    await fs.mkdir(path.dirname(real), { recursive: true });
    await fs.writeFile(real, html);
    await store.settle(place.homeId);
  }

  /** The page's newest version, or null. */
  async function newestVersion(botId, pagePath, options) {
    const [row] = (await pageVersions.query({ filters: { botId: String(botId), path: pagePath }, sort: ["-id"], fields: [...VERSION_FIELDS, "content"], page: { size: 1 } }, passedOn(options))).records;
    return row ?? null;
  }

  /** A new version, unless the page is as its newest version left it. */
  async function record({ botId, path: pagePath, key, kind, userId = null, content }, options) {
    const newest = await newestVersion(botId, pagePath, options);
    if (newest?.content === content) return;
    await pageVersions.create({ botId: String(botId), path: pagePath, pageKey: key, kind, userId: userId == null ? null : String(userId), content }, { ...passedOn(options), returning: "none" });
  }

  /**
   * Saves a page the bot wrote (save_page): a whole document with its title and key, with what it
   * loads from outside copied in (anything that can't be is taken out and named in `removed`), as a
   * new version. `place` is the reply's, where the chat's own pictures are read; the page itself goes
   * in the bot's folder for everyone, at `given` or Pages/<slug>.html, where a page with that name is
   * updated and keeps its key.
   * @returns {Promise<{ path: string, title: string, summary: string, copied: number, removed: { address: string, why: string }[] }>}
   */
  async function save({ place, title, content, given = null, slug }) {
    const pagePath = given || `/files/bot/Pages/${slug}.html`;
    if (!isPagePath(pagePath)) throw new FilesError(400, "Pages live in /files/bot or /files/shared, as .html files.", { code: "files_page_path_invalid" });
    const current = await readDocument(place, pagePath).catch(() => null);
    const key = (current && pageKeyOf(current.document)) || newPageKey();
    const document = readPage(content);
    const forbidden = prepareForSave(document, { title, key });
    const { copied, removed } = await files.bringIn(document, { place, pagePath });
    const html = writePage(document);
    await writeFile(place, pagePath, html);
    await record({ botId: place.botId, path: pagePath, key, kind: "save", content: html }, inHome(place.homeId));
    return { path: pagePath, title, summary: describePage(document).summary, copied, removed: takenOut(forbidden, removed) };
  }

  /**
   * A page the bot changed another way (a command): saved again the same way, as an edit, keeping
   * its key. Answers its card, or null when the file isn't a page any more.
   */
  async function edited({ place, path: pagePath }) {
    if (!isPagePath(pagePath)) return null;
    const current = await readDocument(place, pagePath).catch(() => null);
    if (!current) return null;
    const { document, text } = current;
    const key = pageKeyOf(document) || (await newestVersion(place.botId, pagePath, inHome(place.homeId)))?.pageKey || newPageKey();
    const described = describePage(document);
    const title = described.title || pageNames(pagePath).name.replace(/\.html$/u, "");
    const forbidden = prepareForSave(document, { title, key });
    const { removed } = await files.bringIn(document, { place, pagePath });
    const html = writePage(document);
    if (html !== text) await writeFile(place, pagePath, html);
    await record({ botId: place.botId, path: pagePath, key, kind: "edit", content: html }, inHome(place.homeId));
    return { path: pagePath, title, summary: described.summary, removed: takenOut(forbidden, removed) };
  }

  /** The address a viewer frames the page from, for someone in its home. */
  async function frame({ homeId, botId, path: pagePath }) {
    if (!isPagePath(pagePath)) throw gone();
    if (!(await store.existingFile(pagePlace(homeId, botId), pagePath).catch(() => null))) throw gone();
    return { src: `/api/pages/${frameToken({ homeId, botId, path: pagePath })}/${encodeURIComponent(pageNames(pagePath).name)}` };
  }

  /**
   * What a page's address answers (rest: the page's own name, or a file in its folder): with its scripts in a viewer's
   * frame, or without them opened on its own. Held to a `key`, the page and the files of its folder open only while
   * the file is still the page that carries it.
   * @returns {Promise<{ type: string, body: string | Buffer, headers: Readonly<Record<string, string>> }>}
   */
  async function answer({ homeId, botId, path: pagePath }, { scripts, rest, key = null }) {
    const part = partOf(pagePath, rest);
    if (!part || (!scripts && part.ext === "js")) throw gone();
    const place = pagePlace(homeId, botId);
    const headers = pageHeaders({ scripts });
    const document = key || part.document ? (await readDocument(place, pagePath)).document : null;
    if (key && pageKeyOf(document) !== key) throw gone();
    if (part.file) {
      const file = await store.existingFile(place, part.file).catch(() => null);
      if (!file) throw gone();
      return { type: PAGE_FILE_TYPES[part.ext][0], body: await fs.readFile(file.real), headers };
    }
    withoutForbidden(document);
    if (!scripts) withoutScripts(document);
    withShell(document, { css: SHELL_CSS, helper: scripts ? HELPER : null });
    return { type: "text/html; charset=utf-8", body: writePage(document), headers };
  }

  /** A viewer's frame address: the page it names, with its scripts, while the frame's signed token holds. */
  async function serve({ frameToken: token, rest }) {
    const page = readFrameToken(token);
    if (!page) throw gone();
    return answer(page, { scripts: true, rest });
  }

  /**
   * The page opened on its own, outside its viewer, by an address something else made for it: the page or one of its
   * folder's files, without its scripts, only while the file is still the page carrying `key` (keyOf), so an address
   * made for one page never opens another put at its path.
   * @param {{ homeId: string, botId: string, path: string }} page
   * @param {{ key: string, rest: string }} given
   */
  async function serveOnItsOwn(page, { key, rest }) {
    if (!key || !isPagePath(page.path)) throw gone();
    return answer(page, { scripts: false, rest, key });
  }

  /**
   * The key the page's file carries (D-74), which a save, a restore and a move keep: null when there's no page there or
   * it has none. With `give`, a page without one (written before pages had keys) gets one, written into its file, and
   * one that isn't there is refused (404), so something made for this page can later tell it from another page put at
   * its path.
   * @param {{ homeId: string, botId: string, path: string }} page
   * @param {{ give?: boolean }} [options]
   * @returns {Promise<string | null>}
   */
  async function keyOf({ homeId, botId, path: pagePath }, { give = false } = {}) {
    const place = pagePlace(homeId, botId);
    if (!give) {
      const current = await readDocument(place, pagePath).catch(() => null);
      return current ? pageKeyOf(current.document) : null;
    }
    const { document, text } = await readDocument(place, pagePath);
    const key = pageKeyOf(document);
    if (key) return key;
    const given = newPageKey();
    prepareForSave(document, { title: describePage(document).title || pageNames(pagePath).name, key: given });
    const html = writePage(document);
    if (html !== text) await writeFile(place, pagePath, html);
    return given;
  }

  /**
   * Ticks saved into the page itself (D-74), from the viewer: [{ tick, done }]. The file is written only while it is
   * still as the tick read it, so a save that lands meanwhile (on any server, D-15) gets the tick instead of losing to
   * it, and a page deleted meanwhile stays deleted.
   */
  async function tick({ homeId, botId, path: pagePath, items }) {
    const place = pagePlace(homeId, botId);
    for (let tries = 0; tries < 3; tries += 1) {
      const { file, text, document } = await readDocument(place, pagePath, { writing: true });
      const changed = setTicks(document, items);
      if (!changed) return { changed };
      if (await rewriteIfUnchanged(file.real, text, writePage(document))) {
        await store.settle(place.homeId);
        return { changed };
      }
    }
    throw new FilesError(409, "The page changed while it was being ticked. Try again.", { code: "files_page_changed" });
  }

  /** The page's versions, newest first, at most 50: { versions: [{ id, kind, userId, at, current }] }. */
  async function versions({ botId, path: pagePath }, options) {
    const rows = (await pageVersions.query({ filters: { botId: String(botId), path: pagePath }, sort: ["-id"], fields: VERSION_FIELDS, page: { size: VERSIONS_SHOWN } }, passedOn(options))).records;
    return {
      versions: rows.map((row, index) => ({
        id: String(row.id),
        kind: row.kind,
        userId: row.userId == null ? null : String(row.userId),
        at: new Date(row.createdAt).toISOString(),
        current: index === 0
      }))
    };
  }

  /** Brings back an earlier version as the newest, keeping the page's key. */
  async function restore({ homeId, botId, path: pagePath, versionId, userId }, options) {
    const [version] = await pageVersions.queryAll({ filters: { id: String(versionId), botId: String(botId), path: pagePath }, fields: ["content", "pageKey"] }, passedOn(options));
    if (!version) throw new FilesError(404, "That version isn't there.", { code: "files_page_version_not_found" });
    const place = pagePlace(homeId, botId);
    const current = await readDocument(place, pagePath).catch(() => null);
    const key = (current && pageKeyOf(current.document)) || version.pageKey;
    const document = readPage(version.content);
    prepareForSave(document, { title: describePage(document).title || pageNames(pagePath).name, key });
    const html = writePage(document);
    await writeFile(place, pagePath, html);
    await record({ botId, path: pagePath, key, kind: "restore", userId, content: html }, options);
    return versions({ botId, path: pagePath }, options);
  }

  /**
   * A page that moved (`to`) or went (`to` null, or out of a Pages folder) in a home's files, by a
   * person or a bot, or was deleted from the Library: its versions follow it, or go, so a later page at
   * the same path never shows old versions. A page in a
   * bot's folder is that bot's (`botId`); one in the home's folder, any bot's. The move or delete was
   * already allowed, so this runs in the home's own context, as a bot's saves do. Then whatever else
   * follows pages (`follow`) is told, with `botId` null for a page in the home's folder.
   */
  async function pathChanged({ homeId, botId, from, to }) {
    if (!isPagePath(from)) return;
    const mine = from.startsWith("/files/bot/");
    if (mine && !botId) return;
    const where = mine ? { botId: String(botId), path: from } : { path: from };
    const write = { ...inHome(homeId), returning: "none" };
    const stays = Boolean(to) && isPagePath(to);
    if (stays) await pageVersions.patchWhere(where, { path: to }, write);
    else await pageVersions.deleteWhere(where, write);
    const change = { homeId: String(homeId), botId: mine ? String(botId) : null, from, to: stays ? to : null };
    for (const follower of followers) await follower(change);
  }

  const followers = [];
  /**
   * Adds something else that follows a page as it moves or goes (D-84: its copy on the home's website). `follower`
   * gets { homeId, botId, from, to } after the page's own versions have followed, and handles its own
   * failures: the move or delete has already happened.
   * @param {(change: { homeId: string, botId: string | null, from: string, to: string | null }) => Promise<void>} follower
   */
  function follow(follower) {
    followers.push(follower);
  }

  /**
   * A page as it goes on someone's own website (D-84): the page opened on its own (no scripts, Mercbot's look) as one
   * document, with the files of its folder that it loads carried beside it at the same addresses. An SVG picture goes
   * inside the page as data instead, since opened on its own from a website an SVG runs its scripts there, and no
   * script file is carried. `stamp` goes in the copy, so reading its address back shows whether it answers with this
   * copy. It carries at most as many files and bytes as a save copies in.
   * @returns {Promise<{ title: string, html: string, files: { path: string, type: string, content: Buffer }[] }>}
   */
  async function published({ homeId, botId, path: pagePath }, { stamp }) {
    if (!isPagePath(pagePath)) throw gone();
    const place = pagePlace(homeId, botId);
    const { document } = await readDocument(place, pagePath);
    const { name, folder } = pageNames(pagePath);
    const pageDir = path.posix.dirname(pagePath);
    const title = describePage(document).title || name.replace(/\.html$/u, "");
    withoutForbidden(document);
    withoutScripts(document);
    const carried = new Map();
    let count = 0;
    let total = 0;
    const tooBig = () =>
      new FilesError(413, `This page loads more than a published page carries: at most ${PAGE_LIMITS.files} files and ${PAGE_LIMITS.totalBytes / 1048576} MB.`, {
        code: "files_page_too_big"
      });

    /** The file of the page's folder an address names, seen from `from` (a folder of the copy), or null. */
    function ownFile(address, from) {
      const value = String(address || "").trim().split(/[?#]/u)[0];
      if (!value || /^[a-z][a-z0-9+.-]*:|^\//iu.test(value)) return null;
      let wanted;
      try {
        wanted = path.posix.normalize(path.posix.join(from, decodeURIComponent(value)));
      } catch {
        return null;
      }
      if (!wanted.startsWith(`${folder}/`) || wanted.split("/").includes("..")) return null;
      const ext = path.posix.extname(wanted).slice(1).toLowerCase();
      return PAGE_FILE_TYPES[ext] && ext !== "js" ? { wanted, ext } : null;
    }

    async function read(wanted) {
      const file = await store.existingFile(place, path.posix.join(pageDir, wanted)).catch(() => null);
      if (!file) return null;
      count += 1;
      total += file.stat.size;
      if (count > PAGE_LIMITS.files || total > PAGE_LIMITS.totalBytes) throw tooBig();
      return fs.readFile(file.real);
    }

    /** One address the copy loads: an SVG's data, or undefined to leave it (its file carried, or none of the folder's). */
    async function settle(address, from) {
      const own = ownFile(address, from);
      if (!own || carried.has(own.wanted)) return undefined;
      if (own.ext === "svg") {
        const content = await read(own.wanted);
        return content ? `data:image/svg+xml;base64,${content.toString("base64")}` : undefined;
      }
      carried.set(own.wanted, null);
      const content = await read(own.wanted);
      if (content) carried.set(own.wanted, { type: PAGE_FILE_TYPES[own.ext][0], content: own.ext === "css" ? await styleSheet(content, own.wanted) : content });
      return undefined;
    }

    /** A style sheet the copy carries, with what it loads from the folder settled the same way, from its own folder. */
    async function styleSheet(content, wanted) {
      const text = content.toString("utf8");
      const answers = new Map();
      for (const { url } of cssAddresses(text)) if (!answers.has(url)) answers.set(url, await settle(url, path.posix.dirname(wanted)));
      return Buffer.from(rewriteCss(text, (url) => answers.get(url)), "utf8");
    }

    const addresses = new Set();
    visitLoads(document, (url) => {
      addresses.add(url);
      return undefined;
    });
    const answers = new Map();
    for (const url of addresses) answers.set(url, await settle(url, ""));
    visitLoads(document, (url) => answers.get(url));
    withShell(document, { css: SHELL_CSS, helper: null });
    withPublishedPolicy(document, stamp);
    const files = [...carried].filter(([, file]) => file).map(([filePath, file]) => ({ path: filePath, ...file }));
    return { title, html: writePage(document), files };
  }

  /**
   * A standalone copy: the page with Mercbot's look and helper and every file of its
   * folder inside it, under a policy that loads nothing from outside, so it opens anywhere as a file.
   */
  async function standalone({ homeId, botId, path: pagePath }) {
    const place = pagePlace(homeId, botId);
    const { document } = await readDocument(place, pagePath);
    withoutForbidden(document);
    const inlined = new Map();
    const addresses = [];
    visitLoads(document, (url) => {
      addresses.push(url);
      return undefined;
    });
    for (const url of addresses) if (!inlined.has(url)) inlined.set(url, await files.asDataAddress(place, pagePath, url));
    visitLoads(document, (url) => inlined.get(url));
    withShell(document, { css: SHELL_CSS, helper: HELPER });
    withStandalonePolicy(document);
    return { name: pageNames(pagePath).name, html: writePage(document) };
  }

  return Object.freeze({
    save,
    edited,
    frame,
    serve,
    serveOnItsOwn,
    keyOf,
    tick,
    versions,
    restore,
    pathChanged,
    follow,
    published,
    standalone,
    isPagePath
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ partOf });
