// A browser for server tests that boot the app in their own process: it calls the routes with app.inject(),
// keeps one cookie jar and sends the session's CSRF token, and uploads a file as a browser's form does.

// The smallest PNG there is: one transparent pixel.
export const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const BOUNDARY = "mercbot-test-boundary";

/** A multipart body with one file field, as a browser sends an upload. */
function multipart(field, name, type, data) {
  return Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`)
  ]);
}

/**
 * Calls `app`'s routes as one browser does. `json` is sent as a JSON body, `upload` as
 * `[field, fileName, type, data]`, and `headers` besides; a JSON answer comes back parsed, any other as its bytes.
 * @param {import("fastify").FastifyInstance} app
 */
export function browser(app) {
  const cookies = new Map();
  let csrfToken = null;
  return async function request(method, url, { json, upload, headers = {} } = {}) {
    const response = await app.inject({
      method,
      url,
      payload: upload ? multipart(...upload) : json,
      headers: {
        ...(upload ? { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } : json ? { "content-type": "application/json" } : {}),
        cookie: [...cookies].map(([cookie, value]) => `${cookie}=${value}`).join("; "),
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        ...headers
      }
    });
    for (const cookie of response.cookies) cookies.set(cookie.name, cookie.value);
    const isJson = String(response.headers["content-type"] || "").includes("json");
    const body = isJson ? response.json() : response.rawPayload;
    if (body?.csrfToken) csrfToken = body.csrfToken;
    return { status: response.statusCode, body };
  };
}
