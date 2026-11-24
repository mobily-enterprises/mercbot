import assert from "node:assert/strict";
import test from "node:test";
import { createBotLoops } from "../../packages/bots/src/server/botLoops.js";

// The bots' background loops (botLoops.js, D-15, D-19) around stand-ins of what they claim from: nothing is due, so
// what's checked is how they start and drain. A server shuts its features down in the reverse of their start
// (@jskit-ai/kernel's capability runtime), so Bots drains before Files, which it requires, and Files' drain then stops
// each command still running (shell.js drain): a background one must still wake its bot, as a coding run's end does.

const systemContext = (reason) => ({ reason, forWorkspace: (workspaceId) => ({ reason, workspaceId }) });
const idle = () => ({ drain: async () => {} });

function startLoops() {
  const ends = new Set();
  const queued = [];
  const loops = createBotLoops({
    records: {
      work: { claimRoutine: async () => null, claimStalledRoutine: async () => null, now: () => new Date() },
      pushQueue: { takeDue: async () => [] },
      directory: { seats: async (ids) => ids.map((id) => ({ id, botId: "21" })) }
    },
    systemContext,
    notices: { subscribe: () => () => {} },
    files: {
      shell: {
        startSweeping: () => {},
        onEnd: (handler) => {
          ends.add(handler);
          return () => ends.delete(handler);
        }
      }
    },
    apps: {
      jobs: { withTransaction: (options, work) => work(options), claimNext: async () => null, claimStalled: async () => null },
      apps: { queueTask: async (task, options) => queued.push({ task, options }) }
    },
    bots: {
      runRoutine: async () => {},
      runAppTask: async () => {},
      compaction: { start: idle },
      requests: { start: idle },
      goals: { start: idle },
      startResumer: idle,
      connectFollowUps: { startSweeping: idle },
      knowledge: { start: idle },
      roomsMemory: { start: idle },
      handOverReplies: async () => 0,
      drain: async () => {}
    },
    push: { enabled: false },
    workspaces: { findById: async () => null }
  });
  loops.start();
  /** A command's end, as the shell passes it to its end handlers: its shell_runs row. */
  const end = async (row) => {
    for (const handler of [...ends]) await handler(row);
  };
  return { loops, end, queued };
}

const stoppedRun = { id: "7", workspace_id: "3", chat_bot_id: "11", user_id: "5", status: "stopped", why: "build the site", script: "npm run build", output: "", changed: [] };

test("a background command stopped by its server's shutdown, after the bots' loops drained, still wakes its bot in its chat", async () => {
  const { loops, end, queued } = startLoops();
  await loops.drain(1000);
  await end(stoppedRun);
  assert.equal(queued.length, 1, "its bot is told");
  assert.deepEqual(
    { ...queued[0].task, prompt: undefined },
    { kind: "shell", botId: "21", chatBotId: "11", userId: "5", title: "Command stopped", prompt: undefined }
  );
  assert.match(queued[0].task.prompt, /stopped before it finished, because its server shut down/u);
  assert.equal(queued[0].options.context.workspaceId, "3", "in the command's own home");
});

test("a background command that ends while the server serves wakes its bot the same way", async (context) => {
  const { loops, end, queued } = startLoops();
  context.after(() => loops.drain(1000));
  await end({ ...stoppedRun, status: "done", exit_code: 0 });
  assert.deepEqual(queued.map(({ task }) => task.title), ["Command finished"]);
});
