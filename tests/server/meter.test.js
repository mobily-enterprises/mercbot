import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMeter, createMeteredFetch, refusalOf, refuseWork, streamedUsageOf, usageOf } from "../../packages/account/src/server/meter.js";

// Metering every AI call (D-56, D-73): written down before it goes out, recorded with the provider's own figures
// before the response is handed back, and as an estimate when it fails, is cut or comes back without them.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A recorder that keeps each call as it was opened, and how it ended; `refuse` is what opening throws. */
function keptCalls({ refuse = null } = {}) {
  const calls = [];
  return {
    calls,
    open: async (call) => {
      if (refuse) throw refuse;
      calls.push({ call, outcome: null });
      return { id: String(calls.length) };
    },
    finish: async (ticket, outcome) => {
      calls[Number(ticket.id) - 1].outcome = outcome;
    }
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const send = (env = {}, provider = "together") => createMeteredFetch(env, provider)("https://provider", { method: "POST", body: "x".repeat(400) });

test("the provider's own figures are read in each form it gives them", () => {
  assert.deepEqual(usageOf({ usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } }), {
    state: "done", cacheHit: 40, cacheMiss: 60, output: 10
  });
  assert.deepEqual(usageOf({ usage: { prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 7, completion_tokens: 3, estimated_cost: 0.001 }, service_tier: "flex" }), {
    state: "done", tier: "flex", reportedCost: 0.001, cacheHit: 5, cacheMiss: 7, output: 3
  });
  assert.deepEqual(usageOf({ usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 8 } }), {
    state: "done", cacheHit: 20, cacheMiss: 15, output: 8
  });
  const picture = {
    candidates: [{ content: { parts: [{ text: "Here" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] } }],
    usageMetadata: { promptTokenCount: 30, cachedContentTokenCount: 10, candidatesTokenCount: 1290 }
  };
  assert.deepEqual(usageOf(picture), { state: "done", cacheHit: 10, cacheMiss: 20, output: 1290, images: 1 }, "a Gemini picture counts as one");
  assert.equal(usageOf({ choices: [] }), null);
});

test("a streamed reply's figures come from its last chunk with usage, or Anthropic's start and delta", () => {
  const openai = ["data: {\"choices\":[]}", "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}", "data: [DONE]"].join("\n");
  assert.deepEqual(streamedUsageOf(openai), { state: "done", cacheHit: 0, cacheMiss: 9, output: 4 });
  const anthropic = [
    "event: message_start",
    "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":12,\"cache_read_input_tokens\":3,\"output_tokens\":1}}}",
    "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":50}}"
  ].join("\n");
  assert.deepEqual(streamedUsageOf(anthropic), { state: "done", cacheHit: 3, cacheMiss: 12, output: 50 });
  assert.equal(streamedUsageOf("data: {\"choices\":[]}\n"), null);
});

test("each call is written down before it goes out and recorded before its answer comes back", async () => {
  const recorder = keptCalls();
  const meter = createMeter({ recorder });
  const order = [];
  globalThis.fetch = async () => {
    order.push(`sent after ${recorder.calls.length} written down`);
    return json({ usage: { prompt_tokens: 100, completion_tokens: 10 } });
  };
  await meter.track({ userId: "1", botId: "2", workspaceId: "3", work: "build" }, () => send({}, "deepinfra"));
  assert.deepEqual(order, ["sent after 1 written down"]);
  assert.deepEqual(recorder.calls[0].call, {
    userId: "1", botId: "2", workspaceId: "3", work: "build", kind: undefined, provider: "deepinfra", requestChars: 400, mostOutput: undefined, pictures: 0
  });
  assert.deepEqual(recorder.calls[0].outcome, { state: "done", cacheHit: 0, cacheMiss: 100, output: 10 });
});

test("a call that can't be opened doesn't go out: the database is down, or the recorder refuses the work", async () => {
  let sent = 0;
  globalThis.fetch = async () => {
    sent += 1;
    return json({});
  };
  const refused = () => refuseWork("This home's work is paused.", { code: "work_paused", notice: "(Paused.)" });
  await assert.rejects(createMeter({ recorder: keptCalls({ refuse: new Error("The database is down.") }) }).track({ userId: "1" }, () => send()), /database is down/u);
  await assert.rejects(createMeter({ recorder: keptCalls({ refuse: refused() }) }).track({ userId: "1" }, () => send()),
    (error) => error.status === 402 && error.code === "work_paused");
  assert.equal(sent, 0);
  assert.deepEqual(refusalOf(new Error("A step failed.", { cause: refused() })), { message: "This home's work is paused.", notice: "(Paused.)" },
    "found through what an error was caused by");
  assert.deepEqual(refusalOf(refuseWork("No.", { code: "no" })), { message: "No.", notice: "No." }, "the notice is the sentence unless given");
  assert.equal(refusalOf(new Error("A step failed.")), null);
});

test("a call is opened with the most it may cost, from the reply length and pictures it asks for", async () => {
  const recorder = keptCalls();
  globalThis.fetch = async () => json({ usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const fetch = createMeteredFetch({}, "gemini");
  await createMeter({ recorder }).track({ userId: "1" }, async () => {
    await fetch("https://provider", { method: "POST", body: JSON.stringify({ max_tokens: 900, messages: [] }) });
    await fetch("https://provider", { method: "POST", body: JSON.stringify({ generationConfig: { maxOutputTokens: 300, candidateCount: 2 } }) });
    await fetch("https://provider", { method: "POST", body: JSON.stringify({ generationConfig: { responseModalities: ["IMAGE"], candidateCount: 2 } }) });
    await fetch("https://provider", { method: "POST", body: JSON.stringify({ generationConfig: { responseModalities: ["IMAGE"] } }) });
  });
  assert.deepEqual(
    recorder.calls.map(({ call }) => [call.mostOutput, call.pictures]),
    [[900, 0], [300, 0], [undefined, 2], [undefined, 1]],
    "pictures only when a call asks for them: text candidates aren't pictures"
  );
});

test("a call is opened as the kind of AI its work runs on, and reading a photo for the Vault is recorded with its own figures", async () => {
  const recorder = keptCalls();
  const read = { candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } };
  globalThis.fetch = async () => json(read);
  await createMeter({ recorder }).track({ userId: "1", work: "chat" }, async () => {
    await createMeteredFetch({}, "gemini", { kind: "images", purpose: "photos" })("https://provider", { method: "POST", body: "{}" });
    const picture = JSON.stringify({ generationConfig: { responseModalities: ["IMAGE"] } });
    await createMeteredFetch({}, "gemini", { kind: "images", purpose: "pictures" })("https://provider", { method: "POST", body: picture });
  });
  assert.deepEqual(recorder.calls.map(({ call }) => [call.kind, call.work, call.pictures]), [["images", "photos", 0], ["images", "pictures", 1]]);
  assert.deepEqual(recorder.calls[0].outcome, { state: "done", cacheHit: 0, cacheMiss: 300, output: 20, images: 0 }, "a photo read is recorded with Gemini's own figures, no picture");
  assert.equal(recorder.calls[1].outcome.images, 0, "a picture call that drew none records none");
});

test("a failed, cut or figureless call is still recorded, as what it was", async () => {
  const recorder = keptCalls();
  const meter = createMeter({ recorder });
  globalThis.fetch = async () => json({ error: { message: "busy" } }, 503);
  await meter.track({ userId: "1" }, () => send());
  globalThis.fetch = async () => {
    throw new Error("socket hang up");
  };
  await assert.rejects(meter.track({ userId: "1" }, () => send()), /socket hang up/u);
  globalThis.fetch = async () => new Response("not json", { status: 200 });
  await meter.track({ userId: "1" }, () => send());
  assert.deepEqual(recorder.calls.map((call) => call.outcome), [
    { state: "failed" },
    { state: "cut" },
    { state: "no_usage", outputChars: 8 }
  ]);
});

test("a streamed reply is recorded once its stream ends", async () => {
  const recorder = keptCalls();
  const meter = createMeter({ recorder });
  globalThis.fetch = async () => new Response("data: {\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":2}}\n\ndata: [DONE]\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const response = await meter.track({ userId: "1" }, () => send());
  assert.match(await response.text(), /DONE/u, "the caller reads the whole stream");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(recorder.calls[0].outcome, { state: "done", cacheHit: 0, cacheMiss: 7, output: 2 });
});

test("a computer's day and a command's computation are recorded for whom they name, else the work in progress", async () => {
  const recorded = [];
  const meter = createMeter({
    recorder: {
      ...keptCalls(),
      computerDay: async (computer) => recorded.push(["day", computer]),
      startComputerDay: async (computer) => (recorded.push(["start day", computer]), recorded.length > 5 ? null : { id: "8" }),
      countComputerDay: async (ticket) => recorded.push(["count day", ticket.id]),
      release: async (ticket) => recorded.push(["release", ticket.id]),
      startComputation: async (work) => (recorded.push(["start", work]), { id: "7" }),
      renewComputation: async (ticket) => (recorded.push(["renew", ticket.id]), true),
      finishComputation: async (ticket, seconds) => recorded.push(["finish", ticket.id, seconds])
    }
  });
  const block = await meter.track({ userId: "1", botId: "2" }, () => meter.startComputation({ workspaceId: "9" }));
  assert.equal(block.blockSeconds, 600, "opened ten minutes at a time");
  assert.equal(await block.renew(), true);
  await block.settle(42);
  await meter.computerDay({ computerId: "4", botId: "5", userId: null });
  await (await meter.startComputerDay({ computerId: "4", botId: "5", userId: null })).release();
  assert.equal(await meter.startComputerDay({ computerId: "4", botId: "5", userId: null }), null, "a day counted already starts nothing");
  assert.deepEqual(recorded, [
    ["start", { userId: "1", botId: "2", workspaceId: "9" }],
    ["renew", "7"],
    ["finish", "7", 42],
    ["day", { computerId: "4", botId: "5", userId: null }],
    ["start day", { computerId: "4", botId: "5", userId: null }],
    ["release", "8"],
    ["start day", { computerId: "4", botId: "5", userId: null }]
  ]);
});
