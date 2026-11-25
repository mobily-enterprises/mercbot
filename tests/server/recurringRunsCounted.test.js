import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMeter, createMeteredFetch, refusalOf, refuseWork } from "../../packages/account/src/server/meter.js";
import { createBackgroundRuns } from "../../packages/bots/src/server/backgroundRuns.js";

// A recurring task's run counts once its bot works (D-132): when the run's first AI call goes out. A run in a home its
// copy has paused, or whose work is refused, only says why (D-73) and isn't a run: not in its day's runs, not its last
// run, and not one of a watch's runs in the hour. Counted once, by the server that started it.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const seat = { id: "7", chat_id: "9", user_id: "3", workspace_id: "5" };
const routine = { id: "11", chatBotId: "8", workspaceId: "5", madeBy: "3", name: "Check", schedule: "Every hour", instructions: "Check", timezone: "UTC" };
const watchJob = { id: "21", kind: "watch", watchId: "31", botId: "7", chatBotId: "8", workspaceId: "5", userId: "3", title: "Watch: New deals", prompt: "Watch run" };

/** The background runs with a meter whose recorder refuses calls while `refusing`, and what they wrote of each run. */
function backgroundRuns(respond, { refusing = false } = {}) {
  globalThis.fetch = async () => new Response(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { "content-type": "application/json" } });
  const written = { counted: [], lastRuns: [], watchRuns: [] };
  const recorder = {
    open: async () => {
      if (refusing) throw refuseWork("This home's work is paused.", { code: "work_paused" });
      return { id: "1" };
    },
    finish: async () => true
  };
  const meter = { ...createMeter({ recorder }), countTaskRun: async (run) => (written.counted.push(run), true) };
  const runs = createBackgroundRuns({
    records: { work: { changeRoutine: async (id, changes) => (written.lastRuns.push([id, typeof changes.lastRunAt]), {}) } },
    systemContext: () => ({ forWorkspace: () => ({}) }),
    meter,
    seats: { backgroundSeat: async () => ({ seat, call: {} }), working: async () => {}, tell: async () => {}, say: async () => [] },
    jobs: null,
    watches: { ran: async (watchId) => written.watchRuns.push(watchId) },
    respond
  });
  return { runs, written };
}

const aiCall = () => createMeteredFetch({}, "deepinfra")("https://provider", { method: "POST", body: "{}" });
// A turn in a paused home says why without calling the AI; one refused at its first call says the same (botReplies).
const pausedTurn = async () => [];
const refusedTurn = async () => aiCall().then(() => [], (error) => (refusalOf(error) ? [] : Promise.reject(error)));
const workingTurn = async () => {
  await aiCall();
  await aiCall();
  return [];
};

test("a routine's run that only says its home is paused, or whose work is refused, isn't counted; one that works is, once", async () => {
  for (const [respond, refusing] of [[pausedTurn, false], [refusedTurn, true]]) {
    const { runs, written } = backgroundRuns(respond, { refusing });
    await runs.runRoutine({ ...routine, runAttempts: 1 });
    assert.deepEqual(written, { counted: [], lastRuns: [], watchRuns: [] }, "no run, and no last run");
  }
  const { runs, written } = backgroundRuns(workingTurn);
  await runs.runRoutine({ ...routine, runAttempts: 1 });
  assert.deepEqual(written.counted, [{ kind: "routine", id: "11", workspaceId: "5", userId: "3" }], "one run for its two calls");
  assert.deepEqual(written.lastRuns, [["11", "string"]], "and it's the routine's last run");
  await runs.runRoutine({ ...routine, runAttempts: 2 });
  assert.equal(written.counted.length, 1, "a run carried on after its server stopped isn't counted again");
  assert.equal(written.lastRuns.length, 1);
});

test("a watch's run counts as a routine's does, and is one of its runs in the hour; other tasks aren't recurring", async () => {
  for (const [respond, refusing] of [[pausedTurn, false], [refusedTurn, true]]) {
    const { runs, written } = backgroundRuns(respond, { refusing });
    await runs.runAppTask({ ...watchJob, attempts: 1 });
    assert.deepEqual(written, { counted: [], lastRuns: [], watchRuns: [] });
  }
  const { runs, written } = backgroundRuns(workingTurn);
  await runs.runAppTask({ ...watchJob, attempts: 1 });
  assert.deepEqual(written.counted, [{ kind: "watch", id: "31", workspaceId: "5", userId: "3" }]);
  assert.deepEqual(written.watchRuns, ["31"], "the watch's run, once, for its limit and its last run");
  await runs.runAppTask({ ...watchJob, attempts: 2 });
  await runs.runAppTask({ ...watchJob, kind: "handoff", watchId: null, title: "Task from Deals", attempts: 1 });
  assert.equal(written.counted.length, 1);
  assert.deepEqual(written.watchRuns, ["31"]);
});
