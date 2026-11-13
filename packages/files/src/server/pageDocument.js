import { randomBytes } from "node:crypto";
import path from "node:path";
import { defaultTreeAdapter as tree, parse, serialize } from "parse5";

// A page's HTML (D-40, D-74), read and changed as the browser would read it: parse5 is the HTML
// standard's own parser, so what is found here (a script, a picture from outside, a checklist item)
// is what a browser finds. Every change is made on the tree and the page written back from it.
//
// The page's own files live beside it, in "<name>.files/", and the page names them relatively
// ("party.files/1a2b3c-photo.png"). Anything else it would load (a picture, a font, a library from
// another site; a picture from the chat's folders) is copied in on save (pageFiles.js); this module
// finds those addresses and rewrites them.

const HTML_NS = "http://www.w3.org/1999/xhtml";
export const PAGE_KEY_META = "mercbot-page";
// Never kept in a page: frames and plugins (a page shows no other page), a base address, and meta
// http-equiv, which can reload the page elsewhere or set its own policy. Their absence is also what
// the frame's content policy enforces; removing them keeps a page from relying on what can't run.
const FORBIDDEN = new Set(["iframe", "frame", "frameset", "object", "embed", "portal", "applet", "base"]);
// Links that would reach another site without being clicked: prefetching, preconnecting.
const FORBIDDEN_LINKS = new Set(["preconnect", "dns-prefetch", "prefetch", "prerender", "preload", "modulepreload", "manifest"]);
// Where elements name what they load, by tag: the attribute and the kind of file it must be.
const LOADS = Object.freeze({
  img: [["src", "image"], ["srcset", "image"]],
  source: [["src", "media"], ["srcset", "image"]],
  video: [["src", "media"], ["poster", "image"]],
  audio: [["src", "media"]],
  track: [["src", "track"]],
  script: [["src", "script"]],
  input: [["src", "image"]],
  image: [["href", "image"], ["xlink:href", "image"]],
  feimage: [["href", "image"], ["xlink:href", "image"]],
  use: [["href", "image"], ["xlink:href", "image"]]
});
// An element whose file can't be copied goes with it; for these, only the attribute goes.
const KEEP_WITHOUT = new Set(["video", "input"]);
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/giu;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)\s;'"]+))\s*\)?[^;]*;?/giu;

/** A page's path (D-74): an .html file in a Pages folder of a bot's folder for everyone or of the home's. */
export function isPagePath(virtualPath) {
  const value = String(virtualPath || "");
  return /^\/files\/(bot|shared)\/(.+\/)?Pages\/[^/]+\.html$/u.test(value) && path.posix.normalize(value) === value;
}

/** An older Markdown page, still opened as it was. */
export const isMarkdownPage = (virtualPath) => /^\/files\/.+\.md$/u.test(String(virtualPath || ""));

/** The page's file name and the folder of its own files: "party.html" and "party.files". */
export function pageNames(virtualPath) {
  const name = path.posix.basename(virtualPath);
  return { name, folder: `${name.replace(/\.html$/u, "")}.files` };
}

/** A new page's key, which its file carries, so what is made for the page can tell it from another page put at its path. */
export const newPageKey = () => randomBytes(12).toString("base64url");

// --- The tree -----------------------------------------------------------------------------------

const attrOf = (element, name) => element.attrs.find((entry) => entry.name === name)?.value ?? null;
function setAttr(element, name, value) {
  const found = element.attrs.find((entry) => entry.name === name);
  if (found) found.value = value;
  else element.attrs.push({ name, value });
}
const dropAttr = (element, name) => {
  element.attrs = element.attrs.filter((entry) => entry.name !== name);
};
const classesOf = (element) => String(attrOf(element, "class") || "").split(/\s+/u).filter(Boolean);
const nameOf = (element) => String(element.tagName || "").toLowerCase();

/** Every element in document order; a template's content too when `templates` is set. */
function elementsIn(node, { templates = false } = {}) {
  const found = [];
  const walk = (parent) => {
    for (const child of parent.childNodes || []) {
      if (!child.tagName) continue;
      found.push(child);
      walk(child);
      if (templates && child.content) walk(child.content);
    }
  };
  walk(node);
  return found;
}

const textOf = (element) => (element.childNodes || []).map((child) => (child.nodeName === "#text" ? child.value : child.tagName ? textOf(child) : "")).join("");
const detach = (node) => tree.detachNode(node);

/** The document's html, head and body elements (the parser always makes them). */
function partsOf(document) {
  const htmlElement = document.childNodes.find((node) => nameOf(node) === "html");
  return {
    html: htmlElement,
    head: htmlElement.childNodes.find((node) => nameOf(node) === "head"),
    body: htmlElement.childNodes.find((node) => nameOf(node) === "body")
  };
}

function newElement(tagName, attrs = {}, text = "") {
  const element = tree.createElement(tagName, HTML_NS, Object.entries(attrs).map(([name, value]) => ({ name, value })));
  if (text) tree.insertText(element, text);
  return element;
}

const prepend = (parent, node) =>
  (parent.childNodes.length ? tree.insertBefore(parent, node, parent.childNodes[0]) : tree.appendChild(parent, node));

/** The page as a tree, as a browser reads it. */
export const readPage = (html) => parse(String(html || ""));

/** The tree written back as the page's HTML, with its doctype. */
export function writePage(document) {
  const text = serialize(document);
  return /^<!doctype/iu.test(text) ? text : `<!DOCTYPE html>${text}`;
}

// --- What a page loads --------------------------------------------------------------------------

/** The candidates of a srcset: [{ url, rest }], where `rest` is its width or density. */
function srcsetOf(value) {
  return String(value || "")
    .split(/,(?=\s*\S)/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...rest] = part.split(/\s+/u);
      return { url, rest: rest.join(" ") };
    });
}

/**
 * Addresses a style sheet loads: url(...) and @import. `found(url, kind)` answers the new address,
 * or null to drop it; an @import is always dropped when not kept (its rules can't be copied here).
 */
export function rewriteCss(text, found) {
  const imported = String(text).replace(CSS_IMPORT, (match, a, b, c) => {
    const url = a ?? b ?? c ?? "";
    const next = found(url, "style");
    return next === undefined ? match : next === null ? "" : `@import url("${next}");`;
  });
  return imported.replace(CSS_URL, (match, a, b, c) => {
    const url = (a ?? b ?? c ?? "").trim();
    if (!url) return match;
    const next = found(url, "css");
    return next === undefined ? match : next === null ? "none" : `url("${next}")`;
  });
}

/** The addresses a style sheet loads, for copying them first. */
export function cssAddresses(text) {
  const urls = [];
  rewriteCss(text, (url, kind) => {
    urls.push({ url, kind });
    return undefined;
  });
  return urls;
}

/**
 * Every address the page loads, with what it must be: [{ url, kind }], where kind is image, media,
 * track, script, style (a style sheet) or css (a picture or font a style sheet names). Links people
 * click (<a href>) aren't loads.
 */
export function pageAddresses(document) {
  const urls = [];
  visitLoads(document, (url, kind) => {
    urls.push({ url, kind });
    return undefined;
  });
  return urls;
}

/**
 * Calls `found(url, kind)` for every address the page loads, and puts its answer in place: a new
 * address, null to take it away (and the element with it, for one that is nothing without it), or
 * undefined to leave it.
 */
export function visitLoads(document, found) {
  for (const element of elementsIn(document, { templates: true })) {
    const tag = nameOf(element);
    if (tag === "link") {
      const rel = String(attrOf(element, "rel") || "").toLowerCase().split(/\s+/u);
      const href = attrOf(element, "href");
      if (!href || !(rel.includes("stylesheet") || rel.includes("icon"))) continue;
      const next = found(href, rel.includes("stylesheet") ? "style" : "image");
      if (next === null) detach(element);
      else if (next !== undefined) setAttr(element, "href", next);
      continue;
    }
    if (tag === "style") {
      for (const child of element.childNodes) if (child.nodeName === "#text") child.value = rewriteCss(child.value, found);
    }
    const style = attrOf(element, "style");
    if (style && /url\(|@import/iu.test(style)) setAttr(element, "style", rewriteCss(style, found));
    for (const [name, kind] of LOADS[tag] || []) {
      const value = attrOf(element, name);
      if (value === null) continue;
      if (tag === "input" && String(attrOf(element, "type")).toLowerCase() !== "image") continue;
      if (name === "srcset") {
        const kept = srcsetOf(value)
          .map((candidate) => ({ ...candidate, next: found(candidate.url, kind) }))
          .filter((candidate) => candidate.next !== null);
        const text = kept.map((candidate) => [candidate.next ?? candidate.url, candidate.rest].filter(Boolean).join(" ")).join(", ");
        if (kept.length) setAttr(element, name, text);
        else dropAttr(element, name);
        continue;
      }
      const next = found(value, kind);
      if (next === undefined) continue;
      if (next !== null) {
        setAttr(element, name, next);
        continue;
      }
      dropAttr(element, name);
      if (!KEEP_WITHOUT.has(tag) && !(tag === "img" && attrOf(element, "srcset"))) {
        detach(element);
        break;
      }
    }
  }
}

// --- Saving, serving and ticking ----------------------------------------------------------------

/**
 * Takes out what a page never keeps (see FORBIDDEN): frames and plugins, a base address, meta
 * http-equiv (other than the character set) and links that load ahead, and `ping` on links.
 * @returns {string[]} what was taken out, by tag, for the bot to be told.
 */
export function withoutForbidden(document) {
  const removed = [];
  for (const element of elementsIn(document, { templates: true })) {
    const tag = nameOf(element);
    const equiv = String(attrOf(element, "http-equiv") || "").toLowerCase();
    const rel = String(attrOf(element, "rel") || "").toLowerCase().split(/\s+/u);
    if (FORBIDDEN.has(tag) || (tag === "meta" && equiv && equiv !== "content-type") || (tag === "link" && rel.some((each) => FORBIDDEN_LINKS.has(each)))) {
      removed.push(tag === "meta" ? `meta http-equiv="${equiv}"` : tag === "link" ? `link rel="${rel.join(" ")}"` : tag);
      detach(element);
      continue;
    }
    if (attrOf(element, "ping") !== null) dropAttr(element, "ping");
  }
  return removed;
}

/**
 * A page as it is saved: a whole document with its character set, a phone-sized viewport, its
 * title and its key, and none of what pages never keep. Answers what was taken out.
 */
export function prepareForSave(document, { title, key }) {
  const removed = withoutForbidden(document);
  const { head } = partsOf(document);
  for (const meta of head.childNodes.filter((node) => nameOf(node) === "meta" && (attrOf(node, "charset") !== null || attrOf(node, "name") === PAGE_KEY_META))) detach(meta);
  if (!head.childNodes.some((node) => nameOf(node) === "meta" && attrOf(node, "name") === "viewport")) {
    prepend(head, newElement("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }));
  }
  const titleElement = head.childNodes.find((node) => nameOf(node) === "title");
  if (!titleElement) prepend(head, newElement("title", {}, title));
  else if (!textOf(titleElement).trim()) tree.insertText(titleElement, title);
  prepend(head, newElement("meta", { name: PAGE_KEY_META, content: key }));
  prepend(head, newElement("meta", { charset: "utf-8" }));
  const { html } = partsOf(document);
  if (attrOf(html, "lang") === null) setAttr(html, "lang", "en");
  return removed;
}

/** The key a page's file carries, or null. */
export function pageKeyOf(document) {
  const { head } = partsOf(document);
  const meta = head.childNodes.find((node) => nameOf(node) === "meta" && attrOf(node, "name") === PAGE_KEY_META);
  return meta ? attrOf(meta, "content") : null;
}

/** A page's title (its <title>, else its first heading) and a summary (its first paragraph). */
export function describePage(document) {
  const all = elementsIn(document);
  const titleElement = all.find((element) => nameOf(element) === "title");
  const heading = all.find((element) => /^h[1-3]$/u.test(nameOf(element)));
  const paragraph = all.find((element) => nameOf(element) === "p" && textOf(element).trim());
  const clean = (text) => String(text || "").replace(/\s+/gu, " ").trim();
  return {
    title: clean(textOf(titleElement || heading || { childNodes: [] })).slice(0, 120),
    summary: clean(paragraph ? textOf(paragraph) : "").slice(0, 200)
  };
}

/** The checklist items, in order: every <li> of a <ul class="checklist">, outside templates. */
const checklistItems = (document) =>
  elementsIn(document).filter((element) => nameOf(element) === "li" && element.parentNode && nameOf(element.parentNode) === "ul" && classesOf(element.parentNode).includes("checklist"));

/**
 * Ticks or unticks checklist items, saved in the file as the item's data-done (D-74), so a copy of
 * the file keeps them. `items` are [{ tick, done }], each tick an item's place in checklistItems.
 * @returns {number} how many items changed.
 */
export function setTicks(document, items) {
  const all = checklistItems(document);
  let changed = 0;
  for (const { tick, done } of items) {
    const item = all[tick];
    if (!item || (attrOf(item, "data-done") !== null) === done) continue;
    if (done) setAttr(item, "data-done", "");
    else dropAttr(item, "data-done");
    changed += 1;
  }
  return changed;
}

// Addresses that run a script: browsers ignore spaces and control characters inside the scheme.
const SCRIPT_ADDRESS = /^(javascript|vbscript|data:text\/html)/iu;
const ADDRESS_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "data", "poster"]);
const runsScript = (value) => SCRIPT_ADDRESS.test([...String(value)].filter((char) => char.codePointAt(0) > 32).join(""));

/**
 * Takes out every script, so a page shows without them (a page opened by its link, D-74): script
 * elements, event handler attributes, script addresses and targets. The page's policy forbids them too.
 */
export function withoutScripts(document) {
  for (const element of elementsIn(document, { templates: true })) {
    if (nameOf(element) === "script") {
      detach(element);
      continue;
    }
    element.attrs = element.attrs.filter((entry) =>
      !/^on/iu.test(entry.name) && entry.name !== "target" && !(ADDRESS_ATTRIBUTES.has(entry.name) && runsScript(entry.value)));
  }
}

/**
 * Puts nodes, in order, at the start of the head: after its character set, which a browser reading a
 * file looks for in the first bytes, and before everything else.
 */
function atHeadStart(document, nodes) {
  const { head } = partsOf(document);
  const charset = head.childNodes.find((node) => nameOf(node) === "meta" && attrOf(node, "charset") !== null);
  const before = charset ? head.childNodes[head.childNodes.indexOf(charset) + 1] : head.childNodes[0];
  for (const node of nodes) {
    if (before) tree.insertBefore(head, node, before);
    else tree.appendChild(head, node);
  }
}

/**
 * Mercbot's look and helper in front of everything the page has, so the page's own styles and
 * scripts come after (and win): the shell's style sheet, then (with scripts) the helper. Each
 * checklist item is numbered (data-tick) for saving its tick, and each link card gets its site's
 * domain (data-domain), which the shell's look shows.
 */
export function withShell(document, { css, helper }) {
  checklistItems(document).forEach((item, index) => setAttr(item, "data-tick", String(index)));
  for (const element of elementsIn(document)) {
    if (nameOf(element) !== "a" || !classesOf(element).includes("card")) continue;
    try {
      setAttr(element, "data-domain", new URL(attrOf(element, "href") || "").hostname.replace(/^www\./u, ""));
    } catch {
      setAttr(element, "data-domain", "");
    }
  }
  atHeadStart(document, [newElement("style", { id: "mercbot-shell" }, css), ...(helper ? [newElement("script", {}, helper)] : [])]);
  return document;
}

/** A standalone copy's own policy, which works as a file too: nothing from outside, ever. */
export const STANDALONE_POLICY =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:; " +
  "script-src 'unsafe-inline' 'unsafe-eval' data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/** Puts the standalone policy before everything else the page has, so it covers all of it. */
export function withStandalonePolicy(document) {
  atHeadStart(document, [newElement("meta", { "http-equiv": "Content-Security-Policy", content: STANDALONE_POLICY })]);
  return document;
}

/**
 * A page published to a website (D-84) carries the policy of a page opened by its link itself, since the site's web
 * server sends none of Mercbot's headers: its own site's files and inline styles, no scripts, no requests, forms,
 * frames or workers. A meta policy can't hold `sandbox` or `frame-ancestors`; the scripts are taken out anyway.
 */
export const PUBLISHED_POLICY =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; " +
  "manifest-src 'none'; base-uri 'none'";
export const PUBLISHED_META = "mercbot-published";

/**
 * A page as a website shows it: the published policy and no referrer before everything else, and `stamp` in place of
 * its key (which only Mercbot checks), so whoever reads the page back at its address can tell it's this copy.
 */
export function withPublishedPolicy(document, stamp) {
  const { head } = partsOf(document);
  for (const meta of head.childNodes.filter((node) => nameOf(node) === "meta" && [PAGE_KEY_META, PUBLISHED_META].includes(attrOf(node, "name")))) detach(meta);
  atHeadStart(document, [
    newElement("meta", { "http-equiv": "Content-Security-Policy", content: PUBLISHED_POLICY }),
    newElement("meta", { name: "referrer", content: "no-referrer" }),
    newElement("meta", { name: PUBLISHED_META, content: String(stamp) })
  ]);
  return document;
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ srcsetOf, checklistItems, elementsIn });
