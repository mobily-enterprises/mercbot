/**
 * The apps platform's reports its handles cannot express (Layer 5): each a scoped query on the
 * owner's own tables, under the call's options, with other tables joined only as their scoped
 * subqueries. audit_events.xid (xid8) is no resource field and no filter reads it, so the
 * reads by transaction id say which columns they compare in SQL.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources the apps
 *   feature's handles
 */
export function createAppsRepository({ appWatches, appScripts, appScriptRuns, auditEvents }) {
  const audit = (field) => auditEvents.column(field, "e");

  // Knex: report - the enabled watches with audit entries on their table between their cursor and the horizon, in id
  // order (the watch loop's candidates, claimed next with SKIP LOCKED)
  async function watchesWithNews(horizon, options) {
    const { query: news } = await auditEvents.scopedQuery({ alias: "e" }, options);
    news
      .select(audit("id"))
      .whereColumn(audit("workspaceId"), appWatches.column("workspaceId", "w"))
      .whereColumn(audit("tableId"), appWatches.column("tableId", "w"))
      .whereRaw("e.xid >= w.cursor and e.xid < ?::xid8", [horizon]);
    const { query } = await appWatches.scopedQuery({ alias: "w", filters: { enabled: true } }, options);
    const rows = await query.select({ id: appWatches.column("id", "w") }).whereExists(news).orderBy(appWatches.column("id", "w"));
    return rows.map((row) => String(row.id));
  }

  // Knex: report - the enabled jobs that watch a table with audit entries on it between their cursor and the horizon,
  // in id order (the due scripts' candidates, claimed next with SKIP LOCKED)
  async function watchingScriptsWithNews(horizon, options) {
    const { query: news } = await auditEvents.scopedQuery({ alias: "e" }, options);
    news
      .select(audit("id"))
      .whereColumn(audit("workspaceId"), appScripts.column("workspaceId", "s"))
      .whereRaw("e.table_id = s.settings->'watch'->>'table' and e.xid >= s.cursor and e.xid < ?::xid8", [horizon]);
    const { query } = await appScripts.scopedQuery({ alias: "s", filters: { kind: "job", enabled: true } }, options);
    const rows = await query
      .select({ id: appScripts.column("id", "s") })
      .whereNotNull(appScripts.column("cursor", "s"))
      .whereExists(news)
      .orderBy(appScripts.column("id", "s"));
    return rows.map((row) => String(row.id));
  }

  /**
   * A table's audit entries of the given actions between a cursor and the horizon, after an entry id: a page in id
   * order (what a watch or a watching job reads).
   */
  async function changesBetween({ tableId, actions, cursor, horizon, after, limit }, options) {
    const filters = { tableId, actions, changedSince: cursor, changedBefore: horizon, ...(after ? { afterId: after } : {}) };
    return (await auditEvents.query({ filters, sort: ["id"], page: { size: limit } }, options)).records;
  }

  // Knex: newest-per-group - each script's latest `runs` runs, however many scripts: the scripts' scoped runs numbered
  // newest first per script, so each script reads only its own runs, at most RUNS_KEPT of them (scripts.js prunes the
  // rest). A scoped builder can't join laterally, which would read only the newest `runs` of each.
  async function latestRuns(scriptIds, runs, options) {
    if (!scriptIds.length || runs < 1) return [];
    const { query: numbered } = await appScriptRuns.scopedQuery({ alias: "r" }, options);
    numbered
      .select("r.*")
      .select(appScriptRuns.raw("row_number() over (partition by ?? order by ?? desc) as n", [
        appScriptRuns.column("scriptId", "r"),
        appScriptRuns.column("id", "r")
      ]))
      .whereIn(appScriptRuns.column("scriptId", "r"), scriptIds);
    const { query } = await appScripts.scopedQuery({ alias: "s", filters: { id: scriptIds } }, options);
    const rows = await query
      .join(numbered.as("runs"), "runs.script_id", appScripts.column("id", "s"))
      .where("runs.n", "<=", runs)
      .select({
        scriptId: "runs.script_id",
        id: "runs.id",
        startedAt: "runs.started_at",
        ok: "runs.ok",
        ms: "runs.ms",
        calls: "runs.calls",
        error: "runs.error",
        log: "runs.log",
        via: "runs.via"
      })
      .orderBy([{ column: "runs.script_id" }, { column: "runs.id", order: "desc" }]);
    return rows.map((row) => ({ ...row, scriptId: String(row.scriptId) }));
  }

  // Knex: newest-per-group - the ids of each script's runs past its newest `kept`, which the prune deletes
  async function runsPastNewest(kept, options) {
    const { query: ranked } = await appScriptRuns.scopedQuery({ alias: "k" }, options);
    ranked
      .select({ id: appScriptRuns.column("id", "k") })
      .select(appScriptRuns.raw("row_number() over (partition by ?? order by ?? desc) as n", [
        appScriptRuns.column("scriptId", "k"),
        appScriptRuns.column("id", "k")
      ]));
    const { query } = await appScriptRuns.scopedQuery({ alias: "r" }, options);
    const rows = await query
      .join(ranked.as("ranked"), "ranked.id", appScriptRuns.column("id", "r"))
      .where("ranked.n", ">", kept)
      .select({ id: appScriptRuns.column("id", "r") });
    return rows.map((row) => String(row.id));
  }

  // Knex: report - one step of a loose index scan over ix_audit_events_actor (workspace_id, actor id, id desc): the
  // first entry past `afterId` in the index's own order, which is the next actor's latest entry, so the Activity
  // filter costs a step per actor, never the home's whole history. A scoped builder cannot express the recursive CTE
  // that took every step in one statement (a JSKIT engine gap)
  async function nextActor(afterId, options) {
    const { query } = await auditEvents.scopedQuery({ alias: "e" }, options);
    const actorId = auditEvents.raw("??->>'id'", [audit("actor")]);
    query.select({ actor: audit("actor") }).whereNotNull(actorId);
    if (afterId !== null) query.where(actorId, ">", afterId);
    const row = await query.orderBy(actorId).orderBy(audit("id"), "desc").first();
    return row?.actor ?? null;
  }

  return Object.freeze({
    watchesWithNews,
    watchingScriptsWithNews,
    changesBetween,
    latestRuns,
    runsPastNewest,
    nextActor
  });
}
