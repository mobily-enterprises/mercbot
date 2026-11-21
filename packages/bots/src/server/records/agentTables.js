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
