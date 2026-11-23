import { createApps } from "./apps.js";
import { createAppsRepository } from "./appsRepository.js";
import { createDataGate } from "./dataGate.js";
import { createPractices } from "./practice.js";
import { createRegistry } from "./registry.js";
import { createRuntime } from "./runtime.js";
import { createScripts } from "./scripts.js";
import { installTemplate, templateSummaries } from "./templates.js";
import { createTableCatalog } from "./tableCatalog.js";
import { createTrial } from "./trial.js";
import { createViews } from "./views.js";
import { createWatches } from "./watches.js";

/**
 * The `mercbot.apps` capability (D-35, docs/apps-design.md): a home's tables and records behind the
 * data gate, and its apps with their scripts and watches.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the apps
 *   feature's handles
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext AppsFeature's
 * @param {{ directory: object }} dependencies.records mercbot.bots.records: bots, and the bots in chats watches are of
 * @param {import("./types.js").Anyapi} dependencies.anyapi the homes' runtime tables
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
export function createAppsRuntime({ resources, systemContext, records, anyapi, notices, env }) {
  const repository = createAppsRepository(resources);
  const registry = createRegistry({ resources, anyapi, notices });
  const practices = createPractices({ resources, anyapi, systemContext });
  // A cycle: scripts read and write records through the gate, and the gate runs scripts' rules
  // inside its writes; the gate is made first, so it asks for them late.
  let scripts = null;
  // The home's members, as person fields hold them: who's in the home now, and their names (two reads).
  const people = { activeIds: (options) => records.chats.everyoneIn(options), names: (ids, options) => records.chats.names(ids, options) };
  /** The home's people as a person field's picker lists them, by name. */
  const homePeople = async (options) => {
    const ids = (await people.activeIds(options)).map(String);
    const named = await people.names(ids, options);
    return ids.map((id) => ({ id, name: named.get(id) ?? "Someone" })).sort((a, b) => a.name.localeCompare(b.name));
  };
  // Database files' writer (D-130): the files feature plugs it in at start (useRecordFiles), as it depends on apps.
  let recordFiles = null;
  /** The files feature's writer of record files: `{ write, remove }` (fileStore's writeRecordFile, removeRecordFile). */
  function useRecordFiles(impl) {
    recordFiles = impl;
  }
  /** How a record's upload is read: the files feature's size limit and picture check, or null before it plugs in. */
  const recordUploads = () => (recordFiles ? { receive: recordFiles.receive, limit: recordFiles.limit } : null);
  const gate = createDataGate({
    resources,
    repository,
    anyapi,
    registry,
    practices,
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args),
    people,
    recordFiles: () => recordFiles
  });
  const apps = createApps({ resources, records, registry, anyapi, practices, notices });
  scripts = createScripts({ resources, repository, systemContext, registry, gate, apps, env });
  const runtime = createRuntime({ apps, gate, scripts, practices });
  const trial = createTrial({ apps, runtime, scripts });
  const views = createViews({ resources, records, systemContext, registry, apps, runtime });
  const watches = createWatches({ resources, repository, systemContext, registry, gate, apps, records });
  const catalog = createTableCatalog({ registry, gate });
  const installTemplateFor = (ctx, key, options) => installTemplate({ registry, apps, gate, catalog }, ctx, key, options);
  return Object.freeze({
    anyapi,
    registry,
    gate,
    apps,
    practices,
    views,
    runtime,
    trial,
    watches,
    scripts,
    installTemplate: installTemplateFor,
    templateSummaries,
    catalog,
    homePeople,
    useRecordFiles,
    recordUploads
  });
}
