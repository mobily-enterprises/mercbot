import { sizeText } from "./gateway.js";

// Bots' commands' internet limits that outlast one command (D-127), kept in the database since a home's bots run on
// several servers (D-15): the home's internet a day (`internet_days`, one row per home and UTC day, both ways added
// up) and each bot's new connections a minute (`internet_minutes`, one row per bot). A command's gateway (gateway.js)
// counts as it goes and writes what it counted in one statement at a time: every FLUSH_MS while bytes move, once
// FLUSH_BYTES are waiting, and when it closes, never once a connection. Each write answers the home's day so far, so
// a gateway sees what the home's other gateways used, on this server or another, as of its last write: the home may
// go past its day by about FLUSH_BYTES for each gateway moving data at once. A bot's connections are taken from its
// minute a few at a time (LEASE_MOST at most), and what a gateway took but didn't use goes back when it closes.

const MB = 1024 ** 2;
const MINUTE_MS = 60 * 1000;
const FLUSH_MS = 10 * 1000;
const FLUSH_BYTES = 64 * MB;
const LEASE_MOST = 16;
/** A home's days are kept this long, then removed (the shell's hourly sweep). */
const DAYS_KEPT = 14;

/** The limits' Env names, and their defaults when a name is unset (D-127). */
export const INTERNET_ENV = Object.freeze({
  MERCBOT_INTERNET_COMMAND_IN_MB: 2048,
  MERCBOT_INTERNET_COMMAND_OUT_MB: 200,
  MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE: 120,
  MERCBOT_INTERNET_HOME_DAY_MB: 20480
});

/** The search entries internet_days and internet_minutes add. */
export const INTERNET_DAY_FILTERS = Object.freeze({
  dayBefore: { type: "date", actualField: "day", filterOperator: "<" }
});
export const INTERNET_MINUTE_FILTERS = Object.freeze({
  minuteBefore: { type: "integer", actualField: "minute", filterOperator: "<" },
  connectionsAtMost: { type: "integer", actualField: "connections", filterOperator: "<=" }
});

/**
 * The limits from the server's env: each name's positive number, else its default (a value that isn't one is said
 * once, as the server starts). Bytes, and connections a minute.
 * @param {Record<string, string | undefined>} env
 * @returns {{ commandIn: number, commandOut: number, perMinute: number, homeDay: number }}
 */
export function internetLimits(env = {}) {
  const read = (name) => {
    const fallback = INTERNET_ENV[name];
    const given = env[name];
    if (given == null || String(given).trim() === "") return fallback;
    const value = Number(given);
    if (Number.isFinite(value) && value > 0) return value;
    console.warn(`${name} is "${given}", which isn't a positive number, so its default, ${fallback}, applies.`);
    return fallback;
  };
  return Object.freeze({
    commandIn: Math.round(read("MERCBOT_INTERNET_COMMAND_IN_MB") * MB),
    commandOut: Math.round(read("MERCBOT_INTERNET_COMMAND_OUT_MB") * MB),
    perMinute: Math.max(1, Math.floor(read("MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE"))),
    homeDay: Math.round(read("MERCBOT_INTERNET_HOME_DAY_MB") * MB)
  });
}

/** The day (UTC) a moment is in, "YYYY-MM-DD". */
const dayOf = (at) => at.toISOString().slice(0, 10);
/** The next midnight UTC after a moment. */
const midnightAfter = (at) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));

/** How long until a moment, as people read it: "3 h 5 min", "12 min", "less than a minute". */
function untilText(ms) {
  const minutes = Math.ceil(ms / MINUTE_MS);
  if (ms < MINUTE_MS) return "less than a minute";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

/**
 * What a bot is told when its home's day is spent: why a connection was refused, or why its connections ended.
 * @param {number} homeDay
 * @param {Date} at
 * @param {"refused" | "ended"} how
 */
export function dayMessage(homeDay, at, how) {
  const what = how === "ended" ? "ended this command's internet connections" : "refused a connection";
  return `Mercbot's gateway ${what}: this home's commands have used ${sizeText(homeDay)} of internet today, the most a ` +
    `home's commands may use in a day. It starts again at midnight UTC, in ${untilText(midnightAfter(at) - at)}.`;
}

/** What a bot is told when it opens more connections in a minute than it may. */
export function minuteMessage(perMinute, at) {
  const seconds = Math.max(1, Math.ceil((MINUTE_MS - (at.getTime() % MINUTE_MS)) / 1000));
  return `Mercbot's gateway refused a connection: slow down. This bot opened ${perMinute} new internet connections ` +
    `this minute, the most a bot may; try again in ${seconds} s.`;
}

/**
 * @param {object} dependencies
 * @param {object} dependencies.internetDays the internet_days handle
 * @param {object} dependencies.internetMinutes the internet_minutes handle
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {ReturnType<typeof internetLimits>} dependencies.limits
 * @param {() => Date} [dependencies.now]
 * @param {{ flushMs?: number, flushBytes?: number }} [dependencies.writes] how often a gateway writes (tests)
 */
export function createInternetUsage({ internetDays, internetMinutes, systemContext, limits, now = () => new Date(), writes = {} }) {
  const flushMs = writes.flushMs ?? FLUSH_MS;
  const flushBytes = writes.flushBytes ?? FLUSH_BYTES;
  const inHome = (workspaceId) => ({
    context: systemContext("count and limit the internet a home's bot commands use, in that home").forWorkspace(String(workspaceId))
  });
  const plus = (handle, field, amount) => handle.raw("?? + ?", [handle.column(field, ""), amount]);
  const totalOf = (row) => (Number(row?.bytesIn) || 0) + (Number(row?.bytesOut) || 0);

  /** The home's day, read: its row's totals, or none yet. */
  async function readDay(workspaceId, day, options = inHome(workspaceId)) {
    const [row] = await internetDays.queryAll({ filters: { day }, fields: ["bytesIn", "bytesOut", "connections"], take: 1 }, options);
    return { bytesIn: Number(row?.bytesIn) || 0, bytesOut: Number(row?.bytesOut) || 0, connections: Number(row?.connections) || 0 };
  }

  /**
   * Adds to the home's day, one statement unless it's the day's first: the row changed in place, or created with these
   * amounts, and when another server created it meanwhile, changed in place after all. Answers the day's totals.
   */
  async function addToDay(workspaceId, day, amounts) {
    const options = inHome(workspaceId);
    const added = Object.fromEntries(Object.entries(amounts).map(([field, amount]) => [field, plus(internetDays, field, amount)]));
    const patched = async () => (await internetDays.patchWhere({ day }, added, { ...options, returning: "records" }))[0] ?? null;
    const found = await patched();
    if (found) return found;
    const created = await internetDays.createMany([{ day, ...amounts }], {
      ...options, onConflict: { keys: ["workspaceId", "day"], action: "ignore" }, returning: "count"
    });
    return created ? amounts : patched();
  }

  /**
   * Takes up to `wanted` of a bot's connections in `minute` (minutes since 1970, UTC): how many it got, 0 when the
   * minute has none left. The bot's one row holds its present minute; an older one starts again.
   */
  async function take(workspaceId, botId, minute, wanted) {
    const options = inHome(workspaceId);
    const most = Math.min(wanted, limits.perMinute);
    const inMinute = (count) => internetMinutes.patchWhere(
      { botId, minute, connectionsAtMost: limits.perMinute - count },
      { connections: plus(internetMinutes, "connections", count) },
      { ...options, returning: "count" }
    );
    for (const count of new Set([most, 1])) if (await inMinute(count)) return count;
    if (await internetMinutes.patchWhere({ botId, minuteBefore: minute }, { minute, connections: most }, { ...options, returning: "count" })) return most;
    const created = await internetMinutes.createMany([{ botId, minute, connections: most }], {
      ...options, onConflict: { keys: ["workspaceId", "botId"], action: "ignore" }, returning: "count"
    });
    if (created) return most;
    return (await inMinute(1)) ? 1 : 0;
  }

  /** Gives back connections a gateway took in `minute` and didn't use. */
  function giveBack(workspaceId, botId, minute, count) {
    return internetMinutes.patchWhere(
      { botId, minute },
      { connections: internetMinutes.raw("GREATEST(?? - ?, 0)", [internetMinutes.column("connections", ""), count]) },
      { ...inHome(workspaceId), returning: "none" }
    );
  }

  /**
   * One gateway's meter (gateway.js): a command's, or a computer's session's, for a bot (`botId`, whose minute its
   * connections are taken from) in a home. A failed read or write is said and the work goes on: a gateway never
   * refuses for the database, and what it couldn't write is written next time.
   * @param {{ workspaceId: string | number, botId?: string | number | null }} owner
   */
  function forGateway({ workspaceId, botId = null }) {
    const home = String(workspaceId);
    const bot = botId == null ? null : String(botId);
    const zero = () => ({ bytesIn: 0, bytesOut: 0, connections: 0 });
    // The home's day as of the last read or write, what this gateway hasn't written yet, and what it's writing.
    let known = null;
    let waiting = zero();
    let writing = null;
    let inFlight = 0;
    let timer = null;
    let closed = false;
    // The connections taken from the bot's minute: how many are left and how many were taken last; the minute
    // refused, until it ends.
    let lease = { minute: -1, left: 0, size: 0 };
    let refusedIn = -1;
    const waitingBytes = () => waiting.bytesIn + waiting.bytesOut;
    const usedToday = (day) => (known?.day === day ? known.bytes : 0) + inFlight + waitingBytes();

    const anyWaiting = () => Boolean(waitingBytes() || waiting.connections);

    /** Writes what's waiting, one write at a time: resolves to whether it was written. */
    function write() {
      if (writing) return writing;
      if (!anyWaiting()) return Promise.resolve(true);
      const amounts = waiting;
      waiting = zero();
      inFlight = amounts.bytesIn + amounts.bytesOut;
      const day = dayOf(now());
      writing = addToDay(home, day, amounts).then((row) => {
        known = { day, bytes: totalOf(row) };
        return true;
      }, (error) => {
        for (const field of Object.keys(amounts)) waiting[field] += amounts[field];
        console.warn(`Writing home ${home}'s internet use failed; it's written next time: ${error?.message}`);
        return false;
      }).finally(() => {
        writing = null;
        inFlight = 0;
        if (waitingBytes() >= flushBytes) write();
        else later();
      });
      return writing;
    }

    function later() {
      if (timer || closed || !anyWaiting()) return;
      timer = setTimeout(() => {
        timer = null;
        write();
      }, flushMs);
      timer.unref();
    }

    return Object.freeze({
      /** Before a connection: a refusal, when the home's day is spent or the bot's minute is, else null. */
      async connection() {
        const at = now();
        const day = dayOf(at);
        if (known?.day !== day) {
          const row = await readDay(home, day).catch((error) => {
            console.warn(`Reading home ${home}'s internet use failed; its connections go on: ${error?.message}`);
            return null;
          });
          known = { day, bytes: totalOf(row) };
        }
        if (usedToday(day) >= limits.homeDay) return { status: "403 Forbidden", key: "day", message: dayMessage(limits.homeDay, at, "refused") };
        if (bot) {
          const minute = Math.floor(at.getTime() / MINUTE_MS);
          if (refusedIn === minute) return { status: "429 Too Many Requests", key: "minute", message: minuteMessage(limits.perMinute, at) };
          if (lease.minute !== minute) lease = { minute, left: 0, size: 0 };
          if (!lease.left) {
            const wanted = Math.min(LEASE_MOST, Math.max(1, lease.size * 2));
            const got = await take(home, bot, minute, wanted).catch((error) => {
              console.warn(`Taking bot ${bot}'s connections failed; its connection goes on: ${error?.message}`);
              return 1;
            });
            if (!got) {
              refusedIn = minute;
              return { status: "429 Too Many Requests", key: "minute", message: minuteMessage(limits.perMinute, at) };
            }
            if (lease.minute === minute) {
              lease.left += got;
              lease.size = got;
            }
          }
          lease.left = Math.max(0, lease.left - 1);
        }
        waiting.connections += 1;
        later();
        return null;
      },
      /** A chunk each way: why the connections must end now (the home's day is spent), or null. */
      add(bytesIn, bytesOut) {
        waiting.bytesIn += bytesIn;
        waiting.bytesOut += bytesOut;
        if (waitingBytes() >= flushBytes) write();
        else later();
        const at = now();
        return known?.day === dayOf(at) && usedToday(known.day) > limits.homeDay ? dayMessage(limits.homeDay, at, "ended") : null;
      },
      /** The gateway closed: what it counted is written, and the bot's connections it didn't use go back. */
      async close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        timer = null;
        // Until nothing waits, unless a write fails (it's said; the rest is lost with the gateway).
        while (writing || anyWaiting()) {
          if (!(await (writing ?? write()))) break;
        }
        const minute = Math.floor(now().getTime() / MINUTE_MS);
        if (bot && lease.left && lease.minute === minute) {
          await giveBack(home, bot, minute, lease.left).catch((error) => console.warn(`Giving back bot ${bot}'s connections failed: ${error?.message}`));
        }
      }
    });
  }

  /**
   * The home's internet today, for Settings → Spending, read as the person (`options`): what its commands received and
   * sent, the most they may, and when it starts again.
   * @param {object} options the person's call options in the home
   * @param {string | number} workspaceId
   */
  async function today(options, workspaceId) {
    const at = now();
    const day = dayOf(at);
    const used = await readDay(workspaceId, day, options);
    return {
      day,
      received: used.bytesIn,
      sent: used.bytesOut,
      connections: used.connections,
      homeDay: limits.homeDay,
      commandIn: limits.commandIn,
      commandOut: limits.commandOut,
      perMinute: limits.perMinute,
      startsAgainAt: midnightAfter(at).toISOString()
    };
  }

  /** Removes the days older than DAYS_KEPT, in every home. */
  function removeOld() {
    const before = dayOf(new Date(now().getTime() - DAYS_KEPT * 24 * 60 * MINUTE_MS));
    return internetDays.deleteWhere({ dayBefore: before }, {
      context: systemContext("remove homes' internet use of days older than two weeks, in every home"),
      returning: "count"
    });
  }

  return Object.freeze({
    limits,
    forGateway,
    today,
    removeOld
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ untilText, FLUSH_BYTES, FLUSH_MS, LEASE_MOST, DAYS_KEPT });
