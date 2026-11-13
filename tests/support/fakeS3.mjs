import http from "node:http";

// A stand-in for S3-compatible storage, for tests only: one bucket on 127.0.0.1, reached path-style as the AWS SDK
// reaches any endpoint (PutObject, GetObject, DeleteObject, ListObjectsV2), refusing every request not signed with its
// one access key. It also serves the bucket as a website does, at /website/<key> (index.html for an address ending in
// a slash), so a page published there can be read back. It never checks signatures: only which key signed.

const xmlEscape = (text) => String(text).replace(/[<>&"']/gu, (char) => `&#${char.codePointAt(0)};`);

/**
 * @param {{ after: (work: () => unknown) => void }} context the test's context, which closes the server
 * @param {{ bucket: string, accessKeyId: string }} account
 * @returns {Promise<{ endpoint: string, objects: Map<string, { body: Buffer, type: string }>, requests: string[] }>}
 */
export async function startFakeS3(context, { bucket, accessKeyId }) {
  const objects = new Map();
  const requests = [];

  function fail(response, status, code) {
    response.writeHead(status, { "content-type": "application/xml" });
    response.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
  }

  function list(response, query) {
    const prefix = query.get("prefix") || "";
    const max = Number(query.get("max-keys") || 1000);
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort().slice(0, max);
    const contents = keys
      .map((key) => `<Contents><Key>${xmlEscape(key)}</Key><Size>${objects.get(key).body.length}</Size><ETag>"x"</ETag><StorageClass>STANDARD</StorageClass></Contents>`)
      .join("");
    response.writeHead(200, { "content-type": "application/xml" });
    response.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xmlEscape(bucket)}</Name>` +
      `<Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://fake-s3.test");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push(`${request.method} ${url.pathname}`);
    if (url.pathname.startsWith("/website/")) {
      const key = decodeURIComponent(url.pathname.slice("/website/".length));
      const found = objects.get(key.endsWith("/") ? `${key}index.html` : key);
      if (!found || request.method !== "GET") return fail(response, 404, "NoSuchKey");
      response.writeHead(200, { "content-type": found.type });
      return response.end(found.body);
    }
    const [, name, ...rest] = url.pathname.split("/");
    if (name !== bucket) return fail(response, 404, "NoSuchBucket");
    if (!String(request.headers.authorization || "").includes(`Credential=${accessKeyId}/`)) return fail(response, 403, "InvalidAccessKeyId");
    const key = decodeURIComponent(rest.join("/"));
    if (request.method === "GET" && !key) return list(response, url.searchParams);
    if (request.method === "PUT" && key) {
      objects.set(key, { body, type: String(request.headers["content-type"] || "application/octet-stream") });
      response.writeHead(200, { etag: '"x"' });
      return response.end();
    }
    if (request.method === "GET" && key) {
      const found = objects.get(key);
      if (!found) return fail(response, 404, "NoSuchKey");
      response.writeHead(200, { "content-type": found.type, "content-length": found.body.length });
      return response.end(found.body);
    }
    if (request.method === "DELETE" && key) {
      objects.delete(key);
      response.writeHead(204);
      return response.end();
    }
    return fail(response, 400, "NotImplemented");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, objects, requests };
}
