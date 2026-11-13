import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { AccountError } from "./accountError.js";
import { readerOf } from "./spending.js";
import { PHOTO_LIMIT } from "./vaultPhoto.js";

// The account menu's routes. A route's answer is the service's result, or the refusal it raised
// with its status code, message and code; any other failure is the server's own (a hidden 500).
// Routes for things a home owns (D-36) live under /api/w/:workspaceSlug/…; JSKIT checks the
// person belongs to that home and fills request.workspace before the handler runs.

const SIGNED_IN = Object.freeze({ auth: "required", visibility: checkRouteVisibility("user") });
const IN_HOME = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });

/**
 * A route handler that sends what `work` answers for the request.
 * @param {(request: import("fastify").FastifyRequest) => Promise<unknown>} work
 */
function answering(work) {
  return async function answer(request, reply) {
    try {
      reply.send(await work(request));
    } catch (error) {
      if (!(error instanceof AccountError)) throw error;
      reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
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
 */
export function registerRoutes(http, { account, spending, uploads, track }) {
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
      if (!(error instanceof AccountError)) throw error;
      reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
    }
  }

  async function priceTags(request) {
    return spending.priceTags(homeId(request), readerOf(request));
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
    return track({ userId: request.user.id, workspaceId: homeId(request) }, () => account.readVaultPhoto({ data, type }));
  }

  async function deleteVaultItem(request) {
    return account.deleteVaultItem(request.params.itemId, await request.callOptions());
  }

  http.router.register("GET", "/api/w/:workspaceSlug/usage", IN_HOME, answering(usage));
  http.router.register("GET", "/api/w/:workspaceSlug/spending", IN_HOME, answering(report));
  http.router.register("GET", "/api/w/:workspaceSlug/spending/export", IN_HOME, exportReport);
  http.router.register("GET", "/api/w/:workspaceSlug/spending/bots", IN_HOME, answering(priceTags));
  http.router.register("GET", "/api/vault", SIGNED_IN, answering(vault));
  http.router.register("POST", "/api/vault", SIGNED_IN, answering(addVaultItem));
  http.router.register("POST", "/api/vault/import", SIGNED_IN, answering(importVaultItems));
  http.router.register("POST", "/api/w/:workspaceSlug/vault/read-photo", IN_HOME, answering(readVaultPhoto));
  http.router.register("DELETE", "/api/vault/:itemId", SIGNED_IN, answering(deleteVaultItem));
}
