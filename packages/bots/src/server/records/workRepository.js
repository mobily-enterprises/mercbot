import { randomUUID } from "node:crypto";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

// The bots' queued work (D-15, D-46): requests between bots, routines, and the request cards
// in both chats. Every server runs the loops, so each next step is taken with claim() (SKIP LOCKED)
// in the runner's system context, and leases and due times use the database's clock (now()), as
// they always have, so servers with different clocks agree on what is due.

/** A request still being worked on (botRequests.js OPEN). */
export const OPEN_REQUESTS = Object.freeze(["queued", "working", "question", "waiting_approval"]);

/**
 * bot_requests filters beyond its `search: true` fields (the `owns` entry's searchSchema).
 * - due: a step waits (next_step set), its time has come and no server holds its lease;
 * - statuses: one of the listed statuses;
 * - nextStep: the step that waits, or null for none;
 * - stepWaiting: some step waits (next_step set).
 */
export const REQUEST_SEARCH = Object.freeze({
  due: {
    type: "boolean",
    applyFilter(query, _due, { column }) {
      query
        .whereNotNull(column("nextStep"))
        .whereRaw("?? <= now()", [column("runAfter")])
        .where((free) => free.whereNull(column("leaseUntil")).orWhereRaw("?? < now()", [column("leaseUntil")]));
    }
  },
  statuses: { type: "array", actualField: "status", filterOperator: "in" },
  nextStep: { type: "string", actualField: "nextStep" },
  stepWaiting: {
    type: "boolean",
    applyFilter(query, _waiting, { column }) {
      query.whereNotNull(column("nextStep"));
    }
  }
});

/**
 * bot_routines filters beyond its `search: true` fields.
 * - due: switched on, on a schedule, its next run time has come, and no run of it is in progress;
 * - stalled: a run is in progress and its server's lease has lapsed (it stopped beating);
 * - superseded: a stalled run its routine no longer wants: it was paused, or its next run has come
 *   (that run starts afresh, as runs missed while every server was down collapse into one);
 * - nameIs: the name, in any case (findRoutine).
 */
export const ROUTINE_SEARCH = Object.freeze({
  due: {
    type: "boolean",
    applyFilter(query, _due, { column }) {
      query
        .where(column("enabled"), true)
        .whereNotNull(column("cron"))
        .whereNull(column("runId"))
        .whereRaw("?? <= now()", [column("nextRunAt")]);
    }
  },
  stalled: {
    type: "boolean",
    applyFilter(query, _stalled, { column }) {
      query.whereNotNull(column("runId")).whereRaw("?? < now()", [column("runLeaseUntil")]);
    }
  },
  superseded: {
    type: "boolean",
    applyFilter(query, _superseded, { column }) {
      query.where((wanted) => wanted.where(column("enabled"), false).orWhereRaw("?? <= now()", [column("nextRunAt")]));
    }
  },
  nameIs: {
    type: "string",
    applyFilter(query, name, { column }) {
      query.whereRaw("lower(??) = lower(?)", [column("name"), String(name)]);
    }
  }
});

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

/**
 * The bots' work: requests, routines and request cards.
 * @param {{ botRequests: ResourceHandle, botRoutines: ResourceHandle, botMessages: ResourceHandle }} handles
 */
export function createWorkRepository({ botRequests, botRoutines, botMessages }) {
  /** The database's now(), as a write's value. */
  const now = () => botRequests.raw("now()");

  /**
   * The database's now() plus some seconds, as a write's value (bound, never built into the SQL).
   * @param {number} seconds
   */
  const secondsFromNow = (seconds) => botRequests.raw("now() + make_interval(secs => ?)", [Number(seconds)]);

  /**
   * One request of the caller's home, or null.
   * @param {string} requestId
   * @param {CallOptions} options
   * @param {object} [filters] what the request must also be (status, the person), compared in the same read
   */
  async function request(requestId, options, filters = {}) {
    const [found = null] = await botRequests.queryAll({ filters: { ...filters, id: String(requestId) } }, options);
    return found;
  }

  /**
   * The newest request matching the filters, or null (openFor).
   * @param {object} filters
   * @param {CallOptions} options
   */
  async function newestRequest(filters, options) {
    const { records } = await botRequests.query({ filters, sort: ["-id"], page: { size: 1 } }, options);
    return records[0] ?? null;
  }

  /**
   * A request one bot asked another for this person that isn't finished yet, or null.
   * @param {{ fromBotId: string, toBotId: string, userId: string }} between
   * @param {CallOptions} options
   */
  function openRequestBetween({ fromBotId, toBotId, userId }, options) {
    return newestRequest(
      { fromBotId: String(fromBotId), toBotId: String(toBotId), userId: String(userId), statuses: [...OPEN_REQUESTS] },
      options
    );
  }

  /**
   * Creates a request in the caller's home and answers it.
   * @param {object} fields
   * @param {CallOptions} options
   */
  function createRequest(fields, options) {
    return botRequests.create(fields, options);
  }

  /**
   * Changes a request, while it still matches `filters`, and answers it as it is now; null when it
   * no longer matches (or is gone). `changes` may hold `now()` and `secondsFromNow()` values.
   * @param {string} requestId
   * @param {object} changes
   * @param {CallOptions} options
   * @param {object} [filters] what the stored request must still be, compared under its lock
   */
  async function changeRequest(requestId, changes, options, filters = {}) {
    const [changed = null] = await botRequests.patchWhere({ ...filters, id: String(requestId) }, changes, { ...options, returning: "records" });
    return changed;
  }

  /**
   * The next due request step no other server holds, leased to this server for `leaseSeconds`; null
   * when none is due. Runs in the runner's system context, across every home; the request answers its
   * hidden workspaceId, so its step runs in its own home.
   * @param {number} leaseSeconds
   * @param {CallOptions} options the bot request runner's system context
   */
  function claimRequest(leaseSeconds, options) {
    return botRequests.withTransaction(options, async (txOptions) => {
      const [due] = await botRequests.claim(
        { filters: { due: true }, sort: ["runAfter"], take: 1 },
        { ...txOptions, fields: [...REQUEST_FIELDS, "workspaceId"] }
      );
      if (!due) return null;
      await botRequests.patchWhere({ id: due.id }, { leaseUntil: secondsFromNow(leaseSeconds) }, { ...txOptions, returning: "none" });
      return due;
    });
  }

  /**
   * Keeps a step's lease while its turn runs (the heartbeat).
   * @param {string} requestId
   * @param {number} seconds
   * @param {CallOptions} options
   */
  async function extendLease(requestId, seconds, options) {
    await botRequests.patchWhere({ id: String(requestId) }, { leaseUntil: secondsFromNow(seconds) }, { ...options, returning: "none" });
  }

  /**
   * Merges `patch` into the body of each request card (bot_messages of kind bot_request): the
   * cards in the asking and the asked bot's chats show the same state. The `changed` trigger moves
   * each card's cursor, so open pages read it again.
   * @param {string[]} messageIds
   * @param {object} patch
   * @param {CallOptions} options
   */
  async function patchCards(messageIds, patch, options) {
    if (!messageIds.length) return;
    await botMessages.patchWhere(
      { id: messageIds.map(String) },
      { body: botMessages.raw("?? || ?::jsonb", [botMessages.column("body"), JSON.stringify(patch)]) },
      { ...passedOn(options), returning: "none" }
    );
  }

  /**
   * The next due routine no other server holds, its next run time moved on before it runs,
   * so exactly one server runs it. `nextRunOf(routine)` counts the next time from now, so runs missed
   * while every server was down collapse into one. The run gets its id and a lease of `leaseSeconds`
   * (D-15), which its server renews while it runs. The routine answers its hidden workspaceId.
   * @param {(routine: object) => string | Date | null} nextRunOf
   * @param {number} leaseSeconds
   * @param {CallOptions} options the routine runner's system context
   */
  function claimRoutine(nextRunOf, leaseSeconds, options) {
    return botRoutines.withTransaction(options, async (txOptions) => {
      const [due] = await botRoutines.claim(
        { filters: { due: true }, sort: ["nextRunAt"], take: 1 },
        { ...txOptions, fields: [...ROUTINE_FIELDS, "workspaceId"] }
      );
      if (!due) return null;
      const nextRunAt = nextRunOf(due);
      const run = { runId: randomUUID(), runAttempts: 1, runSteps: null };
      await botRoutines.patchWhere(
        { id: due.id },
        { nextRunAt, lastRunAt: botRoutines.raw("now()"), ...run, runLeaseUntil: secondsFromNow(leaseSeconds) },
        { ...txOptions, returning: "none" }
      );
      return { ...due, nextRunAt, ...run };
    });
  }

  /**
   * A routine run whose server stopped (its lease lapsed), taken over by this server with a new run
   * id and lease, so the old server's writes no longer match; it carries on from the steps the run
   * saved (runSteps). A run its routine no longer wants (`superseded`) ends instead, unrun, and is
   * answered with `superseded: true`. Null when no run has stalled.
   * @param {number} leaseSeconds
   * @param {CallOptions} options the routine runner's system context
   */
  function claimStalledRoutine(leaseSeconds, options) {
    return botRoutines.withTransaction(options, async (txOptions) => {
      const [stalled] = await botRoutines.claim(
        { filters: { stalled: true }, sort: ["runLeaseUntil"], take: 1 },
        { ...txOptions, fields: [...ROUTINE_FIELDS, "workspaceId"] }
      );
      if (!stalled) return null;
      const [unwanted] = await botRoutines.queryAll({ filters: { id: stalled.id, superseded: true } }, txOptions);
      if (unwanted) {
        await botRoutines.patchWhere({ id: stalled.id }, NO_RUN, { ...txOptions, returning: "none" });
        return { ...stalled, ...NO_RUN, superseded: true };
      }
      const run = { runId: randomUUID(), runAttempts: Number(stalled.runAttempts) + 1 };
      await botRoutines.patchWhere({ id: stalled.id }, { ...run, runLeaseUntil: secondsFromNow(leaseSeconds) }, { ...txOptions, returning: "none" });
      return { ...stalled, ...run };
    });
  }

  /**
   * Changes a routine's run while this server still holds it (its run id), and answers the routine
   * as it is now; null when another server took the run over, it ended, or the routine is gone.
   * @param {{ id: string, runId: string }} run
   * @param {object} changes
   * @param {CallOptions} options
   */
  async function changeRoutineRun({ id, runId }, changes, options) {
    const [changed = null] = await botRoutines.patchWhere({ id: String(id), runId: String(runId) }, changes, { ...options, returning: "records" });
    return changed;
  }

  /**
   * Keeps a routine run's lease for `seconds` more (the heartbeat); answers whether this server still holds it.
   * @param {{ id: string, runId: string }} run
   * @param {number} seconds
   * @param {CallOptions} options
   */
  async function renewRoutineRun(run, seconds, options) {
    return Boolean(await changeRoutineRun(run, { runLeaseUntil: secondsFromNow(seconds) }, options));
  }

  /**
   * Ends a routine's run held by this server, counting its failures in a row: a failed run adds one,
   * any other starts again from none. Answers the routine as it is now, or null when the run wasn't
   * this server's any more.
   * @param {{ id: string, runId: string }} run
   * @param {{ failed: boolean }} outcome
   * @param {CallOptions} options
   */
  function endRoutineRun(run, { failed }, options) {
    const failures = failed ? botRoutines.raw("?? + 1", [botRoutines.column("failures")]) : 0;
    return changeRoutineRun(run, { ...NO_RUN, failures }, options);
  }

  /**
   * A conversation's routines, in id order.
   * @param {string} conversationId
   * @param {CallOptions} options
   */
  function routinesOf(conversationId, options) {
    return botRoutines.queryAll({ filters: { conversationId: String(conversationId) }, sort: ["id"] }, options);
  }

  /**
   * The conversation's routine with this name, in any case, or null (findRoutine).
   * @param {string} conversationId
   * @param {string} name
   * @param {CallOptions} options
   */
  async function routineNamed(conversationId, name, options) {
    const { records } = await botRoutines.query({ filters: { conversationId: String(conversationId), nameIs: String(name) }, sort: ["id"], page: { size: 1 } }, options);
    return records[0] ?? null;
  }

  /**
   * A routine of the conversation by id, or null.
   * @param {string} routineId
   * @param {string} conversationId
   * @param {CallOptions} options
   */
  async function routineOf(routineId, conversationId, options) {
    const filters = { id: String(routineId), conversationId: String(conversationId) };
    const [found = null] = await botRoutines.queryAll({ filters }, options);
    return found;
  }

  /**
   * @param {object} fields
   * @param {CallOptions} options
   */
  async function createRoutine(fields, options) {
    await botRoutines.create(fields, { ...options, returning: "none" });
  }

  /**
   * Changes a routine and answers it, or null when it is gone.
   * @param {string} routineId
   * @param {object} changes
   * @param {CallOptions} options
   */
  async function changeRoutine(routineId, changes, options) {
    const [changed = null] = await botRoutines.patchWhere({ id: String(routineId) }, changes, { ...options, returning: "records" });
    return changed;
  }

  /**
   * Deletes a routine of the conversation; answers whether one was deleted.
   * @param {string} routineId
   * @param {string} conversationId
   * @param {CallOptions} options
   */
  async function deleteRoutine(routineId, conversationId, options) {
    const deleted = await botRoutines.deleteWhere({ id: String(routineId), conversationId: String(conversationId) }, { ...options, returning: "count" });
    return Number(deleted) > 0;
  }

  return Object.freeze({
    /** One transaction for several work writes (a request and its two cards): `withTransaction(options, (txOptions) => ...)`. */
    withTransaction: botRequests.withTransaction,
    now,
    secondsFromNow,
    request,
    newestRequest,
    openRequestBetween,
    createRequest,
    changeRequest,
    claimRequest,
    extendLease,
    patchCards,
    claimRoutine,
    claimStalledRoutine,
    changeRoutineRun,
    renewRoutineRun,
    endRoutineRun,
    routinesOf,
    routineNamed,
    routineOf,
    createRoutine,
    changeRoutine,
    deleteRoutine
  });
}

// What a claimed request and routine read: every stored field, as a plain read answers them.
const REQUEST_FIELDS = Object.freeze([
  "answer", "attempts", "brief", "chain", "createdAt", "deadlineAt", "depth", "fromBotId", "fromConversationId", "fromMessageId", "kind",
  "language", "lastError", "leaseUntil", "nextStep", "parentId", "question", "questions", "reply", "runAfter", "status", "timeZone",
  "toBotId", "toConversationId", "toMessageId", "turns", "updatedAt", "userId"
]);
const ROUTINE_FIELDS = Object.freeze([
  "botId", "conversationId", "createdAt", "cron", "enabled", "failures", "instructions", "lastRunAt", "name", "nextRunAt", "once", "runAttempts",
  "runId", "runLeaseUntil", "runSteps", "schedule", "timezone"
]);
/** A routine with no run in progress. */
const NO_RUN = Object.freeze({ runId: null, runAttempts: 0, runLeaseUntil: null, runSteps: null });
