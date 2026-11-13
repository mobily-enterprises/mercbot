import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { publishIn } from "@local/notices/server/publishIn";
import { calculatedUsing, isCalculated } from "../shared/calculated.js";
import { ICONS, checkApp, viewBody, withCopies } from "../shared/check.js";
import { checkTheme, effectiveTheme } from "../shared/theme/index.js";
import { checkStyle } from "./appStyle.js";
import { mapBots, mapViews, toIds, toNames } from "../shared/definitions.js";
import { removeFieldFromApp } from "../shared/removal.js";
import { listedStored } from "../shared/visitorAccess.js";
import { createAppVisitorAccess } from "./appVisitorAccess.js";
import { homeIdOf } from "./callOptions.js";
import { RegistryError, newId } from "./registry.js";

const COLOR = /^#[0-9a-f]{6}$/iu;
// How many versions a page of an app's version list holds.
const VERSIONS_PAGE = 50;
// Route names under /apps can't be app slugs.
const ROUTE_NAMES = ["builder", "pins", "data", "watches", "retired"];

const slugFrom = (name) =>
  String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "app";

const withoutStyle = ({ style: _style, ...body }) => body;

/** An app record (the apps handle's) as people and bots see it. */
const toApp = (record) => ({
  id: record.id,
  slug: record.slug,
  kind: record.kind ?? "app",
  name: record.name,
  icon: record.icon,
  color: record.color,
  visibility: record.visibility,
  liveVersionId: record.liveVersionId ? String(record.liveVersionId) : null,
  draftVersionId: record.draftVersionId ? String(record.draftVersionId) : null,
  publicAt: record.publicAt ?? null,
  madeByBotId: record.madeByBotId ? String(record.madeByBotId) : null,
  madeByUserId: record.madeByUserId ? String(record.madeByUserId) : null,
  themeOverride: record.theme ?? null,
  updatedAt: record.updatedAt
});

/**
 * The live and draft versions of the apps the filters select, as [app, version] pairs: the apps, then
 * their versions in one read.
 * @param {{ apps: object, appVersions: object }} resources the apps and app versions handles
 * @param {object} filters
 * @param {object} options
 */
export async function liveAndDraftVersions({ apps, appVersions }, filters, options) {
  const found = await apps.queryAll({ filters }, passedOn(options));
  const ids = found.flatMap((app) => [app.liveVersionId, app.draftVersionId]).filter(Boolean).map(String);
  const versions = ids.length ? await appVersions.queryAll({ filters: { id: ids } }, passedOn(options)) : [];
  const byId = new Map(versions.map((version) => [String(version.id), version]));
  return found.flatMap((app) => [app.liveVersionId, app.draftVersionId]
    .filter(Boolean)
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((version) => [app, version]));
}

/**
 * A home's apps: their versions, their look and the Builder (D-35). Everyone in the home uses every one (D-66).
 *
 * Apps of a home and their versions (D-35). Definitions are stored by ids and handed out by name.
 * The Builder's changes go into one draft; a person publishes it as the next numbered version.
 * Published versions are kept and can be restored (as a new version). Every method takes the call's
 * options last: the handles keep each read and write in the home they name.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the apps
 *   feature's handles
 * @param {{ directory: { listHomeBots: Function, findBot: Function } }} dependencies.records mercbot.bots.records
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {import("./types.js").Anyapi} dependencies.anyapi
 * @param {import("./types.js").Practices} dependencies.practices drafts' practice copies (D-71), cleared on publishing
 */
export function createApps({ resources, records, registry, anyapi, practices }) {
  const { apps: appRows, appVersions, appScripts, appPins, appSettings, appThemes, appFields, appTables, auditEvents, appJobs } = resources;

  /** What only an app does (a draft, publishing, public screens, scripts, rooms): a view refuses it. */
  function notAView(app, what) {
    if (app.kind === "view") throw new RegistryError(409, `A view can't ${what}.`, { code: "apps_view_refused", params: { what } });
  }

  const audit = (entry, txOptions) => auditEvents.create(entry, { ...txOptions, returning: "none" });

  /** An app or view of the home by slug or id; a retired view (D-62) keeps its row and key, but nothing finds it any more. */
  async function find(slugOrId, options) {
    const { records: found } = await appRows.query(
      { filters: { slugOrId: String(slugOrId), retired: false }, page: { size: 1 } },
      passedOn(options)
    );
    if (!found[0]) throw new RegistryError(404, `No app "${slugOrId}".`, { code: "apps_app_not_found", params: { app: slugOrId } });
    return found[0];
  }

  /**
   * The home's app at this public address (its slug) while it is public, else null. Whether it is live and what
   * visitors reach of it is for whoever serves its visitors to check.
   */
  async function findPublic(slug, options) {
    const { records } = await appRows.query({ filters: { slug: String(slug) }, page: { size: 1 } }, passedOn(options));
    return records[0]?.publicAt ? records[0] : null;
  }

  /**
   * The home's apps and views, which everyone in it uses (D-66), with this person's pins (`withPins: false` for a bot);
   * `kind` ("app" or "view") keeps one kind.
   */
  async function list({ withPins = true, kind = null } = {}, options) {
    const found = await appRows.queryAll({ filters: { retired: false, ...(kind ? { kind } : {}) }, sort: ["name"] }, passedOn(options));
    const pins = withPins ? await appPins.queryAll({ sort: ["position"] }, passedOn(options)) : [];
    return { apps: found.map(toApp), pins: pins.map((pin) => pin.appId) };
  }

  /** One app or view of the home by id, retired or not (`kind` narrows it), for the bots' rooms and settings. */
  async function findApp(appId, options, { kind } = {}) {
    const { records: [app] } = await appRows.query(
      { filters: { id: String(appId || ""), ...(kind ? { kind } : {}) }, page: { size: 1 } },
      { ...passedOn(options), fields: ["id", "name", "slug", "kind"] }
    );
    return app ? { id: app.id, name: app.name, slug: app.slug, kind: app.kind ?? "app" } : null;
  }

  /** The home's views whose name has the text, in name order (D-55): every one, whoever's chat made it (D-66). */
  async function searchViews(text, options, { limit = 5 } = {}) {
    const { records: views } = await appRows.query(
      { filters: { kind: "view", retired: false, nameHas: String(text) }, sort: ["name"], page: { size: limit } },
      { ...passedOn(options), fields: ["slug", "name"] }
    );
    return views.map(({ slug, name }) => ({ slug, name }));
  }

  /**
   * A new app or view, under the next free slug of its name. The apps already under that name are
   * locked first, so two saved together take turns and the second takes the next slug; only a
   * name's first two can still race for its slug, and the loser's retry reads the winner's.
   */
  async function createApp(actor, input = {}, options) {
    const name = String(input.name || "").trim().slice(0, 80);
    if (!name) throw new RegistryError(400, "An app needs a name.", { code: "apps_app_name_missing" });
    const icon = ICONS.includes(input.icon) ? input.icon : "star";
    const color = COLOR.test(String(input.color || "")) ? input.color : "#1f1f1f";
    const base = ROUTE_NAMES.includes(slugFrom(name)) ? `${slugFrom(name)}-app` : slugFrom(name);
    const made = input.kind === "view"
      ? { kind: "view", madeByUserId: input.madeByUserId ?? null, madeByBotId: input.madeByBotId ?? null }
      : {};
    return retryLostInsertRace(options, () => appRows.withTransaction(options, async (txOptions) => {
      const taken = new Set((await appRows.lockWhere({ slugFamily: base }, { ...txOptions, fields: ["slug"] })).map((app) => app.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
      const row = { id: newId("a"), slug, name, icon, color, ...made };
      await appRows.create(row, { ...txOptions, returning: "none" });
      await audit({ actor, via: { kind: "app", appId: row.id }, action: "app", changes: { createdApp: { slug, name } } }, txOptions);
      return toApp({ ...row, visibility: "internal" });
    }));
  }

  /** The home's bots that a button can hand a task to (not group chats), in id order. */
  const botsOf = (options) => records.directory.listHomeBots(passedOn(options));

  /** One bot of the home that a button can hand a task to (not a group chat) by its id, or null. */
  const botOf = async (botId, options) =>
    (/^\d+$/u.test(String(botId ?? "")) ? records.directory.findBot(String(botId), passedOn(options), { kind: "bot" }) : null);

  /**
   * version: "live" (default), "draft" (falls back to live), or a version id.
   * Hand-off steps are stored with bot ids; people and the Builder see names. The runtime asks
   * for ids (`botNames: false`).
   */
  async function get(slugOrId, { version = "live", botNames = true } = {}, options) {
    const app = await find(slugOrId, options);
    const versionId =
      version === "draft" ? app.draftVersionId || app.liveVersionId : version === "live" ? app.liveVersionId : version;
    const versionQuery = { filters: { id: String(versionId), appId: app.id }, page: { size: 1 } };
    const row = versionId ? (await appVersions.query(versionQuery, passedOn(options))).records[0] ?? null : null;
    const tables = await registry.loadTables(options);
    const definition = row ? await namedViews(await namedBots(toNames(row.definition, tables), botNames, options), options) : null;
    return {
      app: toApp(app),
      version: row ? { id: String(row.id), number: row.number, draft: !row.publishedAt, summary: row.summary } : null,
      definition,
      tables
    };
  }

  /**
   * The home's views with their live version: by names, for the save check and copies (D-55). `keys` (view keys)
   * keeps the views named there, and reads only their versions.
   */
  async function viewsOf(options, { keys = null } = {}) {
    if (keys && !keys.length) return [];
    const filters = { kind: "view", retired: false, live: true, ...(keys ? { slugs: keys.map(String) } : {}) };
    const views = await appRows.queryAll({ filters }, passedOn(options));
    const viewByVersion = new Map(views.map((view) => [String(view.liveVersionId), view]));
    const versions = viewByVersion.size
      ? await appVersions.queryAll({ filters: { id: [...viewByVersion.keys()] } }, passedOn(options))
      : [];
    const tables = await registry.loadTables(options);
    return versions.map(({ id, number, definition }) => {
      const view = viewByVersion.get(String(id));
      const body = viewBody(toNames(definition, tables));
      return { id: view.id, key: view.slug, title: view.name, number, params: body.params || {}, body: withoutStyle(body) };
    });
  }

  /**
   * A view part or a copy shows its view by key (the view may have gone: then it's left as it is). Only the views the
   * definition names are read, retired ones too.
   */
  async function namedViews(definition, options) {
    const ids = new Set();
    mapViews(definition, (id) => (ids.add(id), id));
    if (!ids.size) return definition;
    const views = await appRows.queryAll({ filters: { kind: "view", id: [...ids] }, fields: ["slug"] }, passedOn(options));
    const keys = new Map(views.map((view) => [view.id, view.slug]));
    return mapViews(definition, (id) => keys.get(id) ?? null);
  }

  async function namedBots(definition, botNames, options) {
    if (!botNames) return definition;
    const names = new Map((await botsOf(options)).map((bot) => [String(bot.id), bot.name]));
    return mapBots(definition, (id) => names.get(String(id)) ?? "(removed bot)").definition;
  }

  async function saveDraft(actor, slugOrId, definition, summary = "", options) {
    const tables = await registry.loadTables(options);
    const bots = await botsOf(options);
    const app = await find(slugOrId, options);
    notAView(app, "have a draft");
    const views = await viewsOf(options);
    const expanded = withCopies(definition, views);
    const scripts = (await appScripts.queryAll({ filters: { appId: app.id } }, passedOn(options))).map((script) => ({
      key: script.key,
      kind: script.kind,
      params: script.settings?.params || []
    }));
    const errors = [
      ...checkApp(expanded, tables, { bots: bots.map((bot) => bot.name), scripts, views }),
      ...checkStyle(expanded?.style).errors
    ];
    if (errors.length) return { errors };
    const ids = new Map(bots.map((bot) => [bot.name, String(bot.id)]));
    const viewIds = new Map(views.map((view) => [view.key, view.id]));
    const { definition: named } = mapBots(toIds(expanded, tables).definition, (name) => ids.get(name) ?? null);
    const stored = mapViews(named, (key) => viewIds.get(key) ?? null);
    return appVersions.withTransaction(options, async (txOptions) => {
      const current = await find(slugOrId, txOptions);
      const fields = { definition: stored, summary: String(summary).slice(0, 2000), createdBy: actor, kind: "builder" };
      let draftId = current.draftVersionId;
      if (draftId) {
        await appVersions.patch(String(draftId), fields, { ...txOptions, returning: "none" });
      } else {
        draftId = await appVersions.create({ appId: current.id, ...fields }, { ...txOptions, returning: "id" });
        await appRows.patch(current.id, { draftVersionId: String(draftId) }, { ...txOptions, returning: "none" });
      }
      return { errors: [], draftVersionId: String(draftId) };
    });
  }

  /** The next version number of an app: its highest so far, plus one. */
  async function nextNumber(appId, txOptions) {
    const [{ highest = null } = {}] = await appVersions.aggregate({ measures: { highest: { max: "number" } }, filters: { appId } }, txOptions);
    return Number(highest ?? 0) + 1;
  }

  /**
   * A new live version of an app, in the caller's transaction. One at a time for an app, so saves made together each
   * get their own number.
   */
  async function addVersion(app, actor, definition, summary, kind, txOptions) {
    await appRows.lock(app.id, txOptions);
    const number = await nextNumber(app.id, txOptions);
    const id = await appVersions.create(
      { appId: app.id, number, definition, summary, kind, createdBy: actor, publishedAt: new Date().toISOString() },
      { ...txOptions, returning: "id" }
    );
    await appRows.patch(app.id, { liveVersionId: String(id) }, { ...txOptions, returning: "none" });
    await audit({ actor, via: { kind: "app", appId: app.id }, action: "app", changes: { publishedVersion: { number, kind, summary } } }, txOptions);
    return { versionId: String(id), number };
  }

  // What a public app's visitors reach, as people see, narrow and widen it (D-66).
  const visitorAccessOf = createAppVisitorAccess({ resources, registry, find, addVersion, notAView });

  /**
   * Publishing is a person's action; it turns the draft into the next live version. On a public
   * app, wider visitor access needs an owner or admin (`canManage`). The draft's practice copy goes
   * with it (D-71): the live app only ever has the live records.
   */
  async function publish(actor, slugOrId, { canManage = false } = {}, options) {
    return appRows.withTransaction(options, async (txOptions) => {
      const app = await appRows.lock((await find(slugOrId, txOptions)).id, txOptions);
      notAView(app, "be published");
      if (!app.draftVersionId) throw new RegistryError(409, "There is no draft to publish.", { code: "apps_draft_missing" });
      const draft = await appVersions.get(String(app.draftVersionId), {}, txOptions);
      await visitorAccessOf.checkWidening(app, draft.definition, canManage, txOptions);
      const number = await nextNumber(app.id, txOptions);
      await appVersions.patch(String(draft.id), { number, publishedAt: new Date().toISOString(), createdBy: actor }, { ...txOptions, returning: "none" });
      await appRows.patch(app.id, { liveVersionId: String(draft.id), draftVersionId: null }, { ...txOptions, returning: "none" });
      await practices.remove(draft.id, txOptions);
      await audit({
        actor,
        via: { kind: "app", appId: app.id },
        action: "app",
        changes: { publishedVersion: { number, kind: draft.kind, summary: draft.summary } }
      }, txOptions);
      return { versionId: String(draft.id), number };
    });
  }

  /**
   * Restoring makes an earlier version live again, as a new version. One from before visitor access
   * (D-66) comes back with its earlier visitor rules written as visitor access; on a public app,
   * restoring wider visitor access needs an owner or admin, as publishing does.
   */
  async function restore(actor, slugOrId, versionId, { canManage = false } = {}, options) {
    return appRows.withTransaction(options, async (txOptions) => {
      const app = await find(slugOrId, txOptions);
      const { records: [old] } = await appVersions.query(
        { filters: { id: String(versionId ?? ""), appId: app.id, published: true }, page: { size: 1 } },
        txOptions
      );
      if (!old) throw new RegistryError(404, "No such published version.", { code: "apps_version_not_found" });
      const definition = listedStored(old.definition, await registry.loadTables(txOptions));
      await visitorAccessOf.checkWidening(app, definition, canManage, txOptions);
      return addVersion(app, actor, definition, `Restored version ${old.number}`, "restore", txOptions);
    });
  }

  /**
   * An app's versions, newest first, a page at a time: `before` (a version id) gives the page after the
   * one that ended there, and `more` says whether one follows. Each is read without its definition.
   */
  async function versions(slugOrId, { before = null } = {}, options) {
    const app = await find(slugOrId, options);
    const { records: rows, page } = await appVersions.query({
      filters: { appId: app.id, ...(before ? { beforeId: String(before) } : {}) },
      sort: ["-id"],
      fields: ["number", "summary", "kind", "createdBy", "publishedAt"],
      page: { size: VERSIONS_PAGE }
    }, passedOn(options));
    const listed = rows.map((row) => ({
      id: String(row.id),
      number: row.number,
      summary: row.summary,
      kind: row.kind,
      by: row.createdBy,
      publishedAt: row.publishedAt,
      draft: !row.publishedAt,
      live: String(row.id) === String(app.liveVersionId)
    }));
    return { versions: listed, more: page.hasMore };
  }

  /** A person's pinned apps in the home (theirs only: pins are the person's own rows there). */
  async function setPins(appIds = [], options) {
    const asked = [...new Set(Array.isArray(appIds) ? appIds : [])].filter((id) => typeof id === "string");
    // Of the apps asked for, the home's live ones.
    const known = new Set(asked.length
      ? (await appRows.queryAll({ filters: { id: asked, retired: false }, fields: ["slug"] }, passedOn(options))).map((app) => app.id)
      : []);
    const wanted = asked.filter((id) => known.has(id)).slice(0, 8);
    await appPins.withTransaction(options, async (txOptions) => {
      await appPins.deleteWhere({}, { ...txOptions, all: true });
      if (wanted.length) await appPins.createMany(wanted.map((appId, position) => ({ appId, position })), { ...txOptions, returning: "none" });
    });
    return wanted;
  }

  /** The Builder is one bot of the home at a time (D-35). */
  async function builder(options) {
    const { records: [settings] } = await appSettings.query({ page: { size: 1 } }, passedOn(options));
    if (!settings?.builderBotId) return null;
    const bot = await records.directory.findBot(String(settings.builderBotId), passedOn(options));
    return bot ? { id: String(bot.id), name: bot.name, color: bot.color, shared: bot.sharing === "shared" } : null;
  }

  async function setBuilder(actor, botId, options) {
    const bot = botId == null ? null : await records.directory.findBot(String(botId), passedOn(options), { kind: "bot" });
    if (!bot) throw new RegistryError(404, "That bot isn't in this home.", { code: "apps_bot_not_in_home" });
    await appSettings.withTransaction(options, async (txOptions) => {
      await appSettings.createMany([{ builderBotId: String(bot.id) }], {
        ...txOptions,
        onConflict: { keys: ["workspaceId"], action: "merge" },
        returning: "none"
      });
      await audit({ actor, via: { kind: "app" }, action: "app", changes: { builder: { id: String(bot.id), name: bot.name } } }, txOptions);
    });
    return builder(options);
  }

  /** Which tables each app's live and draft versions read or write; with `app` (an id), that app's only. */
  async function tablesUsed({ app: appId = null } = {}, options) {
    const used = new Map();
    const filters = { retired: false, ...(appId ? { id: String(appId) } : {}) };
    for (const [app, version] of await liveAndDraftVersions(resources, filters, options)) {
      const text = JSON.stringify(version.definition);
      for (const tableId of new Set(text.match(/\bt_[0-9a-z]{16}\b/gu) || [])) {
        if (!used.has(tableId)) used.set(tableId, new Map());
        used.get(tableId).set(app.id, { id: app.id, name: app.name, slug: app.slug });
      }
    }
    return new Map([...used].map(([tableId, apps]) => [tableId, [...apps.values()]]));
  }

  /** What removing a field would change, app by app, without changing anything. */
  async function fieldUses(fieldId, options) {
    const field = await appFields.get(String(fieldId), {}, { ...passedOn(options), missing: "skip" });
    if (!field) throw new RegistryError(404, "No such field.", { code: "apps_field_not_found" });
    const table = await appTables.get(field.tableId, {}, passedOn(options));
    const uses = [];
    for (const [app, version] of await liveAndDraftVersions(resources, { retired: false }, options)) {
      if (!JSON.stringify(version.definition).includes(fieldId)) continue;
      const { definition, changes, widened } = removeFieldFromApp(version.definition, fieldId);
      uses.push({
        appId: app.id,
        app: app.name,
        slug: app.slug,
        version: String(version.id) === String(app.liveVersionId) ? "live" : "draft",
        versionId: String(version.id),
        definition,
        changes,
        widened
      });
    }
    return { field, table, uses };
  }

  async function fieldImpact(fieldId, options) {
    const { field, table, uses } = await fieldUses(fieldId, options);
    // The table's calculated fields worked out from this one show "—" once it's gone, until their formula changes (D-78).
    const fields = (await registry.loadTables(options)).find((entry) => entry.id === table.id)?.fields ?? [];
    return {
      field: { id: field.id, key: field.key, label: field.label, obsolete: Boolean(field.obsoleteAt) },
      table: { key: table.key, label: table.label },
      calculated: calculatedUsing({ ...table, fields }, field.id).map(({ key, label }) => ({ key, label })),
      uses: uses.map(({ app, slug, version, changes, widened }) => ({ app, slug, version, changes, widened }))
    };
  }

  /**
   * Removing a field, in one save: the field is marked obsolete (its data is kept), every app that
   * uses it gets a new version without it (drafts are rewritten), and one audit entry says so.
   * Afterwards AnyAPI retires the field, so storage itself refuses writes to it.
   */
  async function removeField(actor, fieldId, options) {
    const result = await appFields.withTransaction(options, async (txOptions) => {
      const { field, table, uses } = await fieldUses(fieldId, txOptions);
      if (field.obsoleteAt) {
        throw new RegistryError(409, `${field.label} has already been removed.`, {
          code: "apps_field_already_removed",
          params: { field: field.label }
        });
      }
      await appFields.patch(field.id, { obsoleteAt: new Date().toISOString() }, { ...txOptions, returning: "none" });
      if (table.titleFieldId === field.id) {
        // The next title is a stored text field: titles are looked for in the database.
        const fields = (await registry.loadTables(txOptions)).find((entry) => entry.id === table.id)?.fields ?? [];
        const next = fields.find((entry) => entry.id !== field.id && !entry.obsolete && entry.type === "text" && !isCalculated(entry));
        await appTables.patch(table.id, { titleFieldId: next?.id ?? null }, { ...txOptions, returning: "none" });
      }
      const summary = `Removed ${field.label} (field removed from ${table.label})`;
      const affected = [];
      for (const use of uses) {
        if (use.version === "live") {
          const { number } = await addVersion({ id: use.appId }, actor, use.definition, summary, "removal", txOptions);
          affected.push({ app: use.app, version: number, changes: use.changes.length, widened: use.widened.length });
        } else {
          await appVersions.patch(use.versionId, { definition: use.definition }, { ...txOptions, returning: "none" });
          affected.push({ app: use.app, version: "draft", changes: use.changes.length, widened: use.widened.length });
        }
      }
      await audit({
        actor,
        via: { kind: "schema" },
        tableId: table.id,
        action: "schema",
        changes: { removedField: { id: field.id, key: field.key, label: field.label, table: table.label }, affected }
      }, txOptions);
      return { field: { id: field.id, label: field.label }, table: { id: table.id, label: table.label }, affected };
    });
    try {
      const api = await anyapi.instanceFor(homeIdOf(options));
      await api.resources[result.table.id].retireKnexFields([fieldId]);
    } catch (error) {
      console.error("Apps: retiring a removed field in AnyAPI failed; the registry still refuses writes to it.", error);
    }
    await registry.changed(options);
    return result;
  }

  /** Making an app public is a person's choice; only its published version is ever public. */
  async function setPublic(actor, slugOrId, on, options) {
    return appRows.withTransaction(options, async (txOptions) => {
      const app = await find(slugOrId, txOptions);
      notAView(app, "be public");
      if (on) {
        const live = app.liveVersionId ? await appVersions.get(String(app.liveVersionId), {}, { ...txOptions, missing: "skip" }) : null;
        if (!live?.definition?.public?.home) {
          throw new RegistryError(409, "Publish a version with a public screen first: ask the Builder to add one.", {
            code: "apps_public_screen_missing"
          });
        }
      }
      const row = await appRows.patch(app.id, { publicAt: on ? new Date().toISOString() : null, visibility: on ? "public" : "internal" }, txOptions);
      await audit({ actor, via: { kind: "app", appId: app.id }, action: "schema", changes: { publicApp: { on: Boolean(on), name: app.name } } }, txOptions);
      return toApp(row);
    });
  }

  /** The home's look for its apps, and each app's own colour and density (owners and admins set them). */
  const homeTheme = async (options) => (await appThemes.query({ page: { size: 1 } }, passedOn(options))).records[0]?.theme || null;

  async function setHomeTheme(actor, theme, options) {
    const problems = checkTheme(theme);
    if (problems.length) throw new RegistryError(400, problems.join(" "), { code: "apps_theme_invalid", params: { problems } });
    await appThemes.withTransaction(options, async (txOptions) => {
      await appThemes.createMany([{ theme }], { ...txOptions, onConflict: { keys: ["workspaceId"], action: "merge" }, returning: "none" });
      await audit({ actor, via: { kind: "app" }, action: "schema", changes: { homeTheme: { color: theme.color, mode: theme.mode } } }, txOptions);
    });
    return effectiveTheme(theme);
  }

  async function setAppTheme(actor, slugOrId, override = null, options) {
    const clean =
      override && Object.fromEntries(Object.entries(override).filter(([key, value]) => ["color", "density"].includes(key) && value));
    const home = await homeTheme(options);
    const problems = clean ? checkTheme({ ...clean, mode: home?.mode }, { partial: true }) : [];
    if (problems.length) throw new RegistryError(400, problems.join(" "), { code: "apps_theme_invalid", params: { problems } });
    const app = await find(slugOrId, options);
    await appRows.withTransaction(options, async (txOptions) => {
      await appRows.patch(app.id, { theme: clean && Object.keys(clean).length ? clean : null }, { ...txOptions, returning: "none" });
      await audit({ actor, via: { kind: "app", appId: app.id }, action: "schema", changes: { appTheme: { name: app.name, ...(clean || {}) } } }, txOptions);
    });
    return effectiveTheme(home, clean);
  }

  /** An app's look: the home's, with the app record's own colour and density. */
  const themeOf = async (app, options) => effectiveTheme(await homeTheme(options), app.theme);

  /** A task for a bot, run in the background by the bots package (app_jobs, D-15). */
  async function queueTask(task, options) {
    // The job and the notice that wakes a runner on any server commit together (inside a watch's transaction
    // when there is one), so the runner finds the job; without the notice, runners still find it on their next poll.
    const id = await appJobs.withTransaction(options, async (txOptions) => {
      const created = await appJobs.create(
        { ...task, title: String(task.title).slice(0, 200), prompt: String(task.prompt).slice(0, 8000) },
        { ...txOptions, returning: "id" }
      );
      await publishIn(txOptions, "apps-jobs", "all", {});
      return created;
    });
    return String(id);
  }

  return Object.freeze({
    list,
    findApp,
    searchViews,
    createApp,
    get,
    viewsOf,
    notAView,
    botOf,
    queueTask,
    homeTheme,
    // readable-check: allow setter-seam - not a slot: saves the home's look for its apps
    setHomeTheme,
    // readable-check: allow setter-seam - not a slot: saves an app's own colour and density
    setAppTheme,
    themeOf,
    // readable-check: allow setter-seam - not a slot: saves whether an app is public
    setPublic,
    saveDraft,
    publish,
    restore,
    visitorAccess: visitorAccessOf.visitorAccess,
    narrowVisitorAccess: visitorAccessOf.narrowVisitorAccess,
    versions,
    // readable-check: allow setter-seam - not a slot: saves a person's pinned apps
    setPins,
    addVersion,
    find,
    findPublic,
    builder,
    // readable-check: allow setter-seam - not a slot: saves which bot is the home's Builder
    setBuilder,
    tablesUsed,
    fieldImpact,
    removeField
  });
}
