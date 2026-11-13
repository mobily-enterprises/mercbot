/**
 * DeepInfra's model doesn't reason unless asked (measured: no reasoning tokens by default), so every
 * call asks, at the effort the loop uses elsewhere; a call that turns thinking off stays off.
 * @param {typeof fetch} send
 * @returns {typeof fetch}
 */
function thinkingFetch(send) {
  return (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (!body || body.thinking?.type === "disabled") return send(url, init);
    return send(url, { ...init, body: JSON.stringify({ ...body, reasoning_effort: "high" }) });
  };
}

// DeepInfra may keep a Flex call waiting for 10 minutes; ours asks at Standard after this long. It's
// shorter than a summary's 3-minute claim, so no other server takes that work over meanwhile.
const FLEX_PATIENCE_MS = 2 * 60 * 1000;

/**
 * Flex (0.8x the price): the same call at the back of the queue, for work nobody is waiting on (D-59).
 * If DeepInfra refuses it (never charged) or it waits too long, the call goes again at Standard.
 * @param {typeof fetch} send
 * @returns {typeof fetch}
 */
function flexFetch(send) {
  return async (url, init = {}) => {
    const patience = new AbortController();
    const timer = setTimeout(() => patience.abort(), FLEX_PATIENCE_MS);
    const flex = {
      ...init,
      body: JSON.stringify({ ...JSON.parse(init.body), service_tier: "flex" }),
      signal: init.signal ? AbortSignal.any([init.signal, patience.signal]) : patience.signal
    };
    const response = await send(url, flex)
      .catch((error) => {
        if (init.signal?.aborted) throw error;
        return null;
      })
      .finally(() => clearTimeout(timer));
    if (response && response.status !== 429) return response;
    await response?.body?.cancel();
    return send(url, init);
  };
}

/**
 * What's left on Mercbot's DeepInfra account, from its billing checklist (the key needs DeepInfra's `billing:read`
 * scope). Its `stripe_balance` is negative while there are funds to spend and positive while money is owed, so the
 * balance is its opposite.
 * @param {string} apiKey
 * @param {typeof fetch} send
 * @returns {Promise<{ amount: number, currency: string }>}
 */
async function readBalance(apiKey, send) {
  const response = await send("https://api.deepinfra.com/payment/checklist", {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`DeepInfra answered ${response.status}.`);
  const { stripe_balance: owed } = await response.json();
  if (typeof owed !== "number") throw new Error("DeepInfra's answer had no balance in it.");
  return { amount: -owed, currency: "USD" };
}

// DeepInfra (D-58): the one type the slower, cheaper AI accepts (D-72). DeepSeek's Flash model through an OpenAI-style
// chat API, with a prompt cache and reasoning. Its own /models list gives these prices; a promotion may charge less.
export const deepinfra = Object.freeze({
  id: "deepinfra",
  name: "DeepInfra",
  baseURL: "https://api.deepinfra.com/v1/openai",
  model: "deepseek-ai/DeepSeek-V4.1-Flash",
  billingUrl: "https://deepinfra.com/dash/billing",
  prices: Object.freeze({ cacheHit: 0.006, cacheMiss: 0.2, output: 0.6 }),
  wrapFetch: (send, tier) => thinkingFetch(tier === "flex" ? flexFetch(send) : send),
  balance: readBalance
});
