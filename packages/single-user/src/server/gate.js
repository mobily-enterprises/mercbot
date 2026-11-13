import http from "node:http";
import { isLoopbackHost } from "@local/account/this-copy";
import { keyMatches } from "./key.js";

// A person's own copy (D-81) answers this computer only, and only the person: every request and websocket, Socket.IO's
// included, passes these checks before anything else in Mercbot sees it.
//   1. The Host is localhost, 127.0.0.1 or [::1] on the server's own port, so another site's name that resolves to this
//      computer (DNS rebinding) gets nothing.
//   2. Routes that prove themselves pass: the health check, which says only that the server is up; another server's
//      work, the bots' browsers and Google Drive mounts, each with its own key; a page's sealed frame (D-74), whose
//      address carries its own signed token, since the frame is credentialless and sends no cookie; and the
//      providers' return from a connection, which its OAuth state proves.
//   3. /open?key=<the key> opens Mercbot (SingleUserFeature).
//   4. Anything that changes something, and every websocket, comes from Mercbot's own page (its Origin), beside JSKIT's
//      CSRF token.
//   5. Everything else carries the key's cookie (KEY_COOKIE), or gets a plain page saying to open Mercbot with
//      `mercbot open`.
//   6. There's no sign-in, registration, sign-out, password, members or invitations to reach.
export const KEY_COOKIE = "mercbot_key";

const OWN_PROOF = [
  /^\/api\/health(?:[/?]|$)/u,
  /^\/api\/internal\/computer(?:\?|$)/u,
  /^\/api\/computer-cdp\//u,
  /^\/api\/files\/drive-token(?:\?|$)/u,
  /^\/api\/pages\//u,
  /^\/api\/connections\/callback(?:\?|$)/u
];
const NOT_ON_ONE_COMPUTER = [
  /^\/api\/(?:register|login|logout|password|oauth|dev-auth)(?:[/?]|$)/u,
  /^\/api\/settings\/security(?:[/?]|$)/u,
  /^\/api\/workspace\/invitations(?:[/?]|$)/u,
  /^\/api\/w\/[^/?]+\/(?:invites(?:[/?]|$)|members\/)/u
];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const REFUSALS = Object.freeze({
  host: { status: 421, text: "Mercbot answers only at its own address on this computer, such as http://127.0.0.1." },
  origin: { status: 403, text: "Refused: this didn't come from Mercbot's own page." },
  key: { status: 401, text: "Open Mercbot with mercbot open." },
  absent: { status: 404, text: "Your own copy of Mercbot has no sign-in, accounts, members or invitations." }
});

/** The value of the cookie `name` in a request's Cookie header, or null. */
export function cookieOf(request, name) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/**
 * Why a request is refused (one of REFUSALS), or null to let it through.
 * @param {{ key: string, port: number }} copy the key and the port the server listens on
 * @param {import("node:http").IncomingMessage} request
 * @param {boolean} upgrade whether it asks for a websocket
 */
export function refusalOf({ key, port }, request, upgrade) {
  const host = String(request.headers.host || "").toLowerCase();
  const [, name, given] = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/u.exec(host) || [];
  if (!name || Number(given || 80) !== port) return REFUSALS.host;
  const url = String(request.url || "/");
  if (OWN_PROOF.some((route) => route.test(url))) return null;
  if (/^\/open(?:\?|$)/u.test(url) && !upgrade) {
    return keyMatches(key, new URL(url, "http://copy").searchParams.get("key")) ? null : REFUSALS.key;
  }
  if ((upgrade || !SAFE_METHODS.has(String(request.method).toUpperCase())) && request.headers.origin !== `http://${host}`) {
    return REFUSALS.origin;
  }
  if (!keyMatches(key, cookieOf(request, KEY_COOKIE))) return REFUSALS.key;
  return NOT_ON_ONE_COMPUTER.some((route) => route.test(url)) ? REFUSALS.absent : null;
}

/** A refusal as a plain page, never cached. */
function page({ text }) {
  const escaped = text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/mercbot open/u, "<code>mercbot open</code>");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mercbot</title><p>${escaped}</p></html>\n`;
}

const HEADERS = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
});

/**
 * Fastify's serverFactory for a person's own copy: an HTTP server that checks every request and websocket upgrade
 * (refusalOf) before any listener sees it. Socket.IO, the live screen and the browsers' remote control listen on this
 * same server, so they are checked too.
 * @param {string} key
 * @returns {(handler: import("node:http").RequestListener) => import("node:http").Server}
 */
export function singleUserServer(key) {
  return (handler) => {
    const server = http.createServer(handler);
    const emit = server.emit.bind(server);
    const copy = () => ({ key, port: server.address()?.port });
    server.emit = (event, ...args) => {
      if (event === "request") {
        const [request, response] = args;
        const refusal = refusalOf(copy(), request, false);
        if (!refusal) return emit(event, ...args);
        response.writeHead(refusal.status, HEADERS).end(request.method === "HEAD" ? undefined : page(refusal));
        return true;
      }
      if (event === "upgrade") {
        const [request, socket] = args;
        const refusal = refusalOf(copy(), request, true);
        if (!refusal) return emit(event, ...args);
        const body = page(refusal);
        const head = Object.entries({ ...HEADERS, "content-length": Buffer.byteLength(body), connection: "close" })
          .map(([name, value]) => `${name}: ${value}`).join("\r\n");
        socket.end(`HTTP/1.1 ${refusal.status} ${http.STATUS_CODES[refusal.status]}\r\n${head}\r\n\r\n${body}`);
        return true;
      }
      return emit(event, ...args);
    };
    return server;
  };
}

/**
 * A person's own copy listens on this computer only: it refuses to start at any HOST but 127.0.0.1 or ::1.
 * @param {{ HOST?: string }} env
 */
export function checkSingleUserHost(env) {
  if (!isLoopbackHost(env.HOST)) {
    throw new Error(`Mercbot listens on this computer only: set HOST to 127.0.0.1 or ::1, not ${env.HOST || "unset"}.`);
  }
}
