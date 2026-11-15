import assert from "node:assert/strict";
import test from "node:test";
import { createComputerManager } from "../../packages/computer/src/server/computerManager.js";

// D-19: a stopping server has put its computers away, and a bot's turn still running there starts none again, as
// nothing would put it away.
test("once its server is stopping, no computer starts there again", async () => {
  const started = [];
  const manager = createComputerManager({
    env: {},
    changed: () => {},
    store: async () => "",
    state: {},
    apps: { launchers: async () => [], closed: async () => {}, command: async () => [] },
    browser: async () => null,
    cdp: { route: () => ({ browserUrl: async () => "", close: () => {} }) },
    coding: { stop: async () => {} },
    withDay: (_computerId, start) => start(),
    noted: () => {},
    startBrowser: async (computer) => {
      started.push(computer.computerId);
      throw new Error("A stand-in for the desktop and Chrome.");
    }
  });
  await manager.shutdown();
  await assert.rejects(manager.wake("7"), { statusCode: 503, code: "computer_server_stopping" });
  assert.deepEqual(started, []);
});

// D-88: with every place taken, a wake puts the least recently used computer that isn't busy to sleep and says so;
// when every computer here stays busy for 90 seconds, the wake is refused and says that too. The clock is a test's own,
// and a startBrowser that never finishes holds each computer in "waking", which takes a place as an awake one does.
test("a computer put to sleep to make room, and one refused because every computer stayed busy, are told", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1_000_000 });
  const events = [];
  const starts = [];
  const manager = createComputerManager({
    env: {},
    maxAwake: 1,
    changed: () => {},
    store: async () => "",
    state: {},
    apps: { launchers: async () => [], closed: async () => {}, command: async () => [] },
    browser: async () => null,
    cdp: { route: () => ({ browserUrl: async () => "", close: () => {} }) },
    // Computer 2 is in the middle of a coding run, so it's busy for as long as it's awake.
    coding: { stop: async () => {}, running: (computer) => computer.computerId === "2" },
    withDay: (_computerId, start) => start(),
    noted: (event) => events.push(event),
    startBrowser: () => new Promise((_resolve, reject) => starts.push(reject))
  });
  const settle = async () => {
    for (let round = 0; round < 5; round += 1) await new Promise(setImmediate);
  };
  const woken = (computerId) => manager.wake(computerId).catch((error) => error);

  // Computer 1 takes the only place; a minute on it isn't busy, so computer 2's wake puts it to sleep.
  const first = woken("1");
  await settle();
  context.mock.timers.tick(61_000);
  const second = woken("2");
  await settle();
  assert.equal(manager.status("1").state, "asleep");
  assert.deepEqual(events, [{ kind: "made_room", computerId: "1" }]);

  // Computer 3 waits for a place that never comes free, and after 90 seconds it is refused.
  const third = woken("3");
  for (let waited = 0; waited <= 92_000; waited += 2_000) {
    context.mock.timers.tick(2_000);
    await settle();
  }
  assert.match((await third).message, /All 1 computers are in use right now/u);
  assert.deepEqual(events, [{ kind: "made_room", computerId: "1" }, { kind: "refused", computerId: "3", code: "computer_all_busy" }]);

  for (const reject of starts) reject(new Error("A stand-in for the desktop and Chrome."));
  await Promise.all([first, second]);
  await manager.shutdown();
});
