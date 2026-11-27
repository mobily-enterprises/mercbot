import { setTimeout as wait } from "node:timers/promises";
import { ConnectionError } from "./oauth.js";

// Every request Mercbot sends to a connected account's app (D-96) goes through that account's own fetch, made here: the
// bots' tools for Google, Microsoft, GitHub and Sedna, the general connector's apps, and Sedna's checks in Connect apps.
// Each request waits its turn in the account's Request pace, kept in PostgreSQL (plugin_account_turns) so that every
// server shares it (D-15), and an app's busy answer holds every request of the account off, on every server, for as
// long as the app asks.
//
// Each app's plugin.json declares its service's published limit, `limits: { requests, seconds }` (with `source` and
// `says`, where the number comes from). The pace an owner or admin chooses in Connect apps uses a share of it: Gentle (the
// default for every connection, and for one that never chose) a tenth, Normal four tenths, Fast nine tenths. Half of
// that share may go at once; the other half is spread evenly over the limit's window, so no window ever holds more than
// the share. Making a key (an hourly token, a renewal) isn't paced: it happens once an hour at most.

/** Each Request pace's share of the app's own limit. */
export const PACES = Object.freeze({ gentle: 0.1, normal: 0.4, fast: 0.9 });
/** The pace of a connection that never chose one. */
export const DEFAULT_PACE = "gentle";
// The share of a pace's allowance that may go at once, without waiting its turn: a search and the messages it found.
const BURST_SHARE = 0.5;
// A request waits its turn this long at most; beyond it, the app is busy for the caller now.
const WAIT_MAX_MS = 20000;
// A busy answer asking for this long or less is waited out once, in turn; a longer one is reported at once.
const WAIT_OUT_MAX_S = 10;
// A busy answer that doesn't say for how long holds requests off this long; no hold-off is longer than an hour.
const BUSY_DEFAULT_S = 5;
const BUSY_MAX_S = 3600;
// An app whose plugin.json names no limit: one request a second.
const UNKNOWN_LIMITS = Object.freeze({ requests: 60, seconds: 60 });

/** The pace an account uses: the one chosen in Connect apps, or Gentle. */
export const paceOf = (account) => (Object.hasOwn(PACES, String(account?.pace)) ? String(account.pace) : DEFAULT_PACE);

/**
 * How a pace spaces an app's requests: `burst` may go at once, then one every `everyMs`. In any window of the app's
 * limit, `burst` plus the spread ones never pass the pace's share of it. `everyMs` is rounded up to a whole millisecond,
 * as each turn is kept (a timestamp), so keeping it never shortens the spacing.
 * @param {{ requests?: number, seconds?: number } | null | undefined} limits plugin.json's
 * @param {string} pace
 */
export function spacing(limits, pace) {
  const requests = Number(limits?.requests) > 0 ? Number(limits.requests) : UNKNOWN_LIMITS.requests;
  const seconds = Number(limits?.seconds) > 0 ? Number(limits.seconds) : UNKNOWN_LIMITS.seconds;
  const allowed = requests * PACES[pace in PACES ? pace : DEFAULT_PACE];
  const burst = Math.max(1, Math.floor(allowed * BURST_SHARE));
  return { burst, everyMs: Math.ceil((seconds * 1000) / (allowed * (1 - BURST_SHARE))) };
}

/** The app is busy for now: nothing was done, and the caller says when to try again. */
export class AppBusyError extends ConnectionError {
  /**
   * @param {string} app
   * @param {number} seconds
   */
  constructor(app, seconds) {
    super(503, `${app} is busy: try again in ${seconds} s. Nothing was done.`, {
      code: "integrations_app_busy",
      params: { app, seconds }
    });
    this.seconds = seconds;
  }
}

/** Seconds a Retry-After asks for: a number of seconds or an HTTP date; null when it says nothing usable. */
function retryAfter(value) {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

/**
 * Seconds until a rate limit's window starts again, once no request is left in it (x-ratelimit-remaining: 0): GitHub's
 * x-ratelimit-reset is a moment (Unix seconds), Calendly's the seconds left. Null when requests are left or it doesn't say.
 * @param {Headers} headers
 */
function untilReset(headers) {
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-remaining") !== "0" || !(reset > 0)) return null;
  return Math.max(1, Math.ceil(reset > 1e9 ? reset - Date.now() / 1000 : reset));
}

/**
 * Whether an answer is the app saying it's busy, and for how many seconds, by each service's published signal: 429 from
 * any app; 529 (Notion's overload); 503 with a Retry-After (Microsoft Graph, SharePoint); a 403 with a Retry-After or no
 * requests left (GitHub); a 403 Google names as a rate limit (rateLimitExceeded, userRateLimitExceeded). Null otherwise.
 * @param {Response} response
 */
export async function busyFor(response) {
  const { status, headers } = response;
  const asked = retryAfter(headers.get("retry-after")) ?? untilReset(headers);
  const seconds = (found) => Math.min(BUSY_MAX_S, Math.max(1, found ?? BUSY_DEFAULT_S));
  if (status === 429 || status === 529) return seconds(asked);
  if (status === 503 && asked !== null) return seconds(asked);
  if (status !== 403) return null;
  if (asked !== null) return seconds(asked);
  const body = await response.clone().json().catch(() => null);
  const reasons = (body?.error?.errors || []).map((entry) => entry?.reason);
  return reasons.some((reason) => reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") ? seconds(null) : null;
}

/**
 * The paced way to every connected account's app.
 * @param {object} dependencies
 * @param {object} dependencies.turns the plugin_account_turns handle: each account's next turn
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {() => number} [dependencies.now]
 * @param {(ms: number) => Promise<unknown>} [dependencies.sleep]
 */
export function createAppRequests({ turns, systemContext, now = Date.now, sleep = wait }) {
  // A turn is taken on its own, outside any transaction the caller holds, so a slow call never keeps the row locked.
  const scope = () => ({ context: systemContext("pace the requests a connected account sends to its app (D-96)") });
  /** Runs `work(row, txOptions)` with the account's turn row locked, made now when it has none. */
  const withTurn = (accountId, work) => turns.lockOrCreate({ id: String(accountId), nextAt: new Date(now()).toISOString() }, scope(), work);

  /**
   * Takes the account's next turn, by the pace's spacing: how long to wait for it, in ms. A turn further off than a
   * caller waits is not taken: the app is busy for it, for that many seconds.
   */
  function take(accountId, { burst, everyMs }) {
    return withTurn(accountId, async (row, txOptions) => {
      const at = now();
      const next = new Date(row.nextAt).getTime() || at;
      const sendAt = Math.max(at, next - (burst - 1) * everyMs);
      if (sendAt - at > WAIT_MAX_MS) return { busy: Math.ceil((sendAt - at) / 1000) };
      await turns.patch(String(accountId), { nextAt: new Date(Math.max(next, at) + everyMs).toISOString() }, { ...txOptions, returning: "none" });
      return { waitMs: sendAt - at };
    });
  }

  /** The app asked to wait `seconds`: no request of the account goes before then, on any server. */
  function holdOff(accountId, { burst, everyMs }, seconds) {
    return withTurn(accountId, async (row, txOptions) => {
      const until = now() + seconds * 1000 + (burst - 1) * everyMs;
      if ((new Date(row.nextAt).getTime() || 0) >= until) return;
      await turns.patch(String(accountId), { nextAt: new Date(until).toISOString() }, { ...txOptions, returning: "none" });
    });
  }

  /**
   * The account's own fetch: every request waits its turn, and a busy answer holds the account's requests off for as long
   * as the app asks; one asking for WAIT_OUT_MAX_S or less is waited out once (the app did nothing, so trying again is
   * safe), else, and when it's busy again, an AppBusyError. A 503 to a change is the exception: the app may have made it,
   * so the requests are held off and the answer is the caller's, never sent again. Any other answer is the caller's, as
   * fetch gives it.
   * @param {{ id: string, pace?: string | null }} account
   * @param {{ name: string, limits?: { requests?: number, seconds?: number } } | null} plugin
   * @param {typeof fetch} [via] how the app is reached: fetch, or the general connector's publicFetch
   * @returns {typeof fetch}
   */
  function fetchFor(account, plugin, via = (...args) => globalThis.fetch(...args)) {
    const app = plugin?.name || "The app";
    const spaced = spacing(plugin?.limits, paceOf(account));
    const inTurn = async () => {
      const turn = await take(account.id, spaced);
      if (turn.busy) throw new AppBusyError(app, turn.busy);
      if (turn.waitMs > 0) await sleep(turn.waitMs);
    };
    return async (url, init) => {
      const change = !["GET", "HEAD"].includes(String(init?.method || "GET").toUpperCase());
      for (let attempt = 0; ; attempt += 1) {
        await inTurn();
        const response = await via(url, init);
        const seconds = await busyFor(response);
        if (seconds === null) return response;
        await holdOff(account.id, spaced, seconds);
        if (change && response.status === 503) return response;
        await response.body?.cancel().catch(() => {});
        if (attempt > 0 || seconds > WAIT_OUT_MAX_S) throw new AppBusyError(app, seconds);
      }
    };
  }

  return Object.freeze({ fetchFor });
}
