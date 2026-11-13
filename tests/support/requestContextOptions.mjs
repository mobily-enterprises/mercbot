/**
 * A route's call options as `request.callOptions()` gives them, built by hand for the tests' fake requests, which no
 * route and none of JSKIT's context contributors ever see: the signed-in person in the home the request names (a
 * `workspace_user` route), outside a home a `user` route, and without a person the request alone.
 * @param {{ user?: object, workspace?: object, membership?: object, permissions?: string[] }} request
 * @returns {{ context: object }}
 */
export function requestContextOptions(request) {
  const userId = request?.user?.id == null ? null : String(request.user.id);
  const workspaceId = request?.workspace?.id == null ? null : String(request.workspace.id);
  const context = { requestMeta: { request } };
  if (!userId) return { context };
  Object.assign(context, { actor: request.user, permissions: request.permissions || [] });
  if (workspaceId) {
    Object.assign(context, { workspace: request.workspace, membership: request.membership || null });
    context.visibilityContext = { visibility: "workspace_user", scopeKind: "workspace_user", scopeOwnerId: workspaceId, userId, requiresActorScope: true };
  } else {
    context.visibilityContext = { visibility: "user", scopeKind: "user", userId, requiresActorScope: true };
  }
  return { context };
}
