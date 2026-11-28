import { open } from "node:fs/promises";
import { isAppIcon } from "../shared/appIcons.js";
import { homeIdOf } from "./callOptions.js";
import { pictureKind } from "./recordFiles.js";
import { RegistryError } from "./registry.js";

// An app's picture and colour (D-141): the tile it wears on the Apps home, the Templates tab, its own bar and the
// sidebar. Anyone in the home who can change an app's screens can change them; each change is in the activity trail.
// A bot can also draw the app a picture of its own, kept with the home's Database files and shown in place of the set
// picture until a set picture is chosen again.
const COLOUR = /^#[0-9a-f]{6}$/iu;

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps and auditEvents
 * @param {{ find: Function }} dependencies.apps createApps' find, an app or a view by slug or id
 * @param {() => { write: Function, remove: Function } | null} dependencies.files Database files' writer, once the files
 *   feature plugged it in
 */
export function createAppIcon({ resources, apps, files }) {
  const { apps: appRows, auditEvents } = resources;

  /**
   * Sets an app's or a view's `icon` (one of the app icons) and `color` (#RRGGBB), either or both, and answers them.
   * Refused: an icon not in the set (400 `apps_icon_unknown`), another colour (400 `apps_color_invalid`), neither given
   * (400 `apps_icon_nothing`).
   */
  async function set(actor, slugOrId, { icon, color } = {}, options) {
    if (icon === undefined && color === undefined) {
      throw new RegistryError(400, "Choose a picture or a colour.", { code: "apps_icon_nothing" });
    }
    if (icon !== undefined && !isAppIcon(icon)) {
      throw new RegistryError(400, `“${icon}” isn't one of the app pictures.`, { code: "apps_icon_unknown", params: { icon } });
    }
    checkColour(color);
    const app = await apps.find(slugOrId, options);
    // Choosing a set picture takes a bot's picture away.
    const to = { icon: icon ?? app.icon, color: color ?? app.color, picture: icon === undefined ? app.picture : null };
    await save(actor, app, to, options);
    return to;
  }

  /**
   * Puts a bot's picture on an app's or a view's tile: `upload` ({ source, name }, a file the caller may read) must be a
   * PNG, JPEG, GIF or WebP picture (400 `apps_icon_not_picture`), and its `color`, when given, goes on in the same
   * change (400 `apps_color_invalid`). It's kept with the home's Database files; the one it replaces goes. Answers
   * { icon, color, picture }.
   */
  async function putPicture(actor, slugOrId, upload, options) {
    checkColour(upload.color);
    const head = Buffer.alloc(16);
    const handle = await open(upload.source, "r");
    await handle.read(head, 0, 16, 0).finally(() => handle.close());
    if (!pictureKind(head)) throw new RegistryError(400, "An app's picture must be a PNG, JPEG, GIF or WebP picture.", { code: "apps_icon_not_picture" });
    const writer = files();
    if (!writer) throw new RegistryError(503, "Pictures can't be kept right now.", { code: "apps_files_unavailable" });
    const app = await apps.find(slugOrId, options);
    const written = await writer.write(homeIdOf(options), { table: "app-pictures", record: app.id, field: "tile" }, upload.source, upload.name);
    const to = { icon: app.icon, color: upload.color ?? app.color, picture: written.path };
    await save(actor, app, to, options);
    return to;
  }

  /** A colour, when given, is #RRGGBB (400 `apps_color_invalid`). */
  function checkColour(color) {
    if (color !== undefined && !COLOUR.test(String(color))) {
      throw new RegistryError(400, "A colour is written #RRGGBB, such as #1E5BD8.", { code: "apps_color_invalid" });
    }
  }

  /** Writes the tile and its activity entry together, then removes a bot's picture the tile no longer shows. */
  async function save(actor, app, to, options) {
    await appRows.withTransaction(options, async (txOptions) => {
      await appRows.patch(app.id, to, { ...txOptions, returning: "none" });
      await auditEvents.create(
        { actor, via: { kind: "app", appId: app.id }, action: "app", changes: { icon: { name: app.name, from: { icon: app.icon, color: app.color, picture: app.picture }, to } } },
        { ...txOptions, returning: "none" }
      );
    });
    if (app.picture && app.picture !== to.picture) {
      await files()?.remove(homeIdOf(options), app.picture).catch((error) => console.warn(`An app's old picture stays in Database files: ${error?.message}`));
    }
  }

  return Object.freeze({
    set,
    putPicture
  });
}
