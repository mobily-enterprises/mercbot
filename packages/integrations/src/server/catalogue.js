import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** @typedef {Awaited<ReturnType<typeof loadCatalogue>>} Catalogue */

/**
 * An app's skill (D-34): how a bot uses it, from the maker's own documentation,
 * written like the bots' skills: a `name:` and `description:` (the
 * skill plugin.json lists), then `---` and the guidance, which reaches the bot with the app's actions.
 * @param {string} file
 * @returns {Promise<string | null>}
 */
async function readSkill(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split(/^---$/mu).slice(1).join("---").trim() || null;
}

/**
 * The catalogue (docs/architecture.md §3.6, D-33): the apps Mercbot connects to, one
 * plugins/<id>/plugin.json folder each, plus plugins/coming-soon.json for apps on the owner's list
 * whose connection isn't built yet. Every app has one or two categories, a badge (b, ✓ or ★, set
 * by the owner's tests) and a rank, the owner's order, which also picks "Recommended for you".
 * @param {string} [root]
 */
export async function loadCatalogue(root = path.resolve(process.cwd(), "plugins")) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const plugin = JSON.parse(await readFile(path.join(root, entry.name, "plugin.json"), "utf8"));
      // An app with no sign-in set up yet can't be connected, so it's coming soon like the apps on
      // the owner's list: Add records interest instead of adding something that can't work. An app
      // that hosts its own connection point signs in through the general connector (D-34).
      if (plugin.id === entry.name) {
        const guide = plugin.mcp ? await readSkill(path.join(root, entry.name, "skill.md")) : null;
        plugins.push(
          plugin.oauth || plugin.mcp || plugin.soon
            ? { ...plugin, ...(guide ? { guide } : {}) }
            : { ...plugin, soon: true, info: { ...plugin.info, availability: "Coming soon" } }
        );
      }
    } catch {
      // A folder without a valid plugin.json isn't listed.
    }
  }
  const built = new Set(plugins.map((plugin) => plugin.id));
  const soon = JSON.parse(await readFile(path.join(root, "coming-soon.json"), "utf8").catch(() => "[]"));
  for (const app of soon) {
    if (built.has(app.id)) continue;
    plugins.push({
      ...app,
      kind: "add",
      soon: true,
      recommended: false,
      connectors: [],
      skills: [],
      info: {
        capabilities: "Not connected yet: the connection is being prepared",
        developer: app.name,
        website: null,
        availability: "Coming soon"
      }
    });
  }
  // Apps without an open-set logo use their maker's own site icon, kept in plugins/logos (D-34).
  const images = new Set((await readdir(path.join(root, "logos")).catch(() => [])).map((file) => file.replace(/\.png$/u, "")));
  return plugins
    .map((plugin) => {
      const categories = plugin.categories || [plugin.category];
      const image = !plugin.logo && images.has(plugin.id) ? { logoImage: `/api/plugins/${plugin.id}/logo.png` } : {};
      return { badge: "b", rank: 10000, ...plugin, ...image, categories, category: categories[0] };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// App logos from Simple Icons (CC0; each mark stays its company's trademark), as an SVG in the
// brand's colour: the mark in white, or in black on a light brand colour. Its single 5 MB module
// loads with the first logo asked for, not with every server start.
let bySlug = null;
function iconsBySlug() {
  bySlug ??= import("simple-icons").then(
    (icons) => new Map(Object.values(icons).filter((icon) => icon?.slug).map((icon) => [icon.slug, icon])),
    (error) => {
      bySlug = null;
      throw error;
    }
  );
  return bySlug;
}

/**
 * The SVG of a Simple Icons mark, over its colour tile with `tile`.
 * @param {string | undefined} slug
 * @param {boolean} tile
 */
async function iconSvg(slug, tile) {
  const icon = (await iconsBySlug()).get(String(slug || ""));
  if (!icon) return null;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(icon.hex.slice(at, at + 2), 16) / 255);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
  const mark = `<path fill="${light ? "#000000" : "#FFFFFF"}" d="${icon.path}"${tile ? ' transform="translate(5 5) scale(0.5833)"' : ""}/>`;
  const title = `<title>${icon.title.replace(/[<&]/gu, "")}</title>`;
  const background = tile ? `<rect width="24" height="24" rx="6" fill="#${icon.hex}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${title}${background}${mark}</svg>`;
}

/**
 * An app's logo: its mark alone.
 * @param {string | undefined} slug
 */
export async function logoSvg(slug) {
  return iconSvg(slug, false);
}

/**
 * An app's logo with its colour tile drawn in, for places that show the logo on its own (a link chip).
 * @param {string | undefined} slug
 */
export async function tileLogoSvg(slug) {
  return iconSvg(slug, true);
}
