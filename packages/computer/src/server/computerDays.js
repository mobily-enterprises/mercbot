import { refusalOf } from "@local/account/meter";

// A bot's computer is recorded a day (UTC) at a time, up front (D-73): the day it wakes is opened before it starts and
// counted once it has (computerManager's `withDay`), so a computer that couldn't start counts nothing, and one still
// awake when a new day begins is counted that day, or put to sleep when its work is refused (meter.js refuseWork). This
// keeps which day each awake computer here was last counted for, so only a new day costs a trip to the database.

/**
 * @param {object} dependencies
 * @param {(computerId: string) => Promise<{ count: () => Promise<unknown>, release: () => Promise<unknown> } | null>} dependencies.start
 *   opens a computer's day before it starts (refused: it throws), or null when that day is counted already
 * @param {(computerId: string) => Promise<unknown>} dependencies.count counts an awake computer a new day (refused: it throws)
 * @param {(computerId: string, why: string) => Promise<unknown>} dependencies.sleep puts a computer to sleep, saying why
 * @param {() => string} [dependencies.today] the day it is, "YYYY-MM-DD" in UTC
 */
export function createComputerDays({ start, count, sleep, today = () => new Date().toISOString().slice(0, 10) }) {
  const awake = new Map();

  /**
   * Starts a computer with its day opened, and counts the day once `launch` has: a start that fails lets the day go.
   * Keeps the day it was opened for, so one that finishes starting after midnight is counted the new day too.
   * @param {string} computerId
   * @param {() => Promise<unknown>} launch
   */
  async function withDay(computerId, launch) {
    const day = today();
    const opened = await start(computerId);
    try {
      await launch();
    } catch (error) {
      await opened?.release().catch((failure) => console.warn("Letting go of a computer's day failed; it expires uncounted.", failure));
      throw error;
    }
    await opened?.count().catch((error) => console.warn("Counting a computer's day failed; it expires uncounted.", error));
    awake.set(String(computerId), day);
  }

  /** A computer's new state: one that isn't waking or awake is forgotten. */
  function changed(computerId, state) {
    if (state !== "waking" && state !== "awake") awake.delete(String(computerId));
  }

  /**
   * Counts each awake computer a day that has begun since it was last counted; one whose day is refused goes to
   * sleep, saying why. A count that fails for another reason is tried again next time.
   */
  async function countNewDays() {
    const day = today();
    for (const [id, counted] of [...awake]) {
      if (counted === day) continue;
      try {
        await count(id);
        awake.set(id, day);
      } catch (error) {
        const refusal = refusalOf(error);
        if (!refusal) continue;
        awake.delete(id);
        await sleep(id, refusal.message).catch(() => {});
      }
    }
  }

  return Object.freeze({
    withDay,
    changed,
    countNewDays
  });
}
