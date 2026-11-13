import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { toCamelCase, toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { resolveUserScopeValue, resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * A record as the bots' code has always read its rows: snake_case columns, with the home it
 * belongs to as workspace_id (the field is hidden, and ownership keeps every read in that home).
 * @param {Record<string, unknown>} record
 * @param {string | null} home
 */
export function rowOf(record, home) {
  return { ...Object.fromEntries(Object.entries(record).map(([field, value]) => [toSnakeCase(field), value])), workspace_id: home };
}

/**
 * Columns as a record's fields, for what callers give in the rows' own names.
 * @param {Record<string, unknown>} columns
 */
export function fieldsOf(columns) {
  return Object.fromEntries(Object.entries(columns).map(([column, value]) => [toCamelCase(column), value]));
}

/**
 * Who and where a call is for, as the bots' repositories read it.
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} systemContext
 */
export function createCallerReaders(systemContext) {
  /** The home the call works in. @param {CallOptions} options */
  const homeOf = (options) => resolveWorkspaceScopeValue(options.context);

  /**
   * "The person": the signed-in user, or for work done for someone (the reply resumer, a goal)
   * the user it acts for. It picks whose seat a read uses and never widens what the work reaches.
   * @param {CallOptions} options
   */
  function personOf(options) {
    const person = resolveAuditActorId(options.context) ?? resolveUserScopeValue(options.context);
    if (!person) throw new TypeError("A bot's seat is read for a person: a signed-in user, or work done for one.");
    return String(person);
  }

  /** A record as its row (rowOf), or null. */
  const asRow = (record, options) => (record ? rowOf(record, homeOf(options)) : null);

  /**
   * Options that reach the person's own rows (conversation_reads): a request's own, or for work
   * done for someone, that person's scope, which a home-wide job context does not carry.
   * @param {CallOptions} options
   */
  function personalOptions(options) {
    if (resolveUserScopeValue(options.context)) return passedOn(options);
    return { ...passedOn(options), context: systemContext("work done for a person reads where they read up to in a room").forUser(personOf(options)) };
  }

  return Object.freeze({
    homeOf,
    personOf,
    asRow,
    personalOptions
  });
}
