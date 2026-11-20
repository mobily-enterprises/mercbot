// A home's settings for its bots (D-100): one row per home in `home_settings`, made the first time one is set. Its one
// read and its one write are here, with who joined the home for the question its owners and admins are asked, and the
// bots' services reach them through homeDefaults.js. Every method takes the call's options last; the table's ownership
// keeps each read and write in the call's home.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { personName } from "@local/homes/server/personName";
import { createCallerReaders } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/**
 * A home's settings as they're kept: null where nothing was chosen.
 * @typedef {{ newBotSharing: string | null, teamQuestionAnsweredAt: string | null }} HomeSettings
 */

// What a read answers of the home's row.
const FIELDS = Object.freeze(["newBotSharing", "teamQuestionAnsweredAt"]);

/**
 * @param {object} dependencies
 * @param {{ homeSettings: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} dependencies.resources
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@jskit-ai/workspaces-core/server/types").WorkspaceMembershipsRepository} dependencies.memberships the
 *   home's people (`workspaces.memberships`)
 */
export function createHomeSettingsRepository({ resources, systemContext, memberships }) {
  const { homeSettings } = resources;
  const { homeOf } = createCallerReaders(systemContext);

  /**
   * The home's settings, or null while none has been set. One statement.
   * @param {CallOptions} options
   * @returns {Promise<HomeSettings | null>}
   */
  async function read(options) {
    const { records: [row] } = await homeSettings.query({ fields: FIELDS, page: { size: 1 } }, passedOn(options));
    if (!row) return null;
    const answered = row.teamQuestionAnsweredAt;
    return { newBotSharing: row.newBotSharing ?? null, teamQuestionAnsweredAt: answered ? new Date(answered).toISOString() : null };
  }

  /**
   * Sets some of the home's settings, as `person` chose them: one upsert on the home's row (unique on the home), so the
   * first write makes it, and two at once leave one. Settings it isn't given keep their value.
   * @param {Partial<HomeSettings>} changes
   * @param {string} person who chose them
   * @param {CallOptions} options
   */
  async function write(changes, person, options) {
    await homeSettings.createMany([{ ...changes, updatedBy: String(person) }], {
      ...passedOn(options),
      onConflict: { keys: ["workspaceId"], action: "merge" },
      returning: "none"
    });
  }

  /**
   * Who joined the home, as its owners and admins are told: the name of the first of its active people, in the order
   * JSKIT lists them (by name), who is neither its owner (one per home) nor `except`, the person asking; "" when there's
   * nobody else. One read of the home's people, whatever its bots.
   * @param {string} except
   * @param {CallOptions} options
   */
  async function joinedName(except, options) {
    const people = await memberships.listActiveByWorkspaceId(homeOf(options), passedOn(options));
    const joined = people.find((person) => person.roleSid !== "owner" && String(person.userId) !== String(except));
    return joined ? personName(joined) || "Someone" : "";
  }

  return Object.freeze({
    read,
    write,
    joinedName
  });
}
