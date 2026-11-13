import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { kindOf, providerCostNano } from "./cost.js";

// Mercbot's own recorder (D-56, D-73): every AI call, a computer's day and its commands' computation are counted for
// their home, person and bot, with what the call cost at its provider. It never refuses work. Each finished piece of
// work adds to its day's and its month's totals, so reports cost the same however busy a home is; an AI call and a
// computer's day also keep their own row for DETAIL_DAYS days. A computer's day is counted once, however often it
// wakes. A copy built on Mercbot may record work its own way instead (`mercbot.usage-recorder`, types.js).

/** Per-call detail is kept this many days (D-73), in daily partitions. */
export const DETAIL_DAYS = 14;
const MINUTE_MS = 60 * 1000;
/** A bot's maker, home and name, kept this long for its calls, for at most this many bots. */
const BOT_FOR_MS = 10 * MINUTE_MS;
const BOTS_KEPT = 2000;
/** A model's text is about four characters a token: what an estimate counts by. */
const CHARS_PER_TOKEN = 4;
/** How a call ended when it gave no figures of its own: counted as an estimate. */
export const ESTIMATES = Object.freeze(["cut", "lost", "no_usage"]);

/** The search entries the usage tables add, by table. */
export const USAGE_FILTERS = Object.freeze({
  usageEvents: Object.freeze({
    createdSince: { type: "dateTime", actualField: "created_at", filterOperator: ">=" }
  }),
  usageDaily: Object.freeze({
    dayFrom: { type: "date", actualField: "day", filterOperator: ">=" },
    dayBefore: { type: "date", actualField: "day", filterOperator: "<" }
  }),
  usageMonthly: Object.freeze({
    monthFrom: { type: "date", actualField: "month", filterOperator: ">=" },
    homeFrom: { type: "integer", actualField: "workspace_id", filterOperator: ">=" },
    homeBefore: { type: "integer", actualField: "workspace_id", filterOperator: "<" }
  }),
  computerDays: Object.freeze({
    dayBefore: { type: "date", actualField: "day", filterOperator: "<" }
  }),
  usageJobs: Object.freeze({
    claimedBefore: { type: "dateTime", actualField: "claimed_at", filterOperator: "<" }
  })
});

/** An id as the tables keep it, or null. */
export const idOf = (value) => (/^[1-9]\d{0,18}$/u.test(String(value ?? "")) ? String(value) : null);
/** A home's id for its keys: 0 for none. */
export const homeOf = (value) => Number(idOf(value) || 0);
/** The day (UTC) a moment is in, "YYYY-MM-DD". */
export const dayOf = (at) => at.toISOString().slice(0, 10);
/** The month (UTC) a moment is in, "YYYY-MM". */
export const monthOf = (at) => at.toISOString().slice(0, 7);

/**
 * Who a piece of work is for, by its bot: the bot's home, maker and name, unless the work names its person and home.
 * Each bot is read once every few minutes.
 * @param {{ botOwner: (botId: string, options: object) => Promise<{ userId: string, workspaceId: string, name: string } | null> }} directory
 * @param {object} options the call options to read bots with
 * @param {() => Date} now
 */
export function createWhoFor(directory, options, now) {
  const bots = new Map();

  async function botOf(botId) {
    const id = idOf(botId);
    if (!id) return null;
    const kept = bots.get(id);
    if (kept && now().getTime() - kept.at < BOT_FOR_MS) return kept.bot;
    const bot = await directory.botOwner(id, options);
    bots.delete(id);
    if (bots.size >= BOTS_KEPT) bots.delete(bots.keys().next().value);
    bots.set(id, { at: now().getTime(), bot });
    return bot;
  }

  /** @param {{ botId?: string, userId?: string, workspaceId?: string }} work */
  return async function whoFor({ botId, userId, workspaceId }) {
    const bot = await botOf(botId);
    return {
      workspaceId: homeOf(bot?.workspaceId ?? workspaceId),
      userId: idOf(userId) ?? bot?.userId ?? null,
      botId: bot ? idOf(botId) : null,
      botName: bot?.name || null
    };
  };
}

/**
 * Adds to a totals row, creating it when it's the first: the key's row is changed in place, or created with these
 * amounts, and when another server created it meanwhile, changed in place after all.
 */
export async function addTo(handle, key, amounts, also, txOptions) {
  const added = { ...also };
  for (const [field, amount] of Object.entries(amounts)) added[field] = handle.raw("?? + ?", [handle.column(field, ""), amount]);
  if (await handle.patchWhere(key, added, { ...txOptions, returning: "count" })) return;
  const created = await handle.createMany([{ ...key, ...amounts, ...also }], {
    ...txOptions,
    onConflict: { keys: Object.keys(key), action: "ignore" },
    returning: "count"
  });
  if (!created) await handle.patchWhere(key, added, { ...txOptions, returning: "count" });
}

/**
 * What an AI call used, from how it ended: the provider's own figures, or for a call that gave none, an estimate from
 * its size; a failed call used nothing. With its cost at the provider.
 * @param {{ provider?: string | null, requestChars?: number, pictures?: number }} ticket
 * @param {{ state?: string, cacheHit?: number, cacheMiss?: number, output?: number, images?: number, reportedCost?: number, tier?: string, outputChars?: number }} outcome
 */
export function callUsage(ticket, outcome) {
  const state = outcome.state || "no_usage";
  const tokens = (chars) => Math.round((chars || 0) / CHARS_PER_TOKEN);
  const usage = state === "done" ? outcome : state === "failed" ? {} : { cacheMiss: tokens(ticket.requestChars), output: tokens(outcome.outputChars) };
  return {
    state,
    cacheHit: usage.cacheHit || 0,
    cacheMiss: usage.cacheMiss || 0,
    output: usage.output || 0,
    images: usage.images || 0,
    servedBy: [ticket.provider, outcome.tier].filter((part) => part && part !== "default").join("/") || null,
    costNano: state === "failed" ? 0 : providerCostNano(usage, ticket.provider || "", ticket.pictures)
  };
}

/**
 * The measures a finished piece of work adds to its totals.
 * @param {{ kind: string, state: string, days?: number, cacheHit?: number, cacheMiss?: number, output?: number, images?: number, seconds?: number, costNano?: number }} event
 */
export function measuresOf(event) {
  return {
    calls: event.kind === "computer" ? event.days || 0 : event.kind === "computation" ? 0 : 1,
    estimatedCalls: ESTIMATES.includes(event.state) ? 1 : 0,
    cacheHitTokens: event.cacheHit || 0,
    cacheMissTokens: event.cacheMiss || 0,
    outputTokens: event.output || 0,
    images: event.images || 0,
    seconds: event.seconds || 0,
    costNano: event.costNano || 0
  };
}

/**
 * The fields of a piece of work's own row (an AI call or a computer's day).
 * @param {Record<string, any>} event
 */
export function eventRow(event) {
  return {
    workspaceId: event.workspaceId,
    userId: idOf(event.userId),
    botId: idOf(event.botId),
    botName: event.botName || null,
    kind: event.kind,
    purpose: event.purpose || "",
    state: event.state,
    servedBy: event.servedBy || null,
    cacheHitTokens: event.cacheHit || 0,
    cacheMissTokens: event.cacheMiss || 0,
    outputTokens: event.output || 0,
    images: event.images || 0,
    seconds: event.seconds || 0,
    costNano: event.costNano || 0,
    createdAt: event.at.toISOString()
  };
}

/** The keys of a piece of work's totals rows: its home, bot, person and kind. */
export const totalsKey = (event) => ({
  workspaceId: event.workspaceId, botId: Number(event.botId || 0), userId: Number(event.userId || 0), kind: event.kind
});

/**
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the account feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {{ botOwner: (botId: string, options: object) => Promise<{ userId: string, workspaceId: string, name: string } | null> }} dependencies.directory
 * @param {() => Date} [dependencies.now]
 */
export function createUsageRecorder({ resources, systemContext, directory, now = () => new Date() }) {
  const { usageEvents, usageDaily, usageMonthly, computerDays } = resources;
  const system = (reason) => ({ context: systemContext(reason) });
  const whoFor = createWhoFor(directory, system("read a bot's maker, home and name for its usage"), now);

  /** Runs work in one transaction, again if a first use of a row raced another server's. */
  function inTransaction(reason, work) {
    const options = system(reason);
    return retryLostInsertRace(options, () => usageDaily.withTransaction(options, work));
  }

  /**
   * Adds a finished piece of work to its day's and its month's totals, and keeps an AI call's or a computer day's own
   * row for the days detail is kept (commands' computation has none). `event.at` is when it's counted.
   */
  async function count(event, txOptions) {
    const key = totalsKey(event);
    const amounts = measuresOf(event);
    const named = event.botName ? { botName: event.botName } : {};
    await addTo(usageDaily, { ...key, day: dayOf(event.at) }, amounts, named, txOptions);
    await addTo(usageMonthly, { ...key, month: `${monthOf(event.at)}-01` }, amounts, named, txOptions);
    if (event.kind === "computation") return;
    await usageEvents.create(eventRow(event), { ...txOptions, returning: "none" });
  }

  const counted = (event) => inTransaction("count a piece of work in its home's usage", (txOptions) => count(event, txOptions)).then(() => true);

  /**
   * Opens an AI call before it goes out, for the person, bot and home it's for.
   * @param {{ userId?: string, botId?: string, workspaceId?: string, work?: string, kind?: string, provider?: string, requestChars?: number, pictures?: number }} call
   */
  async function open(call) {
    const who = await whoFor(call);
    return {
      ...who,
      // aiFetch names the kind its work runs on (D-72); a call made without it is its provider's kind.
      kind: call.kind || kindOf(call.provider),
      purpose: call.work || "chat",
      provider: call.provider || null,
      requestChars: Math.max(0, Math.round(call.requestChars || 0)),
      pictures: Math.max(0, Math.round(call.pictures || 0))
    };
  }

  /**
   * Counts an AI call, from how it ended.
   * @param {Awaited<ReturnType<typeof open>>} ticket
   * @param {{ state: "done" | "failed" | "cut" | "no_usage", cacheHit?: number, cacheMiss?: number, output?: number, images?: number, reportedCost?: number, tier?: string, outputChars?: number }} outcome
   */
  async function finish(ticket, outcome) {
    return counted({ ...ticket, ...callUsage(ticket, outcome), at: now() });
  }

  /** Work that didn't start: nothing was opened that needs letting go. */
  async function release() {
    return true;
  }

  /**
   * A bot's computer's day (UTC), before it starts: null when that day is counted already, however often it wakes.
   * countComputerDay() counts it once the computer has started.
   * @param {{ computerId: string, botId?: string, userId?: string, workspaceId?: string }} computer
   */
  async function startComputerDay({ computerId, ...work }) {
    const who = await whoFor(work);
    const key = { workspaceId: who.workspaceId, computerId: Number(computerId) };
    const { records: [last] } = await computerDays.query({ filters: key, page: { size: 1 } }, system("read the day a bot's computer was last counted"));
    if (last && String(last.day).slice(0, 10) === dayOf(now())) return null;
    return { ...who, computerId: key.computerId, kind: "computer", purpose: "computer" };
  }

  /**
   * Marks the day (UTC) a computer is on, once, and counts it in its home's usage. False when that day was counted
   * meanwhile.
   * @param {{ workspaceId: number, computerId: number }} ticket
   * @param {Date} at
   * @param {object} txOptions
   */
  async function markDay(ticket, at, txOptions) {
    const day = dayOf(at);
    const key = { workspaceId: ticket.workspaceId, computerId: ticket.computerId };
    return Boolean(await computerDays.patchWhere({ ...key, dayBefore: day }, { day }, { ...txOptions, returning: "count" }) ||
      await computerDays.createMany([{ ...key, day }], { ...txOptions, onConflict: { keys: ["workspaceId", "computerId"], action: "ignore" }, returning: "count" }));
  }

  /**
   * Counts a computer's day once it has started: the day (UTC) it is now, once.
   * @param {Awaited<ReturnType<typeof startComputerDay>>} ticket
   */
  async function countComputerDay(ticket) {
    return inTransaction("count a bot's computer's day once it has started", async (txOptions) => {
      const at = now();
      if (!(await markDay(ticket, at, txOptions))) return false;
      await count({ ...ticket, state: "done", days: 1, servedBy: "mercbot", costNano: 0, at }, txOptions);
      return true;
    });
  }

  /**
   * Counts an awake computer's new day (UTC).
   * @param {{ computerId: string, botId?: string, userId?: string, workspaceId?: string }} computer
   * @returns {Promise<boolean>} whether the day was counted now (false: it already was)
   */
  async function computerDay(computer) {
    const ticket = await startComputerDay(computer);
    return ticket ? countComputerDay(ticket) : false;
  }

  /**
   * A command's computation, before it starts.
   * @param {{ botId?: string, userId?: string, workspaceId?: string }} work
   */
  async function startComputation(work) {
    return { ...(await whoFor(work)), kind: "computation", purpose: "command" };
  }

  /** A command still running carries on: Mercbot never stops one for what it uses. */
  async function renewComputation() {
    return true;
  }

  /**
   * Counts a command's computation when it ends: the seconds it ran.
   * @param {Awaited<ReturnType<typeof startComputation>>} ticket
   * @param {number} seconds
   */
  async function finishComputation(ticket, seconds) {
    return counted({ ...ticket, state: "done", seconds: Math.max(0, Math.round(seconds || 0)), servedBy: "mercbot", costNano: 0, at: now() });
  }

  /**
   * What a person's work on one bot in a home has cost since a moment, in dollars (a goal's spending): from the
   * calls' own rows while those are kept, and after that from the daily totals counted from that day.
   * @param {{ workspaceId: string, userId: string, botId: string, since: string | Date }} spend
   */
  async function spentSince({ workspaceId, userId, botId, since }) {
    const from = new Date(since);
    const options = system("add up what a person's work on one bot has cost since a goal began");
    const who = { workspaceId: homeOf(workspaceId), botId: Number(botId), userId: Number(userId) };
    const total = { total: { sum: "costNano" } };
    const detailKept = now().getTime() - from.getTime() < (DETAIL_DAYS - 1) * 24 * 60 * MINUTE_MS;
    const [row] = detailKept
      ? await usageEvents.aggregate({ measures: total, filters: { ...who, createdSince: from.toISOString() } }, options)
      : await usageDaily.aggregate({ measures: total, filters: { ...who, dayFrom: dayOf(from) } }, options);
    return (Number(row?.total) || 0) / 1e9;
  }

  /** Mercbot pauses no home's work. */
  async function pausedMessage() {
    return null;
  }

  return Object.freeze({
    open,
    finish,
    release,
    startComputerDay,
    countComputerDay,
    computerDay,
    startComputation,
    renewComputation,
    finishComputation,
    spentSince,
    pausedMessage
  });
}
