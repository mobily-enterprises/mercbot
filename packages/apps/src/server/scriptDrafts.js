import { passedOn } from "@jskit-ai/resource-runtime/server";
import { newId } from "./registry.js";
import { nextSlot } from "./scriptSchedule.js";

// Scripts belong to an app's draft (D-139). A script saved goes to the draft (a row with `draft`), which the draft's
// preview runs in place of the live one; taking a script away in the draft leaves a `removed` row there. Publishing
// makes the draft's scripts live, in the publish's transaction, and keeps them with the version (`app_versions.scripts`);
// restoring a version makes its scripts live again. Live screens, rules, functions and jobs run only live rows.

// A script's own content, which a version keeps and publishing or restoring copies onto the live row.
const CONTENT = ["kind", "summary", "code", "tests", "settings", "enabled", "createdBy", "runsAsUserId"];
const contentOf = (row) => Object.fromEntries(CONTENT.map((key) => [key, row[key] ?? null]));

/** An app's scripts as its draft has them: each key's draft row over its live one, without those the draft removed. */
export function asDrafted(rows) {
  const byKey = new Map();
  for (const row of rows) if (!byKey.has(row.key) || row.draft) byKey.set(row.key, row);
  return [...byKey.values()].filter((row) => !row.removed);
}

/**
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} handles the apps feature's:
 *   appScripts, apps and appVersions
 */
export function createScriptDrafts({ appScripts, apps: appRows, appVersions }) {
  /**
   * The app's draft, in the caller's transaction (a script saved goes to it): the one it has, or a new one copying its
   * live version (an empty app when it has none). Answers the draft's version id.
   */
  async function ensureDraft(actor, appId, txOptions) {
    const app = await appRows.lock(String(appId), txOptions);
    if (app.draftVersionId) return String(app.draftVersionId);
    const live = app.liveVersionId ? await appVersions.get(String(app.liveVersionId), { fields: ["definition"] }, txOptions) : null;
    const fields = { definition: live?.definition ?? {}, summary: "Script changes", createdBy: actor, kind: "builder" };
    const draftId = await appVersions.create({ appId: app.id, ...fields }, { ...txOptions, returning: "id" });
    await appRows.patch(app.id, { draftVersionId: String(draftId) }, { ...txOptions, returning: "none" });
    return String(draftId);
  }

  /**
   * A script saved to the app's draft (`content`: its own content), in the caller's transaction: its draft row, made or
   * changed, its version the next after the draft's or the live one's. A draft's job never runs on its own: publishing
   * sets its slot and its watch's start. Answers the row.
   */
  async function save(actor, appId, key, content, txOptions) {
    await ensureDraft(actor, appId, txOptions);
    const both = await appScripts.lockWhere({ appId, key }, { ...txOptions, fields: ["id", "version", "draft"] });
    const drafted = both.find((row) => row.draft);
    const version = (drafted?.version ?? both.find((row) => !row.draft)?.version ?? 0) + 1;
    const fields = { ...content, draft: true, removed: false, nextRunAt: null, cursor: null, version };
    return drafted
      ? appScripts.patch(drafted.id, fields, txOptions)
      : appScripts.create({ id: newId("s"), appId, key, ...fields }, txOptions);
  }

  /** A script taken away in the app's draft, in the caller's transaction: a live one goes when it's published; a draft's own goes now. */
  async function remove(actor, appId, key, txOptions) {
    await ensureDraft(actor, appId, txOptions);
    const rows = await appScripts.lockWhere({ appId, key }, txOptions);
    const live = rows.find((row) => !row.draft);
    const drafted = rows.find((row) => row.draft);
    if (live && drafted) await appScripts.patch(drafted.id, { removed: true }, { ...txOptions, returning: "none" });
    else if (live) await appScripts.create({ ...live, id: newId("s"), draft: true, removed: true, nextRunAt: null, cursor: null }, { ...txOptions, returning: "none" });
    else if (drafted) await appScripts.delete(drafted.id, { ...txOptions, returning: "none" });
  }

  /**
   * A live row made like `content` (a script's own content, a draft's or a version's), in the caller's transaction; a new
   * one takes `id` when given (a draft's first publish keeps its id).
   */
  async function makeLive(appId, key, content, txOptions, id = null) {
    const [live] = await appScripts.lockWhere({ appId, key, draft: false }, { ...txOptions, fields: ["id", "version", "cursor", "settings"] });
    const job = content.kind === "job";
    // A job runs on from where its live one was, or, new or watching anew, from the change horizon now.
    const watching = job && content.settings?.watch;
    const fields = {
      ...content,
      nextRunAt: job && content.settings?.every ? nextSlot(content.settings).toISOString() : null,
      cursor: watching ? (live?.settings?.watch && live.cursor ? live.cursor : await appScripts.changeHorizon(txOptions)) : null
    };
    // A draft's version is the one it was saved as; a restored script's, the live one's next.
    const version = content.version ?? (live ? live.version + 1 : 1);
    if (live) await appScripts.patch(live.id, { ...fields, version }, { ...txOptions, returning: "none" });
    else await appScripts.create({ id: id || newId("s"), appId, key, draft: false, removed: false, ...fields, version }, { ...txOptions, returning: "none" });
  }

  /**
   * The draft's scripts made live (publish, in its transaction): each draft row's content onto the live row, or the live
   * row taken away for a removed one, the draft rows gone. Answers the live scripts as they now are, for the version.
   */
  async function publish(appId, txOptions) {
    const drafts = await appScripts.lockWhere({ appId, draft: true }, txOptions);
    for (const draft of drafts) {
      await appScripts.delete(draft.id, { ...txOptions, returning: "none" });
      if (draft.removed) await appScripts.deleteWhere({ appId, key: draft.key, draft: false }, { ...txOptions, returning: "none" });
      else await makeLive(appId, draft.key, { ...contentOf(draft), version: draft.version }, txOptions, draft.id);
    }
    return liveScripts(appId, txOptions);
  }

  /** The app's live scripts, as a version keeps them: key and content. */
  async function liveScripts(appId, txOptions) {
    const live = await appScripts.queryAll({ filters: { appId, draft: false }, sort: ["key"] }, txOptions);
    return live.map((row) => ({ key: row.key, ...contentOf(row) }));
  }

  /**
   * A version's scripts made live again (restore, in its transaction): each one's content onto its live row, and the live
   * scripts it didn't have taken away. A version from before scripts had drafts (null) leaves them as they are.
   */
  async function restore(appId, scripts, txOptions) {
    if (!Array.isArray(scripts)) return liveScripts(appId, txOptions);
    const keep = new Set(scripts.map((script) => script.key));
    const live = await appScripts.lockWhere({ appId, draft: false }, { ...txOptions, fields: ["id", "key"] });
    for (const row of live.filter((entry) => !keep.has(entry.key))) await appScripts.delete(row.id, { ...txOptions, returning: "none" });
    for (const script of scripts) await makeLive(appId, script.key, contentOf(script), txOptions);
    return liveScripts(appId, txOptions);
  }

  /**
   * The rules matching `filters` a save runs (`ctx`, the data gate's): the live ones; in a draft's preview, its app's
   * draft's rules in place of that app's live ones. In key order.
   */
  async function rules(ctx, filters) {
    const live = await appScripts.queryAll({ filters: { ...filters, draft: false }, sort: ["key"] }, passedOn(ctx.options));
    const appId = ctx.practice ? ctx.via?.appId : null;
    if (!appId) return live;
    const drafted = await appScripts.queryAll({ filters: { ...filters, appId }, sort: ["key"] }, passedOn(ctx.options));
    return [...live.filter((row) => row.appId !== appId), ...asDrafted(drafted)].sort((a, b) => a.key.localeCompare(b.key));
  }

  return Object.freeze({
    ensureDraft,
    rules,
    save,
    remove,
    publish,
    restore,
    liveScripts
  });
}
