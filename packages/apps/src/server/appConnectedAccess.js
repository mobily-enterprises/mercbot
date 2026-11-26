import { RegistryError } from "./registry.js";

/** Refused both ways (D-136): an app whose scripts use connected apps or AI is internal only, never public. */
export const internalOnly = (app) =>
  new RegistryError(409, `“${app.name}” uses connected apps or AI, so it stays inside the home: a public app can't use them.`, {
    code: "apps_connected_public",
    params: { app: app.name }
  });

/**
 * The connected apps an app's scripts may use (D-136): plugin ids, and "ai" for bots and pictures, as the home's owners
 * and admins choose them (the route checks who), kept on the app's row. Built by createAppsRuntime.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps and auditEvents.
 * @param {import("./types.js").AppStore} dependencies.apps createApps' find and notAView
 * @param {() => { usable: (pluginId: string) => boolean }} dependencies.connected connected apps for scripts, read at
 *   call time
 */
export function createAppConnectedAccess({ resources, apps, connected }) {
  const { apps: appRows, auditEvents } = resources;

  /** Allows exactly `given` for the app, refusing an id that isn't a usable connected app, and any for a public app. */
  async function allowConnected(actor, slugOrId, given, options) {
    const wanted = [...new Set(Array.isArray(given) ? given.map(String) : [])].sort();
    const unknown = wanted.find((id) => id !== "ai" && !connected().usable(id));
    if (unknown !== undefined) {
      throw new RegistryError(400, `"${unknown}" isn't a connected app scripts can use.`, {
        code: "apps_connected_unknown",
        params: { app: unknown }
      });
    }
    return appRows.withTransaction(options, async (txOptions) => {
      const app = await apps.find(slugOrId, txOptions);
      apps.notAView(app, "have scripts");
      if (wanted.length && app.publicAt) throw internalOnly(app);
      await appRows.patch(app.id, { connectedAccess: wanted }, { ...txOptions, returning: "none" });
      await auditEvents.create(
        { actor, via: { kind: "app", appId: app.id }, action: "schema", changes: { connectedAccess: wanted } },
        { ...txOptions, returning: "none" }
      );
      return wanted;
    });
  }

  /**
   * What the app's Scripts tab shows: the connected apps it may use, the home's connected apps to choose from (and
   * "ai"), and whether it is public, when it can use none.
   */
  async function forApp(slugOrId, options) {
    const app = await apps.find(slugOrId, options);
    return { allowed: app.connectedAccess || [], choices: await connected().choices(options), isPublic: Boolean(app.publicAt) };
  }

  return Object.freeze({
    forApp,
    allowConnected
  });
}
