// readable-check: allow no-direct-knex - infrastructure: notices go between servers on PostgreSQL NOTIFY and LISTEN, which no table resource sends or hears
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CHANNEL } from "./publishIn.js";

/** How long a dropped listening connection waits before it connects again. */
export const RECONNECT_MS = 2000;
// Every 30 seconds each server sends itself a private notice, and one not heard back within 10 seconds means its
// listening connection went quiet without closing (a network path that dropped), which TCP keep-alive alone can take
// minutes to notice: the connection is replaced, and anything it missed is caught up (onMissed).
export const HEARTBEAT_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;
const HEARTBEAT_TOPIC = "notices-check";

/**
 * News for open pages, such as a routine run starting or a bot's computer waking.
 * Any server may publish; PostgreSQL NOTIFY carries it to every server, and each one
 * passes it to its own listeners (D-15). A notice has a topic, a key (a person or a bot) and a
 * small event that only says what changed; pages then read the state itself.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {(config: object) => import("pg").Client} [dependencies.newClient] the listening connection (tests keep theirs)
 */
export function createNotices({ knex, newClient = (config) => new pg.Client(config) }) {
  const listeners = new Map();
  const missedListeners = new Set();
  const self = randomUUID();
  // The one listen loop: the connection connecting or listening, or else the reconnect waiting for its turn. Only the
  // connection the loop holds may end it, so an unheard check, an error and an end together reconnect once.
  let client = null;
  let listening = false;
  let reconnecting = null;
  let closed = false;
  let listenedBefore = false;
  // The check sent and not heard back yet, and the timer that replaces the connection if it stays unheard.
  let waitingFor = null;
  let unheard = null;

  const slot = (topic, key) => `${topic}:${key}`;

  function deliver(payload) {
    let notice;
    try {
      notice = JSON.parse(payload);
    } catch {
      return;
    }
    if (notice.topic === HEARTBEAT_TOPIC) {
      if (notice.key === self && notice.event?.token === waitingFor) heard();
      return;
    }
    for (const listener of listeners.get(slot(notice.topic, notice.key)) || []) listener(notice.event);
  }

  /** The check came back, or no longer matters (its connection went): nothing waits for it. */
  function heard() {
    waitingFor = null;
    clearTimeout(unheard);
    unheard = null;
  }

  /** Anything published while no connection listened is lost: whoever keeps state from notices reads it again. */
  function missed() {
    for (const listener of missedListeners) {
      try {
        listener();
      } catch (error) {
        console.warn("Catching up after missed notices failed.", error);
      }
    }
  }

  /** The connection kept alive at the TCP level, so a dead path is noticed even between checks. */
  function listeningConfig() {
    const connection = knex.client.config.connection;
    if (typeof connection === "string") return { connectionString: connection, keepAlive: true, keepAliveInitialDelayMillis: 10_000 };
    // The password isn't among the settings a copy takes (it's kept out of logs), so it's passed on by name.
    return { ...connection, password: connection.password, keepAlive: true, keepAliveInitialDelayMillis: 10_000 };
  }

  function listen() {
    reconnecting = null;
    if (closed) return;
    const next = newClient(listeningConfig());
    client = next;
    next.on("notification", (message) => deliver(message.payload));
    next.on("error", () => drop(next));
    next.on("end", () => drop(next));
    start(next);
  }

  async function start(next) {
    try {
      await next.connect();
      await next.query(`LISTEN ${CHANNEL}`);
    } catch {
      drop(next);
      return;
    }
    // Replaced or closed while connecting: whatever did that has ended it.
    if (client !== next) return;
    listening = true;
    if (listenedBefore) missed();
    listenedBefore = true;
  }

  /** A connection gone quiet may never answer its end, so its socket closes at once after saying goodbye. */
  function endNow(connection) {
    const ended = connection.end().catch(() => {});
    connection.connection?.stream?.destroy();
    return ended;
  }

  /**
   * The loop's connection ends, and the loop connects again after a pause. A connection the loop no longer holds
   * (already dropped, or the last one before close) changes nothing.
   */
  function drop(dropped) {
    if (dropped !== client) return;
    client = null;
    listening = false;
    heard();
    endNow(dropped);
    if (closed) return;
    reconnecting = setTimeout(listen, RECONNECT_MS);
    reconnecting.unref();
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

  /**
   * The check: a private notice to this server alone, which the listening connection must hear back in time or be
   * replaced. A check that can't be sent says nothing about the connection.
   */
  async function heartbeat() {
    if (closed || !listening || waitingFor) return;
    const watched = client;
    const token = randomUUID();
    waitingFor = token;
    try {
      await publish(HEARTBEAT_TOPIC, self, { token });
    } catch {
      if (waitingFor === token) heard();
      return;
    }
    // Heard already, or the connection went meanwhile.
    if (waitingFor !== token) return;
    unheard = setTimeout(() => {
      console.warn("The notices connection stopped hearing its own check; it connects again.");
      drop(watched);
    }, HEARTBEAT_TIMEOUT_MS);
    unheard.unref();
  }
  const beating = setInterval(() => heartbeat().catch(() => {}), HEARTBEAT_MS);
  beating.unref();

  /** Hears that notices may have been missed (the connection was replaced): reads what it keeps again. */
  function onMissed(listener) {
    missedListeners.add(listener);
    return () => missedListeners.delete(listener);
  }

  /** The last connection ends, and nothing connects again: every timer stops, and an end that comes later is let be. */
  async function close() {
    closed = true;
    clearInterval(beating);
    clearTimeout(reconnecting);
    heard();
    const last = client;
    client = null;
    listening = false;
    if (last) await endNow(last);
  }

  listen();
  return Object.freeze({
    publish,
    publishEach,
    subscribe,
    onMissed,
    close
  });
}
