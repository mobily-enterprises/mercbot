/**
 * Each person's first home is called after them: "Sam's home" (D-36). The
 * `workspaces.personal-workspace-name` capability JSKIT names a new account's
 * personal workspace with.
 * @param {{ displayName?: string, email?: string }} user
 */
export function firstHomeName(user) {
  const first = String(user.displayName || user.email || "").trim().split(/[\s@.]/u)[0];
  return first ? `${first.replace(/^./u, (letter) => letter.toUpperCase())}'s home` : "My home";
}
