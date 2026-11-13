import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { generateText } from "ai";
import { createMeter, createMeteredFetch, currentWork } from "../../packages/account/src/server/meter.js";
import { aiFetch } from "../../packages/account/src/server/providers/index.js";
import { createChatModel } from "../../packages/bots/src/server/model.js";

const ENV = { AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "t", AI_ECONOMY_PROVIDER: "deepinfra", AI_ECONOMY_API_KEY: "d" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const answer = (extra = {}) =>
  new Response(
    JSON.stringify({
      id: "1",
      created: 1,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 10, ...extra.usage },
      ...(extra.tier ? { service_tier: extra.tier } : {})
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

/** Every model request as the provider would get it, each answered by `reply`. */
function capture(reply = () => answer()) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body, key: new Headers(init.headers).get("authorization") });
    return reply(body, calls.length);
  };
  return calls;
}

const ask = (model) => generateText({ model, prompt: "Hello", maxRetries: 0 });

/** A recorder that keeps each call as it was written down, and how it ended. */
function keptCalls() {
  const calls = [];
  return {
    calls,
    open: async (call) => {
      calls.push({ call, outcome: null });
      return { id: String(calls.length) };
    },
    finish: async (ticket, outcome) => {
      calls[Number(ticket.id) - 1].outcome = outcome;
    },
    record: async () => {}
  };
}

test("each kind of work runs where the table says", async () => {
  const calls = capture();
  const meter = createMeter({ recorder: keptCalls() });
  const model = createChatModel(ENV);
  await ask(model);
  await meter.track({ work: "build" }, () => ask(model));
  await meter.track({ work: "background" }, () => ask(model));

  assert.match(calls[0].url, /together/u);
  assert.equal(calls[0].key, "Bearer t");
  assert.equal(calls[0].body.service_tier, undefined);
  assert.equal(calls[0].body.reasoning_effort, undefined, "Together thinks unasked");

  assert.match(calls[1].url, /deepinfra/u);
  assert.equal(calls[1].key, "Bearer d");
  assert.equal(calls[1].body.service_tier, undefined, "app making is on Standard");
  assert.equal(calls[1].body.reasoning_effort, "high");

  assert.match(calls[2].url, /deepinfra/u);
  assert.equal(calls[2].body.service_tier, "flex");
  assert.equal(calls[2].body.reasoning_effort, "high", "Flex loses no thinking");
});

test("work nested in background work stays background, and chats are the default", async () => {
  const meter = createMeter({ recorder: keptCalls() });
  assert.equal(currentWork(), "chat");
  await meter.track({ work: "background" }, () => meter.track({ userId: "1" }, () => assert.equal(currentWork(), "background")));
  assert.equal(currentWork(), "chat");
});

test("a kind of AI that isn't set up fails at once, saying which setting, and asks no provider", async () => {
  const calls = capture();
  const model = createChatModel({ AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "t" });
  await assert.rejects(
    createMeter({ recorder: keptCalls() }).track({ work: "background" }, () => ask(model)),
    /Slower, cheaper AI isn't set up here: AI_ECONOMY_PROVIDER/u
  );
  assert.equal(calls.length, 0);
  await ask(model);
  assert.match(calls[0].url, /together/u, "the kind that is set up still answers");
});

// The background route's fetch with `send` as the network: DeepInfra's Flex, metered, with failures kept.
function flexSend(send) {
  globalThis.fetch = send;
  return aiFetch(ENV, "background");
}
const REQUEST = { body: JSON.stringify({ model: "m", messages: [] }) };

test("a Flex call DeepInfra refuses goes again at Standard, once", async () => {
  const tiers = [];
  const send = flexSend(async (_url, init) => {
    tiers.push(JSON.parse(init.body).service_tier);
    return new Response("{}", { status: tiers.length === 1 ? 429 : 200 });
  });
  assert.equal((await send("u", REQUEST)).status, 200);
  assert.deepEqual(tiers, ["flex", undefined]);
});

test("other Flex answers come back as they are, for the usual retries", async () => {
  let calls = 0;
  const send = flexSend(async () => {
    calls += 1;
    return new Response("{}", { status: 503 });
  });
  assert.equal((await send("u", REQUEST)).status, 503);
  assert.equal(calls, 1);
});

test("a Flex call that waits too long goes again at Standard", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tiers = [];
  const send = flexSend((_url, init) => {
    tiers.push(JSON.parse(init.body).service_tier);
    if (tiers.length > 1) return Promise.resolve(new Response("{}", { status: 200 }));
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  const reply = send("u", REQUEST);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2 * 60 * 1000);
  assert.equal((await reply).status, 200);
  assert.deepEqual(tiers, ["flex", undefined]);
});

test("a reply that's stopped doesn't go again at Standard", async () => {
  const stop = new AbortController();
  let calls = 0;
  const send = flexSend((_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("stopped"))));
  });
  const reply = send("u", { ...REQUEST, signal: stop.signal });
  stop.abort();
  await assert.rejects(reply, /stopped/u);
  assert.equal(calls, 1);
});

test("a call is written down before it goes out, and recorded with who served it and what it really cost", async () => {
  const recorder = keptCalls();
  const meter = createMeter({ recorder });
  capture(() => answer({ tier: "flex", usage: { estimated_cost: 0.00042 } }));
  await meter.track({ userId: "1", botId: "2", work: "background" }, () => ask(createChatModel(ENV)));
  capture(() => answer());
  await meter.track({ userId: "1", botId: "2", workspaceId: "3" }, async () => {
    await createMeteredFetch(ENV, "together")("https://together", { body: "{}" });
  });
  assert.equal(recorder.calls.length, 2, "recorded before the response is handed back");
  assert.equal(recorder.calls[0].call.provider, "deepinfra");
  assert.equal(recorder.calls[0].call.work, "background");
  assert.equal(recorder.calls[0].call.kind, "economy", "recorded as the kind of AI its work runs on");
  assert.ok(recorder.calls[0].call.requestChars > 0, "the request's size is kept for an estimate");
  assert.equal(recorder.calls[0].outcome.tier, "flex");
  assert.equal(recorder.calls[0].outcome.reportedCost, 0.00042);
  assert.equal(recorder.calls[0].outcome.state, "done");
  assert.equal(recorder.calls[1].call.provider, "together", "a browser step's call says who served it too");
  assert.equal(recorder.calls[1].call.workspaceId, "3");
  assert.equal(recorder.calls[1].outcome.reportedCost, undefined);
});
