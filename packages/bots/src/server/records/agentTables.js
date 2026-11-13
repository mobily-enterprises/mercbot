import { agentResources } from "@jskit-ai/agent-runtime/server";

// @jskit-ai/agent-runtime's tables, with the columns mercbot adds (its baseline migration): a
// run also knows its bot; a goal its home, bot and person. agent-runtime declares them system tables:
// only their owner's system context reaches them, never a request's.
const AGENT_TABLES = agentResources({
  columns: {
    runs: { bot_id: { type: "id", required: true } },
    goals: {
      workspace_id: { type: "id", required: true },
      bot_id: { type: "id", required: true },
      user_id: { type: "id", required: true }
    }
  }
});

/** The agent tables in an owns list: runs, goals, summaries, the summary queue and commands. */
export const AGENT_TABLE_RESOURCES = Object.freeze(Object.values(AGENT_TABLES));
