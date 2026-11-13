import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { kindOf, providerCostNano, toNano } from "../../packages/account/src/server/cost.js";
import { deepinfra } from "../../packages/account/src/server/providers/deepinfra.js";
import { modelSettings } from "../../packages/account/src/server/providers/index.js";
import { seal, unseal, vaultKey } from "../../packages/account/src/server/vaultCrypto.js";

// What work cost at its provider (D-73), the providers' settings, and vault secrets (D-17).
test("what a provider charged comes from its own figure, else its tokens at its list prices", () => {
  assert.equal(providerCostNano({ reportedCost: 0.00042, cacheMiss: 1e6 }, "deepinfra"), 420000, "DeepInfra's own figure wins");
  assert.equal(providerCostNano({ cacheHit: 1e6, cacheMiss: 1e6, output: 1e6 }, "together"), toNano(0.006 + 0.3 + 1.2));
  assert.equal(providerCostNano({ cacheHit: 1e6, cacheMiss: 1e6, output: 1e6 }, "deepinfra"), toNano(0.006 + 0.2 + 0.6));
  assert.equal(providerCostNano({ cacheMiss: 1000, output: 1290 }, "gemini", 1), 1000 * 300 + 1290 * 30000, "pictures at Gemini's picture model's list prices");
  assert.equal(providerCostNano({ cacheMiss: 1500, output: 120 }, "gemini"), 1500 * 750 + 120 * 3750, "a call that asks for none, at its reading model's");
  assert.equal(providerCostNano({ cacheHit: 1 }, "together"), 6, "the cheapest token is a whole number of nanodollars");
});

test("each provider's calls count as its kind of AI", () => {
  assert.equal(kindOf("together"), "premium");
  assert.equal(kindOf("deepinfra"), "economy");
  assert.equal(kindOf("gemini"), "images");
  assert.equal(kindOf("gone"), "premium", "a provider no kind has counts as premium");
});

test("each kind's provider gives its address, model and key", () => {
  const env = { AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "t", AI_ECONOMY_PROVIDER: "deepinfra", AI_ECONOMY_API_KEY: "k" };
  const { fetch: _premium, ...premium } = modelSettings(env, "chat");
  assert.deepEqual(premium, { name: "Together AI", baseURL: "https://api.together.xyz/v1", model: "deepseek-ai/DeepSeek-V4.1-Flash", apiKey: "t" });
  const { fetch: _economy, ...economy } = modelSettings(env, "build");
  assert.deepEqual(economy, { name: "DeepInfra", baseURL: "https://api.deepinfra.com/v1/openai", model: "deepseek-ai/DeepSeek-V4.1-Flash", apiKey: "k" });
  assert.equal(modelSettings(env, "browser").apiKey, "t", "the bots' browser runs on the premium AI");
});

test("DeepInfra is always asked to think, unless a call turns thinking off", async () => {
  const sent = [];
  const send = deepinfra.wrapFetch(async (_url, init) => sent.push(JSON.parse(init.body)));
  await send("u", { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) });
  assert.equal(sent[0].reasoning_effort, "high", "without this DeepInfra doesn't reason at all");
  assert.equal(sent[0].model, "m");
  await send("u", { body: JSON.stringify({ model: "m", thinking: { type: "disabled" } }) });
  assert.equal(sent[1].reasoning_effort, undefined, "a quick side call stays without thinking");
});

test("vault secrets are sealed, opened with the key, and refuse tampering", () => {
  const key = vaultKey({ MERCBOT_VAULT_KEY: randomBytes(32).toString("base64") });
  const sealed = seal({ password: "hunter2" }, key);
  assert.ok(!JSON.stringify(sealed).includes("hunter2"));
  assert.deepEqual(unseal(sealed, key), { password: "hunter2" });
  assert.throws(() => unseal({ ...sealed, data: Buffer.from("x").toString("base64") }, key));
  assert.throws(() => unseal(sealed, randomBytes(32)));
  assert.throws(() => vaultKey({ MERCBOT_VAULT_KEY: "short" }), /32 bytes/u);
});
