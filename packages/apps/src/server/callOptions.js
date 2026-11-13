import { resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/**
 * The home a call works in, read from its options as the handles read it: a member's request names
 * it in its route, a job's context was derived for it. Only for what is not a query: the home's
 * AnyAPI tenant, the registry's cache key, a notice's key. Queries get the options themselves.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
 * @returns {string}
 */
export function homeIdOf(options) {
  const homeId = resolveWorkspaceScopeValue(options?.context);
  if (!homeId) throw new AppError(403, "This needs a home you belong to.", { code: "apps_home_required" });
  return homeId;
}
