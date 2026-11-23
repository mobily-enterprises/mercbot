// Every home starts with two mini apps on the shared tables, Contacts and To-dos (D-130): empty, published, the first
// time the home is opened (a new home is opened as soon as it's made; one made before them, at its next open). The home's
// app settings note when it got them, so they're added once, whoever opens it and however many pages ask at once. A
// failure never stops the home from opening: it's logged and tried again at the next open.
const STARTERS = ["contacts", "todos"];
const MERCBOT = Object.freeze({ type: "system", id: null, name: "Mercbot" });

/**
 * @param {object} dependencies
 * @param {object} dependencies.appSettings the home's app settings rows
 * @param {(ctx: object, key: string, settings?: object) => Promise<{ app: object, errors: object[] }>} dependencies.installTemplate
 * @param {{ publish: Function }} dependencies.apps the app store
 */
export function createStarterApps({ appSettings, installTemplate, apps }) {
  const settingsOf = async (options) => (await appSettings.query({ page: { size: 1 } }, options)).records[0] ?? null;

  /** Takes the home's turn to add them: true once, for the first caller; false when they were added already. */
  async function claim(options) {
    return appSettings.withTransaction(options, async (txOptions) => {
      await appSettings.createMany([{}], { ...txOptions, onConflict: { keys: ["workspaceId"], action: "ignore" }, returning: "none" });
      const settings = await appSettings.lock((await settingsOf(txOptions)).id, txOptions);
      if (settings.starterAppsAt) return false;
      await appSettings.patch(settings.id, { starterAppsAt: new Date().toISOString() }, { ...txOptions, returning: "none" });
      return true;
    });
  }

  /**
   * The home's starter apps, made the first time it's opened: one read when they're there already.
   * @param {object} options the call's options: the home, as the person opening it
   */
  async function ensure(options) {
    try {
      if ((await settingsOf(options))?.starterAppsAt || !(await claim(options))) return;
    } catch (error) {
      console.warn(`Checking a home's starter apps failed; they're checked again at its next open: ${error?.message}`);
      return;
    }
    try {
      const ctx = { options, actor: MERCBOT, via: { kind: "template" } };
      for (const key of STARTERS) {
        const { app, errors } = await installTemplate(ctx, key);
        // A home whose own tables clash keeps the draft for its Builder; the others go live at once.
        if (errors.length) console.warn(`The ${key} starter app is a draft in this home: ${errors[0].message}`);
        else await apps.publish(MERCBOT, app.slug, {}, options);
      }
    } catch (error) {
      console.warn(`Adding a home's starter apps failed; they're tried again at its next open: ${error?.message}`);
      const settings = await settingsOf(options);
      if (settings) await appSettings.patch(settings.id, { starterAppsAt: null }, { ...options, returning: "none" }).catch(() => {});
    }
  }

  return Object.freeze({
    ensure
  });
}
