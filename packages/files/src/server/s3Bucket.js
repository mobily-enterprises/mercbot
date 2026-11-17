import { createReadStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { AwsV4Signer } from "aws4fetch";

// The files bucket (D-91): an S3 bucket, or any store speaking the S3 API, reached with the settings below and signed
// with aws4fetch's SigV4 signer (the one JSKIT's storage uses), over plain HTTP requests so that a file goes up and
// comes down as a stream, never whole in memory. Objects are addressed by path (`<endpoint>/<bucket>/<key>`), which
// AWS, MinIO, Garage and R2 all answer. Payloads are sent unsigned (UNSIGNED-PAYLOAD, which S3 takes), since their
// contents are already sealed (filesCipher.js) and a stream can't be hashed before it's sent.
export const S3_SETTINGS = Object.freeze({
  bucket: "MERCBOT_FILES_S3_BUCKET",
  region: "MERCBOT_FILES_S3_REGION",
  endpoint: "MERCBOT_FILES_S3_ENDPOINT",
  accessKeyId: "MERCBOT_FILES_S3_ACCESS_KEY_ID",
  secretAccessKey: "MERCBOT_FILES_S3_SECRET_ACCESS_KEY",
  prefix: "MERCBOT_FILES_S3_PREFIX"
});
const REQUIRED = Object.freeze(["bucket", "region", "accessKeyId", "secretAccessKey"]);
// Folders of letters, digits, dots, hyphens and underscores; never "." or "..", which a URL would resolve away.
const PREFIX = /^(?:(?!\.\.?\/)[A-Za-z0-9._-]+\/)*$/u;
const TIMEOUT_MS = 120000;

export class S3Error extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string }} [details]
   */
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "S3Error";
    this.status = status;
    this.code = code;
  }
}

/**
 * The bucket's settings from the environment, or null when MERCBOT_FILES_S3_BUCKET isn't set (files then stay in a
 * folder). `missing` names each required setting that isn't set, never a value. The prefix, when given, ends in "/"
 * and puts every key Mercbot writes under it, so one bucket can hold other things too.
 * @param {Record<string, string | undefined>} env
 */
export function s3Settings(env) {
  const value = (name) => String(env[name] ?? "").trim();
  if (!value(S3_SETTINGS.bucket)) return null;
  const settings = Object.fromEntries(Object.entries(S3_SETTINGS).map(([key, name]) => [key, value(name)]));
  if (!settings.endpoint && settings.region) settings.endpoint = `https://s3.${settings.region}.amazonaws.com`;
  settings.endpoint = settings.endpoint.replace(/\/+$/u, "");
  if (settings.prefix && !settings.prefix.endsWith("/")) settings.prefix += "/";
  const missing = REQUIRED.filter((key) => !settings[key]).map((key) => S3_SETTINGS[key]);
  if (settings.prefix && !PREFIX.test(settings.prefix)) missing.push(`${S3_SETTINGS.prefix} (letters, digits, dots, hyphens and underscores, in folders, never "." or "..")`);
  return { ...settings, missing };
}

/** A value escaped as S3 expects (RFC 3986). */
const escape = (value) => encodeURIComponent(value).replace(/[!'()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** A key as a URL path: each of its parts escaped. */
const keyPath = (key) => key.split("/").map(escape).join("/");

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, name) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return XML_ENTITIES[name] ?? whole;
  });
}
const tag = (xml, name) => {
  const found = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(xml);
  return found ? unescapeXml(found[1]) : "";
};

/**
 * One S3 bucket, by its settings (s3Settings). Keys given and answered are the bucket's own minus the prefix.
 * @param {{ bucket: string, region: string, endpoint: string, accessKeyId: string, secretAccessKey: string, prefix?: string }} settings
 */
export function createS3Bucket({ bucket, region, endpoint, accessKeyId, secretAccessKey, prefix = "" }) {
  const base = `${endpoint}/${keyPath(bucket)}`;
  const agentOptions = { keepAlive: true, maxSockets: 16 };
  const agents = { "http:": new http.Agent(agentOptions), "https:": new https.Agent(agentOptions) };

  /**
   * Sends one signed request. `body` is a Buffer or a file to stream (`{ file, size }`); `into`, given a 2xx answer's
   * body as a stream, reads it instead. Answers `{ status, headers, body }` (body empty when streamed `into`).
   */
  async function send(method, key, { query = "", headers = {}, body = null, into = null, accept = [] } = {}) {
    const url = `${base}${key === null ? "" : `/${keyPath(prefix + key)}`}${query ? `?${query}` : ""}`;
    const length = Buffer.isBuffer(body) ? body.length : body?.size ?? 0;
    const signer = new AwsV4Signer({
      method,
      url,
      headers: { ...headers, ...(body || method === "PUT" ? { "content-length": String(length) } : {}) },
      accessKeyId,
      secretAccessKey,
      region,
      service: "s3"
    });
    const signed = await signer.sign();
    const target = new URL(url);
    return new Promise((resolve, reject) => {
      const request = (target.protocol === "https:" ? https : http).request(target, {
        method,
        headers: Object.fromEntries(signed.headers),
        agent: agents[target.protocol],
        timeout: TIMEOUT_MS
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (into && status >= 200 && status < 300) {
          into(response).then(() => resolve({ status, headers: response.headers, body: Buffer.alloc(0) }), (error) => {
            response.destroy();
            reject(error);
          });
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks);
          if ((status >= 200 && status < 300) || accept.includes(status)) {
            resolve({ status, headers: response.headers, body: text });
            return;
          }
          const xml = text.toString("utf8");
          const code = tag(xml, "Code");
          reject(new S3Error(`The files bucket answered ${method} ${key ?? "(the bucket)"} with ${status}${code ? ` ${code}` : ""}${tag(xml, "Message") ? `: ${tag(xml, "Message")}` : ""}`, { status, code }));
        });
        response.on("error", reject);
      });
      request.once("timeout", () => request.destroy(new S3Error(`The files bucket didn't answer ${method} ${key ?? "(the bucket)"} in time.`)));
      request.once("error", (error) => reject(error instanceof S3Error ? error : new S3Error(`The files bucket couldn't be reached: ${error.message}`, { code: error.code })));
      if (Buffer.isBuffer(body)) request.end(body);
      else if (body?.file) pipeline(createReadStream(body.file), request).catch(reject);
      else request.end();
    });
  }

  /**
   * Every object under `under` (a key prefix, "" for all), in key order: `{ key, size, etag, modified }`, `modified` in
   * ms. Read a page of 1,000 at a time, as S3 answers.
   * @param {string} under
   */
  async function list(under) {
    const found = [];
    for (let token = ""; ;) {
      const query = [
        "list-type=2",
        `prefix=${escape(prefix + under)}`,
        ...(token ? [`continuation-token=${escape(token)}`] : [])
      ].sort().join("&");
      const xml = (await send("GET", null, { query })).body.toString("utf8");
      for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
        found.push({
          key: tag(entry, "Key").slice(prefix.length),
          size: Number(tag(entry, "Size")),
          etag: tag(entry, "ETag"),
          modified: Date.parse(tag(entry, "LastModified"))
        });
      }
      token = tag(xml, "IsTruncated") === "true" ? tag(xml, "NextContinuationToken") : "";
      if (!token) return found;
    }
  }

  /** An object whole, or null when there's none. */
  async function read(key) {
    const answer = await send("GET", key, { accept: [404] });
    return answer.status === 404 ? null : answer.body;
  }

  /**
   * Hands an object's body, as a stream, to `consume`, which answers once it's read it; answers the object's ETag, or
   * null when there's none.
   * @param {string} key
   * @param {(body: import("node:stream").Readable) => Promise<unknown>} consume
   */
  async function readInto(key, consume) {
    const answer = await send("GET", key, { into: consume, accept: [404] });
    return answer.status === 404 ? null : String(answer.headers.etag ?? "");
  }

  /**
   * Writes an object from a Buffer or a file (`{ file, size }`), and answers its ETag. With `onlyNew`, a key that
   * already holds an object is left alone and answers null (If-None-Match, which S3 and the stores like it keep).
   */
  async function write(key, body, { onlyNew = false } = {}) {
    const answer = await send("PUT", key, { body, headers: onlyNew ? { "if-none-match": "*" } : {}, accept: onlyNew ? [409, 412] : [] });
    return answer.status === 412 || answer.status === 409 ? null : String(answer.headers.etag ?? "");
  }

  /** Removes an object; one already gone is fine, as S3 answers it. */
  async function remove(key) {
    await send("DELETE", key, { accept: [404] });
  }

  function close() {
    for (const agent of Object.values(agents)) agent.destroy();
  }

  return Object.freeze({
    list,
    read,
    readInto,
    write,
    remove,
    close
  });
}
