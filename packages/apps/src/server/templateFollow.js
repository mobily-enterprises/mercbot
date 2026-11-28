import { templateSummaries, templateVersionNow, updateFromTemplate } from "./templates.js";

// Apps follow their template (D-141, the owner, 28 Nov): an app made from a ready-made template and never changed takes
// each new version of it, published at once, the next time its home's apps are read (as the sidebar does when the home
// opens), so a template that improves improves every app that follows it. One whose screens or scripts were changed is
// a fork (apps.forkedAt): it keeps its changes, and its home is told its template has an update, which the Builder
// merges. An update whose draft doesn't pass its save check (a home's own table that clashes) makes the app a fork too,
// at the version it had, for the Builder.
const MERCBOT = Object.freeze({ type: "system", id: null, name: "Mercbot" });
// The templates this server carries, and each one's version now, as the apps' query compares them.
const KEYS = Object.freeze(templateSummaries().map((template) => template.key));
const current = () => KEYS.map((key) => `${key}:${templateVersionNow(key)}`);

/** An app as the home sees it, with whether it's a fork whose template has improved since (`templateUpdate`). */
export function withTemplateState(app) {
  const version = app.forked && app.templateKey ? templateVersionNow(app.templateKey) : null;
  return { ...app, templateUpdate: Boolean(version && version !== app.templateVersion) };
}

/**
 * @param {object} parts
 * @param {object} parts.resources AppsFeature's handles: apps
 * @param {object} parts.apps the app store (createApps)
 * @param {object} parts.updating what updateFromTemplate takes: registry, apps, catalog, scripts
 */
export function createTemplateFollow({ resources, apps, updating }) {
  const { apps: appRows } = resources;

  /**
   * Takes the app's update to `version`, once, whichever page or server asks first: its recorded version moves on under
   * the row's lock, so another finds it current. Answers false when it already was, or when the app was forked meanwhile.
   */
  async function claim(app, version, options) {
    return appRows.withTransaction(options, async (txOptions) => {
      const row = await appRows.lock(String(app.id), txOptions);
      if (row.forkedAt || row.templateVersion !== app.templateVersion) return false;
      await appRows.patch(String(app.id), { templateVersion: version }, { ...txOptions, returning: "none" });
      return true;
    });
  }

  /** An update that didn't go through: the app goes back to the version it had, as a fork for the Builder to bring up. */
  async function giveUp(app, why, options) {
    console.warn(`${app.name} didn't follow its template and is a fork now: ${why}`);
    await appRows.patch(String(app.id), { templateVersion: app.templateVersion, forkedAt: new Date().toISOString() }, { ...options, returning: "none" });
  }

  /**
   * One app's update, claimed: its template's screens and scripts, published as Mercbot when it was live, or a fork if
   * they don't fit.
   */
  async function update(app, options) {
    const ctx = { options, actor: MERCBOT, via: { kind: "template" } };
    try {
      const { errors } = await updateFromTemplate(updating, ctx, app.id);
      if (errors.length) await giveUp(app, errors[0].message, options);
      // Published only when it was live: an app not published yet stays a draft, brought up to date.
      else if (app.liveVersionId) await apps.publish(MERCBOT, app.slug, { canManage: true }, options);
    } catch (error) {
      await giveUp(app, error?.message, options).catch(() => {});
    }
  }

  /**
   * Brings every app of the home that follows its template up to the template's version: one read when all are.
   * The query reads only the apps that follow a template this server carries and are behind its version now. Never fails
   * the read.
   * @param {object} options the call's: the home, as the person opening it
   */
  async function follow(options) {
    try {
      const filters = { fromTemplate: true, forked: false, retired: false, templateKeys: KEYS, behindTemplates: current() };
      for (const app of await appRows.queryAll({ filters }, options)) {
        if (await claim(app, templateVersionNow(app.templateKey), options)) await update(app, options);
      }
    } catch (error) {
      console.warn(`Bringing a home's apps up to their templates failed; it's tried again at the next read: ${error?.message}`);
    }
  }

  return Object.freeze({ follow });
}
