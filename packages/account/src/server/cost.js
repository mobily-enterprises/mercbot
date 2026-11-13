import { kindLayer, kindOfProvider, providerLayer } from "./providers/index.js";

// What an AI call cost at its provider (D-56, D-73). Money is whole nanodollars (a billionth of a dollar), which
// JavaScript holds exactly up to about $9 million: every listed per-token price is a whole number of them ($0.006 per
// million tokens is 6 a token), and only a total shown to a person is rounded.

const NANO_PER_DOLLAR = 1e9;
// A price per million tokens, in dollars, is this many nanodollars a token.
export const NANO_PER_TOKEN_AT_ONE_DOLLAR_A_MILLION = 1000;

/** Dollars as whole nanodollars. */
export const toNano = (dollars) => Math.round(Number(dollars || 0) * NANO_PER_DOLLAR);

/** The kind of AI a provider serves (D-72); an unknown one counts as premium. */
export function kindOf(provider) {
  return kindOfProvider(provider) || "premium";
}

/**
 * A provider's list prices, in dollars per million tokens, for a call that makes `pictures` (an unknown provider's are
 * premium AI's). A layer whose model for calls that make no picture is another lists its prices as `readingPrices`.
 * @param {string} provider
 * @param {number} [pictures]
 */
export function listPrices(provider, pictures = 0) {
  const layer = providerLayer(provider) || kindLayer("premium");
  return (!pictures && layer.readingPrices) || layer.prices;
}

/**
 * What the provider charged for an AI call, in nanodollars: what it reported (DeepInfra's estimated_cost), or else its
 * tokens at the provider's list prices for a call that makes `pictures`.
 * @param {{ cacheHit?: number, cacheMiss?: number, output?: number, reportedCost?: number }} usage
 * @param {string} provider
 * @param {number} [pictures] how many pictures the call asked for
 */
export function providerCostNano(usage, provider, pictures = 0) {
  if (Number.isFinite(usage.reportedCost)) return toNano(usage.reportedCost);
  const list = listPrices(provider, pictures);
  const perToken = (price) => (price || 0) * NANO_PER_TOKEN_AT_ONE_DOLLAR_A_MILLION;
  const output = (usage.output || 0) * perToken(list.output);
  if (Object.hasOwn(list, "input")) return Math.round(((usage.cacheHit || 0) + (usage.cacheMiss || 0)) * perToken(list.input) + output);
  return Math.round((usage.cacheHit || 0) * perToken(list.cacheHit) + (usage.cacheMiss || 0) * perToken(list.cacheMiss) + output);
}
