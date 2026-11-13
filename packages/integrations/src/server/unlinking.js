import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

// Unlinking this copy from its hub (D-31), beside connections.js: who may, and what the home's Activity trail records.

/**
 * Whether the call's person may unlink this copy: the person who linked it, and the owners and admins of a home that
 * person is in, asking from that home; once the linker's account is gone, the owners and admins of any home. Someone
 * who only made a home of their own can't cut everyone else off.
 * @param {{ linkedBy?: string | null }} row the bridge_link row
 * @param {object} options the call's options
 * @param {object} rules
 * @param {(options: object) => boolean} rules.managesHome whether the call's person is an owner or admin of its home
 * @param {(homeId: string, userId: string, options: object) => Promise<boolean>} rules.isMember
 */
export async function mayUnlink(row, options, { managesHome, isMember }) {
  if (row.linkedBy && String(row.linkedBy) === String(resolveActorId(options.context))) return true;
  const homeId = options.context?.workspace?.id;
  if (!homeId || !managesHome(options)) return false;
  return !row.linkedBy || isMember(String(homeId), String(row.linkedBy), options);
}

/**
 * The Activity trail's entry for an unlink by the call's person, named as the apps' own entries name people.
 * @param {{ name: string, hubUrl: string }} row the bridge_link row
 * @param {object} context the call's context
 */
export function unlinkedEntry(row, context) {
  const actor = context.actor || {};
  return {
    actor: { type: "person", id: String(resolveActorId(context)), name: actor.displayName || actor.display_name || actor.username || "Someone" },
    via: { kind: "settings" },
    action: "settings",
    changes: { unlinkedCopy: { name: row.name, hub: String(row.hubUrl).replace(/^https?:\/\//u, "") } }
  };
}
