import { ensureAnyApiSchema } from "json-rest-api";

// Slot counts for AnyAPI's shared record table (json-rest-api 3.1). Raising one adds columns;
// lowering never drops any.
const SLOTS = { string: 60, number: 30, boolean: 20, date: 20, json: 10, belongsTo: 15 };

export function ensureAppsStorage(knex) {
  return ensureAnyApiSchema(knex, { slots: SLOTS });
}
