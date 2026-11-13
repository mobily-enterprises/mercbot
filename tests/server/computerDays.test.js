import assert from "node:assert/strict";
import test from "node:test";
import { createComputerDays } from "../../packages/computer/src/server/computerDays.js";
import { refuseWork } from "../../packages/account/src/server/meter.js";

// A bot's computer is recorded a day (UTC) at a time, up front (D-73): the day it wakes is opened as it starts and
// counted once it has, so one that couldn't start counts nothing, and one still awake when a new day begins is counted
// that day, or put to sleep when its work is refused.

const paused = () => refuseWork("This home's work is paused.", { code: "work_paused" });

/** Computer days kept as "<computer> <day> <what>", with refusals by computer. */
function keptDays() {
  const kept = { day: "2026-11-12", counted: [], slept: [], refuse: new Map(), countedToday: new Set() };
  const refusal = (computerId) => {
    if (kept.refuse.has(computerId)) throw kept.refuse.get(computerId);
  };
  kept.days = createComputerDays({
    start: async (computerId) => {
      refusal(computerId);
      if (kept.countedToday.has(`${computerId} ${kept.day}`)) return null;
      const day = kept.day;
      return {
        count: async () => {
          kept.countedToday.add(`${computerId} ${kept.day}`);
          kept.counted.push(`${computerId} ${kept.day}${kept.day === day ? "" : ` (opened ${day})`}`);
        },
        release: async () => kept.counted.push(`${computerId} released`)
      };
    },
    count: async (computerId) => {
      refusal(computerId);
      if (kept.countedToday.has(`${computerId} ${kept.day}`)) return;
      kept.countedToday.add(`${computerId} ${kept.day}`);
      kept.counted.push(`${computerId} ${kept.day}`);
    },
    sleep: async (computerId, why) => kept.slept.push([computerId, why]),
    today: () => kept.day
  });
  return kept;
}

test("a computer is counted its day once it has started, and each new day once; refused, it sleeps; another failure is tried again", async () => {
  const kept = keptDays();
  const { days } = kept;
  for (const computerId of ["1", "2"]) {
    days.changed(computerId, "waking");
    await days.withDay(computerId, async () => days.changed(computerId, "waking"));
    days.changed(computerId, "awake");
  }
  assert.deepEqual(kept.counted, ["1 2026-11-12", "2 2026-11-12"], "each is counted its day once it has started");
  await days.withDay("1", async () => {});
  await days.countNewDays();
  assert.equal(kept.counted.length, 2, "and not again that day");

  kept.day = "2026-11-13";
  kept.refuse.set("2", new Error("The database is down."));
  await days.countNewDays();
  await days.countNewDays();
  assert.deepEqual(kept.counted.slice(2), ["1 2026-11-13"], "a new day is counted once");
  assert.deepEqual(kept.slept, [], "a count that failed for another reason doesn't put it to sleep");

  kept.refuse.set("2", paused());
  await days.countNewDays();
  assert.deepEqual(kept.slept, [["2", "This home's work is paused."]], "refused work puts it to sleep, saying why");
  await days.countNewDays();
  assert.equal(kept.slept.length, 1, "and it's forgotten");

  days.changed("1", "asleep");
  kept.day = "2026-11-14";
  await days.countNewDays();
  assert.deepEqual(kept.counted.slice(2), ["1 2026-11-13"], "an asleep computer isn't counted");
  await assert.rejects(days.withDay("2", async () => assert.fail("it doesn't start")), (error) => error.code === "work_paused");
});

test("a computer that couldn't start counts nothing: its day is let go", async () => {
  const kept = keptDays();
  await assert.rejects(kept.days.withDay("1", async () => {
    throw new Error("All 3 computers are in use right now. Try again in a moment.");
  }), /in use/u);
  assert.deepEqual(kept.counted, ["1 released"]);
  await kept.days.countNewDays();
  assert.deepEqual(kept.counted, ["1 released"], "and it isn't kept as awake");
});

test("a computer opened just before midnight that started just after is counted once, for the new day", async () => {
  const kept = keptDays();
  await kept.days.withDay("1", async () => {
    kept.day = "2026-11-13";
  });
  kept.days.changed("1", "awake");
  await kept.days.countNewDays();
  await kept.days.countNewDays();
  assert.deepEqual(kept.counted, ["1 2026-11-13 (opened 2026-11-12)"], "counted once, for the day it started in");
});
