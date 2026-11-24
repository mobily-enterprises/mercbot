import { agentResources } from "@jskit-ai/agent-runtime/server";

// @jskit-ai/agent-runtime's tables, with the columns mercbot adds: a run also knows its bot and the
// person it answers (D-112); a goal its home, bot and person. Runs, goals and commands are keyed by the
// bot in the chat (chat_bots.id) as the runtime's conversation id, and summaries by the chat. agent-runtime
// declares them system tables: only their owner's system context reaches them, never a request's.
const AGENT_TABLES = agentResources({
  columns: {
    runs: { bot_id: { type: "id", required: true }, user_id: { type: "id", required: true } },
    goals: {
      workspace_id: { type: "id", required: true },
      bot_id: { type: "id", required: true },
      user_id: { type: "id", required: true }
    }
  }
});

/** The agent tables in an owns list: runs, goals, summaries, the summary queue and commands. */
export const AGENT_TABLE_RESOURCES = Object.freeze(Object.values(AGENT_TABLES));

/**
 * agent-runtime's runs (createRuns) whose claim first looks: a run there and still beating answers busy without an
 * insert. Its own claim inserts the run and reads a refused duplicate as busy, but json-rest-api logs every refused
 * insert at error level ("Error in POST method") before the claim handles it, and a request's step or a goal round
 * tries a busy bot again every few seconds, so each try logged an error while the bot worked. A run whose server
 * stopped beating, and a free slot, are claimed by agent-runtime as before, the database deciding: a run that ends
 * between the look and the claim is at worst tried again, as any busy one is.
 * @param {import("@jskit-ai/agent-runtime/server/types").AgentRuns} runs
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} agentRuns the runs' handle
 * @param {Readonly<{ context: object }>} options the owner's system context
 */
export function lookingRuns(runs, agentRuns, options) {
  async function running(conversationId) {
    const id = String(conversationId);
    if (!(await agentRuns.get(id, { fields: ["id"] }, { ...options, missing: "skip" }))) return false;
    const filters = { id, staleFor: Number(runs.limits.staleSeconds) };
    const { records: stale } = await agentRuns.query({ filters, fields: ["id"], page: { size: 1 } }, options);
    return !stale.length;
  }
  /**
   * In the transaction that posts a person's reply (txOptions): its run's steps and input go, so a run whose reply was
   * posted is never carried on again, even when its server stops before freeing it just after (release).
   */
  async function settle(conversationId, txOptions) {
    await agentRuns.patch(String(conversationId), { steps: null, input: null }, { ...options, trx: txOptions.trx, missing: "skip" });
  }
  /**
   * A person's reply's hold on its run, from just after its claim (botReplies.js runReply): the run is the reply's while
   * it's the one that claim started (started_at), since a server that takes it over (this one stalled past the
   * staleness) starts it again. Each write locks the run's row and goes through only while the reply holds it, and
   * answers whether it did, so a reply whose run was taken over keeps, posts and frees nothing.
   */
  async function hold(conversationId) {
    const id = String(conversationId);
    const claimed = await agentRuns.get(id, { fields: ["started_at"] }, { ...options, missing: "skip" });
    const start = claimed ? new Date(claimed.started_at).getTime() : NaN;
    const writing = (txOptions) => ({ ...options, trx: txOptions.trx, missing: "skip" });
    const now = () => agentRuns.raw("now()");
    async function holds(txOptions) {
      const run = await agentRuns.lock(id, { ...writing(txOptions), fields: ["started_at"] });
      return Boolean(run) && new Date(run.started_at).getTime() === start;
    }
    const whileHeld = (write) => agentRuns.withTransaction(options, async (txOptions) => {
      if (!(await holds(txOptions))) return false;
      await write(txOptions);
      return true;
    });
    return Object.freeze({
      /** Its heartbeat. */
      beat: () => whileHeld((txOptions) => agentRuns.patch(id, { heartbeat_at: now() }, writing(txOptions))),
      /** Its steps so far, and what started it. */
      save: (steps, input) => whileHeld((txOptions) => agentRuns.patch(id, { steps, input, heartbeat_at: now() }, writing(txOptions))),
      /** In the transaction that posts its reply (txOptions): its steps and input go, as settle's do. */
      settle: async (txOptions) => {
        if (!(await holds(txOptions))) return false;
        await agentRuns.patch(id, { steps: null, input: null }, writing(txOptions));
        return true;
      },
      release: () => whileHeld((txOptions) => agentRuns.delete(id, writing(txOptions)))
    });
  }
  return Object.freeze({
    ...runs,
    claim: async (conversationId, owner) => !(await running(conversationId)) && runs.claim(conversationId, owner),
    settle,
    hold
  });
}
