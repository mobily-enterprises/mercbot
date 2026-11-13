import { randomUUID } from "node:crypto";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

// Connect follow-ups (D-77): a row for each connect card a person started signing in from, "waiting"
// until a connection reaches its chat, then "ready" until its bot has carried on, when the row goes. A ready row is
// started once across servers: the start holds it with a run id and a lease on the database's clock (now()), as
// D-77's lost runs do, and a run whose server stopped is taken over under a new run id. Until a start holds it, a
// ready row's lease_until is when its start is due: the server that marked it starts it at once, a sweep after that.

/**
 * connect_follow_ups filters beyond its `search: true` fields (the `owns` entry's searchSchema).
 * - startedWithin, startedBefore: the person started signing in less, or more, than so many minutes ago;
 * - unheld: no run holds it, nor ever did;
 * - startable: ready, and no run holds it (none started, or its lease lapsed);
 * - due: ready, and its start or its run's lease is overdue: what the sweep takes;
 * - expired: waiting longer than so many minutes since its sign-in began, or ready with its start or lease overdue by
 *   that long (no server could start or carry it on meanwhile): what the sweep removes.
 */
export const FOLLOW_UP_SEARCH = Object.freeze({
  startedWithin: {
    type: "integer",
    applyFilter(query, minutes, { column }) {
      query.whereRaw("?? > now() - make_interval(mins => ?)", [column("waitingSince"), Number(minutes)]);
    }
  },
  startedBefore: {
    type: "integer",
    applyFilter(query, minutes, { column }) {
      query.whereRaw("?? <= now() - make_interval(mins => ?)", [column("waitingSince"), Number(minutes)]);
    }
  },
  unheld: {
    type: "boolean",
    applyFilter(query, _unheld, { column }) {
      query.whereNull(column("runId"));
    }
  },
  startable: {
    type: "boolean",
    applyFilter(query, _startable, { column }) {
      query
        .where(column("status"), "ready")
        .where((free) => free.whereNull(column("runId")).orWhereRaw("?? < now()", [column("leaseUntil")]));
    }
  },
  due: {
    type: "boolean",
    applyFilter(query, _due, { column }) {
      query.where(column("status"), "ready").whereRaw("?? < now()", [column("leaseUntil")]);
    }
  },
  expired: {
    type: "integer",
    applyFilter(query, minutes, { column }) {
      const mins = Number(minutes);
      query.where((gone) => gone
        .where((waiting) => waiting
          .where(column("status"), "waiting")
          .whereRaw("?? <= now() - make_interval(mins => ?)", [column("waitingSince"), mins]))
        .orWhere((ready) => ready
          .where(column("status"), "ready")
          .whereRaw("?? <= now() - make_interval(mins => ?)", [column("leaseUntil"), mins])));
    }
  }
});

/** What a follow-up's start and run read of its row. */
const FIELDS = Object.freeze(["messageId", "conversationId", "workspaceId", "pluginId", "runId", "attempts", "steps"]);

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/**
 * A follow-up's row as its start reads it: the card, its chat and home, the app it waits for, and its run so far.
 * @typedef {{ id: string, messageId: string, conversationId: string, workspaceId: string, pluginId: string,
 *   runId: string | null, attempts: number, steps: object[] | null }} FollowUp
 */
/** A follow-up this server holds: its run id, and whether this is its first run (its card isn't claimed yet). @typedef {FollowUp & { runId: string, first: boolean }} HeldFollowUp */

/**
 * The connect follow-ups' statements, on the connectFollowUps handle. Reads and writes across homes take the bots'
 * system context; a run's own writes name its run id, so a server that lost the run changes nothing.
 * @param {{ connectFollowUps: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} handles
 */
export function createFollowUpRepository({ connectFollowUps: followUps }) {
  /** @param {number} seconds now() plus that many seconds, as a write's value (bound, never built into the SQL) */
  const secondsFromNow = (seconds) => followUps.raw("now() + make_interval(secs => ?)", [Number(seconds)]);
  const asFollowUp = (record) => (record ? { ...record, id: String(record.id), attempts: Number(record.attempts) || 0 } : null);
  /** Writes of one run: only while it is still this server's. @param {{ id: string, runId: string }} run */
  const ofRun = ({ id, runId }) => ({ id: [String(id)], runId: String(runId) });

  function withTransaction(options, work) {
    return followUps.withTransaction(options, work);
  }

  /**
   * The person started signing in from a card again or for the first time: its row starts waiting afresh, in the
   * call's home. Answers its id. A run holding the row is the caller's to refuse first (its card is connected).
   * @param {{ messageId: string, conversationId: string, userId: string, personal: boolean, pluginId: string }} fields
   * @param {CallOptions} options the person's request, inside the transaction that marks the card
   */
  async function wait(fields, options) {
    await followUps.deleteWhere({ messageId: String(fields.messageId) }, passedOn(options));
    return String(await followUps.create({ ...fields, status: "waiting" }, { ...passedOn(options), returning: "id" }));
  }

  /**
   * Marks ready the rows a newly connected account reaches whose sign-in started in the last `minutes`: a person's
   * own account their own chats in every home, a home's account every chat in it (D-37). Each start is due in
   * `graceSeconds`, so the server that marked it starts it first. Answers their ids.
   * @param {{ pluginId: string, userId: string, homeId: string | null }} connection
   * @param {{ minutes: number, graceSeconds: number }} timing
   * @param {CallOptions} options the bots' system context, in the transaction that saves the connection
   */
  function markReady({ pluginId, userId, homeId }, { minutes, graceSeconds }, options) {
    const reached = homeId == null ? { userId: String(userId), personal: true } : { workspaceId: String(homeId) };
    return followUps.patchWhere(
      { status: "waiting", pluginId: String(pluginId), ...reached, startedWithin: minutes },
      { status: "ready", leaseUntil: secondsFromNow(graceSeconds) },
      { ...passedOn(options), returning: "ids" }
    );
  }

  /** One waiting row marked ready, its start due in `graceSeconds`; answers whether it was waiting. */
  async function markOneReady(id, graceSeconds, options) {
    const marked = await followUps.patchWhere({ id: [String(id)], status: "waiting" }, { status: "ready", leaseUntil: secondsFromNow(graceSeconds) }, {
      ...passedOn(options),
      returning: "count"
    });
    return Number(marked) > 0;
  }

  /** The row while it can be started, or null. @returns {Promise<FollowUp | null>} */
  async function startable(id, options) {
    const query = { filters: { id: String(id), startable: true }, fields: [...FIELDS] };
    const [found = null] = await followUps.queryAll(query, passedOn(options));
    return asFollowUp(found);
  }

  /** The ids of up to `limit` rows whose start or lease is overdue, the most overdue first: what a sweep starts. */
  async function due(limit, options) {
    const { records } = await followUps.query({ filters: { due: true }, sort: ["leaseUntil"], page: { size: limit }, fields: ["leaseUntil"] }, passedOn(options));
    return records.map((record) => String(record.id));
  }

  /** The id of a row of the chat that can be started now, or null: what the chat's last reply starts as it ends. */
  async function startableIn(conversationId, options) {
    const { records } = await followUps.query(
      { filters: { conversationId: String(conversationId), startable: true }, sort: ["id"], page: { size: 1 }, fields: ["conversationId"] },
      passedOn(options)
    );
    return records[0] ? String(records[0].id) : null;
  }

  /**
   * Takes the row for this server, if it can still be started (SKIP LOCKED: another server starting it skips it), with
   * a new run id, one more attempt and a lease of `leaseSeconds`. Inside the caller's transaction, which claims the card
   * on a first run. @returns {Promise<HeldFollowUp | null>}
   */
  async function hold(id, leaseSeconds, options) {
    const [found] = await followUps.claim({ filters: { id: String(id), startable: true } }, { ...passedOn(options), fields: [...FIELDS] });
    if (!found) return null;
    const run = { runId: randomUUID(), attempts: (Number(found.attempts) || 0) + 1 };
    await followUps.patchWhere({ id: [String(found.id)] }, { ...run, leaseUntil: secondsFromNow(leaseSeconds) }, { ...passedOn(options), returning: "none" });
    return { ...asFollowUp(found), ...run, first: found.runId == null };
  }

  /** Keeps a run's lease for `seconds` more; answers whether this server still holds it. */
  async function renew(run, seconds, options) {
    return Number(await followUps.patchWhere(ofRun(run), { leaseUntil: secondsFromNow(seconds) }, { ...passedOn(options), returning: "count" })) > 0;
  }

  /** Saves a run's steps so far, while this server holds it. */
  async function saveSteps(run, steps, options) {
    await followUps.patchWhere(ofRun(run), { steps }, { ...passedOn(options), returning: "none" });
  }

  /** Ends a run this server holds: the row goes. Answers whether it was this server's. */
  async function end(run, options) {
    return Number(await followUps.deleteWhere(ofRun(run), { ...passedOn(options), returning: "count" })) > 0;
  }

  /** Hands a run over now (its server is stopping): its lease ends, so a sweep takes it over at once. */
  async function handOver(run, options) {
    await followUps.patchWhere(ofRun(run), { leaseUntil: followUps.raw("now()") }, { ...passedOn(options), returning: "none" });
  }

  /** Closes a row no run holds now (startable): it is never started again. */
  async function close(id, options) {
    await followUps.deleteWhere({ id: [String(id)], startable: true }, { ...passedOn(options), returning: "none" });
  }

  /** A row no run holds now whose sign-in started more than `minutes` ago is closed; answers whether this one was. */
  async function closeIfOlder(id, minutes, options) {
    return Number(await followUps.deleteWhere({ id: [String(id)], startable: true, startedBefore: minutes }, { ...passedOn(options), returning: "count" })) > 0;
  }

  /** A ready row no run holds waits for its sign-in again (its app isn't connected for its chat after all). */
  async function waitAgain(id, options) {
    await followUps.patchWhere({ id: [String(id)], status: "ready", unheld: true }, { status: "waiting", leaseUntil: null }, { ...passedOn(options), returning: "none" });
  }

  /** A row no run holds now whose chat is busy: its start is due again in `seconds` (the chat's reply starts it before, as it ends). */
  async function defer(id, seconds, options) {
    await followUps.patchWhere({ id: [String(id)], startable: true }, { leaseUntil: secondsFromNow(seconds) }, { ...passedOn(options), returning: "none" });
  }

  /**
   * Removes the rows whose sign-in started more than `minutes` ago and never finished, and the ready ones no server
   * could start or carry on for that long (a start that keeps failing), so none is tried forever.
   */
  async function prune(minutes, options) {
    await followUps.deleteWhere({ expired: minutes }, { ...passedOn(options), returning: "none" });
  }

  return Object.freeze({
    withTransaction,
    wait,
    markReady,
    markOneReady,
    startable,
    due,
    startableIn,
    hold,
    renew,
    saveSteps,
    end,
    handOver,
    close,
    closeIfOlder,
    waitAgain,
    defer,
    prune
  });
}
