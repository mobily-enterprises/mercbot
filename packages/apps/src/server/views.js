import { passedOn } from "@jskit-ai/resource-runtime/server";
import { checkView, viewBody, viewDefinition } from "../shared/check.js";
import { toIds, toNames } from "../shared/definitions.js";
import { liveAndDraftVersions } from "./apps.js";
import { homeIdOf } from "./callOptions.js";
import { checkStyle } from "./appStyle.js";
import { RegistryError } from "./registry.js";

const notFound = (key) => new RegistryError(404, `No view "${key}".`, { code: "apps_view_not_found", params: { view: key } });
const names = (apps) => [...new Set(apps.map((app) => app.name))].join(", ");
const sameParams = (a, b) => JSON.stringify(Object.keys(a || {}).sort()) === JSON.stringify(Object.keys(b || {}).sort());

/**
 * Views (D-55): a one-screen, read-only app any bot saves at once, kept as an `apps` row. Each save is
 * the next live version. Everyone in the home and every bot sees every view (D-66); people restore,
 * retire and bring it back through the routes, and nothing is ever deleted (D-62). An app shares a
 * view, showing its current version, or keeps a copy of it as its own screen, which is offered the
 * newer version when there is one. Every method takes the call's options last.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the apps
 *   feature's handles
 * @param {{ directory: { findBot: Function } }} dependencies.records mercbot.bots.records
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext AppsFeature's
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {import("./types.js").AppStore} dependencies.apps
 * @param {import("./types.js").AppRuntime} dependencies.runtime
 */
export function createViews({ resources, records, systemContext, registry, apps, runtime }) {
  const { apps: appRows, appVersions, appPins, auditEvents } = resources;

  /** A view by key or id; anything else in the home isn't one. */
  async function find(key, options) {
    const row = await apps.find(key, options).catch(() => null);
    if (row?.kind !== "view") throw notFound(key);
    return row;
  }

  /** The apps that show a view: live or in draft, sharing it, or holding a copy of it. */
  async function usesOf(viewId, options) {
    const shared = [];
    const copies = [];
    for (const [{ name, slug }, { definition }] of await liveAndDraftVersions(resources, { kind: "app" }, options)) {
      for (const { copiedFrom, ...screen } of Object.values(definition?.screens || {})) {
        if (copiedFrom?.view === viewId) copies.push({ name, slug });
        if (JSON.stringify(screen).includes(`"view":"${viewId}"`)) shared.push({ name, slug });
      }
    }
    return { shared, copies };
  }

  /** The live version of a view as a bot reads it. */
  async function read(row, options) {
    const version = row.liveVersionId
      ? await appVersions.get(String(row.liveVersionId), {}, { ...passedOn(options), missing: "skip" })
      : null;
    const tables = await registry.loadTables(options);
    return { version, body: version ? viewBody(toNames(version.definition, tables)) : {} };
  }

  /** The home's views with their live versions, in two reads however many there are. */
  async function list(options) {
    const views = await appRows.queryAll({ filters: { kind: "view", retired: false }, sort: ["name"] }, passedOn(options));
    const ids = views.map((view) => view.liveVersionId).filter(Boolean).map(String);
    const versions = ids.length ? await appVersions.queryAll({ filters: { id: ids } }, passedOn(options)) : [];
    const byId = new Map(versions.map((version) => [String(version.id), version]));
    const tables = await registry.loadTables(options);
    return views.map((view) => {
      const version = view.liveVersionId ? byId.get(String(view.liveVersionId)) : null;
      const body = version ? viewBody(toNames(version.definition, tables)) : {};
      return { view: view.slug, title: view.name, summary: version?.summary || "", params: Object.keys(body.params || {}) };
    });
  }

  async function get(key, options) {
    const row = await find(key, options);
    const { version, body } = await read(row, options);
    return { view: row.slug, title: row.name, summary: version?.summary || "", version: version?.number ?? null, definition: body };
  }

  /** Every query of a saved view once, so whoever saved it hears what doesn't load. */
  async function queriesThatFail(ctx, slug, definition) {
    const problems = [];
    for (const query of Object.keys(definition.data || {})) {
      try {
        const loaded = await runtime.query(ctx, { slug, version: "live", screen: "main", query });
        if (loaded?.needsAttention) problems.push(`Query ${query}: a table or field it uses doesn't exist.`);
      } catch (error) {
        problems.push(`Query ${query}: ${error?.message || error}`);
      }
    }
    return problems;
  }

  /**
   * Makes a view, or the next version of one. The last argument says who made it: the person (null
   * for nobody in particular), the bot, and whether it's the Builder. `ctx.options` are the call's options.
   */
  async function save(ctx, { view, title, summary = "", icon, definition }, { userId, botId, isBuilder = false }) {
    const { actor, options } = ctx;
    const tables = await registry.loadTables(options);
    const errors = [...checkView(definition, tables), ...(definition && typeof definition === "object" ? checkStyle(definition.style).errors : [])];
    if (errors.length) return { errors };
    const stored = toIds(viewDefinition(definition), tables).definition;
    const name = String(title).trim().slice(0, 80);
    let row;
    if (view) {
      row = await find(view, options);
      const uses = await usesOf(row.id, options);
      if (uses.shared.length && !isBuilder) {
        return { errors: [{ path: "view", message: `Only the Builder can change this view, because ${names(uses.shared)} shows it. Ask the Builder, or make a new view.` }] };
      }
      const { body } = await read(row, options);
      if (uses.shared.length && !sameParams(body.params, definition.params)) {
        return { errors: [{ path: "params", message: `${names(uses.shared)} shows this view, so its parameters can't change. Make a new view instead.` }] };
      }
    } else {
      const made = await apps.createApp(actor, { name, icon, kind: "view", madeByUserId: userId, madeByBotId: botId }, options);
      row = await find(made.id, options);
    }
    const saved = await appRows.withTransaction(options, async (txOptions) => {
      await appRows.patch(row.id, { name, ...(icon ? { icon } : {}) }, { ...txOptions, returning: "none" });
      return apps.addVersion(row, actor, stored, String(summary).slice(0, 2000), "builder", txOptions);
    });
    return {
      errors: [],
      view: { id: row.id, key: row.slug, title: name, summary, version: saved.number },
      problems: await queriesThatFail(ctx, row.slug, definition),
      copies: [...new Set((await usesOf(row.id, options)).copies.map((app) => app.name))]
    };
  }

  function checkNotShared(uses, what) {
    if (!uses.shared.length) return;
    throw new RegistryError(409, `${names(uses.shared)} shows this view, so it can't ${what}.`, { code: "apps_view_in_use", params: { apps: names(uses.shared) } });
  }

  /** People's Restore: refused when it would change the parameters of a view an app shows. */
  async function restore(actor, key, versionId, options) {
    const row = await find(key, options);
    const uses = await usesOf(row.id, options);
    if (uses.shared.length) {
      const { records: [old] } = await appVersions.query(
        { filters: { id: String(versionId ?? ""), appId: row.id }, page: { size: 1 } },
        passedOn(options)
      );
      const { version } = await read(row, options);
      if (old && !sameParams(old.definition?.screens?.main?.params, version?.definition?.screens?.main?.params)) {
        throw new RegistryError(409, `${names(uses.shared)} shows this view, and that version has different parameters.`, { code: "apps_view_params_in_use" });
      }
    }
    return apps.restore(actor, row.id, versionId, {}, options);
  }

  /**
   * Retiring a view (D-62): it leaves the Apps area, search, pins and the save check, but its row,
   * versions and key stay. Refused while an app shares it; an app's copy stays as it is. Anyone in
   * the home may retire one or bring it back (D-66): both are audited and can be undone. It leaves
   * everyone's pins, which are each person's own rows: the home's system context removes them, once
   * this person may retire it.
   */
  async function retire(person, key, options) {
    const row = await find(key, options);
    checkNotShared(await usesOf(row.id, options), "be retired");
    await appRows.withTransaction(options, async (txOptions) => {
      await appRows.patch(row.id, { retiredAt: new Date().toISOString() }, { ...txOptions, returning: "none" });
      // Everyone's pins of this view: each pin belongs to its person, so a context derived for the home (which names
      // no person) cannot reach them; the filter names the view and this home.
      const everyone = systemContext("a retired view leaves everyone's pins");
      await appPins.deleteWhere({ appId: row.id, workspaceId: homeIdOf(txOptions) }, { ...txOptions, context: everyone });
      await auditEvents.create({
        actor: person.actor,
        via: { kind: "app" },
        action: "app",
        changes: { retiredView: { name: row.name, slug: row.slug } }
      }, { ...txOptions, returning: "none" });
    });
    return { retired: row.slug };
  }

  /** The home's retired views, to bring back (D-62). */
  async function retired(options) {
    const views = await appRows.queryAll({ filters: { kind: "view", retired: true }, sort: ["-retiredAt"] }, passedOn(options));
    return views.map((view) => ({ view: view.slug, title: view.name, icon: view.icon, color: view.color, retiredAt: view.retiredAt }));
  }

  /**
   * Bringing a retired view back (D-62), as it was, with its versions. If an app or view now has its
   * name, it comes back under the next free one, "Deals (2)", so two never look alike. The home's
   * live apps are locked first, so two views brought back together take different names.
   */
  async function bringBack(person, key, options) {
    const { records: [row] } = await appRows.query(
      { filters: { kind: "view", retired: true, slugOrId: String(key) }, page: { size: 1 } },
      passedOn(options)
    );
    if (!row) throw notFound(key);
    return appRows.withTransaction(options, async (txOptions) => {
      await appRows.lockWhere({ retired: false }, { ...txOptions, fields: ["id"] });
      const live = await appRows.queryAll({ filters: { retired: false } }, { ...txOptions, fields: ["name"] });
      const taken = new Set(live.map((app) => app.name.toLowerCase()));
      let name = row.name;
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${row.name.slice(0, 72)} (${n})`;
      await appRows.patch(row.id, { retiredAt: null, name }, { ...txOptions, returning: "none" });
      await auditEvents.create({
        actor: person.actor,
        via: { kind: "app" },
        action: "app",
        changes: { broughtBackView: { name, slug: row.slug, ...(name === row.name ? {} : { was: row.name }) } }
      }, { ...txOptions, returning: "none" });
      return { view: row.slug, title: name, renamed: name !== row.name };
    });
  }

  /** For the viewer and the card: who to ask about a view. */
  async function details(app, options) {
    const bot = app.madeByBotId ? await records.directory.findBot(String(app.madeByBotId), passedOn(options)) : null;
    return { bot: bot ? { id: String(bot.id), name: bot.name } : null };
  }

  /** The copies in an app's definition (by names) whose original has a newer version it could take. */
  async function copyUpdates(definition, options) {
    const copied = Object.entries(definition?.screens || {}).filter(([, screen]) => screen?.copiedFrom?.view);
    if (!copied.length) return [];
    const views = await apps.viewsOf(options, { keys: copied.map(([, screen]) => screen.copiedFrom.view) });
    return copied.flatMap(([screen, { copiedFrom }]) => {
      const view = views.find((entry) => entry.key === copiedFrom.view);
      if (!view || view.number <= copiedFrom.version) return [];
      return [{ screen, view: view.key, title: view.title, from: copiedFrom.version, to: view.number }];
    });
  }

  /** Puts the original's newer version in the app's draft, for a person to preview and publish. */
  async function updateCopy(actor, slug, screen, options) {
    const { definition } = await apps.get(slug, { version: "draft" }, options);
    const copiedFrom = definition?.screens?.[screen]?.copiedFrom;
    const [view] = copiedFrom?.view ? await apps.viewsOf(options, { keys: [copiedFrom.view] }) : [];
    if (!view) throw new RegistryError(404, "That copy's original isn't available any more.", { code: "apps_view_original_gone" });
    const copy = { ...view.body, copiedFrom: { view: view.key, version: view.number } };
    const next = { ...definition, screens: { ...definition.screens, [screen]: copy } };
    const { errors } = await apps.saveDraft(actor, slug, next, `Updated its copy of the view ${view.title} to version ${view.number}`, options);
    if (errors.length) {
      throw new RegistryError(409, `This app can't take the new version yet: ${errors[0].path}: ${errors[0].message} Ask the Builder.`, { code: "apps_view_copy_refused" });
    }
    return { draft: true };
  }

  return Object.freeze({
    list,
    get,
    save,
    restore,
    retire,
    retired,
    bringBack,
    details,
    copyUpdates,
    updateCopy,
    usesOf
  });
}
