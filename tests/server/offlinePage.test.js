import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// The offline page's script (src/public/offline.js, D-133), run as a browser runs it, around a stand-in of the page's
// world whose clock the test moves: "Mercbot will reconnect by itself as soon as you're back online" holds even when the
// first loads after the online event still can't reach Mercbot. It keeps trying, one loop at a time, waiting 1 s and
// doubling to 30 s, until the page answers, then reloads; Try again tries at once in the same loop.

const source = await readFile(new URL("../../src/public/offline.js", import.meta.url), "utf8");

/** The page with the browser `onLine` or not, whose next loads fail while `failures` lasts. */
function openPage({ onLine = false, failures = 0 } = {}) {
  const listeners = new Map();
  const timers = [];
  const tries = [];
  let now = 0;
  let left = failures;
  let inFlight = 0;
  let mostAtOnce = 0;
  let reloads = 0;
  const button = { addEventListener: (type, listener) => listeners.set(`button:${type}`, listener) };
  const context = vm.createContext({
    document: { getElementById: (id) => (id === "again" ? button : null) },
    window: { addEventListener: (type, listener) => listeners.set(`window:${type}`, listener) },
    navigator: { onLine },
    location: { href: "https://mercbot.example.test/w/home?chat=3", reload: () => { reloads += 1; } },
    fetch: async (url, options) => {
      // The page's options are of the page's own world: copied into this one, so they compare as plain objects.
      tries.push({ at: now, url, options: { ...options } });
      inFlight += 1;
      mostAtOnce = Math.max(mostAtOnce, inFlight);
      await null;
      inFlight -= 1;
      if (left > 0) {
        left -= 1;
        throw new TypeError("Failed to fetch");
      }
      return { status: 200 };
    },
    setTimeout: (callback, ms) => timers.push({ at: now + ms, callback }),
    Math,
    Promise,
    TypeError
  });
  vm.runInContext(source, context);
  const settle = async () => {
    for (let turn = 0; turn < 20; turn += 1) await null;
  };
  return {
    tries,
    get reloads() { return reloads; },
    get mostAtOnce() { return mostAtOnce; },
    get now() { return now; },
    /** Moves the page's clock on by `ms`, running each timer due meanwhile in turn. */
    async wait(ms) {
      const until = now + ms;
      await settle();
      for (;;) {
        timers.sort((one, other) => one.at - other.at);
        if (!timers.length || timers[0].at > until) break;
        const timer = timers.shift();
        now = timer.at;
        timer.callback();
        await settle();
      }
      now = until;
    },
    async online() {
      listeners.get("window:online")();
      await settle();
    },
    async tryAgain() {
      listeners.get("button:click")();
      await settle();
    }
  };
}

test("back online, it tries at once and, while Mercbot still can't be reached, again after 1, 2, 4 and 8 s, then reloads", async () => {
  const page = openPage({ failures: 4 });
  assert.equal(page.tries.length, 0, "offline, it waits for the browser to be online");
  await page.online();
  await page.wait(60_000);
  assert.deepEqual(page.tries.map((one) => one.at), [0, 1000, 3000, 7000, 15000]);
  assert.equal(page.reloads, 1, "the page loads once it answers, and only then");
  assert.deepEqual(page.tries[0].options, { cache: "no-store", redirect: "manual" }, "any answer counts, a sign-in page's redirect too");
  assert.equal(page.tries[0].url, "https://mercbot.example.test/w/home?chat=3", "the page it stands in for");
});

test("one loop at a time: more online events and Try again don't start another, and Try again tries at once", async () => {
  const page = openPage({ failures: 3 });
  await page.online();
  await page.online();
  await page.tryAgain();
  await page.wait(500);
  assert.equal(page.mostAtOnce, 1, "never two tries at once");
  const before = page.tries.length;
  await page.tryAgain();
  assert.equal(page.tries.length, before + 1, "Try again ends the wait");
  assert.equal(page.tries.at(-1).at, 500);
  await page.wait(60_000);
  assert.equal(page.reloads, 1);
  assert.equal(page.mostAtOnce, 1);
});

test("loaded while the browser says it's online, it tries after a moment; the wait never grows past 30 s", async () => {
  const page = openPage({ onLine: true, failures: 9 });
  await page.wait(999);
  assert.equal(page.tries.length, 0);
  await page.wait(10 * 60_000);
  const waits = page.tries.slice(1).map((one, index) => one.at - page.tries[index].at);
  assert.equal(page.tries[0].at, 1000);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(page.reloads, 1);
});
