import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import pg from "pg";
import { moduleClock } from "../support/moduleClock.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, RECONNECT_MS, createNotices } from "../../packages/notices/src/server/notices.js";

// News for open pages (D-15) travels as PostgreSQL notifications. News for many people at once (a
// reply in a chat reaches everyone in it, the everyone chat the whole home: chatMembers.js and
// chatSeats.js tell them through publishEach) goes out in one statement, however many people there
// are, and still reaches each of them on every server.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** Resolves once `heard` holds `count` events, failing past a coarse bound (a notice that never arrives). */
async function hearing(heard, count) {
  const deadline = Date.now() + 10_000;
  while (heard.length < count) {
    if (Date.now() > deadline) throw new Error(`heard ${heard.length} of ${count} notices`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("news for many people goes out in one statement and reaches each of them", async (context) => {
  const knex = await connectTestDatabase();
  const sender = createNotices({ knex });
  // Another server: its own listening connection.
  const elsewhere = createNotices({ knex });
  context.after(async () => {
    await sender.close();
    await elsewhere.close();
    await knex.destroy();
  });
  // Notifications stay within one database, and each test file has its own.
  const topic = "bots";

  // The listening connection connects in the background: wait until it hears something.
  let ready = false;
  elsewhere.subscribe(topic, "ready", () => (ready = true));
  const readyBy = Date.now() + 10_000;
  while (!ready) {
    if (Date.now() > readyBy) throw new Error("the notices connection never listened");
    await sender.publish(topic, "ready", {});
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const tellEveryone = async (count) => {
    const people = Array.from({ length: count }, (_, index) => `${count}-${index}`);
    const heard = [];
    for (const person of people) elsewhere.subscribe(topic, person, (event) => heard.push({ person, ...event }));
    const queries = await queriesDuring(knex, () => sender.publishEach(topic, people, { botId: "7", type: "messages" }));
    await hearing(heard, count);
    assert.deepEqual(heard.map((entry) => entry.person).sort(), [...people].sort(), "each person hears it once");
    assert.ok(heard.every((entry) => entry.botId === "7" && entry.type === "messages"));
    return queries;
  };
  const few = await tellEveryone(3);
  const many = await tellEveryone(40);
  assert.equal(few, 1);
  assert.equal(many, few, `telling 40 people took ${many} queries, 3 took ${few}`);
  assert.equal(await queriesDuring(knex, () => sender.publishEach(topic, [], {})), 0, "nobody to tell costs nothing");
});

/** Waits until `ready()` holds, failing past a coarse bound. */
async function until(ready, what) {
  const deadline = Date.now() + 10_000;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error(`never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Notices' own pauses (a check every 30 s, 10 s for it to come back, 2 s before a dropped connection connects again)
// pass on a clock the tests move (moduleClock), at their real length: the tests below wait only for the database.
const NOTICES = "notices/src/server/notices.js";

/** Notices whose listening connections are kept in `clients`, each made from `config` adjusted by `route`. */
function noticesKeeping(knex, route = (config) => config) {
  const clients = [];
  const notices = createNotices({ knex, newClient: (config) => {
    const client = new pg.Client(route(config));
    clients.push(client);
    return client;
  } });
  let missed = 0;
  notices.onMissed(() => (missed += 1));
  const heard = [];
  notices.subscribe("bots", "pat", (event) => heard.push(event.n));
  return { notices, clients, heard, missed: () => missed };
}

/**
 * Moves notices' clock a heartbeat at a time, never while a check waits, until `client` (the listening connection)
 * heard `count` of its checks back. Notices heard each first (their listener came first), so none waits after.
 */
async function checksHeard(clock, client, count) {
  let heard = 0;
  const hear = (message) => {
    if (String(message.payload).includes('"topic":"notices-check"')) heard += 1;
  };
  client.on("notification", hear);
  try {
    await until(async () => {
      if (heard < count && clock.timeouts() === 0) await clock.advance(HEARTBEAT_MS);
      return heard >= count;
    }, `${count} checks heard back`);
  } finally {
    client.off("notification", hear);
  }
}

/** Moves notices' clock a heartbeat at a time until a check waits to be heard back. */
async function checkWaiting(clock) {
  await until(async () => {
    if (clock.timeouts() === 0) await clock.advance(HEARTBEAT_MS);
    return clock.timeouts() === 1;
  }, "a check waiting to be heard back");
}

/** Publishes `n` from `sender` until `heard` holds it. */
const hears = async (sender, heard, n) => {
  await until(async () => {
    await sender.publish("bots", "pat", { n });
    return heard.includes(n);
  }, `hearing ${n}`);
};

test("a listening connection kept alive, replaced when it stops hearing itself or drops, and what it missed caught up", async (context) => {
  const knex = await connectTestDatabase();
  const clock = moduleClock(context, NOTICES);
  const configs = [];
  const { notices, clients, heard, missed } = noticesKeeping(knex, (config) => {
    configs.push(config);
    return config;
  });
  context.after(async () => {
    await notices.close();
    await knex.destroy();
  });
  const warn = context.mock.method(console, "warn", () => {});
  await hears(notices, heard, 1);
  assert.equal(configs[0].keepAlive, true, "kept alive at the TCP level");

  // Healthy, it hears its own checks back and stays as it is.
  await checksHeard(clock, clients[0], 3);
  assert.deepEqual([clients.length, missed(), warn.mock.callCount()], [1, 0, 0], "three checks heard, nothing replaced");

  // Quiet without closing (here: it stops listening): the next check goes unheard and replaces it, and streams catch up.
  await clients[0].query(`UNLISTEN *`);
  await checkWaiting(clock);
  await clock.advance(HEARTBEAT_TIMEOUT_MS);
  assert.deepEqual([warn.mock.callCount(), clock.timeouts()], [1, 1], "unheard: the connection ended, its reconnect waiting");
  await clock.advance(RECONNECT_MS);
  await until(() => clients.length === 2 && missed() === 1, "a quiet connection replaced");
  await hears(notices, heard, 2);

  // Dropped (its server ended it): it connects again, and streams catch up.
  await knex.raw("select pg_terminate_backend(?)", [clients[1].processID]);
  await until(() => clock.timeouts() === 1, "the reconnect waiting");
  await clock.advance(RECONNECT_MS);
  await until(() => clients.length === 3 && missed() === 2, "a dropped connection replaced");
  await hears(notices, heard, 3);
});

/**
 * A network path to the database that can go quiet: `freeze()` stops forwarding on the connections open now without
 * closing them (as a dropped route does), while connections made after pass as usual. It reaches the database as the
 * test's own connection does: at a host and port, or, when the host is a folder, at the database's socket in it, as
 * pg does.
 */
async function pathTo({ host, port }) {
  const open = new Set();
  const server = net.createServer((socket) => {
    const upstream = String(host).startsWith("/") ? net.connect(`${host}/.s.PGSQL.${Number(port) || 5432}`) : net.connect(Number(port), host);
    const pair = [socket, upstream];
    open.add(pair);
    socket.pipe(upstream);
    upstream.pipe(socket);
    for (const end of pair) end.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    freeze() {
      for (const [socket, upstream] of open) {
        socket.unpipe(upstream);
        upstream.unpipe(socket);
        socket.pause();
        upstream.pause();
      }
    },
    close() {
      for (const pair of open) for (const end of pair) end.destroy();
      server.close();
    }
  };
}

// "Within a few heartbeats" is counted in heartbeats moved on notices' clock, in the order the test sees things happen,
// never in milliseconds a busy host can stretch: each check notices.js sends itself (a pg_notify of its own topic through the server's pool,
// which the quiet path doesn't carry), the warning that one went unheard, each listening connection made, and each
// catch-up.
test("a listening connection whose network path goes quiet is replaced within a few heartbeats, and only then is anything caught up", async (context) => {
  const knex = await connectTestDatabase();
  const path = await pathTo(knex.client.config.connection);
  const events = [];
  const checks = (query) => {
    if (String(query?.bindings?.[1] ?? "").includes('"topic":"notices-check"')) events.push("check");
  };
  knex.on("query", checks);
  // One server publishes; another listens through the path. The sender, made before the clock, keeps real time (its
  // first check is 30 s away), so each check counted here is the listener's.
  const sender = createNotices({ knex });
  const clock = moduleClock(context, NOTICES);
  const { notices, clients, heard, missed } = noticesKeeping(knex, (config) => {
    events.push("connect");
    return { ...config, host: "127.0.0.1", port: path.port };
  });
  notices.onMissed(() => events.push("catch up"));
  context.after(async () => {
    knex.removeListener("query", checks);
    path.close();
    await notices.close();
    await sender.close();
    await knex.destroy();
  });
  context.mock.method(console, "warn", (message) => {
    events.push(String(message).startsWith("The notices connection stopped hearing its own check") ? "unheard" : `warn: ${message}`);
  });
  await hears(sender, heard, 1);
  await checksHeard(clock, clients[0], 3);
  assert.deepEqual(events.filter((event) => event !== "check"), ["connect"], "heard checks replace nothing");
  assert.deepEqual([clients.length, missed()], [1, 0], "the first connect is no reconnect: nothing to catch up");

  // No check waits as the path goes quiet; the next one goes unheard, its 10 s pass, and 2 s later another connects.
  path.freeze();
  events.push("quiet");
  await checkWaiting(clock);
  await clock.advance(HEARTBEAT_TIMEOUT_MS);
  await clock.advance(RECONNECT_MS);
  await hears(sender, heard, 2);
  const after = events.slice(events.indexOf("quiet") + 1);
  const replaced = after.indexOf("connect");
  // None goes out while one waits, nor while no connection listens: one left after the path went quiet.
  const sent = after.slice(0, replaced).filter((event) => event === "check").length;
  assert.equal(sent, 1, `${sent} checks went out between the path going quiet and its replacement`);
  assert.deepEqual(after.filter((event) => event !== "check"), ["unheard", "connect", "catch up"],
    "an unheard check replaces it, and only the new connection's listening catches up");
  assert.deepEqual([clients.length, missed()], [2, 1], "replaced once, and its streams told to catch up");
});

test("an unheard check, an error and an end of the same connection reconnect it once", async (context) => {
  const knex = await connectTestDatabase();
  const clock = moduleClock(context, NOTICES);
  const { notices, clients, heard, missed } = noticesKeeping(knex);
  context.after(async () => {
    await notices.close();
    await knex.destroy();
  });
  const warn = context.mock.method(console, "warn", () => {});
  await hears(notices, heard, 1);

  // Its check goes unheard, and the unheard one ends it; then an error and an end arrive from it as well.
  await clients[0].query(`UNLISTEN *`);
  await checkWaiting(clock);
  await clock.advance(HEARTBEAT_TIMEOUT_MS);
  assert.equal(warn.mock.callCount(), 1, "an unheard check");
  clients[0].emit("error", new Error("the connection failed"));
  clients[0].emit("end");
  assert.equal(clock.timeouts(), 1, "one reconnect waits");

  await clock.advance(RECONNECT_MS);
  await until(() => clients.length === 2 && missed() === 1, "the connection replaced");
  // A second reconnect, had one been set, would connect now.
  await clock.advance(RECONNECT_MS);
  assert.deepEqual([clients.length, missed(), clock.timeouts()], [2, 1, 0], "one connection after, and one catch-up");
  await hears(notices, heard, 2);
});

test("closing leaves no timer and never connects again, even when its connection ends after", async (context) => {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  context.mock.method(console, "warn", () => {});
  const clock = moduleClock(context, NOTICES);

  // Closed while a check waits to be heard back.
  const quiet = noticesKeeping(knex);
  await hears(quiet.notices, quiet.heard, 1);
  await quiet.clients[0].query(`UNLISTEN *`);
  await checkWaiting(clock);
  assert.equal(clock.pending.size, 2, "the heartbeat, and the check waiting to be heard back");
  await quiet.notices.close();
  assert.equal(clock.pending.size, 0, "no timer after closing with a check unheard");
  quiet.clients[0].emit("end");
  assert.equal(clock.pending.size, 0, "an end after closing starts no reconnect");

  // Closed while it waits to connect again.
  const dropped = noticesKeeping(knex);
  await hears(dropped.notices, dropped.heard, 1);
  const ended = new Promise((resolve) => dropped.clients[0].once("end", resolve));
  await knex.raw("select pg_terminate_backend(?)", [dropped.clients[0].processID]);
  await ended;
  assert.equal(clock.pending.size, 2, "the heartbeat, and the reconnect waiting");
  await dropped.notices.close();
  assert.equal(clock.pending.size, 0, "no timer after closing with a reconnect waiting");
  await clock.advance(HEARTBEAT_MS + RECONNECT_MS);
  assert.deepEqual([quiet.clients.length, dropped.clients.length], [1, 1], "nothing connected again");
  assert.ok(clock.made.length >= 4 && clock.made.every((timer) => !timer.hasRef()), "every timer lets the process end");
});
