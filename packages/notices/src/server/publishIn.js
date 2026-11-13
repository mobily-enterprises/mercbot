// readable-check: allow no-transaction-reader - infrastructure: a notice joins the transaction of the call's options, whose commit PostgreSQL delivers it on (pg_notify), and no table resource sends one
// The one channel every notice goes out on.
export const CHANNEL = "mercbot_notices";

/**
 * A notice as part of a transaction: PostgreSQL delivers it when the transaction commits, drops it
 * if it rolls back, and sends identical ones once. `publish` on the capability goes out at once.
 * @param {{ trx: import("@jskit-ai/database-runtime/server/types").RuntimeKnex }} txOptions the options a handle's
 *   withTransaction hands its work
 * @param {string} topic
 * @param {string | number} key
 * @param {object} event
 */
export function publishIn(txOptions, topic, key, event) {
  return txOptions.trx.raw("select pg_notify(?, ?)", [CHANNEL, JSON.stringify({ topic, key: String(key), event })]);
}
