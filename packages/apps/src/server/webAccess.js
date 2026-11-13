import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { isPrivateAddress, publicLookup } from "@local/account/public-address";
import { seal, unseal, vaultKey } from "@local/account/vault-crypto";
import { GateError } from "./validate.js";

// Outside web services for scripts (D-35, owner 2026-10-29): only https origins a home's owners or
// admins allowed, never private network addresses (checked on the address actually connected to,
// so DNS can't be switched after the check), no redirects, 10 s and 1 MB per call. Secret headers
// (API keys) are sealed with the vault key and added here; scripts never see them. The list is AppsFeature's
// app_web_access, in the home of each call's options. A call that can change something there (any method but
// GET) is an outbound webhook: a test copy checks it like a real one, logs it and answers as if it went (D-69), and so
// does a run in a draft's preview (`simulate`, D-71), which works on practice data.
const TIMEOUT_MS = 10000;
const MAX_BYTES = 1024 * 1024;
const MAX_ORIGINS = 50;
const HEADER = /^[A-Za-z0-9-]{1,64}$/u;

function originOf(text) {
  if (!URL.canParse(String(text || ""))) return null;
  const url = new URL(text);
  return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
}

/**
 * The web addresses a home's scripts may call, with their sealed headers (see above).
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: appWebAccess and auditEvents.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {boolean} [dependencies.insecure] Tests only: allows http and local addresses.
 */
export function createWebAccess({ resources, env, insecure = false }) {
  const { appWebAccess, auditEvents } = resources;
  const key = () => {
    const found = vaultKey(env);
    if (!found) throw new GateError(503, "Secret headers need MERCBOT_VAULT_KEY on the server.", { code: "apps_web_vault_key_missing" });
    return found;
  };

  /** The home's addresses with their sealed headers, in origin order. */
  const rowsOf = (options) => appWebAccess.queryAll({ sort: ["origin"], fields: ["origin", "headers"] }, passedOn(options));

  async function list(options) {
    const rows = await rowsOf(options);
    return rows.map((row) => ({ origin: row.origin, secretHeaders: row.headers ? Object.keys(unseal(row.headers, key())) : [] }));
  }

  /**
   * entries: [{ origin, headers?: { name: value } | null }]; a header given as null keeps the
   * value already stored (people never see stored values again).
   */
  async function set(actor, given, options) {
    // No list at all clears it, as an empty one does.
    const entries = given ?? [];
    if (!Array.isArray(entries) || entries.length > MAX_ORIGINS) {
      throw new GateError(400, `A list of at most ${MAX_ORIGINS} addresses.`, {
        code: "apps_web_origins_too_many",
        params: { max: MAX_ORIGINS }
      });
    }
    const current = new Map((await rowsOf(options)).map((row) => [row.origin, row]));
    const rows = [];
    for (const entry of entries) {
      const origin = originOf(entry?.origin);
      if (!origin || (!insecure && !origin.startsWith("https://"))) {
        const given = entry?.origin ?? "";
        throw new GateError(400, `"${given}" isn't an https address like https://api.example.com.`, {
          code: "apps_web_origin_invalid",
          params: { origin: given }
        });
      }
      if (rows.some((row) => row.origin === origin)) continue;
      const kept = current.get(origin)?.headers ? unseal(current.get(origin).headers, key()) : {};
      const headers = {};
      for (const [name, value] of Object.entries(entry.headers || {})) {
        if (!HEADER.test(name)) {
          throw new GateError(400, `"${name}" isn't a header name.`, { code: "apps_web_header_invalid", params: { name } });
        }
        if (value === null || value === undefined) {
          if (kept[name] !== undefined) headers[name] = kept[name];
        } else {
          headers[name] = String(value).slice(0, 4000);
        }
      }
      rows.push({ origin, headers: Object.keys(headers).length ? seal(headers, key()) : null, createdBy: actor });
    }
    await appWebAccess.withTransaction(passedOn(options), async (txOptions) => {
      await appWebAccess.deleteWhere({}, { ...txOptions, all: true });
      if (rows.length) await appWebAccess.createMany(rows, txOptions);
      await auditEvents.create(
        { actor, via: { kind: "apps" }, action: "schema", changes: { webAccess: rows.map((row) => row.origin) } },
        { ...txOptions, returning: "none" }
      );
    });
    return list(options);
  }

  /** DNS for the request itself: an address that isn't public is refused. */
  const checkedLookup = publicLookup(insecure);

  async function fetch(target, { method = "GET", headers, body = null } = {}, options, { simulate = false } = {}) {
    const origin = originOf(target);
    if (!origin || (!insecure && !origin.startsWith("https://"))) throw new Error(`"${target}" isn't an https address`);
    const [row] = await appWebAccess.queryAll({ filters: { origin }, fields: ["headers"] }, passedOn(options));
    if (!row) throw new Error(`${origin} isn't on this home's list of addresses scripts may call (Apps → Scripts)`);
    const url = new URL(target);
    // An IPv6 address is written in brackets ([::1]), which isIP doesn't take; node connects to it without a lookup.
    const host = url.hostname.replace(/^\[|\]$/gu, "");
    if (!insecure && isIP(host) && isPrivateAddress(host)) throw new Error(`${host} is a private network address`);
    const verb = String(method).toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(verb)) throw new Error(`method ${method} isn't allowed`);
    const payload = body === null || body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const sent = Object.fromEntries(
      Object.entries(headers || {})
        .filter(([name]) => HEADER.test(name))
        .map(([name, value]) => [name.toLowerCase(), String(value)])
    );
    if (payload !== null && typeof body !== "string" && !sent["content-type"]) sent["content-type"] = "application/json";
    for (const [name, value] of Object.entries(row.headers ? unseal(row.headers, key()) : {})) sent[name.toLowerCase()] = value;
    if (verb !== "GET" && (simulate || !sideEffectsAreLive(env))) {
      // A draft's practice run reports it to whoever pressed the button instead (D-71).
      if (!simulate) logSimulatedSideEffect(console, { kind: "webhook", summary: `the script's ${verb} to ${origin}${url.pathname}`, details: { method: verb, origin } });
      return { status: 200, ok: true, headers: { "content-type": "" }, text: "", json: null, simulated: true };
    }
    const client = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.request(
        url,
        { method: verb, headers: { "user-agent": "Mercbot-script", ...sent }, lookup: checkedLookup, timeout: TIMEOUT_MS },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              request.destroy(new Error("the answer is larger than 1 MB"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const type = String(response.headers["content-type"] || "");
            let json = null;
            if (/json/iu.test(type)) {
              try {
                json = JSON.parse(text);
              } catch {
                json = null;
              }
            }
            resolve({
              status: response.statusCode,
              ok: response.statusCode >= 200 && response.statusCode < 300,
              headers: { "content-type": type, ...(response.headers.location ? { location: response.headers.location } : {}) },
              text,
              json
            });
          });
          response.on("error", reject);
        }
      );
      request.on("timeout", () => request.destroy(new Error("the address didn't answer within 10 seconds")));
      request.on("error", (error) => reject(new Error(error.message)));
      if (payload !== null) request.write(payload);
      request.end();
    });
  }

  return Object.freeze({
    list,
    set,
    fetch
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ isPrivateAddress, originOf });
