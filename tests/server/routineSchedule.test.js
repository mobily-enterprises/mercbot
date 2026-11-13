import assert from "node:assert/strict";
import test from "node:test";
import { describeRun, nextRunAt, scheduleProblem } from "../../packages/bots/src/server/routineSchedule.js";

// Routine schedules: five-field cron, a real time zone, at most every 10 minutes.
test("valid schedules pass and invalid ones say why", () => {
  assert.equal(scheduleProblem("*/10 8-21 * * *", "Europe/Rome"), "");
  assert.equal(scheduleProblem("0 9 * * 1", "UTC"), "");
  assert.match(scheduleProblem("*/5 * * * *", "UTC"), /every 10 minutes/u);
  assert.match(scheduleProblem("0 0 9 * * 1", "UTC"), /five fields/u);
  assert.match(scheduleProblem("0 9 * * 1", "Mars/Base"), /time zone/u);
  assert.match(scheduleProblem("99 9 * * 1", "UTC"), /doesn't work/u);
});

test("the next run is counted from now in the routine's time zone", () => {
  const after = new Date("2026-10-24T16:31:00Z");
  assert.equal(nextRunAt("*/10 * * * *", "UTC", after), "2026-10-24T16:40:00.000Z");
  assert.equal(nextRunAt("0 9 * * 1", "Europe/London", after), "2026-10-26T09:00:00.000Z");
  assert.equal(describeRun(new Date("2026-10-24T16:40:00Z"), "UTC"), "Saturday, October 24 at 4:40 PM UTC");
});
