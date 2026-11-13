// Whose connected accounts a request may reach (D-37), the rule reachableAccounts wrote by hand
// (accounts.js:27-32). plugin_accounts is `workspace_or_shared`: a home's accounts carry its
// workspace_id, a person's own accounts carry none. Ownership lets a request in a home read that
// home's accounts and every account with no home; this policy keeps, of the latter, only the
// caller's own. Together: the home's accounts, and the person's own personal accounts.
//
// A reach's `personal: false` (in a shared bot's room, which everyone sees, the person's own
// accounts may not be used) narrows one request's read, so it stays a filter in the repository
// (`homeOnly`, accounts.js), never part of who may see a row. A job for a person (`{ actorId }`)
// reaches what that person reaches; background work for no one is scoped by ownership alone; an
// anonymous caller reaches none.

/** plugin_accounts: a home's accounts, and the caller's own personal ones. */
export function reachableAccounts({ query, caller, column, value }) {
  if (caller.kind === "anonymous") return false;
  const person = caller.kind === "user" ? caller.userId : caller.actorId;
  if (!person) return true;
  query.where((reach) => reach
    .whereNotNull(column("workspaceId"))
    .orWhere(column("userId"), value("userId", person)));
  return true;
}
