import assert from "node:assert/strict";
import test from "node:test";
import { standInDesktops } from "../../packages/computer/src/server/standInDesktops.js";

// The Test Preview's computers (MERCBOT_TEST_DESKTOPS=stand-in): only outside staging and production (D-87), and they
// do what a browser test asks of a chat's computer without starting anything.
test("stand-in computers are the Test Preview's only: never in staging or production, nor when not asked for", () => {
  assert.equal(standInDesktops({}), null);
  assert.equal(standInDesktops({ MERCBOT_TEST_DESKTOPS: "real" }), null);
  assert.equal(standInDesktops({ MERCBOT_TEST_DESKTOPS: "stand-in", APP_ENV: "staging" }), null);
  assert.equal(standInDesktops({ MERCBOT_TEST_DESKTOPS: "stand-in", APP_ENV: "production" }), null);
  assert.equal(typeof standInDesktops({ MERCBOT_TEST_DESKTOPS: "stand-in", APP_ENV: "development" }), "function");
});

test("a stand-in computer wakes, browses with a real screenshot, records and sleeps, saying each change", async () => {
  const changes = [];
  const stored = [];
  const manager = standInDesktops({ MERCBOT_TEST_DESKTOPS: "stand-in", APP_ENV: "test" })({
    changed: async (computerId, status) => changes.push([computerId, status.state]),
    store: async (computerId, jpeg) => {
      stored.push(jpeg);
      return `/screens/${computerId}.jpg`;
    }
  });
  assert.deepEqual(manager.status("4"), { state: "asleep", url: "", error: "" });
  const page = await manager.browse("4", "https://example.org/");
  assert.deepEqual(page, { url: "https://example.org/", title: "A page", text: "", status: 200, screenshot: "/screens/4.jpg" });
  assert.deepEqual(stored[0].subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]), "a JPEG, as a real screenshot is");
  assert.deepEqual(manager.status("4"), { state: "awake", url: "https://example.org/", error: "" });
  assert.equal(manager.screen("4"), null, "no live screen to watch");
  await manager.startRecording("4");
  assert.deepEqual(manager.stopRecording("4"), { seconds: 0, events: [] });
  assert.equal(manager.stopRecording("4"), null, "and nothing recorded once stopped");
  await manager.sleep("4");
  assert.deepEqual(changes, [["4", "awake"], ["4", "asleep"]]);
});
