import { refuse } from "./visitorAccess.js";

// The Activity filter's actors: every person, bot and script of a home that changed something.
const ACTORS_MAX = 1000;

/**
 * A home's audit trail as the Data tab's Activity reads it: entries by table, app, person and day, and everyone who
 * changed something. A visitor's ctx is refused, as for every read of the trail.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.auditEvents
 * @param {{ nextActor: (afterId: string | null, options: object) => Promise<object | null> }} dependencies.repository
 */
export function createAuditReads({ auditEvents, repository }) {
  /** The newest audit entries the filters select, up to `limit`: one page. */
  async function newestAudits(filters, limit, options) {
    return (await auditEvents.query({ filters, sort: ["-id"], page: { size: limit } }, options)).records;
  }

  /** The audit trail of a home, newest first, by table, app or person; `before` pages by id. */
  async function activity(ctx, { table = null, app = null, actor = null, from = null, to = null, before = null, limit = 50 } = {}) {
    refuse(ctx);
    const filters = {
      ...(table ? { tableId: table } : {}),
      ...(app ? { viaApp: String(app) } : {}),
      ...(actor ? { actorId: String(actor) } : {}),
      ...(from ? { atFrom: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { atBefore: new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString() } : {}),
      ...(before ? { beforeId: String(before) } : {})
    };
    return (await newestAudits(filters, Math.min(Number(limit) || 50, 200), ctx.options)).map((entry) => ({
      id: String(entry.id),
      at: entry.at,
      actor: entry.actor,
      via: entry.via,
      tableId: entry.tableId,
      recordId: entry.recordId,
      action: entry.action,
      changes: entry.changes
    }));
  }

  /**
   * Everyone and every bot that has changed something in this home, for the Activity filter: one
   * entry per actor id, with the type and name of their latest entry. A loose index scan over
   * ix_audit_events_actor (workspace_id, actor id, id desc): each step reads the first entry past the
   * previous actor in the index's own order, which is the next actor's latest, so the cost grows with
   * the number of actors, not with the home's history. Asking for "the latest entry of actor X" apart
   * instead lets the planner walk the home's entries newest first until it meets X, which for someone
   * who changed something long ago is the whole history.
   */
  async function actors(ctx) {
    refuse(ctx);
    const found = [];
    // One statement per actor, the loose index scan's steps (nextActor); past ACTORS_MAX the filter lists the first ones.
    for (let actor = await repository.nextActor(null, ctx.options); actor && found.length < ACTORS_MAX; ) {
      found.push({ id: String(actor.id), type: actor.type ?? null, name: actor.name ?? null });
      actor = await repository.nextActor(String(actor.id), ctx.options);
    }
    return found;
  }

  return Object.freeze({
    newestAudits,
    activity,
    actors
  });
}
