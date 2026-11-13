import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { createMeteredFetch, keepingErrors } from "../meter.js";
import { deepinfra } from "./deepinfra.js";
import { gemini } from "./gemini.js";
import { together } from "./together.js";

/**
 * One kind of AI: its two settings, AI_<KIND>_PROVIDER (the type, which picks the provider's layer) and
 * AI_<KIND>_API_KEY (its key with that provider), and the types it accepts.
 * @param {string} id
 * @param {string} name
 * @param {ReadonlyArray<{ id: string }>} layers
 */
function kind(id, name, layers) {
  const setting = `AI_${id.toUpperCase()}`;
  return Object.freeze({
    id,
    name,
    providerSetting: `${setting}_PROVIDER`,
    keySetting: `${setting}_API_KEY`,
    types: Object.freeze(Object.fromEntries(layers.map((layer) => [layer.id, layer])))
  });
}

// Mercbot's three kinds of AI (D-72), each with one type for now. A provider's layer is one module in this folder: its
// address, model, list prices, billing page, and whatever its API needs (DeepInfra's thinking and Flex, a balance where
// its API reports one, Gemini's pictures and photo reading). Mercbot starts without any of them: a kind that isn't set
// up is off, and says so where it's used. Bots start no work without the premium and the economy AI (botsAiOff), and
// pictures and the Vault's photo reader say they aren't set up without images.
export const AI_KINDS = Object.freeze({
  premium: kind("premium", "Premium AI", [together]),
  economy: kind("economy", "Slower, cheaper AI", [deepinfra]),
  images: kind("images", "Images", [gemini])
});

// The kinds bots' own work runs on (WORK: chats, browser steps, the Builder and background work).
const BOT_KINDS = Object.freeze(["premium", "economy"]);

// What each kind of work runs on (D-59, D-72), the one place to change it. Someone waiting on a reply gets the premium
// AI; work people expect to wait for gets the slower, cheaper one, and work nobody waits on gets its Flex tier (0.8x
// the price, at the back of DeepInfra's queue). Everything a reply asks the model on the way (status lines, rule
// checks, reply checks) runs as that reply's work.
export const WORK = Object.freeze({
  chat: Object.freeze({
    kind: "premium",
    what: "People's chats and group chats (a Builder's too), requests between bots, and tasks app buttons hand to a bot"
  }),
  browser: Object.freeze({ kind: "premium", what: "The bots' browser steps" }),
  build: Object.freeze({ kind: "economy", what: "The Builder's replies in its own chat" }),
  background: Object.freeze({
    kind: "economy",
    tier: "flex",
    what: "Routines, watch runs, finished background commands, goal rounds and conversation summaries"
  }),
  pictures: Object.freeze({ kind: "images", what: "Making and editing pictures" }),
  photos: Object.freeze({ kind: "images", what: "Reading contact details from photos in the Vault" })
});

/** @typedef {keyof typeof WORK} Work */

/**
 * A setting's value, trimmed; "" when it's unset.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string} name
 */
export function settingOf(env, name) {
  return String(env[name] ?? "").trim();
}

/**
 * Where a test copy's stand-in model answers (D-83): MERCBOT_TEST_AI_URL, which every Preview and Test Preview sets to
 * Mercbot's stand-in (tools/standInModel.mjs, through tools/previewAi.mjs). Never in production or the live copy
 * (D-69), where it's "" whatever the setting says.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function standInAddress(env) {
  if (env.NODE_ENV === "production" || sideEffectsAreLive(env)) return "";
  return settingOf(env, "MERCBOT_TEST_AI_URL").replace(/\/+$/u, "");
}

// What a kind on the stand-in sends as its key: the stand-in needs none, and no provider ever sees it.
const STAND_IN_KEY = "stand-in";

/**
 * A provider's layer with the stand-in answering in its place, at `baseURL`: its model, list prices and needs (such as
 * DeepInfra's thinking and Flex) stay, so the work runs as it would there, but it has no balance or billing page.
 * @param {object} layer
 * @param {string} baseURL
 */
function standInLayer(layer, baseURL) {
  const { balance: _balance, billingUrl: _billingUrl, ...kept } = layer;
  return Object.freeze({
    ...kept,
    name: `Stand-in model, in place of ${layer.name}`,
    baseURL
  });
}

/**
 * A kind of AI as the env sets it up: its provider's layer and key, or null while its type is unset or one it doesn't
 * accept. The key is "" when it's missing. In a test copy with a stand-in model (standInAddress), every kind's layer
 * sends to the stand-in, under /<kind>, with no key of the provider's, and `standIn` is true.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {keyof typeof AI_KINDS} kindId
 */
export function aiKind(env, kindId) {
  const found = AI_KINDS[kindId];
  const type = settingOf(env, found.providerSetting);
  if (!Object.hasOwn(found.types, type)) return null;
  const standIn = standInAddress(env);
  if (standIn) {
    return { kind: found, layer: standInLayer(found.types[type], `${standIn}/${kindId}`), apiKey: STAND_IN_KEY, standIn: true };
  }
  return { kind: found, layer: found.types[type], apiKey: settingOf(env, found.keySetting), standIn: false };
}

/**
 * Whether a kind of AI is ready to use: a type it accepts and a key.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {keyof typeof AI_KINDS} kindId
 */
export function aiReady(env, kindId) {
  return Boolean(aiKind(env, kindId)?.apiKey);
}

/**
 * The settings a kind of AI still needs here, by name: its type while it's unset (or one it doesn't accept), and its
 * key, which the stand-in model doesn't need (D-83). Empty once the kind is ready.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {keyof typeof AI_KINDS} kindId
 * @returns {string[]}
 */
export function aiSettingsNeeded(env, kindId) {
  const found = AI_KINDS[kindId];
  const needed = [];
  if (!Object.hasOwn(found.types, settingOf(env, found.providerSetting))) needed.push(found.providerSetting);
  if (!settingOf(env, found.keySetting) && !standInAddress(env)) needed.push(found.keySetting);
  return needed;
}

/** Names as a sentence's list: "A", "A and B", "A, B and C". */
function listOf(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

/**
 * What a bot says in place of any new work while the AI bots' work runs on (premium and economy, WORK) isn't set up
 * here, naming the settings to add; "" once both are. Bots start nothing new without it, as in a paused home
 * (D-73): bots' botsMeter gives it as every home's pause.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function botsAiOff(env) {
  const needed = BOT_KINDS.flatMap((kindId) => aiSettingsNeeded(env, kindId));
  if (!needed.length) return "";
  return `Bots can't work on this copy of Mercbot yet: its AI isn't set up. Whoever runs it sets ${listOf(needed)}, then starts it again.`;
}

// A provider setting's value is said back only when it looks like a type: a key put there by mistake never reaches a log.
const TYPE_SHAPED = /^[a-z0-9-]{1,20}$/iu;

/**
 * What's wrong with the AI settings, one plain sentence per setting; empty when Mercbot can start. Any kind may be left
 * out, in part or whole, which leaves it off (aiSettingsNeeded), but none names a type it doesn't accept.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @returns {string[]}
 */
export function aiSettingsProblems(env) {
  const problems = [];
  for (const found of Object.values(AI_KINDS)) {
    const type = settingOf(env, found.providerSetting);
    const accepted = Object.keys(found.types).map((id) => `"${id}"`).join(" or ");
    if (type && !Object.hasOwn(found.types, type)) {
      const named = TYPE_SHAPED.test(type) ? `is "${type}", which` : "names a provider";
      problems.push(`${found.providerSetting} ${named} ${found.name} doesn't support: it can be ${accepted}.`);
    }
  }
  return problems;
}

/**
 * Stops startup while a kind of AI names a type it doesn't accept, naming each setting to fix (D-72). A kind that
 * isn't set up doesn't stop it: it's off.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function checkAiSettings(env) {
  const problems = aiSettingsProblems(env);
  if (problems.length) throw new Error(`Mercbot's AI isn't set up. ${problems.join(" ")}`);
}

/**
 * The provider layer with this id, whichever kind accepts it, or null.
 * @param {string | undefined} id
 */
export function providerLayer(id) {
  const found = kindAccepting(id);
  return found ? found.types[id] : null;
}

/**
 * The provider layer a kind of AI runs on when it's priced by the provider's list prices (D-73): each kind accepts one
 * type for now.
 * @param {keyof typeof AI_KINDS} kindId
 */
export function kindLayer(kindId) {
  return Object.values(AI_KINDS[kindId].types)[0];
}

/** The kind of AI that accepts the provider layer with this id, or undefined. */
function kindAccepting(id) {
  return Object.values(AI_KINDS).find((entry) => id && Object.hasOwn(entry.types, id));
}

/**
 * The kind of AI a provider layer serves, by its id, or null (D-73 records each call as its kind).
 * @param {string | undefined} id
 * @returns {keyof typeof AI_KINDS | null}
 */
export function kindOfProvider(id) {
  return kindAccepting(id)?.id || null;
}

/**
 * The fetch every request for this kind of work goes through: recorded as its kind of AI (meter.js, through its
 * recorder), with the provider's own needs added (DeepInfra's thinking and Flex), and its failures handed to the
 * meter's recordError. A kind that isn't set up, its type or its key missing, fails at once, naming the settings
 * (aiSettingsNeeded), and nothing is sent. On a stand-in (aiKind's `standIn`), it sends only to the stand-in's address
 * and refuses any other at once, so nothing the copy asks of its AI can reach a provider (D-83).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {Work} work
 * @returns {typeof fetch}
 */
export function aiFetch(env, work) {
  const route = WORK[work];
  const ai = aiKind(env, route.kind);
  if (!ai?.apiKey) {
    const needed = aiSettingsNeeded(env, route.kind);
    const message = `${AI_KINDS[route.kind].name} isn't set up here: ${listOf(needed)} ${needed.length > 1 ? "aren't" : "isn't"} set.`;
    return async () => {
      throw new Error(message);
    };
  }
  const metered = createMeteredFetch(env, ai.layer.id, { kind: route.kind, purpose: work });
  const send = Object.hasOwn(ai.layer, "wrapFetch") ? ai.layer.wrapFetch(metered, route.tier) : metered;
  const kept = keepingErrors(send, { kind: route.kind, provider: ai.layer.id, secret: ai.apiKey });
  return ai.standIn ? onlyUnder(ai.layer.baseURL, kept) : kept;
}

/**
 * fetch that sends only to addresses under `baseURL`, and refuses any other before it goes out.
 * @param {string} baseURL
 * @param {typeof fetch} send
 * @returns {typeof fetch}
 */
function onlyUnder(baseURL, send) {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(`${baseURL}/`)) {
      throw new Error(`This copy's AI is the stand-in model at ${baseURL}, so a request for ${new URL(url).origin} wasn't sent.`);
    }
    return send(input, init);
  };
}

/**
 * What a text model client for this kind of work uses: the provider's name, address, model and key, and `aiFetch`'s
 * fetch. A kind that isn't set up gets an address that's never reached, since its fetch refuses first.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {"chat" | "browser" | "build" | "background"} work
 */
export function modelSettings(env, work) {
  const ai = aiKind(env, WORK[work].kind);
  return {
    name: ai?.layer.name || AI_KINDS[WORK[work].kind].name,
    baseURL: ai?.layer.baseURL || "https://ai-not-set-up.invalid",
    model: ai?.layer.model || "not-set-up",
    apiKey: ai?.apiKey || "",
    fetch: aiFetch(env, work)
  };
}
