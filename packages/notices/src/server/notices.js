// readable-check: allow no-direct-knex - infrastructure: notices go between servers on PostgreSQL NOTIFY and LISTEN, which no table resource sends or hears
import pg from "pg";
import { CHANNEL } from "./publishIn.js";

const RECONNECT_MS = 2000;

/**
 * News for open pages, such as a routine run starting or a bot's computer waking.
 * Any server may publish; PostgreSQL NOTIFY carries it to every server, and each one
 * passes it to its own listeners (D-15). A notice has a topic, a key (a person or a bot) and a
 * small event that only says what changed; pages then read the state itself.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 */
export function createNotices({ knex }) {
  const listeners = new Map();
  let client = null;
  let closed = false;

  const slot = (topic, key) => `${topic}:${key}`;

  function deliver(payload) {
    let notice;
    try {
      notice = JSON.parse(payload);
    } catch {
      return;
    }
    for (const listener of listeners.get(slot(notice.topic, notice.key)) || []) listener(notice.event);
  }

  async function listen() {
    if (closed) return;
    const next = new pg.Client(knex.client.config.connection);
    next.on("notification", (message) => deliver(message.payload));
    next.on("error", () => next.end().catch(() => {}));
    next.on("end", () => {
      if (client === next) client = null;
      if (!closed) setTimeout(listen, RECONNECT_MS).unref();
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${CHANNEL}`);
      // Closed while connecting: this connection is the last one, so it ends too.
      if (closed) {
        await next.end().catch(() => {});
        return;
      }
      client = next;
    } catch {
      next.end().catch(() => {});
    }
  }

  async function publish(topic, key, event) {
    await knex.raw("select pg_notify(?, ?)", [CHANNEL, JSON.stringify({ topic, key: String(key), event })]);
  }

  /**
   * The same news for many keys, such as everyone in a home, in one statement: a reply in a shared
   * room tells every member, and one query each would grow with the home.
   */
  async function publishEach(topic, keys, event) {
    if (!keys.length) return;
    await knex.raw(
      "select pg_notify(?, json_build_object('topic', ?::text, 'key', key, 'event', ?::json)::text) from unnest(?::text[]) as key",
      [CHANNEL, topic, JSON.stringify(event), keys.map(String)]
    );
  }

  function subscribe(topic, key, listener) {
    const name = slot(topic, String(key));
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(listener);
    return () => {
      listeners.get(name)?.delete(listener);
      if (!listeners.get(name)?.size) listeners.delete(name);
    };
  }

  async function close() {
    closed = true;
    await client?.end().catch(() => {});
  }

  listen();
  return Object.freeze({
    publish,
    publishEach,
    subscribe,
    close
  });
}
