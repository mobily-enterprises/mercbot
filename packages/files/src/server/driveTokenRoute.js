import { fromThisMachine } from "./ownMachine.js";
import { DRIVE_TOKEN_PATH, DriveKeyError } from "./remoteMounts.js";

// Where a Google Drive mount's rclone asks this server for a key (D-80, remoteMounts.js), on Mercbot's own port, since
// a published server listens on no other (D-68). rclone asks as it asks Google's token endpoint: a form with its
// refresh key, which is that mount's random key, known only to this process. Only this machine's own connections
// that came through no proxy are answered (ownMachine.js).
const FORM = "application/x-www-form-urlencoded";

/**
 * The answer to one key request: `{ status, body }` as a token endpoint gives it (RFC 6749 §5).
 * @param {{ token: (mountKey: string) => Promise<object> }} mounts
 * @param {{ socket: { remoteAddress?: string, localAddress?: string }, headers: Record<string, unknown>, form: Record<string, string> }} request
 */
export async function answerDriveToken(mounts, { socket, headers, form }) {
  if (!fromThisMachine(socket, headers)) return { status: 403, body: { error: "access_denied" } };
  if (form.grant_type !== "refresh_token") return { status: 400, body: { error: "unsupported_grant_type" } };
  try {
    return { status: 200, body: await mounts.token(form.refresh_token) };
  } catch (error) {
    if (!(error instanceof DriveKeyError)) throw error;
    return error.refused ? { status: 400, body: { error: "invalid_grant" } } : { status: 503, body: { error: "temporarily_unavailable" } };
  }
}

/**
 * The route, in a Fastify scope of its own so that only it reads form bodies.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} fastify
 * @param {{ token: (mountKey: string) => Promise<object> }} mounts
 */
export async function registerDriveTokenRoute(fastify, mounts) {
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(FORM, { parseAs: "string", bodyLimit: 4096 }, (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body || ""))));
    });
    scope.post(DRIVE_TOKEN_PATH, { config: { authPolicy: "public", csrfProtection: false } }, async (request, reply) => {
      const socket = request.raw.socket || {};
      const { status, body } = await answerDriveToken(mounts, { socket, headers: request.headers, form: request.body || {} });
      return reply.header("cache-control", "no-store").code(status).send(body);
    });
  });
}
