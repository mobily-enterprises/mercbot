// A home's tables and fields as the registry keeps them (D-35).

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/** A field record (the appFields handle's) as the registry hands it out. */
export const toField = (record) => ({
  id: record.id,
  tableId: record.tableId,
  key: record.key,
  label: record.label,
  type: record.type,
  options: record.options || {},
  position: record.position,
  obsolete: Boolean(record.obsoleteAt)
});

/**
 * A home's tables with their fields, obsolete ones included: two reads however many there are.
 * @param {{ appTables: ResourceHandle, appFields: ResourceHandle }} handles
 * @param {CallOptions} options the home's call options
 */
export async function loadTables({ appTables, appFields }, options) {
  const tables = await appTables.queryAll({ sort: ["createdAt"] }, options);
  const fields = await appFields.queryAll({ sort: ["position", "createdAt"] }, options);
  const byTable = Map.groupBy(fields, (field) => field.tableId);
  return tables.map((record) => ({
    id: record.id,
    key: record.key,
    label: record.label,
    titleFieldId: record.titleFieldId,
    obsolete: Boolean(record.obsoleteAt),
    fields: (byTable.get(record.id) || []).map(toField)
  }));
}
