import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import pg from "pg";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createNotices } from "../../packages/notices/src/server/notices.js";

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

// Short heartbeats, so a quiet connection is noticed in a fraction of a second; notices.js waits RECONNECT_MS before it
// connects again.
const HEARTBEAT = { heartbeatMs: 150, heartbeatTimeoutMs: 100 };
const RECONNECT_MS = 2000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Notices whose listening connections are kept in `clients`, each made from `config` adjusted by `route`. */
function noticesKeeping(knex, options, route = (config) => config) {
  const clients = [];
  const notices = createNotices({ knex, ...options, newClient: (config) => {
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

/** Publishes `n` from `sender` until `heard` holds it. */
const hears = async (sender, heard, n) => {
  await until(async () => {
    await sender.publish("bots", "pat", { n });
    return heard.includes(n);
  }, `hearing ${n}`);
};

test("a listening connection kept alive, replaced when it stops hearing itself or drops, and what it missed caught up", async (context) => {
  const knex = await connectTestDatabase();
  const configs = [];
  const { notices, clients, heard, missed } = noticesKeeping(knex, HEARTBEAT, (config) => {
    configs.push(config);
    return config;
  });
  context.after(async () => {
    await notices.close();
    await knex.destroy();
  });
  context.mock.method(console, "warn", () => {});
  await hears(notices, heard, 1);
  assert.equal(configs[0].keepAlive, true, "kept alive at the TCP level");

  // Healthy, it hears its own checks and stays as it is.
  await pause(HEARTBEAT.heartbeatMs * 6);
  assert.deepEqual([clients.length, missed()], [1, 0]);

  // Quiet without closing (here: it stops listening): the next unheard check replaces it, and streams catch up.
  await clients[0].query(`UNLISTEN *`);
  await until(() => clients.length === 2 && missed() === 1, "a quiet connection replaced");
  await hears(notices, heard, 2);

  // Dropped (its server ended it): it connects again, and streams catch up.
  await knex.raw("select pg_terminate_backend(?)", [clients[1].processID]);
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

test("a listening connection whose network path goes quiet is replaced within a few heartbeats, and only then is anything caught up", async (context) => {
  const knex = await connectTestDatabase();
  const path = await pathTo(knex.client.config.connection);
  // One server publishes; another listens through the path.
  const sender = createNotices({ knex });
  const { notices, clients, heard, missed } = noticesKeeping(knex, HEARTBEAT, (config) => ({ ...config, host: "127.0.0.1", port: path.port }));
  context.after(async () => {
    path.close();
    await notices.close();
    await sender.close();
    await knex.destroy();
  });
  context.mock.method(console, "warn", () => {});
  await hears(sender, heard, 1);
  await pause(HEARTBEAT.heartbeatMs * 4);
  assert.deepEqual([clients.length, missed()], [1, 0], "the first connect is no reconnect: nothing to catch up");

  path.freeze();
  const frozenAt = Date.now();
  await hears(sender, heard, 2);
  const took = Date.now() - frozenAt;
  assert.deepEqual([clients.length, missed()], [2, 1], "replaced once, and its streams told to catch up");
  const bound = RECONNECT_MS + 4 * (HEARTBEAT.heartbeatMs + HEARTBEAT.heartbeatTimeoutMs);
  assert.ok(took < bound, `heard again ${took} ms after the path went quiet (bound ${bound} ms)`);
});

test("an unheard check, an error and an end of the same connection reconnect it once", async (context) => {
  const knex = await connectTestDatabase();
  const { notices, clients, heard, missed } = noticesKeeping(knex, HEARTBEAT);
  context.after(async () => {
    await notices.close();
    await knex.destroy();
  });
  const warn = context.mock.method(console, "warn", () => {});
  await hears(notices, heard, 1);

  // Its checks go unheard, and the unheard one ends it; then an error and an end arrive from it as well.
  await clients[0].query(`UNLISTEN *`);
  await until(() => warn.mock.callCount() === 1, "an unheard check");
  clients[0].emit("error", new Error("the connection failed"));
  clients[0].emit("end");

  await until(() => clients.length === 2 && missed() === 1, "the connection replaced");
  await pause(RECONNECT_MS + 500);
  assert.deepEqual([clients.length, missed()], [2, 1], "one connection after, and one catch-up");
  await hears(notices, heard, 2);
});

/** The timers notices.js sets, while they wait: whichever has fired or been cleared leaves `waiting`. */
function noticesTimers(context) {
  const real = { setTimeout, setInterval, clearTimeout, clearInterval };
  const ours = () => new Error().stack.includes("notices/src/server/notices.js");
  const waiting = new Set();
  const made = [];
  const keep = (timer) => {
    waiting.add(timer);
    made.push(timer);
    return timer;
  };
  context.mock.method(globalThis, "setTimeout", (work, ms, ...args) => {
    if (!ours()) return real.setTimeout(work, ms, ...args);
    const timer = real.setTimeout(() => {
      waiting.delete(timer);
      work(...args);
    }, ms);
    return keep(timer);
  });
  context.mock.method(globalThis, "setInterval", (work, ms, ...args) =>
    (ours() ? keep(real.setInterval(work, ms, ...args)) : real.setInterval(work, ms, ...args)));
  context.mock.method(globalThis, "clearTimeout", (timer) => {
    waiting.delete(timer);
    real.clearTimeout(timer);
  });
  context.mock.method(globalThis, "clearInterval", (timer) => {
    waiting.delete(timer);
    real.clearInterval(timer);
  });
  return { waiting, made };
}

test("closing leaves no timer and never connects again, even when its connection ends after", async (context) => {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  context.mock.method(console, "warn", () => {});
  const timers = noticesTimers(context);

  // Closed while a check waits to be heard back.
  const quiet = noticesKeeping(knex, { heartbeatMs: 100, heartbeatTimeoutMs: 60_000 });
  await hears(quiet.notices, quiet.heard, 1);
  await quiet.clients[0].query(`UNLISTEN *`);
  await until(() => timers.waiting.size === 2, "a check waiting to be heard back");
  await quiet.notices.close();
  assert.equal(timers.waiting.size, 0, "no timer after closing with a check unheard");
  quiet.clients[0].emit("end");
  assert.equal(timers.waiting.size, 0, "an end after closing starts no reconnect");

  // Closed while it waits to connect again.
  const dropped = noticesKeeping(knex, HEARTBEAT);
  await hears(dropped.notices, dropped.heard, 1);
  const ended = new Promise((resolve) => dropped.clients[0].once("end", resolve));
  await knex.raw("select pg_terminate_backend(?)", [dropped.clients[0].processID]);
  await ended;
  assert.equal(timers.waiting.size, 2, "the heartbeat, and the reconnect waiting");
  await dropped.notices.close();
  assert.equal(timers.waiting.size, 0, "no timer after closing with a reconnect waiting");
  await pause(RECONNECT_MS + 200);
  assert.deepEqual([quiet.clients.length, dropped.clients.length], [1, 1], "nothing connected again");
  assert.ok(timers.made.length >= 4 && timers.made.every((timer) => !timer.hasRef()), "every timer lets the process end");
});
