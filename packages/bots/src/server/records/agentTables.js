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
  return Object.freeze({
    ...runs,
    claim: async (conversationId, owner) => !(await running(conversationId)) && runs.claim(conversationId, owner)
  });
}
