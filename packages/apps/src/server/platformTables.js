import {
  appFieldResource,
  appJobResource,
  appPracticeResource,
  appResource,
  appScriptResource,
  appTableResource,
  appVersionResource,
  appWatcheResource,
  appWebAccessResource,
  auditEventResource
} from "./tableResources.js";

// The apps platform's own filters, beside each resource's `search: true` fields. Like every filter,
// they only narrow the rows the call's context reaches.

/** Whether a timestamp is set: `retired: false` selects the rows whose `retiredAt` is null. */
const isSet = (field) => ({
  type: "boolean",
  applyFilter(query, set, { column }) {
    if (set) query.whereNotNull(column(field));
    else query.whereNull(column(field));
  }
});

/** A timestamp that has come (`due: true`), on the database's clock. */
const hasCome = (field) => ({
  type: "boolean",
  applyFilter(query, due, { column }) {
    if (due) query.whereRaw("?? <= now()", [column(field)]);
  }
});

const enabled = { type: "boolean", actualField: "enabled", filterOperator: "=" };

// The actions a rule runs on when its settings name none (scriptChecks.js).
const RULE_ACTIONS = Object.freeze(["create", "update"]);

const appSearch = Object.freeze({
  retired: isSet("retiredAt"),
  // `live: true`: the apps and views that have a published version.
  live: isSet("liveVersionId"),
  // A link or route names an app by slug or id.
  slugOrId: {
    type: "string",
    applyFilter(query, value, { column }) {
      query.where((either) => either.where(column("slug"), value).orWhere(column("id"), value));
    }
  },
  // A new app's slug and the ones numbered after it ("deals", "deals-2"...). Slugs hold only a–z, 0–9 and "-".
  slugFamily: {
    type: "string",
    applyFilter(query, base, { column }) {
      query.where((family) => family.where(column("slug"), base).orWhereLike(column("slug"), `${base}-%`));
    }
  },
  // Views by their keys (an app's copies and the view parts it shows).
  slugs: { type: "array", items: { type: "string" }, actualField: "slug", filterOperator: "in" },
  // Views by part of their name, any case (the bots' library search).
  nameHas: {
    type: "string",
    applyFilter(query, text, { column }) {
      query.whereILike(column("name"), `%${String(text).replace(/[\\%_]/gu, (char) => `\\${char}`)}%`);
    }
  }
});

const appVersionSearch = Object.freeze({
  published: isSet("publishedAt"),
  // The version list's next page: the versions older than the last one shown.
  beforeId: {
    type: "id",
    applyFilter(query, id, { column }) {
      query.where(column("id"), "<", id);
    }
  }
});

const appTableSearch = Object.freeze({
  obsolete: isSet("obsoleteAt"),
  // A table by id or by any of its keys, obsolete ones too.
  idOrKey: {
    type: "string",
    applyFilter(query, value, { column }) {
      query.where((either) => either.where(column("id"), value).orWhere(column("key"), value));
    }
  },
  // A table by id (obsolete too) or by its live key.
  idOrLiveKey: {
    type: "string",
    applyFilter(query, value, { column }) {
      query.where((either) =>
        either.where(column("id"), value).orWhere((live) => live.where(column("key"), value).whereNull(column("obsoleteAt"))));
    }
  }
});

const appFieldSearch = Object.freeze({
  obsolete: isSet("obsoleteAt"),
  type: { type: "string", actualField: "type", filterOperator: "=" }
});

const appScriptSearch = Object.freeze({
  enabled,
  due: hasCome("nextRunAt"),
  // A rule's table (settings.table, by id).
  ruleTable: {
    type: "string",
    applyFilter(query, tableId, { column }) {
      query.whereRaw("??->>'table' = ?", [column("settings"), tableId]);
    }
  },
  // A rule that runs on this action (settings.on; create and update when it names none).
  ruleOn: {
    type: "string",
    applyFilter(query, action, { column }) {
      query.whereRaw("jsonb_exists(coalesce(??->'on', ?::jsonb), ?)", [column("settings"), JSON.stringify(RULE_ACTIONS), action]);
    }
  }
});

const appJobSearch = Object.freeze({
  due: hasCome("runAfter"),
  // A running job whose server stopped renewing its lease (the bots' app job runner takes it over).
  stalled: {
    type: "boolean",
    applyFilter(query, _stalled, { column }) {
      query.where(column("status"), "running").whereNotNull(column("leaseUntil")).whereRaw("?? < now()", [column("leaseUntil")]);
    }
  }
});

// A practice copy left unused since a moment (the sweep's seven days).
const appPracticeSearch = Object.freeze({
  usedBefore: { type: "dateTime", actualField: "usedAt", filterOperator: "<" }
});

const appWatchSearch = Object.freeze({
  enabled
});

// The audit trail's: a record's history and the Activity filters.
const auditSearch = Object.freeze({
  tableId: { type: "string", actualField: "tableId", filterOperator: "=" },
  recordId: { type: "string", actualField: "recordId", filterOperator: "=" },
  actions: { type: "array", items: { type: "string" }, actualField: "action", filterOperator: "in" },
  // What a watch reads: the entries a transaction wrote between its cursor and the change horizon (the xid8 stamp).
  changedSince: { type: "xid8", actualField: "xid", filterOperator: ">=" },
  changedBefore: { type: "xid8", actualField: "xid", filterOperator: "<" },
  viaApp: {
    type: "string",
    applyFilter(query, appId, { column }) {
      query.whereRaw("??->>'appId' = ?", [column("via"), appId]);
    }
  },
  actorId: {
    type: "string",
    applyFilter(query, actorId, { column }) {
      query.whereRaw("??->>'id' = ?", [column("actor"), actorId]);
    }
  },
  atFrom: { type: "dateTime", actualField: "at", filterOperator: ">=" },
  atBefore: { type: "dateTime", actualField: "at", filterOperator: "<" },
  // Activity's next page: the entries older than the last one shown.
  beforeId: {
    type: "id",
    applyFilter(query, id, { column }) {
      query.where(column("id"), "<", id);
    }
  },
  // A watch's next page: the entries after the last one it read.
  afterId: {
    type: "id",
    applyFilter(query, id, { column }) {
      query.where(column("id"), ">", id);
    }
  }
});

const PLATFORM_OWNS = Object.freeze([
  { resource: appResource, searchSchema: appSearch },
  { resource: appVersionResource, searchSchema: appVersionSearch },
  { resource: appScriptResource, searchSchema: appScriptSearch },
  { resource: appWatcheResource, searchSchema: appWatchSearch },
  { resource: appTableResource, searchSchema: appTableSearch },
  { resource: appFieldResource, searchSchema: appFieldSearch },
  { resource: auditEventResource, searchSchema: auditSearch },
  { resource: appJobResource, searchSchema: appJobSearch },
  { resource: appPracticeResource, searchSchema: appPracticeSearch },
  // The web addresses a home lets its scripts reach, looked up by origin (webAccess.js).
  { resource: appWebAccessResource, searchSchema: { origin: { type: "string", actualField: "origin", filterOperator: "=" } } }
]);

/**
 * The apps tables' owns entries: each table resource, or its platform entry above.
 * @param {ReadonlyArray<import("@jskit-ai/resource-core/shared/tableResource").TableResource>} resources
 */
export function withPlatformSearch(resources) {
  const entries = new Map(PLATFORM_OWNS.map((entry) => [entry.resource, entry]));
  return Object.freeze(resources.map((resource) => entries.get(resource) ?? resource));
}
