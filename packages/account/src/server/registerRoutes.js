import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { AccountError } from "./accountError.js";
import { mediaRefusal } from "./mediaCheck.js";
import { readerOf } from "./spending.js";
import { PHOTO_LIMIT } from "./vaultPhoto.js";

// The account menu's routes. A route's answer is the service's result, or the refusal it raised
// with its status code, message and code; any other failure is the server's own (a hidden 500).
// Routes for things a home owns (D-36) live under /api/w/:workspaceSlug/…; JSKIT checks the
// person belongs to that home and fills request.workspace before the handler runs.

const IN_HOME = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
const SIGNED_IN = Object.freeze({ auth: "required", visibility: checkRouteVisibility("user") });

/** Sends an account refusal with its status, message and code; any other error is thrown on. */
function refuse(reply, error) {
  if (!(error instanceof AccountError)) throw error;
  reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
}

/**
 * A route handler that sends what `work` answers for the request.
 * @param {(request: import("fastify").FastifyRequest) => Promise<unknown>} work
 */
function answering(work) {
  return async function answer(request, reply) {
    try {
      reply.send(await work(request));
    } catch (error) {
      refuse(reply, error);
    }
  };
}

/**
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Account} capabilities.account
 * @param {import("./types.js").Spending} capabilities.spending what a home has spent
 * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
 * @param {ReturnType<typeof import("./meter.js").createMeter>["track"]} capabilities.track the meter's, for the AI work a route does for the person
 * @param {ReturnType<typeof import("./mediaCheck.js").createMediaGuard>} capabilities.media how a copy checks pictures (D-90)
 */
export function registerRoutes(http, { account, spending, uploads, track, media, push }) {
  const homeId = (request) => String(request.workspace.id);

  async function usage(request) {
    return spending.summary(homeId(request), readerOf(request));
  }

  async function report(request) {
    return spending.report(homeId(request), readerOf(request));
  }

  /** The report's range as a CSV download, streamed. */
  async function exportReport(request, reply) {
    try {
      const { fileName, stream } = await spending.exportCsv(homeId(request), readerOf(request));
      reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${fileName}"`).send(stream);
    } catch (error) {
      refuse(reply, error);
    }
  }

  async function vault(request) {
    return account.vault(await request.callOptions());
  }

  async function addVaultItem(request) {
    return account.addVaultItem(request.body || {}, await request.callOptions());
  }

  async function importVaultItems(request) {
    return account.importVaultItems(request.body || {}, await request.callOptions());
  }

  // A photo to read contact details from (multipart, field "photo"): a JPEG, PNG or WebP picture. It's read for the
  // person, so a failure of the images AI is kept with the AI providers' other failures (meter.js), and what the call
  // used is recorded for the home it's read in (D-73), which may refuse it (meter.js refuseWork).
  async function readVaultPhoto(request) {
    const part = await uploads.readSingleMultipartFile(request, { fieldName: "photo", label: "Photo", maxBytes: PHOTO_LIMIT, required: true });
    const data = await uploads.readUploadBuffer(part.stream, { fieldName: "photo", label: "Photo", maxBytes: PHOTO_LIMIT });
    const type = uploads.detectCommonMimeTypeFromBuffer(data);
    if (!type.startsWith("image/")) {
      throw new AccountError(400, "Send the photo as a JPEG, PNG or WebP picture.", { code: "account_vault_photo_type" });
    }
    // A copy that checks pictures (D-90) checks the photo before the images AI sees it: one it blocks, or can't check now,
    // goes nowhere.
    const refusal = mediaRefusal(await media.check({
      bytes: data, origin: "vault_photo", workspaceId: homeId(request), userId: request.user.id, path: null, ip: request.ip ?? null
    }));
    if (refusal) throw new AccountError(refusal.status, refusal.message, { code: refusal.code });
    return track({ userId: request.user.id, workspaceId: homeId(request) }, () => account.readVaultPhoto({ data, type }));
  }

  async function deleteVaultItem(request) {
    return account.deleteVaultItem(request.params.itemId, await request.callOptions());
  }

  http.router.register("GET", "/api/w/:workspaceSlug/usage", IN_HOME, answering(usage));
  http.router.register("GET", "/api/w/:workspaceSlug/spending", IN_HOME, answering(report));
  http.router.register("GET", "/api/w/:workspaceSlug/spending/export", IN_HOME, exportReport);
  // The Vault is the home's (D8), so its routes are the home's.
  http.router.register("GET", "/api/w/:workspaceSlug/vault", IN_HOME, answering(vault));
  http.router.register("POST", "/api/w/:workspaceSlug/vault", IN_HOME, answering(addVaultItem));
  http.router.register("POST", "/api/w/:workspaceSlug/vault/import", IN_HOME, answering(importVaultItems));
  http.router.register("POST", "/api/w/:workspaceSlug/vault/read-photo", IN_HOME, answering(readVaultPhoto));
  http.router.register("DELETE", "/api/w/:workspaceSlug/vault/:itemId", IN_HOME, answering(deleteVaultItem));
  // Notifications (D-133) are the signed-in person's own, on their own devices, whichever home they're in.
  const me = (request) => String(request.user.id);
  http.router.register("GET", "/api/w/:workspaceSlug/push", IN_HOME, answering((request) => push.mine(me(request))));
  http.router.register("PUT", "/api/w/:workspaceSlug/push/settings", IN_HOME, answering((request) => push.saveSettings(me(request), request.body || {})));
  http.router.register("POST", "/api/w/:workspaceSlug/push/devices", IN_HOME, answering((request) => push.addDevice(me(request), request.body || {})));
  http.router.register("DELETE", "/api/w/:workspaceSlug/push/devices/:deviceId", IN_HOME, answering((request) => push.removeDevice(me(request), request.params.deviceId)));
  // A browser signing out forgets its own device by its push address, from any page, in a home or not.
  http.router.register("POST", "/api/push/devices/forget", SIGNED_IN, answering((request) => push.forgetDevice(me(request), request.body?.endpoint)));
}
