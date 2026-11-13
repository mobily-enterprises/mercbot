import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { isPrivateAddress, publicLookup } from "@local/account/public-address";
import { cssAddresses, pageAddresses, pageNames, rewriteCss, visitLoads } from "./pageDocument.js";

// Nothing from outside (D-74): on save, everything a page would load from anywhere but its own folder
// is copied into "<name>.files/" and the page names the copy: pictures, fonts, video and sound, style
// sheets (and the pictures and fonts they name) and script libraries from other sites, and the
// chat's own pictures by their /files/… path. What can't be copied goes, and the bot is told why. Only
// public internet addresses are fetched (checked on the address connected to), with limits on the
// count, size, kind and time; a GET only reads, so a test copy fetches too (D-69).

// A page's own files, by extension: what each is served as, and what it may stand for.
export const PAGE_FILE_TYPES = Object.freeze({
  png: ["image/png", "image"],
  jpg: ["image/jpeg", "image"],
  jpeg: ["image/jpeg", "image"],
  gif: ["image/gif", "image"],
  webp: ["image/webp", "image"],
  avif: ["image/avif", "image"],
  svg: ["image/svg+xml", "image"],
  ico: ["image/x-icon", "image"],
  woff: ["font/woff", "font"],
  woff2: ["font/woff2", "font"],
  ttf: ["font/ttf", "font"],
  otf: ["font/otf", "font"],
  mp4: ["video/mp4", "media"],
  webm: ["video/webm", "media"],
  ogv: ["video/ogg", "media"],
  mp3: ["audio/mpeg", "media"],
  ogg: ["audio/ogg", "media"],
  wav: ["audio/wav", "media"],
  m4a: ["audio/mp4", "media"],
  vtt: ["text/vtt; charset=utf-8", "track"],
  css: ["text/css; charset=utf-8", "style"],
  js: ["text/javascript; charset=utf-8", "script"]
});
// What a site's answer is, by its content type.
const EXTENSION_OF = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/sfnt": "ttf",
  "application/font-woff": "woff",
  "application/font-woff2": "woff2",
  "application/x-font-ttf": "ttf",
  "application/x-font-otf": "otf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "text/vtt": "vtt",
  "text/css": "css",
  "text/javascript": "js",
  "application/javascript": "js",
  "application/x-javascript": "js"
});
// What each place in a page may hold (pageDocument's kinds): a style sheet's url() a picture or a font.
const ACCEPTS = Object.freeze({
  image: ["image"],
  media: ["media"],
  track: ["track"],
  script: ["script"],
  style: ["style"],
  css: ["image", "font"]
});
// How much a page holds: the files a save copies in, and what a published copy carries (D-84).
export const LIMITS = Object.freeze({
  files: 60,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 40 * 1024 * 1024,
  seconds: 10,
  allSeconds: 60,
  redirects: 3
});
const AT_ONCE = 4;

class PageFileError extends Error {}

/** A page file's extension, from a name or an address's path, when it is one pages hold. */
function extensionIn(name) {
  const ext = path.posix.extname(String(name || "").split(/[?#]/u)[0]).slice(1).toLowerCase();
  return PAGE_FILE_TYPES[ext] ? ext : null;
}

/** A copy's name: its content's hash, then a short readable stem. */
function copyName(data, from, ext) {
  const stem = path.posix.basename(String(from).split(/[?#]/u)[0]).replace(/\.[^.]*$/u, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40);
  return `${createHash("sha256").update(data).digest("hex").slice(0, 12)}${stem ? `-${stem}` : ""}.${ext}`;
}

/**
 * One file from the web, by GET: only http and https, only public addresses, a few redirects, the
 * size limit, and all of it, redirects included, done by `until` (a time), however slowly the site
 * sends. Answers { data, ext }.
 */
async function fetchOutside(address, { insecure, redirects = LIMITS.redirects, maxBytes, until }) {
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol)) throw new PageFileError("it isn't a web address");
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (!insecure && isIP(host) && isPrivateAddress(host)) throw new PageFileError("it's a private network address");
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, {
      headers: { "user-agent": "Mercbot-pages", accept: "*/*" },
      lookup: publicLookup(insecure)
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (!redirects) return reject(new PageFileError("it redirects too many times"));
        return resolve(fetchOutside(new URL(response.headers.location, url).href, { insecure, redirects: redirects - 1, maxBytes, until }));
      }
      if (status !== 200) {
        response.resume();
        return reject(new PageFileError(`the site answered ${status}`));
      }
      const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const ext = EXTENSION_OF[type] || (["", "application/octet-stream", "binary/octet-stream"].includes(type) ? extensionIn(url.pathname) : null);
      if (!ext) {
        response.resume();
        return reject(new PageFileError(`a page can't hold ${type || "that kind of file"}`));
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) request.destroy(new PageFileError(`it's larger than ${Math.round(maxBytes / 1048576)} MB`));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ data: Buffer.concat(chunks), ext }));
      response.on("error", reject);
    });
    const late = setTimeout(() => request.destroy(new PageFileError(`it didn't arrive within ${LIMITS.seconds} seconds`)), Math.max(0, until - Date.now()));
    request.on("close", () => clearTimeout(late));
    request.on("error", (error) => reject(error instanceof PageFileError ? error : new PageFileError(error.message)));
  });
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").FileStore} dependencies.store
 * @param {boolean} [dependencies.insecure] Tests only: fetches from local addresses too.
 */
export function createPageFiles({ store, insecure = false }) {
  /**
   * Copies everything the page loads from outside its folder into it, and names the copies; what
   * can't be copied goes. `place` is where the page's /files/… addresses are read (the reply's).
   * @returns {Promise<{ copied: number, removed: { address: string, why: string }[] }>}
   */
  async function bringIn(document, { place, pagePath }) {
    const { folder } = pageNames(pagePath);
    const pageDir = path.posix.dirname(pagePath);
    const folderPath = `${pageDir}/${folder}`;
    const realFolder = await store.resolve(place, folderPath);
    if (!realFolder) throw new PageFileError("pages live in /files/bot or /files/shared");
    const deadline = Date.now() + LIMITS.allSeconds * 1000;
    const copies = new Map();
    const removed = [];
    let total = 0;
    let count = 0;

    /** Keeps a copy in the page's folder; answers its name there. */
    async function keep(data, from, ext) {
      total += data.length;
      if (total > LIMITS.totalBytes) throw new PageFileError(`the page's files would pass ${LIMITS.totalBytes / 1048576} MB`);
      const name = copyName(data, from, ext);
      await fs.mkdir(realFolder, { recursive: true });
      await fs.writeFile(path.join(realFolder, name), data);
      return name;
    }

    /** One address's bytes and kind: from the web, or from the reply's folders. */
    async function read(address, base) {
      if (++count > LIMITS.files) throw new PageFileError(`a page holds at most ${LIMITS.files} files`);
      if (Date.now() > deadline) throw new PageFileError("copying the page's files took too long");
      if (/^https?:/iu.test(address)) return fetchOutside(address, { insecure, maxBytes: LIMITS.fileBytes, until: Math.min(Date.now() + LIMITS.seconds * 1000, deadline) });
      const virtualPath = address.startsWith("/") ? address : path.posix.join(base, address);
      if (!virtualPath.startsWith("/files/")) throw new PageFileError("it isn't one of your files or a web address");
      const file = await store.existingFile(place, decodeURIComponent(virtualPath.split(/[?#]/u)[0])).catch(() => null);
      if (!file) throw new PageFileError("that file isn't there");
      const ext = extensionIn(virtualPath);
      if (!ext) throw new PageFileError("a page can't hold that kind of file");
      if (file.stat.size > LIMITS.fileBytes) throw new PageFileError(`it's larger than ${LIMITS.fileBytes / 1048576} MB`);
      return { data: await fs.readFile(file.real), ext };
    }

    /** A style sheet's own addresses, copied beside it (an @import inside one goes). */
    async function styleSheet(text, from) {
      const found = new Map();
      for (const { url, kind } of cssAddresses(text)) {
        if (kind === "style" || found.has(url) || /^(data|blob):/iu.test(url)) continue;
        try {
          const nested = await read(/^https?:/iu.test(from) ? new URL(url, from).href : url.startsWith("//") ? `https:${url}` : url, path.posix.dirname(from));
          if (!ACCEPTS.css.includes(PAGE_FILE_TYPES[nested.ext][1])) throw new PageFileError("it isn't a picture or a font");
          found.set(url, await keep(nested.data, url, nested.ext));
        } catch (error) {
          found.set(url, null);
          removed.push({ address: url, why: error.message });
        }
      }
      return rewriteCss(text, (url, kind) => (kind === "style" ? null : found.has(url) ? found.get(url) : undefined));
    }

    /** What to do with one address the page loads: leave it, copy it in, or take it away. */
    async function settle(address, kind) {
      const trimmed = address.trim();
      const value = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
      if (!value || /^(data|blob):|^#/iu.test(value)) return undefined;
      if (value.startsWith(`${folder}/`) || value.startsWith(`./${folder}/`)) {
        const own = await store.existingFile(place, path.posix.join(pageDir, decodeURIComponent(value.split(/[?#]/u)[0]))).catch(() => null);
        if (own) return undefined;
        throw new PageFileError("it isn't in the page's folder");
      }
      if (/^[a-z][a-z0-9+.-]*:/iu.test(value) && !/^https?:/iu.test(value)) throw new PageFileError("a page can only load web addresses and your files");
      const file = await read(value, pageDir);
      const group = PAGE_FILE_TYPES[file.ext][1];
      if (!ACCEPTS[kind].includes(group)) throw new PageFileError(`it's a ${group} file where a ${kind} belongs`);
      const data = group === "style" ? Buffer.from(await styleSheet(file.data.toString("utf8"), value), "utf8") : file.data;
      return `${folder}/${await keep(data, value, file.ext)}`;
    }

    const unique = new Map();
    for (const { url, kind } of pageAddresses(document)) if (!unique.has(url)) unique.set(url, kind);
    const entries = [...unique.entries()];
    for (let start = 0; start < entries.length; start += AT_ONCE) {
      await Promise.all(entries.slice(start, start + AT_ONCE).map(async ([url, kind]) => {
        try {
          copies.set(url, await settle(url, kind));
        } catch (error) {
          copies.set(url, null);
          removed.push({ address: url.slice(0, 300), why: error instanceof PageFileError ? error.message : "it couldn't be read" });
        }
      }));
    }
    visitLoads(document, (url) => copies.get(url));
    return { copied: [...copies.values()].filter((value) => typeof value === "string").length, removed };
  }

  /**
   * A page's own file as data: for a standalone copy, which carries everything inside it. A style
   * sheet's own addresses are inlined as well.
   * @returns {Promise<string | undefined>}
   */
  async function asDataAddress(place, pagePath, address) {
    const { folder } = pageNames(pagePath);
    const pageDir = path.posix.dirname(pagePath);
    const value = String(address || "").trim();
    if (!value.startsWith(`${folder}/`)) return undefined;
    const virtualPath = path.posix.join(pageDir, decodeURIComponent(value.split(/[?#]/u)[0]));
    const ext = extensionIn(virtualPath);
    const file = ext ? await store.existingFile(place, virtualPath).catch(() => null) : null;
    if (!file) return null;
    let data = await fs.readFile(file.real);
    if (ext === "css") {
      const inner = new Map();
      for (const { url } of cssAddresses(data.toString("utf8"))) {
        if (!inner.has(url)) inner.set(url, await asDataAddress(place, pagePath, `${folder}/${url}`));
      }
      data = Buffer.from(rewriteCss(data.toString("utf8"), (url, kind) => (kind === "style" ? null : inner.get(url))), "utf8");
    }
    return `data:${PAGE_FILE_TYPES[ext][0].replace(/;.*$/u, "")};base64,${data.toString("base64")}`;
  }

  return Object.freeze({
    bringIn,
    asDataAddress
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ copyName, extensionIn, fetchOutside, LIMITS });
