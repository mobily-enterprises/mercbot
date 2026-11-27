// A clock a test moves, for the timers one module of Mercbot sets itself: the module's own pauses (a heartbeat, the
// wait for a check to come back, a reconnect) pass in one step, at their real length, never waited out in real time
// and never shortened by an option the product takes only for its tests.
const HELPER = import.meta.filename;

/**
 * Holds every setTimeout and setInterval that `file` (the end of its path, as a stack names it) calls itself until
 * `advance(ms)` passes their time; every other timer (the database driver's, the test's own) runs as usual. A held
 * timer answers unref, ref and hasRef as Node's do, and clearing it takes it away. The mocks end with the test.
 * @param {import("node:test").TestContext} context
 * @param {string} file
 */
export function moduleClock(context, file) {
  const real = { setTimeout, setInterval, clearTimeout, clearInterval };
  const pending = new Set();
  const made = [];
  const held = new WeakSet();
  let now = 0;
  // The module set it itself, not code it called into: the first frame past this helper and Node's own.
  const ours = () =>
    String(new Error().stack)
      .split("\n")
      .slice(1)
      .find((line) => !line.includes(HELPER) && !line.includes("node:"))
      ?.includes(file) ?? false;

  function hold(work, ms, args, repeats) {
    const delay = Math.max(1, Number(ms) || 0);
    let referenced = true;
    const timer = {
      at: now + delay,
      every: repeats ? delay : 0,
      run: () => work(...args),
      unref: () => ((referenced = false), timer),
      ref: () => ((referenced = true), timer),
      hasRef: () => referenced
    };
    held.add(timer);
    pending.add(timer);
    made.push(timer);
    return timer;
  }
  const clear = (realClear) => (timer) => (held.has(timer) ? pending.delete(timer) : realClear(timer));
  context.mock.method(globalThis, "setTimeout", (work, ms, ...args) => (ours() ? hold(work, ms, args, false) : real.setTimeout(work, ms, ...args)));
  context.mock.method(globalThis, "setInterval", (work, ms, ...args) => (ours() ? hold(work, ms, args, true) : real.setInterval(work, ms, ...args)));
  context.mock.method(globalThis, "clearTimeout", clear(real.clearTimeout));
  context.mock.method(globalThis, "clearInterval", clear(real.clearInterval));

  const due = (end) => [...pending].filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
  return {
    /** The module's timers still waiting (an interval waits until cleared). */
    pending,
    /** Every timer the module set. */
    made,
    /** How many of its setTimeouts wait now. */
    timeouts: () => [...pending].filter((timer) => !timer.every).length,
    /** Moves the clock `ms` on: each timer whose time comes runs, in order, and what it starts gets a turn of the event loop. */
    async advance(ms) {
      const end = now + ms;
      for (let timer = due(end); timer; timer = due(end)) {
        now = timer.at;
        if (timer.every) timer.at += timer.every;
        else pending.delete(timer);
        timer.run();
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = end;
    }
  };
}
