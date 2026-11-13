import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isPrivateAddress, publicLookup } from "@local/account/public-address";
import { MARKER_FILE, markerIn } from "./marker.js";
import { WebsiteError } from "./websiteError.js";

const UNREACHABLE = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "TimeoutError"]);
const KEYS_REJECTED = new Set(["InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidToken", "ExpiredToken"]);
const WRONG_REGION = new Set(["PermanentRedirect", "AuthorizationHeaderMalformed"]);

/**
 * A website in S3-compatible storage (D-84: AWS S3, Cloudflare R2, Backblaze B2, MinIO and the like), through the AWS
 * SDK, loaded only when a website uses it: a page is every key under <prefix>/<slug>/. A bucket has no rename, so a
 * page is replaced key by key, its marker first and index.html last, and the keys the new copy no longer has go after.
 * The keys are only ever handed to the SDK; no answer or log names them. A website not set up by someone who runs the
 * copy (`guarded`) reaches storage only at public internet addresses (@local/account/public-address): an endpoint
 * written as a private address is refused before anything connects, and every connection's address is checked as it is
 * looked up. The SDK follows no redirect itself.
 * @param {{ endpoint: string, region: string, bucket: string, prefix: string, accessKeyId: string, secretAccessKey: string,
 *   guarded?: boolean }} settings
 */
export function createS3Site({ endpoint, region, bucket, prefix, accessKeyId, secretAccessKey, guarded = false }) {
  const service = endpoint ? new URL(endpoint).host : "Amazon S3";
  const endpointHost = endpoint ? new URL(endpoint).hostname.replace(/^\[|\]$/gu, "") : "";
  const lookup = publicLookup();
  const placeOf = (slug) => `${prefix ? `${prefix}/` : ""}${slug}/`;
  const privateStorage = () => new WebsiteError(403, `${service} is on a private network. Only the people who run this copy of Mercbot can publish to storage there: enter storage on the internet, or ask them to set the website up.`, {
    code: "websites_storage_private", params: { service }
  });

  /** What the storage answered, as the person needs it; never the keys. */
  function refused(error) {
    if (error instanceof WebsiteError) return error;
    if (error?.code === "PRIVATE_ADDRESS" || error?.cause?.code === "PRIVATE_ADDRESS") return privateStorage();
    const name = String(error?.name || "");
    const network = String(error?.code || error?.cause?.code || name);
    const status = Number(error?.$metadata?.httpStatusCode || 0);
    if (UNREACHABLE.has(network)) {
      return new WebsiteError(502, `Mercbot couldn't reach ${service}. Check the storage's endpoint.`, { code: "websites_storage_unreachable", params: { service } });
    }
    if (KEYS_REJECTED.has(name)) {
      return new WebsiteError(502, `${service} didn't accept these keys. Check the access key and its secret.`, { code: "websites_storage_keys_rejected", params: { service } });
    }
    if (name === "NoSuchBucket") {
      return new WebsiteError(502, `There's no bucket ${bucket} at ${service}. Check the bucket's name.`, { code: "websites_storage_bucket_missing", params: { service, bucket } });
    }
    if (WRONG_REGION.has(name) || status === 301) {
      return new WebsiteError(502, `The bucket ${bucket} isn't in the region ${region}. Enter the bucket's own region.`, { code: "websites_storage_region_wrong", params: { bucket, region } });
    }
    if (name === "AccessDenied" || status === 403) {
      return new WebsiteError(502, `These keys may not change the bucket ${bucket}. Let them list, read, write and delete in it.`, { code: "websites_storage_access_denied", params: { bucket } });
    }
    return new WebsiteError(502, `${service} refused (${name || `HTTP ${status}`}).`, { code: "websites_storage_failed", params: { service } });
  }

  /** Runs `work` with a client of its own, closed afterwards. */
  async function withClient(work) {
    // An address written as one is connected to without a lookup, so it is checked here.
    if (guarded && isIP(endpointHost) && isPrivateAddress(endpointHost)) throw privateStorage();
    const sdk = await import("@aws-sdk/client-s3");
    const agentOptions = { keepAlive: true, lookup };
    const agents = guarded ? { httpAgent: new http.Agent(agentOptions), httpsAgent: new https.Agent(agentOptions) } : {};
    const client = new sdk.S3Client({
      region: region || "us-east-1",
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 60_000, ...agents }
    });
    try {
      return await work(client, sdk);
    } catch (error) {
      throw refused(error);
    } finally {
      client.destroy();
    }
  }

  /** Every key under a page's place, below it. */
  async function keysAt(client, sdk, place) {
    const keys = [];
    let token;
    do {
      const answer = await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: place, ContinuationToken: token }));
      for (const entry of answer.Contents || []) keys.push(String(entry.Key).slice(place.length));
      token = answer.IsTruncated ? answer.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  /** The bucket is there and the keys may list it. */
  const check = () =>
    withClient((client, sdk) => client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix ? `${prefix}/` : undefined, MaxKeys: 1 })));

  /** Whether anything is at <slug>/, and the publication id its marker names (null without one). */
  const read = (slug) =>
    withClient(async (client, sdk) => {
      const place = placeOf(slug);
      const listed = await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: place, MaxKeys: 1 }));
      if (!listed.Contents?.length) return { exists: false, marker: null };
      try {
        const answer = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: `${place}${MARKER_FILE}` }));
        return { exists: true, marker: markerIn(await answer.Body.transformToString("utf8")) };
      } catch (error) {
        if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return { exists: true, marker: null };
        throw error;
      }
    });

  /** Puts exactly `files` at <slug>/: the marker first, index.html last, then takes away the keys left from before. */
  const put = (slug, files) =>
    withClient(async (client, sdk) => {
      const place = placeOf(slug);
      const before = await keysAt(client, sdk, place);
      const rank = (file) => (file.path === MARKER_FILE ? 0 : file.path === "index.html" ? 2 : 1);
      for (const file of [...files].sort((a, b) => rank(a) - rank(b))) {
        await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: `${place}${file.path}`, Body: file.content, ContentType: file.type }));
      }
      const kept = new Set(files.map((file) => file.path));
      for (const key of before.filter((key) => !kept.has(key))) await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: `${place}${key}` }));
    });

  /** Takes every key under <slug>/ away, the marker last. */
  const remove = (slug) =>
    withClient(async (client, sdk) => {
      const place = placeOf(slug);
      const keys = await keysAt(client, sdk, place);
      for (const key of [...keys.filter((key) => key !== MARKER_FILE), ...keys.filter((key) => key === MARKER_FILE)]) {
        await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: `${place}${key}` }));
      }
    });

  return Object.freeze({
    check,
    read,
    put,
    remove
  });
}
