import { AsyncLocalStorage } from "node:async_hooks";
import { AccountError } from "./accountError.js";

// Metering (D-56, D-73): every AI call, a computer's day and its commands' computation are recorded for the home,
// person and bot they were for. Work done for someone runs inside a meter's track(); every AI request, text or
// pictures, whichever provider serves it, goes through createMeteredFetch's fetch. The meter's recorder opens the call
// before it goes out and finishes it, with the provider's own figures, before handing back the response; a call that
// fails, is cut or never answers is still recorded, as an estimate. Mercbot's own recorder (usage.js) counts what each
// piece of work used and what it cost at its provider; a copy built on Mercbot may provide its own
// (`mercbot.usage-recorder`), which may refuse work before it starts (refuseWork).

/** Commands' computation is opened a block at a time, ten minutes of it, renewed while they run. */
export const COMPUTATION_BLOCK_SECONDS = 600;

/** The status of work a recorder refused before it started. */
const REFUSED = 402;

/**
 * The refusal of work before it starts, for a recorder a copy provides: 402, its code, the sentence the person sees,
 * and `notice`, what a bot says in place of the work it didn't start.
 * @param {string} message
 * @param {{ code: string, notice?: string }} refusal
 */
export function refuseWork(message, { code, notice = message }) {
  return new AccountError(REFUSED, message, { code, params: { notice } });
}

/**
 * The refusal of work before it started, if an error is one or was caused by one: its sentence and what a bot says in
 * its place. Null for any other error.
 * @param {unknown} error
 * @returns {{ message: string, notice: string } | null}
 */
export function refusalOf(error) {
  for (let at = error, depth = 0; at && depth < 5; at = at.cause, depth += 1) {
    if ((at.statusCode ?? at.status) === REFUSED) return { message: String(at.message || ""), notice: String(at.params?.notice || at.message || "") };
  }
  return null;
}

// The process's one carrier of who the work in progress is for, and where it's recorded: each meter's track() puts
// its own `recorder` there with the person, bot and home, and `recordError`, where the AI providers' failures go
// (AccountFeature: `mercbot.provider-failures` when a feature provides it, else the server log).
const context = new AsyncLocalStorage();

/**
 * Who the work in progress is for: the person, bot, home and kind of work track() was given, without where things go.
 * @returns {{ userId?: string, botId?: string, workspaceId?: string, work?: string } | null}
 */
function currentWho() {
  const store = context.getStore();
  if (!store) return null;
  const { recorder: _recorder, recordError: _recordError, ...who } = store;
  return who;
}

/**
 * The kind of work in progress, which decides what the model runs on (D-59): "background" or "build"
 * if track() was told so, otherwise "chat".
 * @returns {"chat" | "build" | "background"}
 */
export function currentWork() {
  return context.getStore()?.work || "chat";
}

/**
 * The meter the account feature provides (`mercbot.meter`): work tracked for a person, bot and home, and recorded for
 * them through `recorder` (usage.js, or the copy's own). The AI providers' failures inside tracked work go to
 * `recordError`.
 * @param {object} dependencies
 * @param {Pick<import("./types.js").UsageRecorder, "open" | "finish" | "startComputerDay" | "countComputerDay" | "computerDay" | "release" | "startComputation" | "renewComputation" | "finishComputation">} dependencies.recorder
 * @param {(failure: { kind: string, provider: string, status: number | null, message: string }) => Promise<void>} [dependencies.recordError]
 */
export function createMeter({ recorder, recordError }) {
  /**
   * Runs work for a person, bot and home; what it uses is recorded for them.
   * @template T
   * @param {{ userId?: string, botId?: string, workspaceId?: string, work?: "chat" | "build" | "background" }} who
   * @param {() => T} work
   * @returns {T}
   */
  function track(who, work) {
    return context.run({ ...context.getStore(), ...who, recorder, ...(recordError ? { recordError } : {}) }, work);
  }

  /** Who the work in progress is for, to carry to another server (null outside tracked work). */
  function currentMeter() {
    return currentWho();
  }

  /**
   * Opens a bot's computer's day before it starts, for whom `computer` names or else the work in progress: null when
   * that day is recorded already. Throws the recorder's refusal (refuseWork) when it won't have it. Answers the day:
   * count() it once the computer has started, or release() it when it couldn't start.
   * @param {{ computerId: string, botId?: string, userId?: string, workspaceId?: string }} computer
   */
  async function startComputerDay(computer) {
    const ticket = await recorder.startComputerDay({ ...currentWho(), ...computer });
    return ticket && Object.freeze({ count: () => recorder.countComputerDay(ticket), release: () => recorder.release(ticket) });
  }

  /**
   * Records an awake computer's new day, for whom `computer` names or else the work in progress. Throws the recorder's
   * refusal when it won't have it.
   * @param {{ computerId: string, botId?: string, userId?: string, workspaceId?: string }} computer
   */
  function computerDay(computer) {
    return recorder.computerDay({ ...currentWho(), ...computer });
  }

  /**
   * Opens a first block of a command's computation before it starts, for whom `work` names or else the work in
   * progress. Throws the recorder's refusal when it won't have it. Answers the block: renew() it each block
   * (blockSeconds) while the command runs (false: stop the command), and settle(seconds) when it ends.
   * @param {{ botId?: string, userId?: string, workspaceId?: string }} work
   */
  async function startComputation(work) {
    const ticket = await recorder.startComputation({ ...currentWho(), ...work });
    return Object.freeze({
      blockSeconds: COMPUTATION_BLOCK_SECONDS,
      renew: () => recorder.renewComputation(ticket),
      settle: (seconds) => recorder.finishComputation(ticket, seconds)
    });
  }

  return Object.freeze({
    track,
    currentMeter,
    startComputerDay,
    computerDay,
    startComputation
  });
}

// Development only (D-48 evaluations): with MERCBOT_TRACE_DIR set, each model request's body and its
// response are written there, one file per call, to see exactly what the model was sent. The
// counter numbers the files across the whole process.
let traced = 0;
async function trace(dir, init, response) {
  if (!dir) return;
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  traced += 1;
  const body = await response.clone().text().catch(() => "");
  await writeFile(
    `${dir}/${String(traced).padStart(4, "0")}.json`,
    JSON.stringify({ request: JSON.parse(String(init?.body || "null")), response: body.slice(0, 200000) }, null, 1)
  );
}

/**
 * fetch for AI clients: each call is recorded through the meter tracking the work in progress. Every kind of AI's
 * requests come through here (providers/index.js, aiFetch). A call outside tracked work belongs to no one, so it goes
 * out unrecorded, with a warning.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env The server's, for the development trace folder.
 * @param {string} provider which provider these calls go to (a provider layer's id)
 * @param {{ kind?: string, purpose?: string }} [recorded] the kind of AI they are recorded as, and what they're for
 *   (aiFetch's work); without them, the provider's kind and the work in progress
 */
export function createMeteredFetch(env, provider, recorded = {}) {
  return (input, init) => meteredFetch(env.MERCBOT_TRACE_DIR, provider, recorded, input, init);
}

// What an AI provider's failure keeps: its own words, short, without the key or anything shaped like part of one.
const KEPT_MESSAGE = 300;
const LONG_TOKEN = /[\w-]{32,}/gu;
const KEY_PART = 8;

/**
 * Text with the key taken out, and with it any word holding 8 of its characters in a row (a provider may say back the
 * start or the end of a key) and any token of 32 or more letters, digits, - and _ (another key, or a request's ID).
 * @param {string} text
 * @param {string} secret the key
 */
export function withoutSecrets(text, secret) {
  const parts = [];
  for (let at = 0; at + KEY_PART <= secret.length; at += 1) parts.push(secret.slice(at, at + KEY_PART));
  const words = text.replace(/\S+/gu, (word) => (parts.some((part) => word.includes(part)) ? "[key]" : word));
  return (secret ? words.split(secret).join("[key]") : words).replace(LONG_TOKEN, "[…]");
}

/**
 * The provider's own words from a failed answer: the error's message in its JSON, else the text.
 * @param {string} text
 */
function failureWords(text) {
  try {
    const body = JSON.parse(text);
    const said = body?.error?.message ?? body?.error ?? body?.message ?? body?.detail;
    if (typeof said === "string") return said;
  } catch {
    // Not JSON: the text itself.
  }
  return text;
}

/**
 * Keeps a failure of the work in progress where the meter's `recordError` sends it, never failing the caller's work.
 * @param {{ kind: string, provider: string, status: number | null, message: string }} failure
 * @param {string} secret the provider's key, never kept
 */
function keepFailure(failure, secret) {
  const recordError = context.getStore()?.recordError;
  if (!recordError) return;
  const message = withoutSecrets(failure.message.replace(/\s+/gu, " ").trim(), secret).slice(0, KEPT_MESSAGE) || "No message.";
  Promise.resolve(recordError({ ...failure, message })).catch((error) => console.warn("Keeping an AI provider's failure failed; the work carries on.", error));
}

/**
 * Where the AI providers' failures go when no feature keeps them (`mercbot.provider-failures`): one line each in the server
 * log, the message already without the key (keepFailure).
 * @param {{ kind: string, provider: string, status: number | null, message: string }} failure
 */
export async function logAiFailure({ kind, provider, status, message }) {
  console.warn(`The ${kind} AI's provider ${provider} failed${status === null ? "" : ` with ${status}`}: ${message}`);
}

/**
 * fetch that keeps each failed answer (status 400 or more) and each request that never got one, unless the caller
 * stopped it (a request that ran out of its own time is kept), through the meter's `recordError`: what kind of AI,
 * which provider, the status and the provider's words. It wraps the provider's own fetch, so a Flex call DeepInfra
 * refused and then answered at Standard is no failure.
 * @param {typeof fetch} send
 * @param {{ kind: string, provider: string, secret: string }} where
 * @returns {typeof fetch}
 */
export function keepingErrors(send, { kind, provider, secret }) {
  return async (input, init) => {
    let response;
    try {
      response = await send(input, init);
    } catch (error) {
      const stopped = init?.signal?.aborted && init.signal.reason?.name !== "TimeoutError";
      if (!stopped) keepFailure({ kind, provider, status: null, message: String(error?.message || error) }, secret);
      throw error;
    }
    if (!response.ok) {
      response
        .clone()
        .text()
        .catch(() => "")
        .then((text) => keepFailure({ kind, provider, status: response.status, message: failureWords(text) || `Answered ${response.status}.` }, secret));
    }
    return response;
  };
}


/**
 * The provider's own figures in a response's body: its tokens (cache hits, cache misses and output) in DeepSeek's,
 * the OpenAI-style or the Anthropic form, or Gemini's usageMetadata with the pictures it made; what it really cost
 * when it says (DeepInfra's estimated_cost, tier and promotions included); and the tier that served it. Null when
 * the body has none.
 * @param {any} body
 */
export function usageOf(body) {
  if (body?.usageMetadata) {
    const meta = body.usageMetadata;
    const cached = Number(meta.cachedContentTokenCount) || 0;
    const parts = (body.candidates || []).flatMap((candidate) => candidate?.content?.parts || []);
    return {
      state: "done",
      cacheHit: cached,
      cacheMiss: Math.max(0, (Number(meta.promptTokenCount) || 0) - cached),
      output: (Number(meta.candidatesTokenCount) || 0) + (Number(meta.thoughtsTokenCount) || 0),
      images: parts.filter((part) => part?.inlineData?.data).length
    };
  }
  const usage = body?.usage;
  if (!usage) return null;
  const served = {
    state: "done",
    ...(body.service_tier ? { tier: body.service_tier } : {}),
    ...(Number.isFinite(usage.estimated_cost) ? { reportedCost: usage.estimated_cost } : {})
  };
  // The Anthropic format counts cached and uncached input separately (D-48).
  if ("input_tokens" in usage) {
    return {
      ...served,
      cacheHit: Number(usage.cache_read_input_tokens) || 0,
      cacheMiss: (Number(usage.input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0),
      output: Number(usage.output_tokens) || 0
    };
  }
  const cacheHit = Number(usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens) || 0;
  return {
    ...served,
    cacheHit,
    cacheMiss: Number(usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens || 0) - cacheHit)) || 0,
    output: Number(usage.completion_tokens) || 0
  };
}

/**
 * The provider's figures in a streamed reply: the last OpenAI-style chunk that carries usage, or the Anthropic
 * stream's message_start (input) and message_delta (output). Null when it carried none.
 * @param {string} text the whole stream
 */
export function streamedUsageOf(text) {
  let found = null;
  let anthropic = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (event?.type === "message_start" && event.message?.usage) anthropic = { ...event.message.usage };
    else if (event?.type === "message_delta" && event.usage && anthropic) anthropic = { ...anthropic, ...event.usage };
    else if (event?.usage) found = usageOf(event);
  }
  return anthropic ? usageOf({ usage: anthropic }) : found;
}

/** Records how a call ended, never failing it: a call that can't be recorded is left to its recorder. */
function settle(recorder, ticket, outcome) {
  return Promise.resolve()
    .then(() => recorder.finish(ticket, outcome))
    .catch((error) => console.warn("Recording an AI call failed; the call carries on.", error));
}

/** The figures in a body, or for a body with none, what it says for an estimate. */
function outcomeOf(text) {
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // A body that isn't JSON carries no figures.
  }
  return usageOf(body) || { state: "no_usage", outputChars: text.length };
}

// The longest reply a request asks for, in the OpenAI, Anthropic or Gemini form, and whether it asks for pictures
// (Gemini's image output) and how many.
const MOST_OUTPUT = /"(?:max_tokens|max_completion_tokens|max_output_tokens|maxOutputTokens)"\s*:\s*(\d+)/u;
const ASKS_FOR_PICTURES = /"responseModalities"\s*:\s*\[[^\]]*"IMAGE"/u;
const PICTURES = /"candidateCount"\s*:\s*(\d+)/u;

/**
 * @param {string | undefined} traceDir
 * @param {string | undefined} provider
 * @param {{ kind?: string, purpose?: string }} recorded
 * @param {Parameters<typeof fetch>[0]} input
 * @param {Parameters<typeof fetch>[1]} init
 */
async function meteredFetch(traceDir, provider, recorded, input, init) {
  const store = context.getStore();
  if (!store?.recorder) {
    console.warn(`An AI call to ${provider || "the provider"} was made outside tracked work, so it isn't recorded for anyone.`);
    const response = await fetch(input, init);
    await trace(traceDir, init, response).catch((error) => console.warn("Tracing a model request failed; the request carries on.", error));
    return response;
  }
  const { recorder, ...who } = store;
  const body = typeof init?.body === "string" ? init.body : "";
  // Opened first: if the recorder refuses it, or can't open it, the call doesn't go out.
  const ticket = await recorder.open({
    userId: who.userId,
    botId: who.botId,
    workspaceId: who.workspaceId,
    work: recorded.purpose || who.work,
    kind: recorded.kind,
    provider,
    requestChars: body.length,
    mostOutput: Number(MOST_OUTPUT.exec(body)?.[1]) || undefined,
    pictures: ASKS_FOR_PICTURES.test(body) ? Number(PICTURES.exec(body)?.[1]) || 1 : 0
  });
  let response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    await settle(recorder, ticket, { state: "cut" });
    throw error;
  }
  await trace(traceDir, init, response).catch((error) => console.warn("Tracing a model request failed; the request carries on.", error));
  if (!response.ok) {
    await settle(recorder, ticket, { state: "failed" });
    return response;
  }
  // A streamed reply is recorded when its stream ends, from its last figures; a stream cut short is an estimate.
  if (/event-stream/iu.test(response.headers.get("content-type") || "")) {
    response.clone().text().then(
      (text) => settle(recorder, ticket, streamedUsageOf(text) || { state: "no_usage", outputChars: text.length }),
      () => settle(recorder, ticket, { state: "cut" })
    );
    return response;
  }
  const text = await response.clone().text().catch(() => null);
  const outcome = text === null ? { state: "cut" } : outcomeOf(text);
  await settle(recorder, ticket, outcome);
  return response;
}
