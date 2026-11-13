// Together AI (D-45): the one type premium AI accepts (D-72). It serves DeepSeek's Flash model through an
// OpenAI-style chat API. Its API reports no balance; its billing page is `billingUrl`.
export const together = Object.freeze({
  id: "together",
  name: "Together AI",
  baseURL: "https://api.together.xyz/v1",
  model: "deepseek-ai/DeepSeek-V4.1-Flash",
  billingUrl: "https://api.together.ai/settings/billing",
  // List prices in dollars per million tokens.
  prices: Object.freeze({ cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 })
});
