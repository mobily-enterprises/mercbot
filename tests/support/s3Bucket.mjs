import { createHash } from "node:crypto";
import http from "node:http";
import { AwsV4Signer } from "aws4fetch";

// A stand-in for an S3-compatible store, for tests only (D-91): one bucket on 127.0.0.1, reached path-style at a custom
// endpoint as Garage and MinIO are, holding its objects in memory. Every request's AWS signature (SigV4) is worked out
// again from what reached it, as S3 checks it, and a wrong one refused with S3's own codes. It answers PutObject (with
// If-None-Match: * unless `ignoreIfNoneMatch`, as some stores do), GetObject, DeleteObject and ListObjectsV2 (pages of
// `pageSize` keys, with continuation tokens), with MD5 ETags and LastModified, and records each request.

const xmlEscape = (text) => String(text).replace(/[<>&"']/gu, (char) => `&#${char.codePointAt(0)};`);
const xml = (status, code, message) => ({
  status,
  body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`
});

/** The request's signature checked with the bucket's credentials; null when it matches, else the refusal. */
async function refusal(request, { region, accessKeyId, secretAccessKey }) {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/u
    .exec(String(request.headers.authorization || ""));
  if (!match) return xml(403, "AccessDenied", "Access Denied");
  const [, key, , signedRegion, signedHeaders, signature] = match;
  if (key !== accessKeyId) return xml(403, "InvalidAccessKeyId", "The access key doesn't exist.");
  if (signedRegion !== region) return xml(400, "AuthorizationHeaderMalformed", `The region '${signedRegion}' is wrong; expecting '${region}'`);
  const headers = Object.fromEntries(signedHeaders.split(";").filter((name) => name !== "host").map((name) => [name, String(request.headers[name] ?? "")]));
  const signer = new AwsV4Signer({
    method: request.method,
    url: `http://${request.headers.host}${request.url}`,
    headers,
    accessKeyId,
    secretAccessKey,
    region,
    service: "s3",
    datetime: String(request.headers["x-amz-date"] || "")
  });
  return (await signer.signature()) === signature ? null : xml(403, "SignatureDoesNotMatch", "The request signature doesn't match.");
}

/**
 * @param {{ after: (work: () => unknown) => void }} context the test's context, which closes the server
 * @param {{ bucket?: string, region?: string, accessKeyId?: string, secretAccessKey?: string, pageSize?: number,
 *   ignoreIfNoneMatch?: boolean }} [options]
 */
export async function startS3Bucket(context, {
  bucket = "mercbot-files", region = "garage", accessKeyId = "GKtest", secretAccessKey = "test-secret", pageSize = 1000, ignoreIfNoneMatch = false
} = {}) {
  /** @type {Map<string, { body: Buffer, etag: string, modified: Date }>} */
  const objects = new Map();
  const requests = [];
  let failing = 0;

  function list(query) {
    const prefix = query.get("prefix") || "";
    const after = query.get("continuation-token") || "";
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && key > after).sort();
    const page = keys.slice(0, pageSize);
    const truncated = keys.length > page.length;
    const contents = page.map((key) => {
      const object = objects.get(key);
      return `<Contents><Key>${xmlEscape(key)}</Key><LastModified>${object.modified.toISOString()}</LastModified><ETag>${xmlEscape(object.etag)}</ETag>` +
        `<Size>${object.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
    }).join("");
    return {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xmlEscape(bucket)}</Name>` +
        `<Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys><IsTruncated>${truncated}</IsTruncated>` +
        `${truncated ? `<NextContinuationToken>${xmlEscape(page.at(-1))}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`
    };
  }

  async function answer(request, body) {
    const refused = await refusal(request, { region, accessKeyId, secretAccessKey });
    if (refused) return refused;
    if (failing > 0) {
      failing -= 1;
      return xml(503, "SlowDown", "Please reduce your request rate.");
    }
    const url = new URL(request.url, "http://stand-in");
    const [name, ...rest] = url.pathname.slice(1).split("/");
    if (decodeURIComponent(name) !== bucket) return xml(404, "NoSuchBucket", "The specified bucket does not exist");
    const key = decodeURIComponent(rest.join("/"));
    if (!key) return request.method === "GET" && url.searchParams.get("list-type") === "2" ? list(url.searchParams) : xml(405, "MethodNotAllowed", "Not allowed.");
    if (request.method === "PUT") {
      if (!ignoreIfNoneMatch && request.headers["if-none-match"] === "*" && objects.has(key)) return xml(412, "PreconditionFailed", "At least one of the preconditions failed.");
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      objects.set(key, { body, etag, modified: new Date() });
      return { status: 200, headers: { etag } };
    }
    if (request.method === "GET") {
      const object = objects.get(key);
      if (!object) return xml(404, "NoSuchKey", "The specified key does not exist.");
      return { status: 200, headers: { etag: object.etag, "last-modified": object.modified.toUTCString(), "content-type": "application/octet-stream" }, body: object.body };
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      return { status: 204 };
    }
    return xml(405, "MethodNotAllowed", "Not allowed.");
  }

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const answered = await answer(request, Buffer.concat(chunks)).catch((error) => xml(500, "InternalError", String(error?.message || error)));
    requests.push({ method: request.method, path: request.url, status: answered.status, headers: request.headers });
    response.writeHead(answered.status, { ...(answered.body && !answered.headers?.["content-type"] ? { "content-type": "application/xml" } : {}), ...answered.headers });
    response.end(answered.body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return {
    endpoint,
    objects,
    requests,
    /** The next `count` requests are answered 503 SlowDown, as a store under load answers. */
    failNext(count) {
      failing = count;
    },
    /** The environment that points Mercbot's files at this bucket. */
    env: {
      MERCBOT_FILES_S3_BUCKET: bucket,
      MERCBOT_FILES_S3_REGION: region,
      MERCBOT_FILES_S3_ENDPOINT: endpoint,
      MERCBOT_FILES_S3_ACCESS_KEY_ID: accessKeyId,
      MERCBOT_FILES_S3_SECRET_ACCESS_KEY: secretAccessKey,
      MERCBOT_FILES_PASSPHRASE: "correct horse battery staple"
    }
  };
}
