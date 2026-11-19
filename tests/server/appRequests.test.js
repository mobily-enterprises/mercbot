import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { AppBusyError, DEFAULT_PACE, PACES, busyFor, createAppRequests, paceOf, spacing } from "../../packages/integrations/src/server/appRequests.js";
import { memoryTurns } from "../support/appKey.mjs";

// The one way every request reaches a connected account's app (D-96): each waits its turn in the account's Request pace,
// a share of the limit the app's plugin.json declares, and a busy answer holds the account's requests off for as long as
// the app asks. Here on a clock the test moves: the turns as plugin_account_turns keeps them, in memory.
const PLUGINS = new URL("../../plugins/", import.meta.url);

/** Every plugin that reaches a service of its own (a sign-in, its own connection point, or API credentials). */
async function connectable() {
  const found = [];
  for (const id of await readdir(PLUGINS)) {
    const plugin = JSON.parse(await readFile(new URL(`${id}/plugin.json`, PLUGINS), "utf8").catch(() => "null"));
    if (plugin && (plugin.oauth || plugin.mcp || plugin.credentials)) found.push({ id, ...plugin });
  }
  return found;
}

/** An account's fetch on a clock of the test's own; `answer(url, init)` is the app. Each send's time is in `sent`. */
function onClock(answer, { pace = null, limits = { requests: 100, seconds: 1 }, turns = memoryTurns(), clock = { now: 0 } } = {}) {
  const sent = [];
  const slept = [];
  const requests = createAppRequests({
    turns,
    systemContext: () => ({}),
    now: () => clock.now,
    sleep: async (ms) => {
      slept.push(ms);
      clock.now += ms;
    }
  });
  const fetch = requests.fetchFor({ id: "7", pace }, { name: "Acme", limits }, async (url, init) => {
    sent.push(clock.now);
    return answer(url, init);
  });
  return { fetch, sent, slept, clock, turns };
}
/** The most of `sent` (in time order) that fall in any one window of `windowMs`. */
function busiestWindow(sent, windowMs) {
  let most = 0;
  for (let start = 0, end = 0; start < sent.length; start += 1) {
    while (end < sent.length && sent[end] < sent[start] + windowMs) end += 1;
    most = Math.max(most, end - start);
  }
  return most;
}
const busy = (status, headers = {}, body = {}) => () => new Response(JSON.stringify(body), { status, headers });
const ok = () => new Response("{}", { status: 200 });

test("every app that reaches a service declares the service's limit, and where the number comes from", async () => {
  const plugins = await connectable();
  assert.ok(plugins.length >= 11);
  for (const plugin of plugins) {
    const { requests, seconds, source, says } = plugin.limits || {};
    assert.ok(requests > 0 && seconds > 0, `${plugin.id} declares limits: { requests, seconds }`);
    assert.match(String(source), /^https:\/\//u, `${plugin.id} names where its limit is published`);
    assert.ok(String(says).length > 10, `${plugin.id} says what the source says`);
  }
});

test("a connection that never chose a pace is Gentle", () => {
  assert.equal(DEFAULT_PACE, "gentle");
  for (const account of [undefined, null, {}, { pace: null }, { pace: "" }, { pace: "turbo" }, { pace: "toString" }]) {
    assert.equal(paceOf(account), "gentle", JSON.stringify(account));
  }
  assert.deepEqual(Object.keys(PACES), ["gentle", "normal", "fast"]);
  assert.equal(paceOf({ pace: "fast" }), "fast");
  assert.deepEqual(spacing({ requests: 100, seconds: 1 }, undefined), spacing({ requests: 100, seconds: 1 }, "gentle"));
});

// For each app's published limit and each pace: one caller sending as fast as it's let, for three of the limit's
// windows. No window ever holds more than the pace's share; Gentle sends well below, Fast close to the limit.
test("each pace keeps every app under its share of the service's own limit, in any window", async () => {
  for (const plugin of await connectable()) {
    for (const [pace, share] of Object.entries(PACES)) {
      const { fetch, sent, clock } = onClock(ok, { pace, limits: plugin.limits });
      const windowMs = plugin.limits.seconds * 1000;
      while (clock.now < 3 * windowMs) {
        // A turn further off than a caller waits is the app busy: the caller tries again a second later.
        await fetch("https://app.example/").catch((error) => {
          assert.ok(error instanceof AppBusyError, error.message);
          clock.now += 1000;
        });
      }
      const allowed = plugin.limits.requests * share;
      const most = busiestWindow(sent, windowMs);
      assert.ok(most <= allowed, `${plugin.id} ${pace}: ${most} requests in one window, over ${allowed}`);
      assert.ok(most >= Math.floor(allowed * 0.75), `${plugin.id} ${pace}: ${most} requests in one window, well under ${allowed}`);
    }
  }
});

test("busy answers, by each service's own signal", async () => {
  const cases = [
    [new Response("", { status: 429, headers: { "retry-after": "7" } }), 7],
    [new Response("", { status: 429, headers: { "retry-after": new Date(Date.now() + 30000).toUTCString() } }), 30],
    [new Response("", { status: 429 }), 5],
    [new Response("", { status: 429, headers: { "retry-after": "99999" } }), 3600],
    [new Response("", { status: 529 }), 5],
    [new Response("", { status: 503, headers: { "retry-after": "12" } }), 12],
    [new Response("", { status: 503 }), null],
    [new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 90) } }), 90],
    [new Response("", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "40" } }), 40],
    [new Response("", { status: 403, headers: { "retry-after": "60" } }), 60],
    [new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), { status: 403 }), 5],
    [new Response(JSON.stringify({ error: { errors: [{ reason: "insufficientPermissions" }] } }), { status: 403 }), null],
    [new Response("", { status: 403, headers: { "x-ratelimit-remaining": "12", "x-ratelimit-reset": "40" } }), null],
    [new Response("", { status: 500 }), null],
    [new Response("", { status: 200 }), null]
  ];
  for (const [response, seconds] of cases) {
    const found = await busyFor(response);
    if (seconds === null) assert.equal(found, null, `${response.status} ${JSON.stringify([...response.headers])}`);
    else assert.ok(Math.abs(found - seconds) <= 1, `${response.status}: ${found}, not ${seconds}`);
  }
});

test("a short busy answer is waited out once, in turn; a second one, or a long one, is the app busy, with when to try again", async () => {
  let answers = [busy(429, { "retry-after": "3" }), ok];
  const brief = onClock(() => answers.shift()());
  assert.equal((await brief.fetch("https://app.example/")).status, 200);
  assert.equal(brief.sent.length, 2);
  assert.ok(brief.sent[1] - brief.sent[0] >= 3000, "the second waited what the app asked");

  answers = [busy(429, { "retry-after": "2" }), busy(429, { "retry-after": "8" })];
  const twice = onClock(() => answers.shift()());
  await assert.rejects(twice.fetch("https://app.example/"), (error) => {
    assert.ok(error instanceof AppBusyError);
    assert.deepEqual([error.code, error.statusCode, error.seconds, error.message], ["integrations_app_busy", 503, 8, "Acme is busy: try again in 8 s. Nothing was done."]);
    return true;
  });
  assert.equal(twice.sent.length, 2, "never a loop");

  const long = onClock(busy(429, { "retry-after": "120" }));
  await assert.rejects(long.fetch("https://app.example/"), { code: "integrations_app_busy", seconds: 120 });
  assert.equal(long.sent.length, 1, "a long wait is reported at once");
  long.clock.now += 1000;
  await assert.rejects(long.fetch("https://app.example/"), (error) => error.seconds >= 118 && error.seconds <= 120);
  assert.equal(long.sent.length, 1, "while the app asked to wait, nothing is sent to it");
  long.clock.now += 120000;
  await assert.rejects(long.fetch("https://app.example/"), { code: "integrations_app_busy" });
  assert.equal(long.sent.length, 2, "once it's over, the next request goes");
});

test("a 503 to a change is never sent again: the app may have made it", async () => {
  const change = onClock(busy(503, { "retry-after": "4" }, { error: "unavailable" }));
  const answer = await change.fetch("https://app.example/send", { method: "POST", body: "{}" });
  assert.equal(answer.status, 503, "the caller's to report");
  assert.equal(change.sent.length, 1);
  // A 429 to a change was refused before anything was done: waited out once, as for a read.
  let answers = [busy(429, { "retry-after": "1" }), ok];
  const refused = onClock(() => answers.shift()());
  assert.equal((await refused.fetch("https://app.example/send", { method: "POST", body: "{}" })).status, 200);
  assert.equal(refused.sent.length, 2);
});

test("an account's turns are one line for every server: two servers' requests together keep to its pace", async () => {
  const turns = memoryTurns();
  const clock = { now: 0 };
  const one = onClock(ok, { turns, clock });
  const two = onClock(ok, { turns, clock });
  for (let at = 0; at < 20; at += 1) await (at % 2 ? one : two).fetch("https://app.example/");
  // Sedna-sized limits, Gentle: 5 at once, then a turn every 200 ms, whichever server sends.
  const sent = [...one.sent, ...two.sent].sort((a, b) => a - b);
  assert.deepEqual(sent.slice(0, 5), [0, 0, 0, 0, 0]);
  assert.deepEqual(sent.slice(5).map((at, index) => at - (index + 1) * 200), Array(15).fill(0));
});

test("a turn further off than a caller waits isn't taken: the app is busy for it, and nothing is sent", async () => {
  const { fetch, sent, clock } = onClock(ok, { limits: { requests: 50, seconds: 60 } });
  // Gentle on 50 a minute: 2 at once, then a turn every 24 s, longer than a caller waits (20 s).
  await fetch("https://app.example/");
  await fetch("https://app.example/");
  await assert.rejects(fetch("https://app.example/"), { code: "integrations_app_busy", seconds: 24, message: "Acme is busy: try again in 24 s. Nothing was done." });
  assert.deepEqual([sent.length, clock.now], [2, 0]);
});
