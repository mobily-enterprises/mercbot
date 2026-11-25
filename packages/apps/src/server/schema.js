import { ensureAnyApiSchema } from "@jskit-ai/resource-runtime/server/anyapi";

// Slot counts for AnyAPI's shared record table (json-rest-api 3.1). Raising one adds columns;
// lowering never drops any.
export const SLOTS = { string: 60, number: 30, boolean: 20, date: 20, json: 10, belongsTo: 15 };
// The indexed slots the shared table has (the baseline migration's): a table's links take the string ones (D-130).
export const INDEXED_SLOTS = { string: 5, number: 3, date: 2 };

export function ensureAppsStorage(knex) {
  return ensureAnyApiSchema(knex, { slots: SLOTS });
}
