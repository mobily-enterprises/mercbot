import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMeter, withoutSecrets } from "../../packages/account/src/server/meter.js";
import { deepinfra } from "../../packages/account/src/server/providers/deepinfra.js";
import { gemini } from "../../packages/account/src/server/providers/gemini.js";
import { AI_KINDS, WORK, aiFetch, aiKind, aiReady, aiSettingsNeeded, aiSettingsProblems, botsAiOff, checkAiSettings, modelSettings } from "../../packages/account/src/server/providers/index.js";
import { together } from "../../packages/account/src/server/providers/together.js";
import { botsMeter } from "../../packages/bots/src/server/model.js";
import { makePicture } from "../../packages/bots/src/server/pictureMaker.js";

// The three kinds of AI from settings (D-72): what startup asks for, where each kind of work runs, how a provider's
// failures are kept (through the meter's recordError), the balances providers report and the pictures' layer.
const ALL = Object.freeze({
  AI_PREMIUM_PROVIDER: "together",
  AI_PREMIUM_API_KEY: "premium-secret",
  AI_ECONOMY_PROVIDER: "deepinfra",
  AI_ECONOMY_API_KEY: "economy-secret",
  AI_IMAGES_PROVIDER: "gemini",
  AI_IMAGES_API_KEY: "images-secret"
});
const SECRETS = ["premium-secret", "economy-secret", "images-secret"];
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

test("any kind of AI may be left out, and is off; startup stops only for a type a kind doesn't accept, named, never a key", () => {
  assert.doesNotThrow(() => checkAiSettings(ALL));
  assert.doesNotThrow(() => checkAiSettings({}));
  assert.deepEqual(aiSettingsProblems({}), []);
  assert.deepEqual(aiSettingsProblems({ ...ALL, AI_ECONOMY_API_KEY: "  " }), []);
  // What each kind still needs: its type and its key, or only the one missing.
  assert.deepEqual(aiSettingsNeeded({}, "premium"), ["AI_PREMIUM_PROVIDER", "AI_PREMIUM_API_KEY"]);
  assert.deepEqual(aiSettingsNeeded({ ...ALL, AI_ECONOMY_API_KEY: "  " }, "economy"), ["AI_ECONOMY_API_KEY"]);
  assert.deepEqual(aiSettingsNeeded({ ...ALL, AI_IMAGES_PROVIDER: "" }, "images"), ["AI_IMAGES_PROVIDER"]);
  assert.deepEqual(aiSettingsNeeded(ALL, "premium"), []);
  const { AI_IMAGES_PROVIDER: _type, AI_IMAGES_API_KEY: _key, ...twoKinds } = ALL;
  assert.equal(aiReady(twoKinds, "images"), false);
  assert.equal(aiReady({ ...ALL, AI_IMAGES_API_KEY: " " }, "images"), false);
  assert.equal(aiReady(ALL, "images"), true);
  assert.deepEqual(aiSettingsProblems({ ...ALL, AI_PREMIUM_PROVIDER: "deepseek", AI_IMAGES_PROVIDER: "together" }), [
    "AI_PREMIUM_PROVIDER is \"deepseek\", which Premium AI doesn't support: it can be \"together\".",
    "AI_IMAGES_PROVIDER is \"together\", which Images doesn't support: it can be \"gemini\"."
  ]);
  assert.throws(() => checkAiSettings({ ...ALL, AI_ECONOMY_PROVIDER: "toString" }), (error) => {
    assert.equal(
      error.message,
      "Mercbot's AI isn't set up. AI_ECONOMY_PROVIDER is \"toString\", which Slower, cheaper AI doesn't support: it can be \"deepinfra\"."
    );
    for (const secret of SECRETS) assert.ok(!error.message.includes(secret));
    return true;
  });
  // A key put in the provider setting by mistake isn't said back, so it never reaches the startup log.
  const misplaced = "tgp_v1_0123456789abcdefFAKEkey";
  assert.deepEqual(aiSettingsProblems({ ...ALL, AI_PREMIUM_PROVIDER: misplaced, AI_PREMIUM_API_KEY: "together" }), [
    "AI_PREMIUM_PROVIDER names a provider Premium AI doesn't support: it can be \"together\"."
  ]);
});

test("bots are off, saying which settings to add, until the premium and economy AI are both set up", async () => {
  assert.equal(
    botsAiOff({}),
    "Bots can't work on this copy of Mercbot yet: its AI isn't set up. Whoever runs it sets AI_PREMIUM_PROVIDER, AI_PREMIUM_API_KEY, AI_ECONOMY_PROVIDER and AI_ECONOMY_API_KEY, then starts it again."
  );
  assert.match(botsAiOff({ ...ALL, AI_ECONOMY_API_KEY: "" }), /Whoever runs it sets AI_ECONOMY_API_KEY, then starts it again\.$/u);
  const { AI_IMAGES_PROVIDER: _type, AI_IMAGES_API_KEY: _key, ...twoKinds } = ALL;
  assert.equal(botsAiOff(twoKinds), "", "images isn't needed for bots to work");
  assert.equal(botsAiOff({ AI_PREMIUM_PROVIDER: "together", AI_ECONOMY_PROVIDER: "deepinfra", MERCBOT_TEST_AI_URL: "http://127.0.0.1:4999" }), "", "the stand-in needs no key");

  // The meter bots run on pauses every home with that notice, and is the account's own once the AI is set up.
  const meter = Object.freeze({ track: async (_who, run) => run(), pausedMessage: async () => null });
  assert.equal(botsMeter(meter, ALL), meter);
  const off = botsMeter(meter, { AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "premium-secret" });
  assert.equal(await off.pausedMessage("7"), botsAiOff({ AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "premium-secret" }));
  assert.match(await off.pausedMessage("7"), /sets AI_ECONOMY_PROVIDER and AI_ECONOMY_API_KEY, then/u);
  assert.equal(off.track, meter.track);

  // A kind with its type and no key sends nothing, and says which setting is missing.
  let sent = 0;
  globalThis.fetch = async () => {
    sent += 1;
    return new Response("{}");
  };
  await assert.rejects(aiFetch({ ...ALL, AI_PREMIUM_API_KEY: "" }, "chat")("https://api.together.xyz/v1/chat/completions", { body: "{}" }), {
    message: "Premium AI isn't set up here: AI_PREMIUM_API_KEY isn't set."
  });
  await assert.rejects(aiFetch({}, "background")("https://d", { body: "{}" }), {
    message: "Slower, cheaper AI isn't set up here: AI_ECONOMY_PROVIDER and AI_ECONOMY_API_KEY aren't set."
  });
  assert.equal(sent, 0);
});

test("a server refuses to start while a kind of AI names a type it doesn't accept", async () => {
  const saved = Object.fromEntries(Object.keys(ALL).map((name) => [name, process.env[name]]));
  // An empty value counts as set for .env, which then leaves it alone.
  for (const name of Object.keys(ALL)) process.env[name] = "";
  process.env.AI_PREMIUM_PROVIDER = "deepseek";
  try {
    const { startServer } = await import("../../server.js");
    await assert.rejects(startServer({ host: "127.0.0.1", port: 0 }), /^Error: Mercbot's AI isn't set up\. AI_PREMIUM_PROVIDER is "deepseek", which Premium AI doesn't support/u);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("every kind of work runs on one of the three kinds, from one table", () => {
  const routes = Object.fromEntries(Object.entries(WORK).map(([id, work]) => [id, work.tier ? `${work.kind}/${work.tier}` : work.kind]));
  assert.deepEqual(routes, { chat: "premium", browser: "premium", build: "economy", background: "economy/flex", pictures: "images", photos: "images" });
  assert.deepEqual(
    Object.values(AI_KINDS).map((kind) => [kind.name, kind.providerSetting, kind.keySetting, Object.keys(kind.types)]),
    [
      ["Premium AI", "AI_PREMIUM_PROVIDER", "AI_PREMIUM_API_KEY", ["together"]],
      ["Slower, cheaper AI", "AI_ECONOMY_PROVIDER", "AI_ECONOMY_API_KEY", ["deepinfra"]],
      ["Images", "AI_IMAGES_PROVIDER", "AI_IMAGES_API_KEY", ["gemini"]]
    ]
  );
});

test("a provider's failures are kept in its own words, without the key, and only real failures", async () => {
  const kept = [];
  // Recorded nowhere: what these calls used isn't what's checked here.
  const recorder = { open: async () => ({}), finish: async () => {} };
  const meter = createMeter({ recorder, recordError: async (failure) => kept.push(failure) });
  let answer = () => new Response(JSON.stringify({ error: { message: "Invalid API key provided: premium-secret (request 0123456789abcdef0123456789abcdef42)" } }), { status: 401 });
  globalThis.fetch = async (url, init) => answer(url, init);
  const send = aiFetch(ALL, "chat");
  await meter.track({ userId: "1" }, () => send("https://api.together.xyz/v1/chat/completions", { body: "{}" }));
  await settled();
  assert.deepEqual(kept, [{ kind: "premium", provider: "together", status: 401, message: "Invalid API key provided: [key] (request […])" }]);

  // Part of a key said back, its start or its end, goes too, with the word around it.
  kept.length = 0;
  answer = () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided: premium-****ret. Check it." } }), { status: 401 });
  await meter.track({ userId: "1" }, () => send("https://t", { body: "{}" }));
  await settled();
  assert.equal(kept[0].message, "Incorrect API key provided: [key] Check it.");
  assert.equal(withoutSecrets("Key ****-premium-secret!", "premium-secret"), "Key [key]");

  kept.length = 0;
  answer = () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(meter.track({ userId: "1" }, () => aiFetch(ALL, "pictures")("https://g", { body: "{}" })), /fetch failed/u);
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(meter.track({ userId: "1" }, () => send("https://t", { body: "{}", signal: stop.signal })), /fetch failed/u);
  // A request that ran out of its own time (as Gemini's 150 s) is a failure, unlike one its caller stopped.
  const timedOut = AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError"));
  await assert.rejects(meter.track({ userId: "1" }, () => send("https://t", { body: "{}", signal: timedOut })), /fetch failed/u);
  answer = () => new Response("Service unavailable", { status: 503 });
  await send("https://t", { body: "{}" });
  await settled();
  assert.deepEqual(
    kept,
    [
      { kind: "images", provider: "gemini", status: null, message: "fetch failed" },
      { kind: "premium", provider: "together", status: null, message: "fetch failed" }
    ],
    "a stopped call is no failure, nor one outside tracked work"
  );

  kept.length = 0;
  let tries = 0;
  answer = () => new Response("{}", { status: (tries += 1) === 1 ? 429 : 200 });
  await meter.track({ userId: "1" }, () => aiFetch(ALL, "background")("https://d", { body: JSON.stringify({ messages: [] }) }));
  await settled();
  assert.equal(tries, 2);
  assert.deepEqual(kept, [], "a Flex call DeepInfra refused and then answered at Standard is no failure");
});

test("DeepInfra's balance comes from its billing checklist; Together and Gemini report none", async () => {
  const asked = [];
  const answering = (status, body) => async (url, init) => {
    asked.push({ url: String(url), key: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify(body), { status });
  };
  assert.deepEqual(await deepinfra.balance("k", answering(200, { stripe_balance: -12.5, recent: 3 })), { amount: 12.5, currency: "USD" });
  assert.deepEqual(asked[0], { url: "https://api.deepinfra.com/payment/checklist", key: "Bearer k" });
  assert.deepEqual(await deepinfra.balance("k", answering(200, { stripe_balance: 4 })), { amount: -4, currency: "USD" }, "money owed is below zero");
  await assert.rejects(deepinfra.balance("k", answering(403, {})), /DeepInfra answered 403/u);
  await assert.rejects(deepinfra.balance("k", answering(200, { stripe_balance: null })), /no balance/u);
  assert.equal(Object.hasOwn(together, "balance"), false);
  assert.equal(Object.hasOwn(gemini, "balance"), false);
});

test("pictures are drawn by the images kind's layer, and a refusal says why in the bot's words", async () => {
  const sent = [];
  let answer = { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "cG5n" } }] } }] } };
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), key: new Headers(init.headers).get("x-goog-api-key"), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  const picture = await makePicture(ALL, "A cake", [{ type: "image/jpeg", data: Buffer.from("jpg") }]);
  assert.deepEqual(picture, { data: Buffer.from("png"), type: "image/png" });
  assert.equal(sent[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
  assert.equal(sent[0].key, "images-secret");
  assert.deepEqual(sent[0].body.contents[0].parts, [{ inlineData: { mimeType: "image/jpeg", data: Buffer.from("jpg").toString("base64") } }, { text: "A cake" }]);
  const refusal = async (status, body) => {
    answer = { status, body };
    return makePicture(ALL, "A cake").then(() => "made", (error) => error.message);
  };
  assert.match(await refusal(429, { error: { message: "Quota exceeded, limit: 0" } }), /billing isn't set up/u);
  assert.match(await refusal(429, { error: { message: "Slow down" } }), /at its limit right now/u);
  assert.equal(await refusal(400, { error: { message: "Bad image" } }), "Bad image");
  assert.match(await refusal(200, { candidates: [{ finishReason: "IMAGE_SAFETY" }] }), /couldn't be made \(IMAGE_SAFETY\)/u);
  const { AI_IMAGES_API_KEY: _key, ...withoutImages } = ALL;
  assert.match(await makePicture(withoutImages, "A cake").then(() => "made", (error) => error.message), /^Pictures aren't set up on this copy/u);
});

test("a test copy with a stand-in model sends every kind there, needs no key, and never reaches a provider; production and the live copy ignore it", async () => {
  const standIn = "http://127.0.0.1:4999";
  const types = { AI_PREMIUM_PROVIDER: "together", AI_ECONOMY_PROVIDER: "deepinfra", AI_IMAGES_PROVIDER: "gemini" };
  const env = { ...types, MERCBOT_TEST_AI_URL: `${standIn}/` };
  assert.deepEqual(aiSettingsNeeded(env, "premium"), [], "no key is needed");
  for (const kind of ["premium", "economy", "images"]) {
    const ai = aiKind(env, kind);
    assert.deepEqual([ai.standIn, ai.layer.baseURL, ai.apiKey, aiReady(env, kind)], [true, `${standIn}/${kind}`, "stand-in", true], kind);
    assert.equal(Object.hasOwn(ai.layer, "balance") || Object.hasOwn(ai.layer, "billingUrl"), false, `${kind}: no balance or billing page`);
  }
  assert.equal(aiKind(env, "economy").layer.model, deepinfra.model, "the provider's model and needs stay");
  assert.equal(modelSettings(env, "chat").baseURL, `${standIn}/premium`);

  const sent = [];
  globalThis.fetch = async (url) => {
    sent.push(String(url));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "cG5n" } }] } }] }), { status: 200 });
  };
  await makePicture(env, "A cake");
  assert.deepEqual(sent, [`${standIn}/images/models/gemini-3.1-flash-image:generateContent`], "pictures go to the stand-in too");
  await assert.rejects(aiFetch(env, "chat")("https://api.together.xyz/v1/chat/completions", { body: "{}" }), /stand-in model at http:\/\/127\.0\.0\.1:4999\/premium, so a request for https:\/\/api\.together\.xyz wasn't sent/u);
  assert.equal(sent.length, 1, "nothing else went out");

  // The live copy and production never use it: there each kind is its provider's, with its key, as before.
  for (const live of [{ SIDE_EFFECTS: "live" }, { NODE_ENV: "production" }]) {
    const copy = { ...ALL, ...live, MERCBOT_TEST_AI_URL: standIn };
    const ai = aiKind(copy, "premium");
    assert.deepEqual([ai.standIn, ai.layer, ai.apiKey], [false, together, "premium-secret"], JSON.stringify(live));
    assert.deepEqual(aiSettingsNeeded({ ...types, ...live, MERCBOT_TEST_AI_URL: standIn }, "premium"), ["AI_PREMIUM_API_KEY"], "the key is needed there");
  }
});
