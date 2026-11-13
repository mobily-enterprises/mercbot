import { passedOn } from "@jskit-ai/resource-runtime/server";

// The bots' command runs (shell_runs), each a home's (D-47): the shell's own writes of a run it
// started, the sweep that stops runs whose server went away, and the reads a bot's tools make in
// their own call's home. The shell's writes and the sweep run on no request, so they use this
// feature's system context: a run's for the home it runs in, the sweep's for every home. The
// database's clock (now()) times the heartbeats, as every server reads them.

const RUN_FIELDS = Object.freeze([
  "botId", "conversationId", "userId", "why", "script", "server", "status", "exitCode", "output", "changed", "background",
  "startedAt", "finishedAt", "heartbeatAt"
]);

/** The search entries shell_runs' owns entry adds: runs whose heartbeat is older than some seconds; runs started before a time. */
export const SHELL_RUN_FILTERS = Object.freeze({
  heartbeatOlderThan: {
    type: "integer",
    applyFilter(query, seconds, { column }) {
      query.whereRaw("?? < now() - make_interval(secs => ?)", [column("heartbeatAt"), Number(seconds)]);
    }
  },
  startedBefore: {
    type: "string",
    applyFilter(query, before, { column }) {
      query.whereRaw("?? < ?::timestamptz", [column("startedAt"), String(before)]);
    }
  }
});

/**
 * A run as the shell's callers read it: today's snake_case shell_runs row (bots botLoops.js and
 * commandTools.js).
 * @param {Record<string, any>} record
 * @param {string | number} workspaceId the run's home
 */
function asRunRow(record, workspaceId) {
  return {
    id: String(record.id),
    workspace_id: String(workspaceId),
    bot_id: record.botId == null ? null : String(record.botId),
    conversation_id: record.conversationId == null ? null : String(record.conversationId),
    user_id: record.userId == null ? null : String(record.userId),
    why: record.why,
    script: record.script,
    server: record.server,
    status: record.status,
    exit_code: record.exitCode ?? null,
    output: record.output,
    changed: record.changed,
    background: record.background,
    started_at: record.startedAt,
    finished_at: record.finishedAt ?? null,
    heartbeat_at: record.heartbeatAt
  };
}

/**
 * @param {object} dependencies
 * @param {object} dependencies.shellRuns the shell_runs handle
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 */
export function createShellRuns({ shellRuns, systemContext }) {
  /** The options of the shell's own writes of a run, in the home it runs in. */
  function inHome(workspaceId) {
    return { context: systemContext("start, beat and finish a bot's command runs in the home they run in").forWorkspace(String(workspaceId)) };
  }

  /** A new run, running: its row. */
  async function begin(workspaceId, { botId, conversationId, userId, why, script, server }) {
    const record = await shellRuns.create({ botId: String(botId), conversationId, userId, why, script, server }, inHome(workspaceId));
    return asRunRow(record, workspaceId);
  }

  /** A running run's heartbeat and output so far. */
  function beat(row, output) {
    return shellRuns.patchWhere(
      { id: row.id, status: "running" },
      { heartbeatAt: shellRuns.raw("now()"), output },
      { ...inHome(row.workspace_id), returning: "none" }
    );
  }

  /** A run's ending, written once while it is still running: its row, or null when the sweep stopped it first. */
  async function finish(row, { status, exitCode, output, changed }) {
    const [ended] = await shellRuns.patchWhere(
      { id: row.id, status: "running" },
      { status, exitCode, output, changed, finishedAt: shellRuns.raw("now()"), heartbeatAt: shellRuns.raw("now()") },
      { ...inHome(row.workspace_id), returning: "records" }
    );
    return ended ? asRunRow(ended, row.workspace_id) : null;
  }

  /** The run went on in the background. */
  function inBackground(row) {
    return shellRuns.patch(row.id, { background: true }, { ...inHome(row.workspace_id), returning: "none", missing: "skip" });
  }

  /**
   * Runs whose server stopped heartbeating, in every home: marked stopped once, here or on any
   * other server. Answers their rows.
   */
  async function stopStale(staleSeconds) {
    const system = { context: systemContext("stop the command runs whose server stopped heartbeating, in every home") };
    const ids = await shellRuns.patchWhere(
      { status: "running", heartbeatOlderThan: Number(staleSeconds) },
      { status: "stopped", finishedAt: shellRuns.raw("now()") },
      { ...system, returning: "ids" }
    );
    if (!ids.length) return [];
    const stopped = await shellRuns.queryAll({ filters: { id: ids }, fields: [...RUN_FIELDS, "workspaceId"] }, system);
    return stopped.map((record) => asRunRow(record, record.workspaceId));
  }

  /**
   * Whether a command of the home that started before `before` (an ISO time) is still running: a move of the home's
   * files waits for it, as it may still write there (D-80).
   */
  async function runningBefore(workspaceId, before) {
    const found = await shellRuns.queryAll(
      { filters: { status: "running", startedBefore: before }, fields: ["id"], take: 1 },
      inHome(workspaceId)
    );
    return found.length > 0;
  }

  /** One run of the call's home, or null. */
  async function find(runId, options) {
    const id = String(runId ?? "");
    if (!/^\d+$/u.test(id)) return null;
    const record = await shellRuns.get(id, { fields: RUN_FIELDS }, { ...passedOn(options), missing: "skip" });
    return record ? { ...record, id: String(record.id) } : null;
  }

  /**
   * A run of one conversation in the call's home, for reading its whole output (bots commandTools.js).
   * @param {string} runId
   * @param {string} conversationId
   * @param {object} options
   * @returns {Promise<{ id: string, conversationId: string, output: string, status: string } | null>}
   */
  async function commandOutput(runId, conversationId, options) {
    const id = String(runId ?? "");
    if (!/^\d+$/u.test(id) || conversationId == null) return null;
    const [record] = await shellRuns.queryAll(
      { filters: { id, conversationId: String(conversationId) }, fields: ["conversationId", "output", "status"] },
      passedOn(options)
    );
    if (!record) return null;
    return { id: String(record.id), conversationId: String(record.conversationId), output: record.output, status: record.status };
  }

  return Object.freeze({
    begin,
    beat,
    finish,
    inBackground,
    stopStale,
    runningBefore,
    find,
    commandOutput
  });
}
