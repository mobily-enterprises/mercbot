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
    startBrowser: async (computer) => {
      started.push(computer.computerId);
      throw new Error("A stand-in for the desktop and Chrome.");
    }
  });
  await manager.shutdown();
  await assert.rejects(manager.wake("7"), { statusCode: 503, code: "computer_server_stopping" });
  assert.deepEqual(started, []);
});
