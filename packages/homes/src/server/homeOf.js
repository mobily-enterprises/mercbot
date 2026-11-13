import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/**
 * The current home and person on a request (D-36): the one place feature routes read them.
 * Routes under /api/w/:workspaceSlug/… declare { auth: "required", contextPolicy: "required" };
 * JSKIT then checks membership and fills request.workspace, request.membership and
 * request.permissions before the handler runs.
 * @param {import("fastify").FastifyRequest} request
 */
export function homeOf(request) {
  const workspaceId = request?.workspace?.id;
  const userId = request?.user?.id;
  if (!workspaceId || !userId) throw new AppError(403, "This needs a home you belong to.", { code: "homes_home_required" });
  return Object.freeze({
    workspaceId: Number(workspaceId),
    slug: request.workspace.slug,
    userId: Number(userId),
    role: request.membership?.roleSid || "member",
    permissions: request.permissions || []
  });
}
