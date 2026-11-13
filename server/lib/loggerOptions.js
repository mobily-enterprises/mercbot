import pino from "pino";

// A page's own address carries the token that opens it, as the first part after its `pages/` folder: a viewer's
// 12-hour frame address (D-74), and any other address that opens a page by a token. The request log names them
// without it. A token is a long run of base64url, with a seal after a dot when it is signed; a route's own words
// (frame, versions, copy) are short, so they stay.
const PAGE_TOKEN = /^(\/api\/(?:[^/?#]+\/)*?pages\/)[A-Za-z0-9_-]{32,}(?:\.[A-Za-z0-9_-]+)?(?=[/?#]|$)/u;

/**
 * The Fastify logger's options. Fastify's logger serializes only the `err` key, so the same serializer under `error`
 * keeps the message and stack of `logger.error({ error }, "...")`. A request is logged as Fastify logs it, with a
 * page's token left out of its address.
 */
function buildLoggerOptions() {
  return {
    serializers: {
      error: pino.stdSerializers.err,
      req: (request) => ({
        method: request.method,
        url: String(request.url || "").replace(PAGE_TOKEN, "$1…"),
        version: request.headers?.["accept-version"],
        host: request.host,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort
      })
    }
  };
}

export { buildLoggerOptions };
