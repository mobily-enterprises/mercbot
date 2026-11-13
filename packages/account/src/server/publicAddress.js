import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

// What Mercbot's own outside requests may reach: public internet addresses only, never the private
// network it runs in (a cloud's metadata address, a database, another server). Scripts' web calls
// (apps webAccess.js), pages' copied files (files pageFiles.js), the general connector's requests to
// apps (integrations connector.js, through `publicFetch`) and the websites people set up who don't run
// the copy (websites s3Site.js and answerCheck.js) check the address actually connected to, through
// `publicLookup`, so a name can't be switched to a private address after a check. A refusal's error has
// the code PRIVATE_ADDRESS.

/** The refusal of an address that isn't on the public internet. */
const refusal = (host) => Object.assign(new Error(`${host} is a private network address`), { code: "PRIVATE_ADDRESS" });
const PRIVATE = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3]
]) {
  PRIVATE.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96]
]) {
  PRIVATE.addSubnet(address, prefix, "ipv6");
}

/**
 * Whether an address is not on the public internet (or isn't an address at all).
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateAddress(address) {
  // An IPv4 address written as IPv6, as ::ffff:127.0.0.1 or, as a URL gives it, ::ffff:7f00:1.
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/iu.exec(address);
  if (mapped) {
    const [high, low] = [mapped[2], mapped[3]].map((part) => Number.parseInt(part, 16));
    return isPrivateAddress(mapped[1] || [high >> 8, high & 255, low >> 8, low & 255].join("."));
  }
  const family = isIP(address);
  return !family || PRIVATE.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * A DNS lookup for node's http and https requests that refuses names leading to a private address.
 * `insecure` (tests only) lets them through.
 * @param {boolean} [insecure]
 */
export function publicLookup(insecure = false) {
  return (hostname, options, callback) => dnsLookup(hostname, options, (error, address, family) => {
    if (error) return callback(error);
    const addresses = Array.isArray(address) ? address : [{ address, family }];
    const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
    if (blocked && !insecure) return callback(refusal(hostname));
    return callback(null, address, family);
  });
}

/**
 * fetch for addresses that could be anywhere: a request reaches only a public internet address, never the private
 * network Mercbot runs in (a cloud's metadata address, a database, another server). The address actually connected to
 * is checked, whether written as one (10.0.0.1, [::1]) or found by name, on each request and so on each redirect, which
 * it never follows itself. `insecure` (tests only) lets a stand-in on this machine through.
 * @param {boolean} [insecure]
 * @returns {typeof fetch}
 */
export function publicFetch(insecure = false) {
  const lookup = publicLookup(insecure);
  return async (address, { method = "GET", headers, body = null, signal } = {}) => {
    const url = new URL(address);
    const host = url.hostname.replace(/^\[|\]$/gu, "");
    if (!insecure && isIP(host) && isPrivateAddress(host)) throw refusal(host);
    const payload = body === null ? null : String(body);
    const sent = Object.fromEntries(new Headers(headers));
    if (payload !== null) sent["content-length"] = String(Buffer.byteLength(payload));
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const request = send(url, { method, headers: sent, lookup, signal }, (response) => {
        try {
          const [raw, answer] = [response.rawHeaders, new Headers()];
          for (let index = 0; index < raw.length; index += 2) answer.append(raw[index], raw[index + 1]);
          const empty = [204, 205, 304].includes(response.statusCode);
          resolve(new Response(empty ? null : Readable.toWeb(response), { status: response.statusCode, headers: answer }));
          if (empty) response.resume();
        } catch (error) {
          // An answer fetch can't hold (a status above 599, a header it refuses).
          response.destroy();
          reject(error);
        }
      });
      request.on("error", (error) => reject(signal?.aborted ? signal.reason : error));
      request.end(payload ?? undefined);
    });
  };
}
