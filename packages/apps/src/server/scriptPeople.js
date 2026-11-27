import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

// Who a script's run is about (D-140): who acted, for a rule on saving, and the person a button's, screen's or job's
// run is for (`people.me()`), each with their role in the home, so an app can keep an approval from its own claimant.

/**
 * @param {object} dependencies
 * @param {(userId: string, options: object) => Promise<string | null>} dependencies.roleOf someone's role in the home,
 *   or null when they aren't in it (the bots' chats records' roleIn)
 */
export function createScriptPeople({ roleOf }) {
  /**
   * Who acted, as a script sees them (D-140): `{ type, id, name, role }`. A person's role in the home ("owner", "admin",
   * "member"…) comes from their signed-in request, else from the home's members; a bot, a script or a visitor has its
   * kind as its role. Never anything the browser or the script sends.
   */
  async function whoActed(actor, options) {
    if (actor?.type !== "person" || !actor.id) {
      const type = actor?.type || "system";
      return { type, id: actor?.id ? String(actor.id) : null, name: actor?.name || "", role: type };
    }
    const signedIn = options?.context?.actor?.id != null && String(options.context.actor.id) === String(actor.id);
    const role = (signedIn ? options.context.membership?.roleSid : null) ?? (await roleOf(String(actor.id), options));
    return { type: "person", id: String(actor.id), name: actor.name || "", role: role ?? null };
  }

  /** The person a run is for (`people.me()`): the member using the app, or the job's person; null for a visitor's. */
  async function personOfRun(ctx, row) {
    if (ctx.visitor) return null;
    const id = row.kind === "job" ? row.runsAsUserId : resolveAuditActorId(ctx.options?.context);
    if (!id) return null;
    const name = row.kind === "job" ? "" : ctx.options?.context?.actor?.displayName || ctx.options?.context?.actor?.name || "";
    const who = await whoActed({ type: "person", id: String(id), name }, ctx.options);
    return { id: who.id, name: who.name, role: who.role };
  }

  return Object.freeze({
    whoActed,
    personOfRun
  });
}
