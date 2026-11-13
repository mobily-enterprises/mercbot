import { createHash } from "node:crypto";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

// An app's own style sheet (owner, 2026-10-30: the Builder has complete freedom to make apps look
// totally different). It's ordinary CSS, with three fences, so an app restyles itself and nothing
// else:
// - every selector is scoped to the app's own area (`:root`, `html` and `body` mean that area); the
//   area paints only inside itself, so even fixed positioning can't cover Mercbot around it;
// - nothing is loaded from outside: images only as data URLs, fonts only from Google Fonts' file
//   host, no @import; so a style can't send what people type to someone else's server;
// - its animation and font names are its own, so they can't change Mercbot's.
const MAX_CHARS = 60000;
const AT_RULES = new Set(["media", "supports", "container", "keyframes", "-webkit-keyframes", "font-face", "layer"]);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml)[;,]/iu;
const FONT_FILES = /^https:\/\/fonts\.gstatic\.com\//u;
const FORBIDDEN = /(expression\s*\(|javascript:|-moz-binding|behavior\s*:|\bsrc\s*\()/iu;

function urlsIn(value) {
  const urls = [];
  value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/giu, (_match, _quote, url) => urls.push(url.trim()));
  return urls;
}

/**
 * Checks an app's CSS. Returns { errors } (each { path, message }) and, when it's fine, the CSS
 * as written (stored with the app; scoped when served).
 */
export function checkStyle(css) {
  if (css === undefined || css === null || css === "") return { errors: [], css: "" };
  if (typeof css !== "string") return { errors: [{ path: "style", message: "is the app's CSS, as text." }] };
  if (css.length > MAX_CHARS) return { errors: [{ path: "style", message: `at most ${MAX_CHARS} characters.` }] };
  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    return { errors: [{ path: "style", message: `CSS doesn't parse (line ${error.line ?? "?"}): ${error.reason || error.message}` }] };
  }
  const errors = [];
  const fail = (node, message) => errors.push({ path: `style (line ${node.source?.start?.line ?? "?"})`, message });
  root.walkAtRules((rule) => {
    if (!AT_RULES.has(rule.name.toLowerCase())) {
      fail(
        rule,
        `@${rule.name} isn't allowed in an app's style` +
          `${rule.name === "import" ? ": nothing is loaded from outside; for fonts, use @font-face with fonts.gstatic.com" : ""}.`
      );
    }
  });
  root.walkDecls((decl) => {
    if (FORBIDDEN.test(decl.value) || FORBIDDEN.test(decl.prop)) fail(decl, `"${decl.prop}: ${decl.value.slice(0, 60)}" isn't allowed.`);
    const inFontFace = decl.parent?.type === "atrule" && decl.parent.name.toLowerCase() === "font-face";
    for (const url of urlsIn(decl.value)) {
      if (DATA_IMAGE.test(url)) continue;
      if (inFontFace && decl.prop.toLowerCase() === "src" && FONT_FILES.test(url)) continue;
      fail(
        decl,
        `url(${url.slice(0, 60)}) can't be loaded: use a data:image URL (an SVG works well), ` +
          "or a font file from https://fonts.gstatic.com in @font-face."
      );
    }
  });
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/iu.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      if (/^\s*[>+~]/u.test(selector)) fail(rule, `"${selector}" starts with a combinator; start from a part of the app.`);
    }
  });
  return errors.length ? { errors } : { errors: [], css };
}

// The app's CSS fenced to its own area, `[data-app-style="<appId>"]`, with its own animation and
// font names. Cached by app and content.
const cache = new Map();
export function scopeStyle(appId, css) {
  if (!css) return "";
  const key = `${appId}:${createHash("sha1").update(css).digest("hex")}`;
  if (cache.has(key)) return cache.get(key);
  const scope = `[data-app-style="${appId}"]`;
  const own = (name) => `a${appId}-${name}`.replace(/[^\w-]/gu, "");
  const root = postcss.parse(css);
  const animations = new Set();
  const fonts = new Set();
  root.walkAtRules((rule) => {
    if (/keyframes$/iu.test(rule.name)) {
      animations.add(rule.params.trim());
      rule.params = own(rule.params.trim());
    }
  });
  root.walkAtRules("font-face", (rule) => rule.walkDecls(/^font-family$/iu, (decl) => {
    const name = decl.value.trim().replace(/^['"]|['"]$/gu, "");
    fonts.add(name);
    decl.value = `"${own(name)}"`;
  }));
  const scoper = selectorParser((selectors) => {
    selectors.each((selector) => {
      const first = selector.first;
      const isRoot =
        first &&
        ((first.type === "pseudo" && first.value === ":root") ||
          (first.type === "tag" && ["html", "body"].includes(first.value.toLowerCase())));
      const attribute = selectorParser.attribute({
        attribute: "data-app-style",
        operator: "=",
        value: appId,
        quoteMark: '"',
        raws: { value: `"${appId}"` }
      });
      if (isRoot) {
        first.replaceWith(attribute);
      } else {
        selector.prepend(selectorParser.combinator({ value: " " }));
        selector.prepend(attribute);
      }
    });
  });
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/iu.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map((selector) => scoper.processSync(selector.trim()));
  });
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if ((prop === "animation" || prop === "animation-name") && animations.size) {
      decl.value = decl.value
        .split(",")
        .map((part) => part.replace(/[\w-]+/gu, (word) => (animations.has(word) ? own(word) : word)))
        .join(",");
    }
    if (
      (prop === "font-family" || prop === "font") &&
      fonts.size &&
      !(decl.parent?.type === "atrule" && decl.parent.name === "font-face")
    ) {
      for (const name of fonts) {
        decl.value = decl.value
          .replaceAll(`"${name}"`, `"${own(name)}"`)
          .replaceAll(`'${name}'`, `"${own(name)}"`)
          .replace(new RegExp(`(^|,\\s*)${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=\\s*(,|$))`, "gu"), `$1"${own(name)}"`);
      }
    }
  });
  const out = `${scope} { contain: paint; isolation: isolate; }\n${root.toString()}`;
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}
